import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	pondFindMany: vi.fn(),
	eventCount: vi.fn(),
	eventFindMany: vi.fn(),
	eventFindFirst: vi.fn(),
	userFindMany: vi.fn(),
	getOwnerId: vi.fn(),
	pageSize: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		pond: { findMany: mocks.pondFindMany },
		deviceStateEvent: {
			count: mocks.eventCount,
			findMany: mocks.eventFindMany,
			findFirst: mocks.eventFindFirst,
		},
		user: { findMany: mocks.userFindMany },
	},
}));

vi.mock("@/lib/auth/session", () => ({
	getCurrentPondOwnerId: mocks.getOwnerId,
}));

vi.mock("@/lib/settings/platform", () => ({
	getListPageSize: mocks.pageSize,
	LIST_PAGE_SIZE_DEFAULT: 20,
}));

import { getAuditLog } from "@/lib/actions/audit";
import {
	AUDIT_METADATA_LIMIT,
	AUDIT_VISIBILITY_MATRIX,
	buildAuditWhere,
	displayActorLabel,
	formatAuditMetadata,
	indexAuditActors,
	isUserTouch,
	labelForActor,
} from "@/lib/audit/trail";

/**
 * #273 regression coverage for the farmer Audit Trail.
 *
 * Focus: the multi-pond scope bug, actor label mapping for both id conventions,
 * the tenant boundary on actor resolution, system/device fallbacks, the Last
 * touch query, and the bounded metadata preview.
 */

interface TestActor {
	id: string;
	farmId: string;
	email: string;
	displayName: string | null;
	role: string;
}

interface ActorQuery {
	where: {
		farmId: string;
		OR: [{ id: { in: string[] } }, { farmId: { in: string[] } }];
	};
	take: number;
	select: Record<string, boolean>;
}

const OWN_ACTOR: TestActor = {
	id: "user-1",
	farmId: "farm-1",
	email: "juan@pond.optifeed.local",
	displayName: "Nong Juan",
	role: "ADMIN",
};

const FOREIGN_ACTOR: TestActor = {
	id: "user-foreign",
	farmId: "farm-foreign",
	email: "foreign@pond.optifeed.local",
	displayName: "Foreign Farmer",
	role: "OPERATOR",
};

const ALL_ACTORS = [OWN_ACTOR, FOREIGN_ACTOR];

function actorQuery(query: ActorQuery): TestActor[] {
	const ids = new Set([...query.where.OR[0].id.in, ...query.where.OR[1].farmId.in]);
	return ALL_ACTORS.filter(
		(actor) => actor.farmId === query.where.farmId && (ids.has(actor.id) || ids.has(actor.farmId)),
	);
}

function eventRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "evt-1",
		eventType: "settings_changed",
		source: "user",
		actorId: "farm-1",
		deviceTime: null,
		createdAt: new Date("2026-10-28T01:00:00.000Z"),
		metadata: { before: { feedsPerDay: 2 }, after: { feedsPerDay: 3 } },
		device: { id: "dev-1", label: "Feeder 1" },
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getOwnerId.mockResolvedValue("farm-1");
	mocks.pageSize.mockResolvedValue(20);
	mocks.pondFindMany.mockResolvedValue([{ id: "pond-1" }, { id: "pond-2" }]);
	mocks.eventCount.mockResolvedValue(1);
	mocks.eventFindMany.mockResolvedValue([eventRow()]);
	mocks.eventFindFirst.mockResolvedValue(eventRow());
	mocks.userFindMany.mockImplementation(async (query: ActorQuery) => actorQuery(query));
});

describe("farmer audit scope", () => {
	it("queries every ACTIVE pond owned by the caller, not just the first", async () => {
		await getAuditLog();

		expect(mocks.pondFindMany).toHaveBeenCalledWith({
			where: { ownerId: "farm-1", status: "ACTIVE" },
			select: { id: true },
		});
		expect(mocks.eventFindMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { device: { pondId: { in: ["pond-1", "pond-2"] } } },
			}),
		);
	});

	it("never puts another farm's pond or actor in the caller's query", async () => {
		mocks.eventFindMany.mockResolvedValue([
			eventRow({ id: "evt-own", actorId: "farm-1" }),
			eventRow({ id: "evt-stale", actorId: "user-foreign" }),
		]);
		mocks.eventFindFirst.mockResolvedValue(eventRow({ id: "evt-own", actorId: "farm-1" }));

		const result = await getAuditLog();

		const where = mocks.eventFindMany.mock.calls[0]?.[0]?.where as {
			device: { pondId: { in: string[] } };
		};
		expect(where.device.pondId.in).toEqual(["pond-1", "pond-2"]);
		expect(where.device.pondId.in).not.toContain("pond-foreign");

		// The actor query is farm-scoped; a foreign id stays raw and exposes no name.
		expect(mocks.userFindMany).toHaveBeenCalledTimes(1);
		expect(mocks.userFindMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: expect.objectContaining({ farmId: "farm-1" }) }),
		);
		const foreign = result.events.find((event) => event.id === "evt-stale");
		expect(foreign).toMatchObject({
			actorId: "user-foreign",
			actorLabel: "user-foreign",
			actorRole: null,
			actorFarmId: null,
		});
		expect(foreign?.actorLabel).not.toBe(FOREIGN_ACTOR.displayName);
	});

	it("returns an empty result without touching events when no pond is active", async () => {
		mocks.pondFindMany.mockResolvedValue([]);

		const result = await getAuditLog();

		expect(result).toEqual({ events: [], total: 0, page: 1, pageSize: 20, lastTouch: null });
		expect(mocks.eventCount).not.toHaveBeenCalled();
		expect(mocks.eventFindMany).not.toHaveBeenCalled();
	});
});

describe("actor labels", () => {
	it("resolves both actor id conventions in one batch query", async () => {
		mocks.eventFindMany.mockResolvedValue([
			eventRow({ id: "evt-slug", actorId: "farm-1" }),
			eventRow({ id: "evt-id", actorId: "user-1" }),
		]);

		const result = await getAuditLog();

		expect(mocks.userFindMany).toHaveBeenCalledTimes(1);
		expect(mocks.userFindMany).toHaveBeenCalledWith({
			where: {
				farmId: "farm-1",
				OR: [{ id: { in: ["farm-1", "user-1"] } }, { farmId: { in: ["farm-1", "user-1"] } }],
			},
			take: 2,
			select: {
				id: true,
				farmId: true,
				email: true,
				displayName: true,
				role: true,
			},
		});
		for (const event of result.events) {
			expect(event).toMatchObject({
				actorLabel: "Nong Juan",
				actorRole: "ADMIN",
				actorFarmId: "farm-1",
			});
		}
	});

	it("falls back from display name to email to farm id", () => {
		expect(labelForActor({ ...OWN_ACTOR, displayName: "  " })).toBe(OWN_ACTOR.email);
		expect(labelForActor({ ...OWN_ACTOR, displayName: null, email: "" })).toBe("farm-1");
		expect(labelForActor(undefined)).toBeNull();
	});

	it("maps both id conventions to the same actor", () => {
		const byKey = indexAuditActors([OWN_ACTOR]);
		expect(byKey.get("user-1")).toEqual(OWN_ACTOR);
		expect(byKey.get("farm-1")).toEqual(OWN_ACTOR);
	});

	it("uses System, Device and Unknown actor only when no raw actor exists", () => {
		const labels = { system: "System", device: "Device", unknown: "Unknown actor" };

		expect(displayActorLabel({ actorId: null, source: "system", actorLabel: null }, labels)).toBe(
			"System",
		);
		expect(displayActorLabel({ actorId: null, source: "device", actorLabel: null }, labels)).toBe(
			"Device",
		);
		expect(displayActorLabel({ actorId: null, source: "user", actorLabel: null }, labels)).toBe(
			"Unknown actor",
		);
		expect(
			displayActorLabel({ actorId: "user-x", source: "user", actorLabel: "user-x" }, labels),
		).toBe("user-x");
		expect(
			displayActorLabel({ actorId: "user-1", source: "user", actorLabel: "Nong Juan" }, labels),
		).toBe("Nong Juan");
	});
});

describe("last touch", () => {
	it("queries the newest user-touched event and exposes its resolved actor", async () => {
		const result = await getAuditLog();

		expect(mocks.eventFindFirst).toHaveBeenCalledWith({
			where: {
				device: { pondId: { in: ["pond-1", "pond-2"] } },
				OR: [{ actorId: { not: null } }, { source: "user" }],
			},
			orderBy: { id: "desc" },
			include: { device: { select: { id: true, label: true } } },
		});
		expect(result.lastTouch).toMatchObject({
			id: "evt-1",
			eventType: "settings_changed",
			actorLabel: "Nong Juan",
			actorRole: "ADMIN",
			actorFarmId: "farm-1",
			device: { id: "dev-1", label: "Feeder 1" },
		});
	});

	it("keeps the active filter when looking for the last touch", async () => {
		await getAuditLog({ eventTypes: ["manual_trigger"], page: 2 });

		expect(mocks.eventFindFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					device: { pondId: { in: ["pond-1", "pond-2"] } },
					eventType: { in: ["manual_trigger"] },
					OR: [{ actorId: { not: null } }, { source: "user" }],
				},
			}),
		);
	});

	it("renders no summary when there is no user-touched event", async () => {
		mocks.eventFindFirst.mockResolvedValue(null);

		const result = await getAuditLog();

		expect(result.lastTouch).toBeNull();
	});

	it("treats a null actor id as a touch only when the source is user", () => {
		expect(isUserTouch({ actorId: null, source: "system" })).toBe(false);
		expect(isUserTouch({ actorId: null, source: "device" })).toBe(false);
		expect(isUserTouch({ actorId: null, source: "user" })).toBe(true);
		expect(isUserTouch({ actorId: "user-1", source: "device" })).toBe(true);
	});
});

describe("metadata preview", () => {
	it("pretty-prints a small payload unchanged", () => {
		const metadata = { before: { grams: 100 }, after: { grams: 120 } };
		expect(formatAuditMetadata(metadata)).toBe(JSON.stringify(metadata, null, 2));
	});

	it("caps a large payload and marks the truncation", () => {
		const text = formatAuditMetadata({ command: "x".repeat(AUDIT_METADATA_LIMIT * 2) });

		expect(text).not.toBeNull();
		expect(text?.length).toBe(AUDIT_METADATA_LIMIT);
		expect(text?.endsWith("…")).toBe(true);
		expect(text).toContain('"command"');
	});

	it("returns null for empty metadata and a safe fallback for circular data", () => {
		expect(formatAuditMetadata(null)).toBeNull();
		expect(formatAuditMetadata(undefined)).toBeNull();

		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(formatAuditMetadata(circular)).toBe("[unserializable metadata]");
	});

	it("honours a caller-supplied cap", () => {
		expect(formatAuditMetadata({ note: "abcdef" }, 10)).toBe('{\n  "note…');
	});
});

describe("visibility matrix", () => {
	it("keeps the farmer, tenant-admin and platform scopes separate", () => {
		expect(AUDIT_VISIBILITY_MATRIX.farmer).toMatchObject({
			surface: "/dashboard/audit",
			scope: "own_farm",
		});
		expect(AUDIT_VISIBILITY_MATRIX.tenantAdmin).toMatchObject({
			surface: "/admin/audit",
			scope: "organization",
		});
		expect(AUDIT_VISIBILITY_MATRIX.platformAdmin).toMatchObject({
			surface: "/superadmin/operations/audit",
			scope: "platform",
		});
	});

	it("never widens the farmer where clause to an organization", () => {
		const where = buildAuditWhere(["pond-1"]);
		expect(where).toEqual({ device: { pondId: { in: ["pond-1"] } } });
		expect(JSON.stringify(where)).not.toContain("org");
		expect(JSON.stringify(where)).not.toContain("ownerId");
	});
});
