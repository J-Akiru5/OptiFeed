import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("resend", () => ({
	Resend: class {
		emails = { send: sendMock };
	},
}));

import {
	__resetAlertEmailWarningForTests,
	alertFromAddress,
	isAlertEmailConfigured,
	sendAlertDigestEmail,
	sendCriticalAlertEmail,
} from "@/lib/notify/alert-email";

const CONFIGURED = {
	RESEND_API_KEY: "re_test_key",
	REMINDER_FROM_EMAIL: "PakaonAI <alerts@syntaxure.dev>",
};

const CRITICAL = {
	to: ["owner@example.test"],
	pondName: "Pond A",
	farmId: "farm-a",
	tier: "CRITICAL",
	message: "Feeder A is offline",
	linkUrl: "https://pakaonai.syntaxure.dev/dashboard/notifications",
	occurredAt: new Date("2026-11-02T01:00:00.000Z"),
};

const DIGEST = {
	to: ["owner@example.test"],
	dayLabel: "1 November 2026",
	linkUrl: "https://pakaonai.syntaxure.dev/dashboard/notifications",
	items: [
		{
			pondName: "Pond A",
			tier: "WARNING",
			message: "Hopper at 12 %",
			occurredAt: new Date("2026-11-01T02:00:00.000Z"),
		},
	],
};

beforeEach(() => {
	vi.clearAllMocks();
	__resetAlertEmailWarningForTests();
	sendMock.mockResolvedValue({ data: { id: "email-1" }, error: null });
});

describe("alert email configuration", () => {
	it("uses the alert sender, then the reminder sender, then the invite sender", () => {
		expect(alertFromAddress({ ALERT_FROM_EMAIL: "a@x", REMINDER_FROM_EMAIL: "r@x" })).toBe("a@x");
		expect(alertFromAddress({ REMINDER_FROM_EMAIL: "r@x", INVITE_FROM_EMAIL: "i@x" })).toBe("r@x");
		expect(alertFromAddress({ INVITE_FROM_EMAIL: "i@x" })).toBe("i@x");
		expect(alertFromAddress({})).toBeNull();
	});

	it("needs the key and a sender", () => {
		expect(isAlertEmailConfigured(CONFIGURED)).toBe(true);
		expect(isAlertEmailConfigured({})).toBe(false);
		expect(isAlertEmailConfigured({ ...CONFIGURED, RESEND_API_KEY: "" })).toBe(false);
	});

	it("skips without calling Resend when unconfigured", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		await expect(sendCriticalAlertEmail(CRITICAL, {})).resolves.toEqual({
			ok: false,
			error: "email_not_configured",
			skipped: true,
		});
		expect(sendMock).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledTimes(1);
	});
});

describe("critical alert email", () => {
	it("sends a single-line subject and the message body", async () => {
		await expect(sendCriticalAlertEmail(CRITICAL, CONFIGURED)).resolves.toEqual({ ok: true });

		const payload = sendMock.mock.calls[0][0];
		expect(payload.to).toEqual(["owner@example.test"]);
		expect(payload.from).toBe("PakaonAI <alerts@syntaxure.dev>");
		expect(payload.subject).toBe("Pond A — Critical alert");
		expect(payload.html).toContain("Feeder A is offline");
		expect(payload.text).toContain("Feeder A is offline");
	});

	it("strips line breaks so tenant-controlled text cannot inject a header", async () => {
		await sendCriticalAlertEmail(
			{ ...CRITICAL, pondName: "Pond\r\nBcc: attacker@example.test" },
			CONFIGURED,
		);

		const payload = sendMock.mock.calls[0][0];
		expect(payload.subject).not.toContain("\n");
		expect(payload.subject).not.toContain("\r");
	});

	it("escapes markup in the message", async () => {
		await sendCriticalAlertEmail(
			{ ...CRITICAL, message: '<a href="https://evil.example">click</a>' },
			CONFIGURED,
		);

		const payload = sendMock.mock.calls[0][0];
		expect(payload.html).toContain("&lt;a href=&quot;https://evil.example&quot;&gt;");
		expect(payload.html).not.toContain('<a href="https://evil.example">');
	});
});

describe("digest email", () => {
	it("groups items and refuses an empty digest", async () => {
		await expect(sendAlertDigestEmail(DIGEST, CONFIGURED)).resolves.toEqual({ ok: true });

		const payload = sendMock.mock.calls[0][0];
		expect(payload.subject).toBe("Daily alert summary — 1 November 2026");
		expect(payload.html).toContain("Pond A");
		expect(payload.html).toContain("Hopper at 12 %");

		await expect(sendAlertDigestEmail({ ...DIGEST, items: [] }, CONFIGURED)).resolves.toEqual({
			ok: false,
			error: "empty_digest",
			skipped: true,
		});
	});

	it("reports a provider failure instead of throwing", async () => {
		sendMock.mockResolvedValue({ error: { message: "domain not verified" } });

		await expect(sendCriticalAlertEmail(CRITICAL, CONFIGURED)).resolves.toEqual({
			ok: false,
			error: "domain not verified",
		});
	});
});
