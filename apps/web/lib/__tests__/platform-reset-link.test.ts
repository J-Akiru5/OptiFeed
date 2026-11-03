import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenancyDb } from "./helpers/tenancy";

/**
 * `sendPlatformUserResetLink` — the superadmin "Send link" path.
 *
 * The action must refuse cleanly when the account has no deliverable address or
 * the deployment cannot send mail, and it must never surrender the recovery
 * link itself. The audit row records the attempt either way.
 */

const holder = vi.hoisted(() => ({ db: undefined as TenancyDb | undefined }));
const auth = vi.hoisted(() => ({
	generateLink: vi.fn(),
	deleteUser: vi.fn(),
}));
const resetEmail = vi.hoisted(() => ({
	deliverPasswordResetEmail: vi.fn(),
	isResetEmailConfigured: vi.fn(() => true),
}));
const resetAction = vi.hoisted(() => ({
	resolveAppBaseUrl: vi.fn(async (): Promise<string | null> => "https://pakaonai.syntaxure.dev"),
}));
const resetProof = vi.hoisted(() => ({
	issuePasswordResetProof: vi.fn(async () => ({
		token: "proof-token",
		expiresAt: new Date("2026-11-02T12:15:00.000Z"),
	})),
}));
const STEP_UP_AT = vi.hoisted(() => new Date("2026-11-02T12:00:00.000Z"));

vi.mock("@/lib/prisma", async () => {
	const { createTenancyDb } = await import("./helpers/tenancy");
	holder.db = createTenancyDb();
	return { default: holder.db.client };
});

vi.mock("@/lib/auth/session", () => ({
	getCurrentUser: vi.fn(),
	assertPasswordChanged: vi.fn(async () => undefined),
	buildPondEmail: (farmId: string) => `${farmId.toLowerCase().trim()}@pond.optifeed.local`,
}));

vi.mock("@/lib/auth/session-cache", () => ({ invalidateFarm: vi.fn() }));

vi.mock("@/lib/auth/step-up", () => ({
	withStepUp: vi.fn(async (action: (stepUpAt: Date) => Promise<unknown>) => action(STEP_UP_AT)),
	isStepUpRequiredError: (error: unknown) =>
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === "step_up_required",
}));

vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({ auth: { admin: auth } }),
}));

vi.mock("@/lib/notify/reset-email", () => resetEmail);
vi.mock("@/lib/actions/password-reset", () => resetAction);
vi.mock("@/lib/auth/password-reset-proof", () => resetProof);

vi.mock("@/i18n/routing", () => ({
	routing: { locales: ["en", "hil", "tl"], defaultLocale: "en" },
	redirect: vi.fn(() => {
		throw new Error("NEXT_REDIRECT");
	}),
}));

vi.mock("next-intl/server", () => ({
	getLocale: vi.fn(async () => "en"),
}));

import { sendPlatformUserResetLink } from "@/lib/actions/superadmin";
import { getCurrentUser } from "@/lib/auth/session";
import { withStepUp } from "@/lib/auth/step-up";
import {
	ADMIN_A_ID,
	FARMER_A_ID,
	PLATFORM_ADMIN_A_ID,
	type TenancyUser,
	userById,
} from "./helpers/tenancy";

const REASON = "Support call: the farmer cannot sign in";
const mockUser = vi.mocked(getCurrentUser);
const mockWithStepUp = vi.mocked(withStepUp);

function tenancy(): TenancyDb {
	if (!holder.db) throw new Error("tenancy database was not initialised");
	return holder.db;
}

function signInAs(userId: string) {
	mockUser.mockResolvedValue(userById(tenancy(), userId) as never);
}

function setContactEmail(userId: string, value: string | null) {
	const user = tenancy().tables.users.find((row) => row.id === userId) as
		| (TenancyUser & { contactEmail?: string | null })
		| undefined;
	if (!user) throw new Error(`fixture user ${userId} not found`);
	user.contactEmail = value;
}

beforeEach(() => {
	vi.clearAllMocks();
	tenancy().reset();
	auth.generateLink.mockReset().mockResolvedValue({
		data: { properties: { hashed_token: "hashed-token-abc" } },
		error: null,
	});
	resetEmail.deliverPasswordResetEmail.mockReset().mockResolvedValue(true);
	resetEmail.isResetEmailConfigured.mockReset().mockReturnValue(true);
	resetAction.resolveAppBaseUrl.mockReset().mockResolvedValue("https://pakaonai.syntaxure.dev");
	resetProof.issuePasswordResetProof.mockReset().mockResolvedValue({
		token: "proof-token",
		expiresAt: new Date("2026-11-02T12:15:00.000Z"),
	});
	mockWithStepUp.mockImplementation(async (action: (stepUpAt: Date) => Promise<unknown>) =>
		action(STEP_UP_AT),
	);
	setContactEmail(FARMER_A_ID, "farmer@example.test");
	signInAs(PLATFORM_ADMIN_A_ID);
});

describe("sendPlatformUserResetLink", () => {
	it("refuses a caller who is not a platform admin", async () => {
		signInAs(ADMIN_A_ID);

		await expect(sendPlatformUserResetLink(FARMER_A_ID, REASON)).rejects.toThrow("NEXT_REDIRECT");
		expect(auth.generateLink).not.toHaveBeenCalled();
	});

	it("refuses an account with no contact email and mints nothing", async () => {
		setContactEmail(FARMER_A_ID, null);

		await expect(sendPlatformUserResetLink(FARMER_A_ID, REASON)).resolves.toMatchObject({
			code: "no_contact_email",
		});
		expect(auth.generateLink).not.toHaveBeenCalled();
		expect(resetEmail.deliverPasswordResetEmail).not.toHaveBeenCalled();
	});

	it("refuses when reset email is not configured", async () => {
		resetEmail.isResetEmailConfigured.mockReturnValue(false);

		await expect(sendPlatformUserResetLink(FARMER_A_ID, REASON)).resolves.toMatchObject({
			code: "email_not_configured",
		});
		expect(auth.generateLink).not.toHaveBeenCalled();
	});

	it("refuses when no reset base URL is configured on this deployment", async () => {
		resetAction.resolveAppBaseUrl.mockResolvedValue(null);

		await expect(sendPlatformUserResetLink(FARMER_A_ID, REASON)).resolves.toMatchObject({
			code: "email_not_configured",
		});
		expect(resetProof.issuePasswordResetProof).not.toHaveBeenCalled();
		expect(auth.generateLink).not.toHaveBeenCalled();
	});

	it("mints a single-use proof and carries it in the recovery link", async () => {
		await sendPlatformUserResetLink(FARMER_A_ID, REASON);

		expect(resetProof.issuePasswordResetProof).toHaveBeenCalledWith(FARMER_A_ID);
		expect(auth.generateLink).toHaveBeenCalledWith({
			type: "recovery",
			email: userById(tenancy(), FARMER_A_ID).email,
		});
		expect(resetEmail.deliverPasswordResetEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				resetUrl:
					"https://pakaonai.syntaxure.dev/en/auth/confirm?token_hash=hashed-token-abc&type=recovery&reset=proof-token",
			}),
		);
	});

	it("mints the link for the login address and mails the contact address", async () => {
		const result = await sendPlatformUserResetLink(FARMER_A_ID, `  ${REASON}  `);

		expect(result).toEqual({ success: true, sentTo: "farmer@example.test" });
		expect(auth.generateLink).toHaveBeenCalledTimes(1);
		expect(auth.generateLink).toHaveBeenCalledWith({
			type: "recovery",
			email: userById(tenancy(), FARMER_A_ID).email,
		});
		expect(resetEmail.deliverPasswordResetEmail).toHaveBeenCalledWith({
			to: "farmer@example.test",
			farmId: userById(tenancy(), FARMER_A_ID).farmId,
			resetUrl:
				"https://pakaonai.syntaxure.dev/en/auth/confirm?token_hash=hashed-token-abc&type=recovery&reset=proof-token",
		});

		const audits = tenancy().tables.platformAuditLogs.filter(
			(row) => row.action === "platform.user.password_reset_link",
		);
		expect(audits).toHaveLength(1);
		expect(audits[0]).toMatchObject({ targetId: FARMER_A_ID, reason: REASON });
		expect(audits[0].after).toEqual({ emailSent: true });
	});

	it("reports a delivery failure and still audits emailSent: false", async () => {
		resetEmail.deliverPasswordResetEmail.mockResolvedValue(false);
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		const result = await sendPlatformUserResetLink(FARMER_A_ID, REASON);

		expect(result).toMatchObject({ error: expect.stringContaining("could not be sent") });
		const audits = tenancy().tables.platformAuditLogs.filter(
			(row) => row.action === "platform.user.password_reset_link",
		);
		expect(audits).toHaveLength(1);
		expect(audits[0].after).toEqual({ emailSent: false });
	});

	it("surfaces the step-up requirement so the dialog can re-authenticate", async () => {
		mockWithStepUp.mockRejectedValueOnce(
			Object.assign(new Error("Step-up required."), { code: "step_up_required" }),
		);

		await expect(sendPlatformUserResetLink(FARMER_A_ID, REASON)).resolves.toMatchObject({
			code: "step_up_required",
		});
	});

	it("never returns the recovery link", async () => {
		const result = await sendPlatformUserResetLink(FARMER_A_ID, REASON);

		expect(JSON.stringify(result)).not.toContain("secret");
	});
});
