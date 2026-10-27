import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("resend", () => ({
	Resend: class {
		emails = { send: sendMock };
	},
}));

import {
	__resetInviteEmailWarningForTests,
	deliverMemberInviteEmail,
	isDeliverableEmail,
	isInviteEmailConfigured,
	sendInviteEmail,
} from "@/lib/notify/invite-email";

const CONFIGURED = {
	RESEND_API_KEY: "re_test_key",
	INVITE_FROM_EMAIL: "PakaonAI <invite@syntaxure.dev>",
	NEXT_PUBLIC_BASE_URL: "https://pakaonai.syntaxure.dev",
};

const INPUT = {
	to: "juan@example.com",
	loginId: "juan-dela-cruz",
	temporaryPassword: "TempPass123",
	orgName: "Pond A Farm",
	inviterName: "Maria Santos",
};

beforeEach(() => {
	vi.clearAllMocks();
	__resetInviteEmailWarningForTests();
	sendMock.mockResolvedValue({ data: { id: "email-1" }, error: null });
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("invite email configuration", () => {
	it("requires the API key, the sender and the base URL", () => {
		expect(isInviteEmailConfigured(CONFIGURED)).toBe(true);
		expect(isInviteEmailConfigured({})).toBe(false);
		expect(isInviteEmailConfigured({ ...CONFIGURED, RESEND_API_KEY: "" })).toBe(false);
		expect(isInviteEmailConfigured({ ...CONFIGURED, INVITE_FROM_EMAIL: "" })).toBe(false);
		expect(isInviteEmailConfigured({ ...CONFIGURED, NEXT_PUBLIC_BASE_URL: "" })).toBe(false);
	});

	it("skips gracefully when unconfigured and never calls Resend", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		await expect(sendInviteEmail(INPUT, {})).resolves.toEqual({
			ok: false,
			error: "email_not_configured",
			skipped: true,
		});
		expect(sendMock).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledTimes(1);
	});
});

describe("invite email validation", () => {
	it("accepts ordinary deliverable addresses", () => {
		expect(isDeliverableEmail("juan@example.com")).toBe(true);
		expect(isDeliverableEmail("  juan.dc+pond@sub.example.ph  ")).toBe(true);
	});

	it("rejects addresses that are not deliverable", () => {
		expect(isDeliverableEmail("")).toBe(false);
		expect(isDeliverableEmail("juan")).toBe(false);
		expect(isDeliverableEmail("juan@example")).toBe(false);
		expect(isDeliverableEmail("juan@@example.com")).toBe(false);
		expect(isDeliverableEmail("juan@example .com")).toBe(false);
	});

	it("rejects a comma-separated recipient list (no second delivery)", () => {
		// SMTP list separators would let a crafted address deliver the one-time
		// password to an extra mailbox.
		expect(isDeliverableEmail("juan@example.com,attacker@evil.example")).toBe(false);
		expect(isDeliverableEmail("juan@example.com;attacker@evil.example")).toBe(false);
		expect(isDeliverableEmail("Juan <juan@example.com>")).toBe(false);
		expect(isDeliverableEmail("juan@example.com\r\nBcc: attacker@evil.example")).toBe(false);
	});

	it("refuses to send to an invalid recipient even when configured", async () => {
		await expect(sendInviteEmail({ ...INPUT, to: "juan@example" }, CONFIGURED)).resolves.toEqual({
			ok: false,
			error: "invalid_recipient",
		});
		expect(sendMock).not.toHaveBeenCalled();
	});
});

describe("invite email delivery", () => {
	it("sends from INVITE_FROM_EMAIL to the typed address with the login details", async () => {
		await expect(sendInviteEmail(INPUT, CONFIGURED)).resolves.toEqual({ ok: true });

		expect(sendMock).toHaveBeenCalledTimes(1);
		const payload = sendMock.mock.calls[0][0] as {
			from: string;
			to: string[];
			subject: string;
			html: string;
			text: string;
		};

		expect(payload.from).toBe("PakaonAI <invite@syntaxure.dev>");
		expect(payload.to).toEqual(["juan@example.com"]);
		expect(payload.subject).toContain("PakaonAI");
		expect(payload.subject).toContain("Pond A Farm");
		expect(payload.html).toContain("juan-dela-cruz");
		expect(payload.html).toContain("TempPass123");
		expect(payload.html).toContain("https://pakaonai.syntaxure.dev/login");
		expect(payload.html).toContain("PakaonAI");
		expect(payload.html.toLowerCase()).not.toContain("optifeed");
		expect(payload.text).toContain("Login ID: juan-dela-cruz");
		expect(payload.text).toContain("Temporary password: TempPass123");
		expect(payload.text).toContain("https://pakaonai.syntaxure.dev/login");
	});

	it("escapes inviter and organization markup", async () => {
		await sendInviteEmail(
			{ ...INPUT, orgName: "<script>alert(1)</script>", inviterName: "A & B" },
			CONFIGURED,
		);

		const payload = sendMock.mock.calls[0][0] as { html: string };
		expect(payload.html).not.toContain("<script>");
		expect(payload.html).toContain("&lt;script&gt;");
		expect(payload.html).toContain("A &amp; B");
	});

	it("collapses a line break in the organization name before it reaches the subject", async () => {
		// The organization name is tenant-controlled; a CR/LF in a subject is a
		// header-injection vector, so it must never survive into the payload.
		await sendInviteEmail(
			{ ...INPUT, orgName: "Pond A Farm\r\nBcc: attacker@evil.example" },
			CONFIGURED,
		);

		const payload = sendMock.mock.calls[0][0] as { subject: string };
		expect(payload.subject).toBe(
			"Your PakaonAI invitation for Pond A Farm Bcc: attacker@evil.example",
		);
		expect(payload.subject).not.toMatch(/[\r\n]/);
	});

	it("returns the provider error without leaking the password", async () => {
		sendMock.mockResolvedValueOnce({ data: null, error: { message: "Domain not verified" } });

		await expect(sendInviteEmail(INPUT, CONFIGURED)).resolves.toEqual({
			ok: false,
			error: "Domain not verified",
		});
	});

	it("returns false from the delivery helper for an attached account (no password)", async () => {
		await expect(
			deliverMemberInviteEmail({ ...INPUT, temporaryPassword: "" }, CONFIGURED),
		).resolves.toBe(false);
		expect(sendMock).not.toHaveBeenCalled();
	});

	it("logs a provider failure but never the temporary password", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		sendMock.mockRejectedValueOnce(new Error("provider down"));

		await expect(deliverMemberInviteEmail(INPUT, CONFIGURED)).resolves.toBe(false);

		const logged = [...warn.mock.calls, ...error.mock.calls, ...log.mock.calls]
			.flat()
			.map((value) => String(value))
			.join(" ");
		expect(logged).toContain("provider down");
		expect(logged).not.toContain("TempPass123");
	});
});
