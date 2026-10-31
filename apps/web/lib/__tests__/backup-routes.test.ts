import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getSession: vi.fn(),
	getCurrentUser: vi.fn(),
	isTenantAdmin: vi.fn(),
	isPlatformAdmin: vi.fn(),
	isViewingAs: vi.fn(),
	requireStepUp: vi.fn(),
	requestOrigin: vi.fn(),
	actorContext: vi.fn(),
	rateLimit: vi.fn(),
	resolveTenantScope: vi.fn(),
	prepare: vi.fn(),
	createResponse: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: {} }));

vi.mock("@/lib/auth/session", () => ({
	getVerifiedSession: mocks.getSession,
	getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@/lib/auth/tenant-admin", () => ({ isCurrentTenantAdmin: mocks.isTenantAdmin }));
vi.mock("@/lib/auth/require-platform-admin", () => ({
	isCurrentPlatformAdmin: mocks.isPlatformAdmin,
}));
vi.mock("@/lib/auth/view-as", () => ({ isViewingAs: mocks.isViewingAs }));

vi.mock("@/lib/auth/step-up", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/auth/step-up")>();
	return { ...actual, requireStepUp: mocks.requireStepUp };
});

vi.mock("@/lib/actions/platform/audit", () => ({
	requestOrigin: mocks.requestOrigin,
	actorContext: mocks.actorContext,
}));

vi.mock("@/lib/rate-limit", () => ({ checkBackupExportRateLimit: mocks.rateLimit }));

vi.mock("@/lib/backup/scope", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/backup/scope")>();
	return { ...actual, resolveTenantExportScope: mocks.resolveTenantScope };
});

vi.mock("@/lib/backup/export", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/backup/export")>();
	return {
		...actual,
		prepareBackupExport: mocks.prepare,
		createBackupExportResponse: mocks.createResponse,
	};
});

import { POST as adminExport } from "@/app/api/admin/backup/export/route";
import { POST as platformExport } from "@/app/api/superadmin/backup/export/route";
import { StepUpRequiredError } from "@/lib/auth/step-up";
import { BackupExportTooLargeError } from "@/lib/backup/export";
import { EMPTY_TENANT_SCOPE } from "@/lib/backup/scope";

/**
 * Route guards for both exports (issue #353).
 *
 * Every refusal is a status the UI can explain: no session, wrong role,
 * view-as, missing step-up, bad reason, rate limit and an over-size export.
 */

const USER = { id: "user-1", email: "owner@example.com", farmId: "cict", displayName: "Owner One" };
const SCOPE = {
	kind: "tenant" as const,
	orgIds: ["org-1"],
	orgNames: ["CICT Farm"],
	memberUserIds: ["user-1"],
	farmIds: ["farm-1"],
	pondIds: ["pond-1"],
	membershipIds: ["membership-1"],
};

function post(path: string, body: unknown = {}): Request {
	return new Request(`http://localhost${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

async function errorBody(
	response: Response,
): Promise<{ error: { code: string; message: string; details?: unknown } }> {
	return (await response.json()) as { error: { code: string; message: string; details?: unknown } };
}

beforeEach(() => {
	mocks.getSession.mockReset().mockResolvedValue({ sub: "supabase-1", email: "owner@example.com" });
	mocks.getCurrentUser.mockReset().mockResolvedValue({ ...USER, mustChangePassword: false });
	mocks.isTenantAdmin.mockReset().mockResolvedValue(true);
	mocks.isPlatformAdmin.mockReset().mockResolvedValue(true);
	mocks.isViewingAs.mockReset().mockResolvedValue(false);
	mocks.requireStepUp.mockReset().mockResolvedValue(new Date("2026-10-31T07:00:00.000Z"));
	mocks.requestOrigin.mockReset().mockResolvedValue({ ip: "203.0.113.9", userAgent: "vitest" });
	mocks.actorContext.mockReset().mockResolvedValue({ id: "user-1", temporaryGrant: true });
	mocks.rateLimit.mockReset().mockResolvedValue({ success: true, remaining: 4 });
	mocks.resolveTenantScope.mockReset().mockResolvedValue(SCOPE);
	mocks.prepare
		.mockReset()
		.mockResolvedValue({ tables: [], counts: {}, totalRows: 3, filename: "backup.sql" });
	mocks.createResponse.mockReset().mockReturnValue(
		new Response("-- sql", {
			headers: { "content-type": "application/sql", "cache-control": "no-store" },
		}),
	);
});

describe("POST /api/admin/backup/export", () => {
	it("rejects an unauthenticated caller", async () => {
		mocks.getSession.mockResolvedValue(null);
		const response = await adminExport(post("/api/admin/backup/export"));
		expect(response.status).toBe(401);
	});

	it("rejects a caller who must still change their password", async () => {
		mocks.getCurrentUser.mockResolvedValue({ ...USER, mustChangePassword: true });
		expect((await adminExport(post("/api/admin/backup/export"))).status).toBe(403);
	});

	it("rejects a non-admin member", async () => {
		mocks.isTenantAdmin.mockResolvedValue(false);
		expect((await adminExport(post("/api/admin/backup/export"))).status).toBe(403);
	});

	it("rejects a read-only view-as session", async () => {
		mocks.isViewingAs.mockResolvedValue(true);
		const response = await adminExport(post("/api/admin/backup/export"));
		expect(response.status).toBe(403);
		expect((await errorBody(response)).error.message).toContain("view-as");
	});

	it("rejects the sixth export in an hour", async () => {
		mocks.rateLimit.mockResolvedValue({ success: false, remaining: 0 });
		const response = await adminExport(post("/api/admin/backup/export"));
		expect(response.status).toBe(429);
		expect(response.headers.get("retry-after")).toBe("3600");
		expect((await errorBody(response)).error.message).toContain("5 exports per hour");
	});

	it("rejects a reason that is not text", async () => {
		const response = await adminExport(post("/api/admin/backup/export", { reason: 42 }));
		expect(response.status).toBe(400);
	});

	it("refuses when the caller administers no organization", async () => {
		mocks.resolveTenantScope.mockResolvedValue(EMPTY_TENANT_SCOPE);
		const response = await adminExport(post("/api/admin/backup/export"));
		expect(response.status).toBe(403);
		expect(mocks.prepare).not.toHaveBeenCalled();
	});

	it("streams a scoped export and records the caller and reason", async () => {
		const response = await adminExport(
			post("/api/admin/backup/export", { reason: "  Quarterly backup  " }),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(mocks.prepare).toHaveBeenCalledWith(SCOPE);
		expect(mocks.createResponse).toHaveBeenCalledWith(
			expect.objectContaining({
				scope: SCOPE,
				actorUserId: "user-1",
				actorLabel: "Owner One",
				reason: "Quarterly backup",
				stepUpAt: null,
				temporaryGrant: false,
				origin: { ip: "203.0.113.9", userAgent: "vitest" },
			}),
			expect.objectContaining({ filename: "backup.sql" }),
		);
	});

	it("uses a default reason when the tenant operator leaves it blank", async () => {
		await adminExport(post("/api/admin/backup/export", { reason: "   " }));
		expect(mocks.createResponse.mock.calls[0][0].reason).toContain("admin Backup page");
	});

	it("answers 413 with the observed row count when the export is too large", async () => {
		mocks.prepare.mockRejectedValueOnce(new BackupExportTooLargeError(300_000));
		const response = await adminExport(post("/api/admin/backup/export"));
		expect(response.status).toBe(413);
		expect((await errorBody(response)).error.message).toContain("300,000");
	});
});

describe("POST /api/superadmin/backup/export", () => {
	it("rejects an unauthenticated caller", async () => {
		mocks.getSession.mockResolvedValue(null);
		expect((await platformExport(post("/api/superadmin/backup/export"))).status).toBe(401);
	});

	it("rejects a non-platform admin", async () => {
		mocks.isPlatformAdmin.mockResolvedValue(false);
		expect((await platformExport(post("/api/superadmin/backup/export"))).status).toBe(403);
	});

	it("rejects a read-only view-as session", async () => {
		mocks.isViewingAs.mockResolvedValue(true);
		expect((await platformExport(post("/api/superadmin/backup/export"))).status).toBe(403);
	});

	it("asks for a step-up check when the cookie is missing", async () => {
		mocks.requireStepUp.mockRejectedValueOnce(new StepUpRequiredError("missing"));
		const response = await platformExport(post("/api/superadmin/backup/export"));
		expect(response.status).toBe(403);
		const body = await errorBody(response);
		expect((body.error.details as { code?: string }).code).toBe("step_up_required");
		expect(mocks.prepare).not.toHaveBeenCalled();
	});

	it("rejects the sixth export in an hour", async () => {
		mocks.rateLimit.mockResolvedValue({ success: false, remaining: 0 });
		expect((await platformExport(post("/api/superadmin/backup/export"))).status).toBe(429);
	});

	it("requires a reason of at least ten characters", async () => {
		expect((await platformExport(post("/api/superadmin/backup/export"))).status).toBe(400);
		const response = await platformExport(
			post("/api/superadmin/backup/export", { reason: "too short" }),
		);
		expect(response.status).toBe(400);
		expect((await errorBody(response)).error.message).toContain("required");
	});

	it("streams the full database with the step-up time and temporary grant", async () => {
		const response = await platformExport(
			post("/api/superadmin/backup/export", { reason: "Before the schema migration" }),
		);

		expect(response.status).toBe(200);
		expect(mocks.requireStepUp).toHaveBeenCalled();
		expect(mocks.prepare).toHaveBeenCalledWith({ kind: "platform" });
		expect(mocks.createResponse).toHaveBeenCalledWith(
			expect.objectContaining({
				scope: { kind: "platform" },
				actorUserId: "user-1",
				reason: "Before the schema migration",
				stepUpAt: new Date("2026-10-31T07:00:00.000Z"),
				temporaryGrant: true,
			}),
			expect.anything(),
		);
	});

	it("answers 413 when the platform export is too large", async () => {
		mocks.prepare.mockRejectedValueOnce(new BackupExportTooLargeError(300_000));
		const response = await platformExport(
			post("/api/superadmin/backup/export", { reason: "Before the schema migration" }),
		);
		expect(response.status).toBe(413);
	});
});
