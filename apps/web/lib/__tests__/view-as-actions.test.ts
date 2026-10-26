import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
	cookies: vi.fn(async () => ({
		get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
		set: (name: string, value: string) => {
			jar.set(name, value);
		},
		delete: (name: string) => {
			jar.delete(name);
		},
	})),
	headers: vi.fn(
		async () => new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1", "user-agent": "vitest" }),
	),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db, tx } = vi.hoisted(() => {
	const tx = {
		impersonationSession: {
			findMany: vi.fn(),
			updateMany: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
		},
		platformAuditLog: { create: vi.fn() },
	};
	const db = {
		organization: { findFirst: vi.fn(), findUnique: vi.fn() },
		membership: { findMany: vi.fn() },
		user: { findMany: vi.fn() },
		pond: { findMany: vi.fn() },
		platformAdmin: { findUnique: vi.fn() },
		impersonationSession: { findUnique: vi.fn() },
		$transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
	};
	return { db, tx };
});

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth/require-platform-admin", () => ({ requirePlatformAdmin: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/auth/step-up", () => ({
	withStepUp: vi.fn(async (action: (stepUpAt: Date) => Promise<unknown>) =>
		action(new Date("2026-10-26T00:00:00.000Z")),
	),
	isStepUpRequiredError: (error: unknown) =>
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === "step_up_required",
}));

import { getViewAsBanner, startViewAs, stopViewAs } from "@/lib/actions/platform/impersonation";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { getCurrentUser } from "@/lib/auth/session";
import { withStepUp } from "@/lib/auth/step-up";
import {
	VIEW_AS_COOKIE,
	VIEW_AS_MODE,
	VIEW_AS_TTL_MS,
	createViewAsToken,
} from "@/lib/auth/view-as";
import { revalidatePath } from "next/cache";

const mockGate = vi.mocked(requirePlatformAdmin);
const mockUser = vi.mocked(getCurrentUser);
const mockWithStepUp = vi.mocked(withStepUp);

const REASON = "Support call about a feeder that will not dispense";
const ACTOR = "admin-1";
const STEP_UP_AT = new Date("2026-10-26T00:00:00.000Z");

const originalSecret = process.env.SUPABASE_SERVICE_ROLE_KEY;

beforeAll(() => {
	process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
});

afterAll(() => {
	if (originalSecret === undefined) {
		Reflect.deleteProperty(process.env, "SUPABASE_SERVICE_ROLE_KEY");
	} else {
		process.env.SUPABASE_SERVICE_ROLE_KEY = originalSecret;
	}
});

function allowOrgAFarmA() {
	db.organization.findFirst.mockResolvedValue({ id: "org-a", name: "Org A" });
	db.membership.findMany.mockResolvedValue([
		{ userId: "u-owner", role: "OWNER", createdAt: new Date("2026-01-01") },
	]);
	db.user.findMany.mockResolvedValue([{ id: "u-owner", farmId: "farm-a" }]);
	db.pond.findMany.mockResolvedValue([{ ownerId: "farm-a" }]);
	db.platformAdmin.findUnique.mockResolvedValue({ expiresAt: null });
	tx.impersonationSession.findMany.mockResolvedValue([]);
	tx.impersonationSession.updateMany.mockResolvedValue({ count: 0 });
	tx.impersonationSession.create.mockResolvedValue({ id: "sess-1" });
	tx.platformAuditLog.create.mockResolvedValue({});
}

function auditRows() {
	return tx.platformAuditLog.create.mock.calls.map((call) => call[0].data);
}

beforeEach(() => {
	vi.clearAllMocks();
	jar.clear();
	mockGate.mockResolvedValue(undefined);
	mockUser.mockResolvedValue({ id: ACTOR } as Awaited<ReturnType<typeof getCurrentUser>>);
	db.$transaction.mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
});

describe("startViewAs", () => {
	it("denies a caller who is not a platform admin", async () => {
		mockGate.mockRejectedValue(new Error("NEXT_REDIRECT"));

		await expect(startViewAs({ orgId: "org-a", reason: REASON })).rejects.toThrow("NEXT_REDIRECT");
		expect(db.organization.findFirst).not.toHaveBeenCalled();
		expect(tx.impersonationSession.create).not.toHaveBeenCalled();
	});

	it("requires a reason", async () => {
		const result = await startViewAs({ orgId: "org-a", reason: "short" });
		expect(result).toEqual({ error: expect.stringContaining("reason") });
		expect(db.organization.findFirst).not.toHaveBeenCalled();
	});

	it("rejects an organization that is not ACTIVE", async () => {
		allowOrgAFarmA();
		db.organization.findFirst.mockResolvedValue(null);

		const result = await startViewAs({ orgId: "org-a", reason: REASON });

		expect(result).toEqual({ error: "Choose an active organization." });
		expect(db.membership.findMany).not.toHaveBeenCalled();
	});

	it("rejects an organization with no farm to view", async () => {
		allowOrgAFarmA();
		db.membership.findMany.mockResolvedValue([]);

		const result = await startViewAs({ orgId: "org-a", reason: REASON });

		expect(result).toEqual({
			error: "This organization has no farm to view yet. Add a member with a farm first.",
		});
		expect(tx.impersonationSession.create).not.toHaveBeenCalled();
	});

	it("requires a fresh step-up and writes no session without one", async () => {
		allowOrgAFarmA();
		mockWithStepUp.mockRejectedValueOnce(
			Object.assign(new Error("Re-enter your password to continue."), {
				code: "step_up_required",
			}),
		);

		const result = await startViewAs({ orgId: "org-a", reason: REASON });

		expect(result).toMatchObject({ code: "step_up_required" });
		expect(tx.impersonationSession.create).not.toHaveBeenCalled();
		expect(tx.platformAuditLog.create).not.toHaveBeenCalled();
		expect(jar.has(VIEW_AS_COOKIE)).toBe(false);
	});

	it("creates a 30-minute READ_ONLY session, audits the start and sets the cookie", async () => {
		allowOrgAFarmA();

		const result = await startViewAs({ orgId: "org-a", reason: REASON });

		expect(result).toMatchObject({
			success: true,
			orgId: "org-a",
			orgName: "Org A",
			farmId: "farm-a",
		});

		const created = tx.impersonationSession.create.mock.calls[0][0].data;
		expect(created).toMatchObject({
			actorUserId: ACTOR,
			orgId: "org-a",
			mode: VIEW_AS_MODE,
			reason: REASON,
		});
		expect(created.expiresAt.getTime() - created.startedAt.getTime()).toBe(VIEW_AS_TTL_MS);

		const rows = auditRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			actorUserId: ACTOR,
			action: "platform.impersonation.start",
			targetType: "organization",
			targetId: "org-a",
			orgId: "org-a",
			reason: REASON,
			stepUpAt: STEP_UP_AT,
			impersonationId: "sess-1",
			ip: "203.0.113.9",
			userAgent: "vitest",
		});
		expect(rows[0].after).toMatchObject({ mode: VIEW_AS_MODE, farmId: "farm-a" });

		expect(jar.has(VIEW_AS_COOKIE)).toBe(true);
		expect(revalidatePath).toHaveBeenCalled();
	});

	it("prefers a farm that owns a pond and closes/audits a previous open session", async () => {
		allowOrgAFarmA();
		db.membership.findMany.mockResolvedValue([
			{ userId: "u-viewer", role: "VIEWER", createdAt: new Date("2026-01-01") },
			{ userId: "u-owner", role: "OWNER", createdAt: new Date("2026-01-02") },
		]);
		db.user.findMany.mockResolvedValue([
			{ id: "u-viewer", farmId: "farm-empty" },
			{ id: "u-owner", farmId: "farm-a" },
		]);
		db.pond.findMany.mockResolvedValue([{ ownerId: "farm-a" }]);
		tx.impersonationSession.findMany.mockResolvedValue([
			{ id: "sess-old", orgId: "org-old", reason: "Previous look" },
		]);

		const result = await startViewAs({ orgId: "org-a", reason: REASON });

		expect(result).toMatchObject({ success: true, farmId: "farm-a" });
		expect(tx.impersonationSession.updateMany).toHaveBeenCalledWith({
			where: { id: { in: ["sess-old"] } },
			data: { endedAt: expect.any(Date) },
		});
		const actions = auditRows().map((row) => row.action);
		expect(actions).toEqual(["platform.impersonation.stop", "platform.impersonation.start"]);
		expect(auditRows()[0]).toMatchObject({
			impersonationId: "sess-old",
			orgId: "org-old",
			after: { superseded: true },
		});
	});
});

describe("stopViewAs", () => {
	function openSession(overrides: Record<string, unknown> = {}) {
		return {
			id: "sess-1",
			actorUserId: ACTOR,
			orgId: "org-a",
			reason: REASON,
			endedAt: null,
			...overrides,
		};
	}

	it("ends the session, audits the stop and clears the cookie", async () => {
		jar.set(
			VIEW_AS_COOKIE,
			createViewAsToken(
				{ sid: "sess-1", actorUserId: ACTOR, orgId: "org-a", farmId: "farm-a" },
				new Date(),
			),
		);
		db.impersonationSession.findUnique.mockResolvedValue(openSession());
		tx.impersonationSession.update.mockResolvedValue({});
		tx.platformAuditLog.create.mockResolvedValue({});

		const result = await stopViewAs();

		expect(result).toEqual({ success: true });
		expect(tx.impersonationSession.update).toHaveBeenCalledWith({
			where: { id: "sess-1" },
			data: { endedAt: expect.any(Date) },
		});

		const rows = auditRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			actorUserId: ACTOR,
			action: "platform.impersonation.stop",
			targetType: "organization",
			targetId: "org-a",
			orgId: "org-a",
			impersonationId: "sess-1",
		});
		expect(jar.has(VIEW_AS_COOKIE)).toBe(false);
	});

	it("is a safe no-op without a session cookie", async () => {
		const result = await stopViewAs();

		expect(result).toEqual({ success: true });
		expect(db.impersonationSession.findUnique).not.toHaveBeenCalled();
		expect(tx.impersonationSession.update).not.toHaveBeenCalled();
	});

	it("closes and audits a session whose 30 minutes already elapsed", async () => {
		const issuedAt = new Date(Date.now() - VIEW_AS_TTL_MS - 60_000);
		jar.set(
			VIEW_AS_COOKIE,
			createViewAsToken(
				{ sid: "sess-1", actorUserId: ACTOR, orgId: "org-a", farmId: "farm-a" },
				issuedAt,
			),
		);
		db.impersonationSession.findUnique.mockResolvedValue(openSession());
		tx.impersonationSession.update.mockResolvedValue({});
		tx.platformAuditLog.create.mockResolvedValue({});

		const result = await stopViewAs();

		expect(result).toEqual({ success: true });
		expect(tx.impersonationSession.update).toHaveBeenCalledWith({
			where: { id: "sess-1" },
			data: { endedAt: expect.any(Date) },
		});
		expect(auditRows()[0]).toMatchObject({ action: "platform.impersonation.stop" });
		expect(jar.has(VIEW_AS_COOKIE)).toBe(false);
	});

	it("never ends another admin's session", async () => {
		jar.set(
			VIEW_AS_COOKIE,
			createViewAsToken(
				{ sid: "sess-1", actorUserId: ACTOR, orgId: "org-a", farmId: "farm-a" },
				new Date(),
			),
		);
		db.impersonationSession.findUnique.mockResolvedValue(openSession({ actorUserId: "admin-2" }));

		const result = await stopViewAs();

		expect(result).toEqual({ success: true });
		expect(tx.impersonationSession.update).not.toHaveBeenCalled();
		expect(jar.has(VIEW_AS_COOKIE)).toBe(false);
	});

	it("rejects an unauthenticated caller", async () => {
		mockUser.mockResolvedValue(null);

		const result = await stopViewAs();

		expect(result).toEqual({ error: "Not authenticated." });
	});
});

describe("getViewAsBanner", () => {
	it("returns the org name, reason and expiry for a live session", async () => {
		jar.set(
			VIEW_AS_COOKIE,
			createViewAsToken(
				{ sid: "sess-1", actorUserId: ACTOR, orgId: "org-a", farmId: "farm-a" },
				new Date(),
			),
		);
		db.impersonationSession.findUnique.mockResolvedValue({
			actorUserId: ACTOR,
			orgId: "org-a",
			mode: VIEW_AS_MODE,
			reason: REASON,
			expiresAt: new Date(Date.now() + 60_000),
			endedAt: null,
		});
		db.platformAdmin.findUnique.mockResolvedValue({ revokedAt: null, expiresAt: null });
		db.organization.findUnique.mockResolvedValue({ id: "org-a", name: "Org A" });

		await expect(getViewAsBanner()).resolves.toMatchObject({
			orgName: "Org A",
			reason: REASON,
		});
	});

	it("returns null without a session", async () => {
		await expect(getViewAsBanner()).resolves.toBeNull();
	});
});
