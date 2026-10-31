import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ count: vi.fn(), findMany: vi.fn(), create: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
	default: new Proxy(
		{},
		{ get: () => ({ count: mocks.count, findMany: mocks.findMany, create: mocks.create }) },
	),
}));

// The caps are constants in production; this file shrinks the byte cap so the
// mid-stream guard is provable without generating 64 MB.
vi.mock("@/lib/backup/constants", () => ({
	BACKUP_SQL_FORMAT_VERSION: 1,
	BACKUP_EXPORT_MAX_ROWS: 250_000,
	BACKUP_EXPORT_MAX_BYTES: 10,
	BACKUP_EXPORT_BATCH: 500,
	BACKUP_EXPORT_TIMEOUT_MS: 120_000,
	BACKUP_TRAILER_MARKER: "-- === END OF EXPORT ===",
	BACKUP_STEP_UP_REQUIRED_CODE: "step_up_required",
}));

import { createBackupExportResponse, prepareBackupExport } from "@/lib/backup/export";
import type { TenantExportScope } from "@/lib/backup/scope";

const SCOPE: TenantExportScope = {
	kind: "tenant",
	orgIds: ["org-1"],
	orgNames: ["CICT Farm"],
	memberUserIds: ["user-1"],
	farmIds: ["farm-1"],
	pondIds: ["pond-1"],
	membershipIds: ["membership-1"],
};

beforeEach(() => {
	mocks.count.mockReset().mockResolvedValue(0);
	mocks.findMany.mockReset().mockResolvedValue([]);
	mocks.create.mockReset().mockResolvedValue({});
});

describe("streaming byte cap", () => {
	it("stops the stream and audits the failure once the cap is passed", async () => {
		mocks.findMany.mockResolvedValueOnce([
			{
				id: "user-1",
				supabaseId: "11111111-1111-1111-1111-111111111111",
				farmId: "cict-farm",
				email: "owner@example.com",
				displayName: null,
				role: "OWNER",
			},
		]);

		const prepared = await prepareBackupExport(SCOPE);
		const response = createBackupExportResponse(
			{
				scope: SCOPE,
				actorUserId: "user-1",
				actorLabel: "Owner One",
				reason: "Monthly backup",
				stepUpAt: null,
				temporaryGrant: false,
				origin: { ip: null, userAgent: null },
			},
			prepared,
		);

		await expect(response.text()).rejects.toThrow();

		expect(mocks.create).toHaveBeenCalledTimes(1);
		const audit = mocks.create.mock.calls[0][0].data;
		expect(audit.after.outcome).toBe("failed");
		expect(audit.after.error).toContain("size limit");
		expect(audit.after.sha256).toBeNull();
	});
});
