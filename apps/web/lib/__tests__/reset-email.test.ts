import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("resend", () => ({
	Resend: class {
		emails = { send: sendMock };
	},
}));

import {
	__resetResetEmailWarningForTests,
	deliverPasswordResetEmail,
	isResetEmailConfigured,
	resetBaseUrl,
	resetFromAddress,
	sendPasswordResetEmail,
} from "@/lib/notify/reset-email";

const CONFIGURED = {
	RESEND_API_KEY: "re_test_key",
	INVITE_FROM_EMAIL: "PakaonAI <invite@syntaxure.dev>",
	NEXT_PUBLIC_BASE_URL: "https://pakaonai.syntaxure.dev",
};

const INPUT = {
	to: "superadmin@pond.optifeed.local",
	farmId: "superadmin",
	resetUrl: "https://pakaonai.syntaxure.dev/en/reset-password?token=secret-token",
};

beforeEach(() => {
	vi.clearAllMocks();
	__resetResetEmailWarningForTests();
	sendMock.mockResolvedValue({ data: { id: "email-1" }, error: null });
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("reset email configuration", () => {
	it("requires the API key and a from address", () => {
		expect(isResetEmailConfigured(CONFIGURED)).toBe(true);
		expect(isResetEmailConfigured({})).toBe(false);
		expect(isResetEmailConfigured({ ...CONFIGURED, RESEND_API_KEY: "" })).toBe(false);
		expect(isResetEmailConfigured({ ...CONFIGURED, INVITE_FROM_EMAIL: "" })).toBe(false);
	});

	it("does not require NEXT_PUBLIC_BASE_URL: the link target always resolves", () => {
		// Production scoped NEXT_PUBLIC_BASE_URL to Preview/staging, so requiring
		// it silently skipped every reset email while the key and sender were set.
		expect(isResetEmailConfigured({ ...CONFIGURED, NEXT_PUBLIC_BASE_URL: "" })).toBe(true);
		expect(isResetEmailConfigured({ ...CONFIGURED, NEXT_PUBLIC_BASE_URL: undefined })).toBe(true);

		expect(resetBaseUrl({})).toBe("https://pakaonai.syntaxure.dev");
		expect(resetBaseUrl({ NEXT_PUBLIC_SITE_URL: "https://staging.example/" })).toBe(
			"https://staging.example",
		);
		expect(resetBaseUrl({ NEXT_PUBLIC_BASE_URL: "https://preview.example/" })).toBe(
			"https://preview.example",
		);
	});

	it("falls back to the invite sender when no reset sender is set", () => {
		expect(resetFromAddress(CONFIGURED)).toBe("PakaonAI <invite@syntaxure.dev>");
		expect(
			resetFromAddress({ ...CONFIGURED, RESET_FROM_EMAIL: "PakaonAI <reset@syntaxure.dev>" }),
		).toBe("PakaonAI <reset@syntaxure.dev>");
		expect(resetFromAddress({})).toBeNull();
	});

	it("skips gracefully when unconfigured and never calls Resend", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		await expect(sendPasswordResetEmail(INPUT, {})).resolves.toEqual({
			ok: false,
			error: "email_not_configured",
			skipped: true,
		});
		expect(sendMock).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledTimes(1);
	});
});

describe("reset email delivery", () => {
	it("sends the recovery link to the account address", async () => {
		const result = await sendPasswordResetEmail(INPUT, CONFIGURED);

		expect(result).toEqual({ ok: true });
		expect(sendMock).toHaveBeenCalledTimes(1);
		const payload = sendMock.mock.calls[0][0];
		expect(payload.to).toEqual([INPUT.to]);
		expect(payload.from).toBe("PakaonAI <invite@syntaxure.dev>");
		expect(payload.html).toContain(INPUT.resetUrl);
		expect(payload.text).toContain(INPUT.resetUrl);
	});

	it("uses the canonical login URL when NEXT_PUBLIC_BASE_URL is unset", async () => {
		const env = { ...CONFIGURED, NEXT_PUBLIC_BASE_URL: undefined };

		await expect(sendPasswordResetEmail(INPUT, env)).resolves.toEqual({ ok: true });

		const payload = sendMock.mock.calls[0][0];
		expect(payload.html).toContain("https://pakaonai.syntaxure.dev/login");
		expect(payload.html).not.toContain('href="/login"');
	});

	it("reports a provider failure without throwing", async () => {
		sendMock.mockResolvedValue({ error: { message: "domain not verified" } });

		await expect(sendPasswordResetEmail(INPUT, CONFIGURED)).resolves.toEqual({
			ok: false,
			error: "domain not verified",
		});
	});

	it("reports delivery as a boolean for the caller", async () => {
		await expect(deliverPasswordResetEmail(INPUT, CONFIGURED)).resolves.toBe(true);

		sendMock.mockResolvedValue({ error: { message: "boom" } });
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		await expect(deliverPasswordResetEmail(INPUT, CONFIGURED)).resolves.toBe(false);
	});
});
