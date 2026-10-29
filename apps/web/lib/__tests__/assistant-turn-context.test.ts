import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The assistant turn snapshot.
 *
 * Every rule here is a read rule: which pond is active, what the feeder looks
 * like right now, and which ids the planner may use. The tests assert the exact
 * query shape (scope, order, cap) and the mapping of each row into the prompt
 * context, including the fail-soft branches that must never break a chat turn.
 */

const mocks = vi.hoisted(() => ({
	getCurrentPondOwnerIdSafe: vi.fn(),
	getActivePondId: vi.fn(),
	resolveCurrentSchedule: vi.fn(),
	pondFindMany: vi.fn(),
	deviceFindFirst: vi.fn(),
	membershipFindFirst: vi.fn(),
	membershipFindMany: vi.fn(),
	pondEventFindMany: vi.fn(),
	userFindMany: vi.fn(),
	organizationFindMany: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
	getCurrentPondOwnerIdSafe: mocks.getCurrentPondOwnerIdSafe,
}));
vi.mock("@/lib/pond-selection", () => ({ getActivePondId: mocks.getActivePondId }));
vi.mock("@/lib/schedule/resolve-current", () => ({
	resolveCurrentSchedule: mocks.resolveCurrentSchedule,
}));
vi.mock("@/lib/prisma", () => ({
	default: {
		pond: { findMany: mocks.pondFindMany },
		energyDevice: { findFirst: mocks.deviceFindFirst },
		membership: {
			findFirst: mocks.membershipFindFirst,
			findMany: mocks.membershipFindMany,
		},
		pondEvent: { findMany: mocks.pondEventFindMany },
		user: { findMany: mocks.userFindMany },
		organization: { findMany: mocks.organizationFindMany },
	},
}));

import type { Permission } from "@/lib/auth/permissions";
import { OFFLINE_THRESHOLD_MS } from "@/lib/constants";
import type { AssistantCaller } from "../assistant/caller";
import { buildAssistantTurnData } from "../assistant/turn-context";

const CALLER: AssistantCaller = {
	userId: "user-1",
	role: "farmer",
	permissions: new Set<Permission>(),
	canWrite: true,
	isPlatformAdmin: false,
	isTenantAdmin: false,
	orgName: null,
};

const TENANT_ADMIN: AssistantCaller = {
	...CALLER,
	role: "owner",
	isTenantAdmin: true,
	orgName: "Org A",
};

const PLATFORM_ADMIN: AssistantCaller = {
	...CALLER,
	role: "superadmin",
	isPlatformAdmin: true,
};

const PONDS = [
	{ id: "pond-1", name: "Pond A", feedsPerDay: 3, feedingRatePct: 3 },
	{ id: "pond-2", name: "Pond B", feedsPerDay: 2, feedingRatePct: 2.5 },
];

const DEVICE = {
	id: "device-1",
	label: "Feeder A",
	isPaused: false,
	feedLevelPercent: 62,
	lastSeenAt: new Date(),
	gramsPerFeeding: 120,
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getCurrentPondOwnerIdSafe.mockResolvedValue("farm-1");
	mocks.getActivePondId.mockResolvedValue(null);
	mocks.pondFindMany.mockResolvedValue(PONDS);
	mocks.deviceFindFirst.mockResolvedValue(DEVICE);
	mocks.resolveCurrentSchedule.mockResolvedValue(null);
	mocks.membershipFindFirst.mockResolvedValue(null);
	mocks.membershipFindMany.mockResolvedValue([]);
	mocks.pondEventFindMany.mockResolvedValue([]);
	mocks.userFindMany.mockResolvedValue([]);
	mocks.organizationFindMany.mockResolvedValue([]);
});

describe("pond selection", () => {
	it("reads only the caller's ACTIVE ponds, oldest first", async () => {
		await buildAssistantTurnData("en", CALLER);

		expect(mocks.pondFindMany).toHaveBeenCalledWith({
			where: { ownerId: "farm-1", status: "ACTIVE" },
			orderBy: { createdAt: "asc" },
			select: { id: true, name: true, feedsPerDay: true, feedingRatePct: true },
		});
	});

	it("honours the pond cookie when it points at one of the caller's ponds", async () => {
		mocks.getActivePondId.mockResolvedValue("pond-2");

		const data = await buildAssistantTurnData("en", CALLER);

		expect(data.pondId).toBe("pond-2");
		expect(data.turn.pondName).toBe("Pond B");
	});

	it("falls back to the oldest pond when the cookie is stale or absent", async () => {
		mocks.getActivePondId.mockResolvedValue("pond-from-another-farm");
		const stale = await buildAssistantTurnData("en", CALLER);

		mocks.getActivePondId.mockResolvedValue(null);
		const absent = await buildAssistantTurnData("en", CALLER);

		expect(stale.pondId).toBe("pond-1");
		expect(absent.pondId).toBe("pond-1");
	});

	it("returns an empty snapshot without pond reads when the caller has no pond", async () => {
		mocks.pondFindMany.mockResolvedValue([]);

		const data = await buildAssistantTurnData("en", CALLER);

		expect(data.pondId).toBeNull();
		expect(data.turn).toMatchObject({
			pondName: null,
			currentGrams: null,
			currentFeedsPerDay: null,
			currentRatePct: null,
			deviceLabel: null,
			deviceOnline: null,
			devicePaused: null,
			hopperLevelPct: null,
			openTasks: [],
		});
		expect(mocks.deviceFindFirst).not.toHaveBeenCalled();
		expect(mocks.resolveCurrentSchedule).not.toHaveBeenCalled();
		expect(mocks.pondEventFindMany).not.toHaveBeenCalled();
	});

	it("does not read ponds at all when the session has no farm", async () => {
		mocks.getCurrentPondOwnerIdSafe.mockResolvedValue(null);

		const data = await buildAssistantTurnData("en", CALLER);

		expect(data.pondId).toBeNull();
		expect(mocks.pondFindMany).not.toHaveBeenCalled();
		// The organization lookup is independent of the farm.
		expect(mocks.membershipFindFirst).toHaveBeenCalled();
	});
});

describe("feeder snapshot", () => {
	it("reads the oldest paired device and copies its live values", async () => {
		const lastSeenAt = new Date(Date.now() - 60_000);
		mocks.deviceFindFirst.mockResolvedValue({ ...DEVICE, lastSeenAt });

		const data = await buildAssistantTurnData("en", CALLER);

		expect(mocks.deviceFindFirst).toHaveBeenCalledWith({
			where: { pondId: "pond-1" },
			orderBy: { createdAt: "asc" },
			select: {
				id: true,
				label: true,
				isPaused: true,
				feedLevelPercent: true,
				lastSeenAt: true,
				gramsPerFeeding: true,
			},
		});
		expect(data.turn).toMatchObject({
			deviceLabel: "Feeder A",
			deviceOnline: true,
			devicePaused: false,
			hopperLevelPct: 62,
			currentGrams: 120,
		});
	});

	it("treats a heartbeat older than the offline window as offline", async () => {
		mocks.deviceFindFirst.mockResolvedValue({
			...DEVICE,
			lastSeenAt: new Date(Date.now() - OFFLINE_THRESHOLD_MS - 1_000),
		});

		const data = await buildAssistantTurnData("en", CALLER);

		expect(data.turn.deviceOnline).toBe(false);
	});

	it("treats a missing heartbeat as offline rather than unknown", async () => {
		mocks.deviceFindFirst.mockResolvedValue({ ...DEVICE, lastSeenAt: null });

		const data = await buildAssistantTurnData("en", CALLER);

		expect(data.turn.deviceOnline).toBe(false);
	});

	it("keeps device fields null for a pond with no feeder", async () => {
		mocks.deviceFindFirst.mockResolvedValue(null);

		const data = await buildAssistantTurnData("en", CALLER);

		expect(data.turn).toMatchObject({
			pondName: "Pond A",
			deviceLabel: null,
			deviceOnline: null,
			devicePaused: null,
			hopperLevelPct: null,
			currentGrams: null,
		});
		expect(mocks.resolveCurrentSchedule).toHaveBeenCalledWith("pond-1", null);
	});
});

describe("schedule resolution", () => {
	it("prefers the resolved schedule over the pond row", async () => {
		mocks.resolveCurrentSchedule.mockResolvedValue({
			scheduleStart: new Date("2026-01-01T06:00:00Z"),
			scheduleEnd: new Date("2026-01-01T18:00:00Z"),
			feedsPerDay: 4,
			feedingRatePct: 3.5,
		});

		const data = await buildAssistantTurnData("en", CALLER);

		expect(mocks.resolveCurrentSchedule).toHaveBeenCalledWith("pond-1", "device-1");
		expect(data.turn.currentFeedsPerDay).toBe(4);
		expect(data.turn.currentRatePct).toBe(3.5);
		// The proposal card shows what a save would actually change.
		expect(data.proposal).toMatchObject({ currentFeedsPerDay: 4, currentRatePct: 3.5 });
	});

	it("falls back to the pond row when no schedule can be resolved", async () => {
		mocks.resolveCurrentSchedule.mockResolvedValue(null);

		const data = await buildAssistantTurnData("en", CALLER);

		expect(data.turn.currentFeedsPerDay).toBe(3);
		expect(data.turn.currentRatePct).toBe(3);
	});
});

describe("open tasks", () => {
	it("reads the next ten planned tasks and renders date-only starts", async () => {
		mocks.pondEventFindMany.mockResolvedValue([
			{ id: "task-1", title: "Clean the net", startsAt: new Date("2026-10-30T09:15:00.000Z") },
			{ id: "task-2", title: "Check aerator", startsAt: new Date("2026-11-02T00:00:00.000Z") },
		]);

		const data = await buildAssistantTurnData("en", CALLER);

		expect(mocks.pondEventFindMany).toHaveBeenCalledWith({
			where: { pondId: "pond-1", kind: "TASK", status: "PLANNED" },
			orderBy: { startsAt: "asc" },
			take: 10,
			select: { id: true, title: true, startsAt: true },
		});
		expect(data.turn.openTasks).toEqual([
			{ id: "task-1", title: "Clean the net", startsAt: "2026-10-30" },
			{ id: "task-2", title: "Check aerator", startsAt: "2026-11-02" },
		]);
	});

	it("degrades to no tasks when the calendar read fails", async () => {
		mocks.pondEventFindMany.mockRejectedValue(new Error("db down"));

		const data = await buildAssistantTurnData("en", CALLER);

		expect(data.turn.openTasks).toEqual([]);
		expect(data.turn.pondName).toBe("Pond A");
	});
});

describe("organization membership", () => {
	it("returns the caller's oldest active membership org", async () => {
		mocks.membershipFindFirst.mockResolvedValue({ orgId: "org-1" });

		const data = await buildAssistantTurnData("en", CALLER);

		expect(mocks.membershipFindFirst).toHaveBeenCalledWith({
			where: { userId: "user-1", revokedAt: null },
			orderBy: { createdAt: "asc" },
			select: { orgId: true },
		});
		expect(data.orgId).toBe("org-1");
	});

	it("treats a membership lookup failure as no organization", async () => {
		mocks.membershipFindFirst.mockRejectedValue(new Error("db down"));

		const data = await buildAssistantTurnData("en", CALLER);

		expect(data.orgId).toBeNull();
	});

	it("does not load members for a non-admin caller", async () => {
		mocks.membershipFindFirst.mockResolvedValue({ orgId: "org-1" });

		const data = await buildAssistantTurnData("en", CALLER);

		expect(mocks.membershipFindMany).not.toHaveBeenCalled();
		expect(data.turn.members).toEqual([]);
	});
});

describe("members list for tenant admins", () => {
	it("resolves display names, falling back to the farm id and then the user id", async () => {
		mocks.membershipFindFirst.mockResolvedValue({ orgId: "org-1" });
		mocks.membershipFindMany.mockResolvedValue([
			{ userId: "u1", role: "OWNER" },
			{ userId: "u2", role: "OPERATOR" },
			{ userId: "u3", role: "VIEWER" },
		]);
		mocks.userFindMany.mockResolvedValue([
			{ id: "u1", displayName: "Maria Cruz", farmId: "farm-1" },
			{ id: "u2", displayName: null, farmId: "farm-2" },
		]);

		const data = await buildAssistantTurnData("en", TENANT_ADMIN);

		expect(mocks.membershipFindMany).toHaveBeenCalledWith({
			where: { orgId: "org-1", revokedAt: null },
			orderBy: { createdAt: "asc" },
			select: { userId: true, role: true },
		});
		expect(mocks.userFindMany).toHaveBeenCalledWith({
			where: { id: { in: ["u1", "u2", "u3"] } },
			select: { id: true, displayName: true, farmId: true },
		});
		expect(data.turn.members).toEqual([
			{ userId: "u1", name: "Maria Cruz", role: "OWNER" },
			{ userId: "u2", name: "farm-2", role: "OPERATOR" },
			{ userId: "u3", name: "u3", role: "VIEWER" },
		]);
	});

	it("asks for each user id once but keeps one member row per membership", async () => {
		mocks.membershipFindFirst.mockResolvedValue({ orgId: "org-1" });
		mocks.membershipFindMany.mockResolvedValue([
			{ userId: "u1", role: "OWNER" },
			{ userId: "u1", role: "ADMIN" },
		]);
		mocks.userFindMany.mockResolvedValue([
			{ id: "u1", displayName: "Maria Cruz", farmId: "farm-1" },
		]);

		const data = await buildAssistantTurnData("en", TENANT_ADMIN);

		expect(mocks.userFindMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: { in: ["u1"] } } }),
		);
		expect(data.turn.members).toEqual([
			{ userId: "u1", name: "Maria Cruz", role: "OWNER" },
			{ userId: "u1", name: "Maria Cruz", role: "ADMIN" },
		]);
	});

	it("loads members even when the caller has no pond", async () => {
		mocks.pondFindMany.mockResolvedValue([]);
		mocks.membershipFindFirst.mockResolvedValue({ orgId: "org-1" });
		mocks.membershipFindMany.mockResolvedValue([{ userId: "u1", role: "OWNER" }]);
		mocks.userFindMany.mockResolvedValue([
			{ id: "u1", displayName: "Maria Cruz", farmId: "farm-1" },
		]);

		const data = await buildAssistantTurnData("en", TENANT_ADMIN);

		expect(data.turn.members).toEqual([{ userId: "u1", name: "Maria Cruz", role: "OWNER" }]);
	});

	it("degrades to no members when the member read fails", async () => {
		mocks.membershipFindFirst.mockResolvedValue({ orgId: "org-1" });
		mocks.membershipFindMany.mockRejectedValue(new Error("db down"));

		const data = await buildAssistantTurnData("en", TENANT_ADMIN);

		expect(data.turn.members).toEqual([]);
	});
});

describe("organizations for platform admins", () => {
	it("lists the first fifty organizations by name", async () => {
		mocks.organizationFindMany.mockResolvedValue([
			{ id: "org-1", name: "Org A", status: "ACTIVE" },
			{ id: "org-2", name: "Org B", status: "SUSPENDED" },
		]);

		const data = await buildAssistantTurnData("en", PLATFORM_ADMIN);

		expect(mocks.organizationFindMany).toHaveBeenCalledWith({
			orderBy: { name: "asc" },
			take: 50,
			select: { id: true, name: true, status: true },
		});
		expect(data.turn.organizations).toEqual([
			{ id: "org-1", name: "Org A", status: "ACTIVE" },
			{ id: "org-2", name: "Org B", status: "SUSPENDED" },
		]);
	});

	it("does not list organizations for a tenant-only caller", async () => {
		const data = await buildAssistantTurnData("en", TENANT_ADMIN);

		expect(mocks.organizationFindMany).not.toHaveBeenCalled();
		expect(data.turn.organizations).toEqual([]);
	});

	it("degrades to no organizations when the read fails", async () => {
		mocks.organizationFindMany.mockRejectedValue(new Error("db down"));

		const data = await buildAssistantTurnData("en", PLATFORM_ADMIN);

		expect(data.turn.organizations).toEqual([]);
	});
});

describe("prompt and proposal context", () => {
	it("carries the locale, org name and proposal values through unchanged", async () => {
		mocks.getActivePondId.mockResolvedValue("pond-2");

		const data = await buildAssistantTurnData("hil", {
			...CALLER,
			orgName: "Org A",
		});

		expect(data.turn.locale).toBe("hil");
		expect(data.turn.orgName).toBe("Org A");
		expect(data.proposal).toEqual({
			pondName: "Pond B",
			orgName: "Org A",
			deviceLabel: "Feeder A",
			currentGrams: 120,
			currentFeedsPerDay: 2,
			currentRatePct: 2.5,
		});
	});
});
