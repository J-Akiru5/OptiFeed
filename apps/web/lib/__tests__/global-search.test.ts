import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenancyDb } from "./helpers/tenancy";

/**
 * Global search (#270): role filtering and cross-tenant denial.
 *
 * The action runs against the two-org in-memory database, with the real
 * `getCurrentPermissions`, `getTenantAdminState`, `resolveOrgScope` and
 * `isCurrentPlatformAdmin`. Only the session and the view-as cookie are mocked,
 * so a missing scope filter really does expose org B and fails the test.
 */

const holder = vi.hoisted(() => ({ db: undefined as TenancyDb | undefined }));
const session = vi.hoisted(() => ({
	user: undefined as unknown,
	farm: null as string | null,
}));
const viewAs = vi.hoisted(() => ({
	state: { active: false, reason: "missing" } as Record<string, unknown>,
}));

vi.mock("@/lib/prisma", async () => {
	const { createTenancyDb } = await import("./helpers/tenancy");
	holder.db = createTenancyDb();
	return { default: holder.db.client };
});

vi.mock("@/lib/auth/session", () => ({
	getCurrentUser: vi.fn(async () => session.user),
	getCurrentPondOwnerIdSafe: vi.fn(async () => session.farm),
}));

vi.mock("@/lib/auth/view-as", () => ({
	getViewAsState: vi.fn(async () => viewAs.state),
	assertNotViewingAs: vi.fn(),
	isViewingAs: vi.fn(async () => viewAs.state.active === true),
}));

vi.mock("@/i18n/routing", () => ({
	redirect: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
	getLocale: vi.fn(async () => "en"),
}));

import { globalSearch } from "@/lib/actions/search";
import { pagesFor } from "@/lib/search/catalogue";
import {
	ADMIN_A_ID,
	DEVICE_A_1,
	DEVICE_A_1_LABEL,
	DEVICE_A_1_MAC,
	DEVICE_B_1,
	FARMER_A_ID,
	FARM_B,
	PLATFORM_ADMIN_A_ID,
	POND_A_1,
	POND_A_1_NAME,
	POND_B_1,
	POND_B_1_NAME,
	userById,
} from "./helpers/tenancy";

const TOKEN_A_1 = "tok_SECRET_org_a_one_do_not_leak";
const BATCH_A = "Batch Alpha";
const BATCH_B = "Batch Bravo";
const EVENT_A = "A Pond Sampling";
const EVENT_B = "B Pond Harvest";

function tenancy(): TenancyDb {
	if (!holder.db) throw new Error("tenancy database was not initialised");
	return holder.db;
}

function signInAs(userId: string) {
	const user = userById(tenancy(), userId);
	session.user = user;
	session.farm = user.farmId;
}

beforeEach(() => {
	vi.clearAllMocks();
	tenancy().reset();
	viewAs.state = { active: false, reason: "missing" };
	const tables = tenancy().tables;

	tables.biomassLogs.push(
		{
			id: "batch-a",
			pondId: POND_A_1,
			batchLabel: BATCH_A,
			recordedAt: new Date("2026-10-01T02:00:00.000Z"),
			farmId: "farm-a",
		},
		{
			id: "batch-b",
			pondId: POND_B_1,
			batchLabel: BATCH_B,
			recordedAt: new Date("2026-10-02T02:00:00.000Z"),
			farmId: "farm-b",
		},
	);
	tables.pondEvents.push(
		{
			id: "event-a",
			pondId: POND_A_1,
			title: EVENT_A,
			startsAt: new Date("2026-10-03T02:00:00.000Z"),
			type: "SAMPLING",
			status: "PLANNED",
			farmId: "farm-a",
		},
		{
			id: "event-b",
			pondId: POND_B_1,
			title: EVENT_B,
			startsAt: new Date("2026-10-04T02:00:00.000Z"),
			type: "HARVEST_PLANNED",
			status: "PLANNED",
			farmId: "farm-b",
		},
	);
	tables.feedEvents.push(
		{
			id: "feed-a",
			deviceId: DEVICE_A_1,
			eventType: "feed_dispensed",
			receivedAt: new Date("2026-10-05T02:00:00.000Z"),
			grams: 150,
			source: "scheduled",
			farmId: "farm-a",
		},
		{
			id: "feed-b",
			deviceId: DEVICE_B_1,
			eventType: "feed_dispensed",
			receivedAt: new Date("2026-10-06T02:00:00.000Z"),
			grams: 120,
			source: "scheduled",
			farmId: "farm-b",
		},
	);
});

describe("page catalogue follows the caller's role", () => {
	it("gives a farmer farmer pages only (allow)", async () => {
		signInAs(FARMER_A_ID);
		const result = await globalSearch({ query: "", shell: "farmer" });
		const ids = result.pages.map((page) => page.id);

		expect(result.status).toBe("ok");
		expect(ids).toContain("pages:dashboard");
		expect(ids).toContain("pages:schedule");
		expect(ids).toContain("pages:settings-hardware");
	});

	it("denies a farmer every /admin and /superadmin page", async () => {
		signInAs(FARMER_A_ID);
		const result = await globalSearch({ query: "", shell: "platform" });
		const ids = result.pages.map((page) => page.id);

		expect(ids.some((id) => id.startsWith("pages:admin-"))).toBe(false);
		expect(ids.some((id) => id.startsWith("pages:platform-"))).toBe(false);
	});

	it("gives a tenant admin the admin console but never superadmin-only pages", async () => {
		signInAs(ADMIN_A_ID);
		const result = await globalSearch({ query: "", shell: "admin" });
		const ids = result.pages.map((page) => page.id);

		expect(ids).toContain("pages:admin-devices");
		expect(ids).toContain("pages:admin-members");
		expect(ids.some((id) => id.startsWith("pages:platform-"))).toBe(false);
	});

	it("gives a platform admin the platform console and not the tenant admin console", async () => {
		signInAs(PLATFORM_ADMIN_A_ID);
		const result = await globalSearch({ query: "", shell: "platform" });
		const ids = result.pages.map((page) => page.id);
		const overview = result.pages.find((page) => page.id === "pages:platform-overview");

		expect(ids).toContain("pages:platform-devices");
		expect(ids.some((id) => id.startsWith("pages:admin-"))).toBe(false);
		expect(overview?.keywords).toContain("superadmin");
	});

	it("hides permission-gated pages when the grant is absent", () => {
		const withoutGrants = pagesFor("tenantAdmin", new Set(), "admin").map((page) => page.id);
		const withGrants = pagesFor(
			"tenantAdmin",
			new Set(["manage_members", "manage_farms_ponds"]),
			"admin",
		).map((page) => page.id);

		expect(withoutGrants).not.toContain("pages:admin-members");
		expect(withoutGrants).not.toContain("pages:admin-add-pond");
		expect(withGrants).toContain("pages:admin-members");
		expect(withGrants).toContain("pages:admin-add-pond");
	});
});

describe("data results stay inside the caller's scope", () => {
	it("allows a farmer to find their own pond, device, batch and event", async () => {
		signInAs(FARMER_A_ID);
		const ponds = await globalSearch({ query: "Pond A", shell: "farmer" });
		const devices = await globalSearch({ query: "Feeder A", shell: "farmer" });
		const batches = await globalSearch({ query: "Batch", shell: "farmer" });
		const events = await globalSearch({ query: "Sampling", shell: "farmer" });

		expect(ponds.rows.map((row) => row.title)).toContain(POND_A_1_NAME);
		expect(devices.rows.map((row) => row.title)).toContain(DEVICE_A_1_LABEL);
		expect(batches.rows.map((row) => row.title)).toContain(BATCH_A);
		expect(events.rows.map((row) => row.title)).toContain(EVENT_A);
	});

	it("denies a farmer another organization's pond", async () => {
		signInAs(FARMER_A_ID);
		const result = await globalSearch({ query: "Pond", shell: "farmer" });

		expect(result.rows.map((row) => row.title)).not.toContain(POND_B_1_NAME);
	});

	it("denies a farmer another organization's device (and never returns a token)", async () => {
		signInAs(FARMER_A_ID);
		const result = await globalSearch({ query: "Feeder", shell: "farmer" });
		const text = JSON.stringify(result.rows);

		expect(result.rows.map((row) => row.title)).not.toContain("Feeder B One");
		expect(text).toContain(DEVICE_A_1_LABEL);
		expect(text).toContain(DEVICE_A_1_MAC);
		expect(text).not.toContain(TOKEN_A_1);
		expect(text).not.toContain("token");
	});

	it("denies a farmer another organization's sampling batch and calendar item", async () => {
		signInAs(FARMER_A_ID);
		const batches = await globalSearch({ query: "Batch", shell: "farmer" });
		const events = await globalSearch({ query: "Pond", shell: "farmer" });

		expect(batches.rows.map((row) => row.title)).not.toContain(BATCH_B);
		expect(events.rows.map((row) => row.title)).not.toContain(EVENT_B);
	});

	it("matches feed events by pond name and by farm day, never across orgs", async () => {
		signInAs(FARMER_A_ID);
		const byPond = await globalSearch({ query: "Pond A One", shell: "farmer" });
		const byDate = await globalSearch({ query: "2026-10-05", shell: "farmer" });
		const foreign = await globalSearch({ query: "Pond B One", shell: "farmer" });

		expect(byPond.rows.some((row) => row.id.startsWith("records:feed:"))).toBe(true);
		expect(byDate.rows.some((row) => row.id.startsWith("records:feed:"))).toBe(true);
		expect(foreign.rows).toEqual([]);
	});

	it("never gives a farmer a member result", async () => {
		signInAs(FARMER_A_ID);
		const result = await globalSearch({ query: "Farmer", shell: "farmer" });

		expect(result.rows.filter((row) => row.group === "members")).toHaveLength(0);
	});

	it("gives a tenant admin their own org's members but no other org's member", async () => {
		signInAs(ADMIN_A_ID);
		const own = await globalSearch({ query: "Farmer", shell: "admin" });
		const foreign = await globalSearch({ query: "Farmer B", shell: "admin" });

		expect(own.rows.filter((row) => row.group === "members").map((row) => row.title)).toContain(
			"Farmer A",
		);
		expect(foreign.rows.filter((row) => row.group === "members")).toHaveLength(0);
	});

	it("denies a tenant admin another organization's devices, ponds and records", async () => {
		signInAs(ADMIN_A_ID);
		const result = await globalSearch({ query: "Feeder", shell: "admin" });
		const text = JSON.stringify(result.rows);

		expect(result.rows.map((row) => row.title)).not.toContain("Feeder B One");
		expect(text).not.toContain(POND_B_1_NAME);
		expect(text).not.toContain(BATCH_B);
		expect(text).not.toContain(EVENT_B);
	});
});

describe("platform audience follows the platform-admin rules", () => {
	it("can find entities from every tenant", async () => {
		signInAs(PLATFORM_ADMIN_A_ID);
		const ponds = await globalSearch({ query: "Pond B", shell: "platform" });
		const devices = await globalSearch({ query: "Feeder B", shell: "platform" });

		expect(ponds.rows.map((row) => row.title)).toContain(POND_B_1_NAME);
		expect(devices.rows.map((row) => row.title)).toContain("Feeder B One");
	});

	it("does not leak device tokens", async () => {
		signInAs(PLATFORM_ADMIN_A_ID);
		const result = await globalSearch({ query: "Feeder", shell: "platform" });

		expect(JSON.stringify(result.rows)).not.toContain(TOKEN_A_1);
	});

	it("treats view-as as the viewed farmer, not the platform console", async () => {
		signInAs(PLATFORM_ADMIN_A_ID);
		session.farm = FARM_B;
		viewAs.state = {
			active: true,
			sessionId: "view-1",
			actorUserId: PLATFORM_ADMIN_A_ID,
			orgId: "org-b",
			farmId: FARM_B,
			reason: "support",
			expiresAt: new Date("2026-10-20T09:00:00.000Z"),
		};

		const result = await globalSearch({ query: "Pond", shell: "platform" });

		expect(result.pages.some((page) => page.id.startsWith("pages:platform-"))).toBe(false);
		expect(result.rows.map((row) => row.title)).toContain(POND_B_1_NAME);
		expect(result.rows.map((row) => row.title)).not.toContain(POND_A_1_NAME);
	});
});

describe("empty, quiet failure and edge cases", () => {
	it("returns no data rows for an empty query but keeps suggestions", async () => {
		signInAs(FARMER_A_ID);
		const result = await globalSearch({ query: "   ", shell: "farmer" });

		expect(result.status).toBe("ok");
		expect(result.rows).toEqual([]);
		expect(result.pages.length).toBeGreaterThan(0);
	});

	it("returns an empty result set for no match", async () => {
		signInAs(FARMER_A_ID);
		const result = await globalSearch({ query: "zzzz-no-such-thing", shell: "farmer" });

		expect(result.status).toBe("ok");
		expect(result.rows).toEqual([]);
	});

	it("fails quietly with no stack or query text", async () => {
		signInAs(ADMIN_A_ID);
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.spyOn(tenancy().client.pond, "findMany").mockRejectedValueOnce(
			new Error("SELECT * FROM pond WHERE name = 'secret'"),
		);

		const result = await globalSearch({ query: "secret", shell: "admin" });

		expect(result).toEqual({ status: "unavailable", pages: [], rows: [] });
		expect(error).toHaveBeenCalled();
		error.mockRestore();
	});

	it("returns unavailable with no rows for an unauthenticated caller", async () => {
		session.user = null;
		session.farm = null;
		const result = await globalSearch({ query: "Pond", shell: "farmer" });

		expect(result).toEqual({ status: "unavailable", pages: [], rows: [] });
	});
});
