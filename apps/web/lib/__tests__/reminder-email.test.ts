import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("resend", () => ({
	Resend: class {
		emails = { send: sendMock };
	},
}));

import {
	__resetReminderEmailWarningForTests,
	isDeliverableReminderAddress,
	sendReminderEmail,
} from "@/lib/notify/email";

const CONFIGURED = {
	RESEND_API_KEY: "re_test_key",
	REMINDER_FROM_EMAIL: "PakaonAI <reminders@syntaxure.dev>",
	NEXT_PUBLIC_BASE_URL: "https://pakaonai.syntaxure.dev",
} as unknown as NodeJS.ProcessEnv;

const INPUT = {
	to: ["owner@example.com", "admin@example.com"],
	pondName: "Pond A",
	cycleLabel: "Batch A",
	eventLabel: "Harvest" as const,
	dateLabel: "2026-11-01",
	timingLabel: "Harvest in 3 days",
};

beforeEach(() => {
	vi.clearAllMocks();
	__resetReminderEmailWarningForTests();
	sendMock.mockResolvedValue({ data: { id: "email-1" }, error: null });
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("reminder email", () => {
	it("rejects the synthetic pond login domain and malformed addresses", () => {
		expect(isDeliverableReminderAddress("owner@example.com")).toBe(true);
		expect(isDeliverableReminderAddress("owner@pond.optifeed.local")).toBe(false);
		expect(isDeliverableReminderAddress("owner")).toBe(false);
		expect(isDeliverableReminderAddress(null)).toBe(false);
	});

	it("sends one message to every deliverable recipient with HTML and text parts", async () => {
		await expect(sendReminderEmail(INPUT, CONFIGURED)).resolves.toEqual({ ok: true });

		expect(sendMock).toHaveBeenCalledTimes(1);
		const payload = sendMock.mock.calls[0][0] as {
			from: string;
			to: string[];
			subject: string;
			html: string;
			text: string;
		};

		expect(payload.from).toBe("PakaonAI <reminders@syntaxure.dev>");
		expect(payload.to).toEqual(["owner@example.com", "admin@example.com"]);
		expect(payload.subject).toContain("Harvest in 3 days");
		expect(payload.subject).toContain("Pond A");
		expect(payload.html).toContain("PakaonAI");
		expect(payload.html).not.toContain("OptiFeed");
		expect(payload.html).toContain("https://pakaonai.syntaxure.dev/dashboard/settings/profile");
		expect(payload.text).toContain("Harvest in 3 days - Pond A");
		expect(payload.text).toContain("a harvest reminder for Pond A.");
		expect(payload.text).toContain(
			"Open the harvest calendar: https://pakaonai.syntaxure.dev/dashboard/calendar",
		);
		expect(payload.text).toContain(
			"Change these alerts in Pond Alert Settings: https://pakaonai.syntaxure.dev/dashboard/settings/profile",
		);
		expect(payload.text).not.toContain("<");
	});

	it("refuses to send a message without a recipient", async () => {
		await expect(sendReminderEmail({ ...INPUT, to: [] }, CONFIGURED)).resolves.toEqual({
			ok: false,
			error: "invalid_recipient",
		});
		expect(sendMock).not.toHaveBeenCalled();
	});
});
