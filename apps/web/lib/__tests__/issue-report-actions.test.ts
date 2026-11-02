import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	findUnique: vi.fn(),
	update: vi.fn(),
	transaction: vi.fn(),
	gate: vi.fn(),
	actorContext: vi.fn(),
	writePlatformAudit: vi.fn(),
	revalidatePath: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		$transaction: mocks.transaction,
	},
}));

vi.mock("@/lib/auth/require-platform-admin", () => ({
	requirePlatformAdmin: mocks.gate,
}));

vi.mock("@/lib/actions/platform/audit", () => ({
	actorContext: mocks.actorContext,
	writePlatformAudit: mocks.writePlatformAudit,
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { resolveIssueReport } from "@/lib/actions/reports";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.gate.mockResolvedValue(undefined);
	mocks.actorContext.mockResolvedValue({ id: "admin-1", temporaryGrant: false });
	mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
		callback({
			issueReport: {
				findUnique: mocks.findUnique,
				update: mocks.update,
			},
		}),
	);
});

describe("resolveIssueReport", () => {
	it("denies a caller without an active PlatformAdmin row", async () => {
		mocks.gate.mockRejectedValue(new Error("NEXT_REDIRECT"));

		await expect(resolveIssueReport("rep-1")).rejects.toThrow("NEXT_REDIRECT");

		expect(mocks.transaction).not.toHaveBeenCalled();
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it("allows a platform admin and records the resolve in the audit log", async () => {
		mocks.findUnique.mockResolvedValue({ id: "rep-1", status: "OPEN" });

		const result = await resolveIssueReport("rep-1");

		expect(result).toEqual({ success: true });
		expect(mocks.update).toHaveBeenCalledWith({
			where: { id: "rep-1" },
			data: {
				status: "RESOLVED",
				resolvedAt: expect.any(Date),
				resolvedBy: "admin-1",
			},
		});
		expect(mocks.writePlatformAudit).toHaveBeenCalledTimes(1);
		expect(mocks.writePlatformAudit).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				actorUserId: "admin-1",
				action: "platform.issue_report.resolve",
				targetType: "issue_report",
				targetId: "rep-1",
			}),
		);
		expect(mocks.revalidatePath).toHaveBeenCalledWith(
			"/[locale]/(superadmin)/superadmin/operations/reports",
			"page",
		);
	});

	it("is idempotent and does not write a second audit row", async () => {
		mocks.findUnique.mockResolvedValue({ id: "rep-1", status: "RESOLVED" });

		await expect(resolveIssueReport("rep-1")).resolves.toEqual({ success: true });

		expect(mocks.update).not.toHaveBeenCalled();
		expect(mocks.writePlatformAudit).not.toHaveBeenCalled();
	});

	it("rejects an unknown report without mutating", async () => {
		mocks.findUnique.mockResolvedValue(null);

		await expect(resolveIssueReport("missing")).resolves.toEqual({
			error: "Unknown report.",
		});
		expect(mocks.update).not.toHaveBeenCalled();
		expect(mocks.writePlatformAudit).not.toHaveBeenCalled();
	});

	it("rejects a malformed id before opening a transaction", async () => {
		await expect(resolveIssueReport(" ")).resolves.toEqual({ error: "Unknown report." });
		expect(mocks.transaction).not.toHaveBeenCalled();
	});
});
