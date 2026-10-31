import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateLink } = vi.hoisted(() => ({ generateLink: vi.fn() }));

vi.mock("@/lib/supabase/server", () => {
	const auth = {
		getUser: vi.fn(async () => ({ data: { user: null } })),
		updateUser: vi.fn(async () => ({ error: null })),
		signOut: vi.fn(async () => ({ error: null })),
	};
	return { createClient: vi.fn(async () => ({ auth })) };
});

// The self-service flow mints the recovery link with the admin client and
// hands delivery to Resend (issue #411); Supabase's own SMTP is not used.
vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: vi.fn(() => ({ auth: { admin: { generateLink } } })),
}));

vi.mock("@/lib/notify/reset-email", () => ({ deliverPasswordResetEmail: vi.fn(async () => true) }));

vi.mock("@/lib/prisma", () => ({
	default: {
		user: { findUnique: vi.fn(), updateMany: vi.fn() },
		platformAuditLog: { create: vi.fn(async () => ({})) },
	},
}));

vi.mock("@/lib/rate-limit", () => ({
	checkPasswordResetRateLimit: vi.fn(async () => ({ success: true, remaining: 2 })),
	getClientIp: vi.fn(async () => "203.0.113.9"),
}));

vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "en") }));

import { completePasswordReset, requestPasswordReset } from "@/lib/actions/password-reset";
import { deliverPasswordResetEmail } from "@/lib/notify/reset-email";
import { reportError } from "@/lib/observability";
import prisma from "@/lib/prisma";
import { checkPasswordResetRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const RESET_URL = "https://auth.example/recovery?token=abc";

const user = vi.mocked(prisma.user);
const auditCreate = vi.mocked(prisma.platformAuditLog.create);
const deliverEmail = vi.mocked(deliverPasswordResetEmail);
const rateLimit = vi.mocked(checkPasswordResetRateLimit);

async function auth() {
	const client = (await createClient()) as unknown as { auth: Record<string, unknown> };
	return client.auth as {
		getUser: ReturnType<typeof vi.fn>;
		updateUser: ReturnType<typeof vi.fn>;
		signOut: ReturnType<typeof vi.fn>;
	};
}

const POND_ADDRESS = "demo-farmer-1@pond.optifeed.local";
const ACCOUNT_SELECT = { id: true, email: true, farmId: true, contactEmail: true };
const accountWith = (contactEmail: string | null) =>
	({ id: "user-1", email: POND_ADDRESS, farmId: "demo-farmer-1", contactEmail }) as never;

describe("requestPasswordReset", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		rateLimit.mockResolvedValue({ success: true, remaining: 2 });
		generateLink.mockResolvedValue({
			data: { properties: { action_link: RESET_URL } },
			error: null,
		});
		deliverEmail.mockResolvedValue(true);
		auditCreate.mockResolvedValue({} as never);
	});

	it("answers an unknown email exactly like a known one (no enumeration)", async () => {
		user.findUnique.mockResolvedValue(null);

		const result = await requestPasswordReset("nobody@example.com");

		expect(result).toEqual({ success: true });
		expect(user.findUnique).toHaveBeenCalledWith({
			where: { contactEmail: "nobody@example.com" },
			select: ACCOUNT_SELECT,
		});
		expect(generateLink).not.toHaveBeenCalled();
		expect(deliverEmail).not.toHaveBeenCalled();
		expect(auditCreate).not.toHaveBeenCalled();
	});

	it("answers an unknown farm ID exactly like a known one (no enumeration)", async () => {
		user.findUnique.mockResolvedValue(null);

		const result = await requestPasswordReset("no-such-farm");

		expect(result).toEqual({ success: true });
		expect(user.findUnique).toHaveBeenCalledWith({
			where: { farmId: "no-such-farm" },
			select: ACCOUNT_SELECT,
		});
		expect(generateLink).not.toHaveBeenCalled();
		expect(deliverEmail).not.toHaveBeenCalled();
		expect(auditCreate).not.toHaveBeenCalled();
	});

	it("finds the account by contact email, mints the link for the login address and mails the contact email", async () => {
		user.findUnique.mockResolvedValue(accountWith("farmer@example.com"));

		const result = await requestPasswordReset("  Farmer@Example.COM  ");

		expect(result).toEqual({ success: true });
		expect(user.findUnique).toHaveBeenCalledWith({
			where: { contactEmail: "farmer@example.com" },
			select: ACCOUNT_SELECT,
		});
		// The link is minted for the Supabase login address, which never changes...
		expect(generateLink).toHaveBeenCalledWith({
			type: "recovery",
			email: POND_ADDRESS,
			options: { redirectTo: expect.stringMatching(/\/en\/reset-password$/) },
		});
		// ...but it is mailed to the real mailbox, not the synthetic pond address.
		expect(deliverEmail).toHaveBeenCalledWith({
			to: "farmer@example.com",
			farmId: "demo-farmer-1",
			resetUrl: RESET_URL,
		});

		const auditPayload = auditCreate.mock.calls[0]?.[0] as
			| { data: { action: string; actorUserId: string; targetId: string; after: unknown } }
			| undefined;
		expect(auditPayload?.data.action).toBe("platform.user.password_reset_requested");
		expect(auditPayload?.data.actorUserId).toBe("self-service");
		expect(auditPayload?.data.targetId).toBe("user-1");
		expect(auditPayload?.data.after).toEqual({
			farmId: "demo-farmer-1",
			via: "email",
			emailSent: true,
		});
		// The recovery link is a credential and the typed email is personal data:
		// neither may reach the audit row.
		expect(JSON.stringify(auditPayload)).not.toContain(RESET_URL);
		expect(JSON.stringify(auditPayload)).not.toContain("farmer@example.com");
	});

	it("still accepts a farm ID and mails the account's contact email", async () => {
		user.findUnique.mockResolvedValue(accountWith("farmer@example.com"));

		const result = await requestPasswordReset("  Demo-Farmer-1  ");

		expect(result).toEqual({ success: true });
		expect(user.findUnique).toHaveBeenCalledWith({
			where: { farmId: "demo-farmer-1" },
			select: ACCOUNT_SELECT,
		});
		expect(deliverEmail).toHaveBeenCalledWith({
			to: "farmer@example.com",
			farmId: "demo-farmer-1",
			resetUrl: RESET_URL,
		});
		const auditPayload = auditCreate.mock.calls[0]?.[0] as { data: { after: unknown } } | undefined;
		expect(auditPayload?.data.after).toEqual({
			farmId: "demo-farmer-1",
			via: "farmId",
			emailSent: true,
		});
	});

	it("reads the pond address the profile page used to show as a farm ID", async () => {
		user.findUnique.mockResolvedValue(accountWith("farmer@example.com"));

		await requestPasswordReset(POND_ADDRESS);

		expect(user.findUnique).toHaveBeenCalledWith({
			where: { farmId: "demo-farmer-1" },
			select: ACCOUNT_SELECT,
		});
	});

	it("mints and sends nothing for an account with no contact email, and says why in the audit row", async () => {
		user.findUnique.mockResolvedValue(accountWith(null));

		const result = await requestPasswordReset("demo-farmer-1");

		// Same answer as any other request: the caller learns nothing.
		expect(result).toEqual({ success: true });
		expect(generateLink).not.toHaveBeenCalled();
		expect(deliverEmail).not.toHaveBeenCalled();
		const auditPayload = auditCreate.mock.calls[0]?.[0] as { data: { after: unknown } } | undefined;
		expect(auditPayload?.data.after).toEqual({
			farmId: "demo-farmer-1",
			via: "farmId",
			emailSent: false,
			reason: "no_contact_email",
		});
	});

	it("still reports success when Supabase refuses to mint the link", async () => {
		user.findUnique.mockResolvedValue(accountWith("farmer@example.com"));
		generateLink.mockResolvedValue({ data: null, error: { message: "SMTP not configured" } });

		const result = await requestPasswordReset("farmer@example.com");

		// "Sent" would be a claim we cannot make.
		expect(result).toEqual({ success: true });
		expect(reportError).toHaveBeenCalled();
		expect(deliverEmail).not.toHaveBeenCalled();
		const auditPayload = auditCreate.mock.calls[0]?.[0] as { data: { after: unknown } } | undefined;
		expect(auditPayload?.data.after).toEqual({
			farmId: "demo-farmer-1",
			via: "email",
			emailSent: false,
		});
	});

	it("is rate limited per IP", async () => {
		rateLimit.mockResolvedValue({ success: false, remaining: 0 });

		const result = await requestPasswordReset("farmer@example.com");

		expect(result).toEqual({ error: "rate_limited" });
		expect(user.findUnique).not.toHaveBeenCalled();
	});

	it("rejects an empty identifier before touching the store", async () => {
		const result = await requestPasswordReset("   ");

		expect(result).toEqual({ error: "invalid" });
		expect(user.findUnique).not.toHaveBeenCalled();
	});

	it("does not put the typed email into the error report", async () => {
		user.findUnique.mockRejectedValue(new Error("db down"));

		const result = await requestPasswordReset("farmer@example.com");

		expect(result).toEqual({ error: "service" });
		expect(reportError).toHaveBeenCalledWith(expect.any(Error), { action: "requestPasswordReset" });
	});
});

describe("completePasswordReset", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		user.updateMany.mockResolvedValue({ count: 1 });
	});

	it("requires a recovery session", async () => {
		const result = await completePasswordReset({
			newPassword: "NewPassw0rd",
			confirmPassword: "NewPassw0rd",
		});

		expect(result).toEqual({ error: "session" });
		const supabase = await auth();
		expect(supabase.updateUser).not.toHaveBeenCalled();
	});

	it("rejects mismatched confirmation", async () => {
		const supabase = await auth();
		supabase.getUser.mockResolvedValue({ data: { user: { id: "sb-1" } } });

		const result = await completePasswordReset({
			newPassword: "NewPassw0rd",
			confirmPassword: "Different1",
		});

		expect(result).toEqual({ error: "mismatch" });
		expect(supabase.updateUser).not.toHaveBeenCalled();
	});

	it("rejects a weak password", async () => {
		const supabase = await auth();
		supabase.getUser.mockResolvedValue({ data: { user: { id: "sb-1" } } });

		const result = await completePasswordReset({
			newPassword: "short",
			confirmPassword: "short",
		});

		expect(result).toEqual({ error: "weak_password" });
		expect(supabase.updateUser).not.toHaveBeenCalled();
	});

	it("sets the password, clears the forced-change flag and revokes other sessions", async () => {
		const supabase = await auth();
		supabase.getUser.mockResolvedValue({ data: { user: { id: "sb-1" } } });
		supabase.updateUser.mockResolvedValue({ error: null });

		const result = await completePasswordReset({
			newPassword: "NewPassw0rd",
			confirmPassword: "NewPassw0rd",
		});

		expect(result).toEqual({ success: true });
		expect(supabase.updateUser).toHaveBeenCalledWith({ password: "NewPassw0rd" });
		expect(user.updateMany).toHaveBeenCalledWith({
			where: { supabaseId: "sb-1" },
			data: { mustChangePassword: false },
		});
		expect(supabase.signOut).toHaveBeenCalledWith({ scope: "others" });
	});

	it("maps a Supabase update failure to 'service'", async () => {
		const supabase = await auth();
		supabase.getUser.mockResolvedValue({ data: { user: { id: "sb-1" } } });
		supabase.updateUser.mockResolvedValue({ error: { message: "boom" } });

		const result = await completePasswordReset({
			newPassword: "NewPassw0rd",
			confirmPassword: "NewPassw0rd",
		});

		expect(result).toEqual({ error: "service" });
		expect(user.updateMany).not.toHaveBeenCalled();
	});
});
