import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { generateLink, headersMock } = vi.hoisted(() => ({
	generateLink: vi.fn(),
	headersMock: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: headersMock }));

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
		passwordResetToken: { create: vi.fn(), updateMany: vi.fn() },
		platformAuditLog: { create: vi.fn(async () => ({})) },
	},
}));

vi.mock("@/lib/rate-limit", () => ({
	checkPasswordResetRateLimit: vi.fn(async () => ({ success: true, remaining: 2 })),
	getClientIp: vi.fn(async () => "203.0.113.9"),
}));

vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "en") }));

import {
	completePasswordReset,
	requestPasswordReset,
	resolveAppBaseUrl,
} from "@/lib/actions/password-reset";
import { deliverPasswordResetEmail } from "@/lib/notify/reset-email";
import { reportError } from "@/lib/observability";
import prisma from "@/lib/prisma";
import { checkPasswordResetRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const RESET_URL = "https://auth.example/recovery?token=abc";
const PRODUCTION_URL = "https://pakaonai.syntaxure.dev";

const user = vi.mocked(prisma.user);
const resetTokens = vi.mocked(prisma.passwordResetToken);
const auditCreate = vi.mocked(prisma.platformAuditLog.create);
const deliverEmail = vi.mocked(deliverPasswordResetEmail);
const rateLimit = vi.mocked(checkPasswordResetRateLimit);

const ENV_KEYS = [
	"SUPABASE_SERVICE_ROLE_KEY",
	"NEXT_PUBLIC_BASE_URL",
	"NEXT_PUBLIC_SITE_URL",
	"VERCEL_ENV",
	"TRUSTED_PROXY_HOPS",
] as const;
const originalEnv = new Map<string, string | undefined>();

for (const key of ENV_KEYS) originalEnv.set(key, process.env[key]);

afterAll(() => {
	for (const key of ENV_KEYS) {
		const value = originalEnv.get(key);
		if (value === undefined) Reflect.deleteProperty(process.env, key);
		else process.env[key] = value;
	}
});

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
const accountWith = (contactEmail: string | null, id = "user-1") =>
	({ id, email: POND_ADDRESS, farmId: "demo-farmer-1", contactEmail }) as never;

function lastRedirectTo(): string {
	const call = generateLink.mock.calls[generateLink.mock.calls.length - 1]?.[0] as
		| { options?: { redirectTo?: string } }
		| undefined;
	const redirectTo = call?.options?.redirectTo;
	if (!redirectTo) throw new Error("generateLink did not receive a redirectTo");
	return redirectTo;
}

function lastResetToken(): string {
	const token = new URL(lastRedirectTo()).searchParams.get("reset");
	if (!token) throw new Error("redirectTo did not carry a reset proof");
	return token;
}

/** Run the normal request path and return the proof it put in the recovery link. */
async function issueResetProof(userId = "user-1"): Promise<string> {
	user.findUnique.mockResolvedValueOnce(accountWith("farmer@example.com", userId));
	generateLink.mockResolvedValue({
		data: { properties: { action_link: RESET_URL } },
		error: null,
	});

	const result = await requestPasswordReset("farmer@example.com");

	expect(result).toEqual({ success: true });
	return lastResetToken();
}

beforeEach(() => {
	vi.clearAllMocks();
	process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
	process.env.NEXT_PUBLIC_BASE_URL = "https://app.example";
	Reflect.deleteProperty(process.env, "NEXT_PUBLIC_SITE_URL");
	Reflect.deleteProperty(process.env, "VERCEL_ENV");
	Reflect.deleteProperty(process.env, "TRUSTED_PROXY_HOPS");

	user.findUnique.mockReset();
	user.updateMany.mockReset();
	resetTokens.create.mockReset();
	resetTokens.updateMany.mockReset();
	headersMock.mockReset();
	headersMock.mockRejectedValue(new Error("headers() outside a request"));
	user.updateMany.mockResolvedValue({ count: 1 } as never);
	resetTokens.create.mockResolvedValue({} as never);
	resetTokens.updateMany.mockResolvedValue({ count: 1 } as never);
});

describe("resolveAppBaseUrl (#732)", () => {
	it("prefers NEXT_PUBLIC_BASE_URL and strips trailing slashes", async () => {
		process.env.NEXT_PUBLIC_BASE_URL = "https://preview.example///";
		process.env.NEXT_PUBLIC_SITE_URL = "https://site.example";

		expect(await resolveAppBaseUrl()).toBe("https://preview.example");
	});

	it("falls back to NEXT_PUBLIC_SITE_URL", async () => {
		Reflect.deleteProperty(process.env, "NEXT_PUBLIC_BASE_URL");
		process.env.NEXT_PUBLIC_SITE_URL = "https://site.example/";

		expect(await resolveAppBaseUrl()).toBe("https://site.example");
	});

	it("uses the canonical production URL only when VERCEL_ENV=production", async () => {
		Reflect.deleteProperty(process.env, "NEXT_PUBLIC_BASE_URL");
		Reflect.deleteProperty(process.env, "NEXT_PUBLIC_SITE_URL");
		process.env.VERCEL_ENV = "production";

		expect(await resolveAppBaseUrl()).toBe(PRODUCTION_URL);
	});

	it("returns null outside production when neither variable is set", async () => {
		Reflect.deleteProperty(process.env, "NEXT_PUBLIC_BASE_URL");
		Reflect.deleteProperty(process.env, "NEXT_PUBLIC_SITE_URL");
		Reflect.deleteProperty(process.env, "VERCEL_ENV");

		expect(await resolveAppBaseUrl()).toBeNull();

		process.env.VERCEL_ENV = "preview";
		expect(await resolveAppBaseUrl()).toBeNull();
	});
});

describe("requestPasswordReset", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		rateLimit.mockResolvedValue({ success: true, remaining: 2 });
		generateLink.mockReset();
		generateLink.mockResolvedValue({
			data: { properties: { action_link: RESET_URL } },
			error: null,
		});
		deliverEmail.mockReset();
		deliverEmail.mockResolvedValue(true);
		auditCreate.mockReset();
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
		expect(resetTokens.create).not.toHaveBeenCalled();
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
		expect(resetTokens.create).not.toHaveBeenCalled();
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
			options: {
				redirectTo: expect.stringMatching(
					/^https:\/\/app\.example\/en\/reset-password\?reset=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
				),
			},
		});
		// ...but it is mailed to the real mailbox, not the synthetic pond address.
		expect(deliverEmail).toHaveBeenCalledWith({
			to: "farmer@example.com",
			farmId: "demo-farmer-1",
			resetUrl: RESET_URL,
		});
		// The proof is persisted by jti so it can be consumed exactly once.
		expect(resetTokens.create).toHaveBeenCalledWith({
			data: {
				jti: expect.any(String),
				userId: "user-1",
				expiresAt: expect.any(Date),
			},
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
		// The recovery link and proof are credentials and the typed email is
		// personal data: none may reach the audit row.
		const proof = lastResetToken();
		expect(JSON.stringify(auditPayload)).not.toContain(RESET_URL);
		expect(JSON.stringify(auditPayload)).not.toContain("farmer@example.com");
		expect(JSON.stringify(auditPayload)).not.toContain(proof);
	});

	it("records the trusted X-Forwarded-For hop, not the first entry (#732)", async () => {
		headersMock.mockResolvedValue({
			get: (name: string) => (name === "x-forwarded-for" ? "203.0.113.66, 198.51.100.4" : null),
		});
		user.findUnique.mockResolvedValue(accountWith("farmer@example.com"));

		await requestPasswordReset("farmer@example.com");

		const auditPayload = auditCreate.mock.calls[0]?.[0] as
			| { data: { ip: string | null } }
			| undefined;
		expect(auditPayload?.data.ip).toBe("198.51.100.4");
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
		expect(resetTokens.create).not.toHaveBeenCalled();
		expect(deliverEmail).not.toHaveBeenCalled();
		const auditPayload = auditCreate.mock.calls[0]?.[0] as { data: { after: unknown } } | undefined;
		expect(auditPayload?.data.after).toEqual({
			farmId: "demo-farmer-1",
			via: "farmId",
			emailSent: false,
			reason: "no_contact_email",
		});
	});

	it("fails closed outside production when no base URL is configured", async () => {
		Reflect.deleteProperty(process.env, "NEXT_PUBLIC_BASE_URL");
		Reflect.deleteProperty(process.env, "NEXT_PUBLIC_SITE_URL");
		Reflect.deleteProperty(process.env, "VERCEL_ENV");
		user.findUnique.mockResolvedValue(accountWith("farmer@example.com"));

		const result = await requestPasswordReset("farmer@example.com");

		// Same anti-enumeration answer, but no proof, no link and no email.
		expect(result).toEqual({ success: true });
		expect(generateLink).not.toHaveBeenCalled();
		expect(resetTokens.create).not.toHaveBeenCalled();
		expect(deliverEmail).not.toHaveBeenCalled();
		expect(reportError).toHaveBeenCalledWith(expect.any(Error), {
			action: "requestPasswordReset.baseUrl",
			farmId: "demo-farmer-1",
		});

		const auditPayload = auditCreate.mock.calls[0]?.[0] as { data: { after: unknown } } | undefined;
		expect(auditPayload?.data.after).toEqual({
			farmId: "demo-farmer-1",
			via: "email",
			emailSent: false,
			reason: "base_url_unconfigured",
		});
	});

	it("uses the canonical production origin when production has no base URL", async () => {
		Reflect.deleteProperty(process.env, "NEXT_PUBLIC_BASE_URL");
		Reflect.deleteProperty(process.env, "NEXT_PUBLIC_SITE_URL");
		process.env.VERCEL_ENV = "production";
		user.findUnique.mockResolvedValue(accountWith("farmer@example.com"));

		await requestPasswordReset("farmer@example.com");

		expect(lastRedirectTo()).toMatch(
			/^https:\/\/pakaonai\.syntaxure\.dev\/en\/reset-password\?reset=/,
		);
		expect(deliverEmail).toHaveBeenCalled();
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

	it("keeps the anti-enumeration answer when the proof cannot be persisted", async () => {
		user.findUnique.mockResolvedValue(accountWith("farmer@example.com"));
		resetTokens.create.mockRejectedValue(new Error("db down"));

		const result = await requestPasswordReset("farmer@example.com");

		// Same answer as an unknown account: the caller learns nothing.
		expect(result).toEqual({ success: true });
		expect(generateLink).not.toHaveBeenCalled();
		expect(deliverEmail).not.toHaveBeenCalled();
		expect(reportError).toHaveBeenCalledWith(expect.any(Error), {
			action: "requestPasswordReset.proof",
			farmId: "demo-farmer-1",
		});

		const auditPayload = auditCreate.mock.calls[0]?.[0] as { data: { after: unknown } } | undefined;
		expect(auditPayload?.data.after).toEqual({
			farmId: "demo-farmer-1",
			via: "email",
			emailSent: false,
			reason: "proof_unavailable",
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
		expect(reportError).toHaveBeenCalledWith(expect.any(Error), {
			action: "requestPasswordReset",
		});
	});
});

describe("completePasswordReset", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		rateLimit.mockResolvedValue({ success: true, remaining: 2 });
		user.updateMany.mockResolvedValue({ count: 1 } as never);
		resetTokens.updateMany.mockResolvedValue({ count: 1 } as never);
		deliverEmail.mockResolvedValue(true);
		auditCreate.mockResolvedValue({} as never);
	});

	it("rejects a normal authenticated session with no recovery proof (#718)", async () => {
		const supabase = await auth();
		supabase.getUser.mockResolvedValue({ data: { user: { id: "sb-1" } } });

		const result = await completePasswordReset({
			newPassword: "NewPassw0rd",
			confirmPassword: "NewPassw0rd",
		});

		expect(result).toEqual({ error: "reset_link" });
		expect(supabase.updateUser).not.toHaveBeenCalled();
		expect(resetTokens.updateMany).not.toHaveBeenCalled();
		expect(user.updateMany).not.toHaveBeenCalled();
	});

	it("requires a recovery session", async () => {
		const supabase = await auth();
		supabase.getUser.mockResolvedValue({ data: { user: null } });

		const result = await completePasswordReset({
			newPassword: "NewPassw0rd",
			confirmPassword: "NewPassw0rd",
			resetToken: "anything",
		});

		expect(result).toEqual({ error: "session" });
		expect(supabase.updateUser).not.toHaveBeenCalled();
	});

	it("accepts a valid proof once and burns it", async () => {
		const token = await issueResetProof();
		user.findUnique.mockResolvedValue({ id: "user-1" } as never);

		const supabase = await auth();
		supabase.getUser.mockResolvedValue({ data: { user: { id: "sb-1" } } });
		supabase.updateUser.mockResolvedValue({ error: null });

		const result = await completePasswordReset({
			newPassword: "NewPassw0rd",
			confirmPassword: "NewPassw0rd",
			resetToken: token,
		});

		expect(result).toEqual({ success: true });
		expect(resetTokens.updateMany).toHaveBeenCalledWith({
			where: {
				jti: expect.any(String),
				userId: "user-1",
				consumedAt: null,
				expiresAt: { gt: expect.any(Date) },
			},
			data: { consumedAt: expect.any(Date) },
		});
		expect(supabase.updateUser).toHaveBeenCalledWith({ password: "NewPassw0rd" });
		expect(user.updateMany).toHaveBeenCalledWith({
			where: { supabaseId: "sb-1" },
			data: { mustChangePassword: false },
		});
		expect(supabase.signOut).toHaveBeenCalledWith({ scope: "others" });
	});

	it("rejects a replayed proof without updating the password", async () => {
		const token = await issueResetProof();
		user.findUnique.mockResolvedValue({ id: "user-1" } as never);

		const supabase = await auth();
		supabase.getUser.mockResolvedValue({ data: { user: { id: "sb-1" } } });
		supabase.updateUser.mockResolvedValue({ error: null });
		resetTokens.updateMany
			.mockResolvedValueOnce({ count: 1 } as never)
			.mockResolvedValueOnce({ count: 0 } as never);

		const input = {
			newPassword: "NewPassw0rd",
			confirmPassword: "NewPassw0rd",
			resetToken: token,
		};

		expect(await completePasswordReset(input)).toEqual({ success: true });
		expect(await completePasswordReset(input)).toEqual({ error: "reset_link" });
		expect(supabase.updateUser).toHaveBeenCalledTimes(1);
		expect(user.updateMany).toHaveBeenCalledTimes(1);
	});

	it("rejects an expired proof without updating the password", async () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date("2026-11-04T10:00:00.000Z"));
			const token = await issueResetProof();
			vi.setSystemTime(new Date("2026-11-04T10:16:00.000Z"));

			user.findUnique.mockResolvedValue({ id: "user-1" } as never);
			const supabase = await auth();
			supabase.getUser.mockResolvedValue({ data: { user: { id: "sb-1" } } });

			const result = await completePasswordReset({
				newPassword: "NewPassw0rd",
				confirmPassword: "NewPassw0rd",
				resetToken: token,
			});

			expect(result).toEqual({ error: "reset_link" });
			expect(resetTokens.updateMany).not.toHaveBeenCalled();
			expect(supabase.updateUser).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it("rejects a tampered proof without updating the password", async () => {
		const token = await issueResetProof();
		const [payload, signature] = token.split(".");
		const tampered = `${payload}.${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
		user.findUnique.mockResolvedValue({ id: "user-1" } as never);

		const supabase = await auth();
		supabase.getUser.mockResolvedValue({ data: { user: { id: "sb-1" } } });

		const result = await completePasswordReset({
			newPassword: "NewPassw0rd",
			confirmPassword: "NewPassw0rd",
			resetToken: tampered,
		});

		expect(result).toEqual({ error: "reset_link" });
		expect(resetTokens.updateMany).not.toHaveBeenCalled();
		expect(supabase.updateUser).not.toHaveBeenCalled();
	});

	it("rejects a proof minted for another user", async () => {
		const token = await issueResetProof("user-1");
		// The session belongs to a different application user.
		user.findUnique.mockResolvedValue({ id: "user-2" } as never);

		const supabase = await auth();
		supabase.getUser.mockResolvedValue({ data: { user: { id: "sb-2" } } });

		const result = await completePasswordReset({
			newPassword: "NewPassw0rd",
			confirmPassword: "NewPassw0rd",
			resetToken: token,
		});

		expect(result).toEqual({ error: "reset_link" });
		expect(resetTokens.updateMany).not.toHaveBeenCalled();
		expect(supabase.updateUser).not.toHaveBeenCalled();
	});

	it("rejects mismatched confirmation without burning the proof", async () => {
		const token = await issueResetProof();
		user.findUnique.mockResolvedValue({ id: "user-1" } as never);

		const supabase = await auth();
		supabase.getUser.mockResolvedValue({ data: { user: { id: "sb-1" } } });

		const result = await completePasswordReset({
			newPassword: "NewPassw0rd",
			confirmPassword: "Different1",
			resetToken: token,
		});

		expect(result).toEqual({ error: "mismatch" });
		expect(resetTokens.updateMany).not.toHaveBeenCalled();
		expect(supabase.updateUser).not.toHaveBeenCalled();
	});

	it("rejects a weak password without burning the proof", async () => {
		const token = await issueResetProof();
		user.findUnique.mockResolvedValue({ id: "user-1" } as never);

		const supabase = await auth();
		supabase.getUser.mockResolvedValue({ data: { user: { id: "sb-1" } } });

		const result = await completePasswordReset({
			newPassword: "short",
			confirmPassword: "short",
			resetToken: token,
		});

		expect(result).toEqual({ error: "weak_password" });
		expect(resetTokens.updateMany).not.toHaveBeenCalled();
		expect(supabase.updateUser).not.toHaveBeenCalled();
	});

	it("maps a Supabase update failure to 'service'", async () => {
		const token = await issueResetProof();
		user.findUnique.mockResolvedValue({ id: "user-1" } as never);

		const supabase = await auth();
		supabase.getUser.mockResolvedValue({ data: { user: { id: "sb-1" } } });
		supabase.updateUser.mockResolvedValue({ error: { message: "boom" } });

		const result = await completePasswordReset({
			newPassword: "NewPassw0rd",
			confirmPassword: "NewPassw0rd",
			resetToken: token,
		});

		expect(result).toEqual({ error: "service" });
		expect(user.updateMany).not.toHaveBeenCalled();
	});
});
