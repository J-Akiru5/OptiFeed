import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requirePlatformAdmin: vi.fn(),
	withStepUp: vi.fn(),
	actorContext: vi.fn(),
	writePlatformAudit: vi.fn(),
	orgFindUnique: vi.fn(),
	orgUpdate: vi.fn(),
}));

vi.mock("@/lib/auth/require-platform-admin", () => ({
	requirePlatformAdmin: mocks.requirePlatformAdmin,
}));
vi.mock("@/lib/auth/step-up", () => ({
	withStepUp: mocks.withStepUp,
	isStepUpRequiredError: (error: unknown) =>
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === "step_up_required",
}));
vi.mock("@/lib/actions/platform/audit", () => ({
	actorContext: mocks.actorContext,
	writePlatformAudit: mocks.writePlatformAudit,
}));
vi.mock("@/lib/prisma", () => ({
	default: {
		organization: { findUnique: mocks.orgFindUnique },
		$transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
			fn({ organization: { update: mocks.orgUpdate } }),
		),
	},
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { setOrganizationStatus } from "../actions/platform/organizations";

const ORG = { id: "org-1", name: "CICT", status: "ACTIVE" };
const REASON = "Non-payment for three months";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.requirePlatformAdmin.mockResolvedValue(undefined);
	mocks.withStepUp.mockImplementation(async (action: (stepUpAt: Date) => Promise<unknown>) =>
		action(new Date("2026-10-27T12:00:00Z")),
	);
	mocks.actorContext.mockResolvedValue({ id: "admin-1", temporaryGrant: false });
	mocks.orgFindUnique.mockResolvedValue(ORG);
	mocks.orgUpdate.mockResolvedValue({ ...ORG, status: "SUSPENDED" });
});

describe("setOrganizationStatus", () => {
	it("allows a platform admin with a fresh step-up to suspend, with one audit row", async () => {
		const result = await setOrganizationStatus({
			orgId: "org-1",
			status: "SUSPENDED",
			reason: REASON,
		});

		expect(result).toEqual({ success: true, status: "SUSPENDED" });
		expect(mocks.orgUpdate).toHaveBeenCalledWith({
			where: { id: "org-1" },
			data: { status: "SUSPENDED" },
		});
		expect(mocks.writePlatformAudit).toHaveBeenCalledTimes(1);
		expect(mocks.writePlatformAudit).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				action: "platform.organization.suspend",
				targetId: "org-1",
				orgId: "org-1",
				reason: REASON,
			}),
		);
	});

	it("denies a caller who is not a platform admin", async () => {
		mocks.requirePlatformAdmin.mockRejectedValue(new Error("redirect"));

		await expect(
			setOrganizationStatus({ orgId: "org-1", status: "SUSPENDED", reason: REASON }),
		).rejects.toThrow("redirect");
		expect(mocks.orgUpdate).not.toHaveBeenCalled();
		expect(mocks.writePlatformAudit).not.toHaveBeenCalled();
	});

	it("refuses to change anything without a fresh step-up", async () => {
		mocks.withStepUp.mockRejectedValue({
			code: "step_up_required",
			message: "Re-enter your password.",
		});

		const result = await setOrganizationStatus({
			orgId: "org-1",
			status: "SUSPENDED",
			reason: REASON,
		});

		expect(result).toEqual({ error: "Re-enter your password.", code: "step_up_required" });
		expect(mocks.orgUpdate).not.toHaveBeenCalled();
		expect(mocks.writePlatformAudit).not.toHaveBeenCalled();
	});

	it("refuses a reason shorter than 10 characters", async () => {
		const result = await setOrganizationStatus({
			orgId: "org-1",
			status: "SUSPENDED",
			reason: "too short",
		});

		expect("error" in result).toBe(true);
		expect(mocks.orgUpdate).not.toHaveBeenCalled();
	});

	it("does not restore an organization pending deletion", async () => {
		mocks.orgFindUnique.mockResolvedValue({ ...ORG, status: "PENDING_DELETION" });

		const result = await setOrganizationStatus({
			orgId: "org-1",
			status: "ACTIVE",
			reason: REASON,
		});

		expect("error" in result).toBe(true);
		expect(mocks.orgUpdate).not.toHaveBeenCalled();
	});

	it("refuses to restore a purged organization", async () => {
		mocks.orgFindUnique.mockResolvedValue({ ...ORG, status: "PURGED" });

		const result = await setOrganizationStatus({
			orgId: "org-1",
			status: "ACTIVE",
			reason: REASON,
		});

		expect("error" in result).toBe(true);
		expect(mocks.orgUpdate).not.toHaveBeenCalled();
	});
});
