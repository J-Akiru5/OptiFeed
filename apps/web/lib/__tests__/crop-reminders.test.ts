import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
	const reminderCreate = vi.fn();
	const notificationCreate = vi.fn();
	const transactionClient = {
		reminderLog: { create: reminderCreate },
		notification: { create: notificationCreate },
	};

	return {
		default: {
			cropCycle: { findMany: vi.fn() },
			pond: { findMany: vi.fn() },
			biomassLog: { groupBy: vi.fn() },
			user: { findMany: vi.fn() },
			reminderLog: {
				create: reminderCreate,
				findMany: vi.fn(),
				update: vi.fn(),
			},
			notification: { create: notificationCreate },
			$transaction: vi.fn(async (input: unknown) => {
				if (typeof input === "function") {
					return (input as (tx: unknown) => Promise<unknown>)(transactionClient);
				}
				return Promise.all(input as Promise<unknown>[]);
			}),
		},
	};
});

import {
	collectRecipientsByOwner,
	computeReminderCandidates,
	dedupeEmailAddresses,
	harvestOccurrence,
	nextSamplingDueDate,
	processCropReminders,
	reminderDedupeKey,
	samplingOccurrence,
} from "@/lib/crop-cycle/reminders";
import { normalizeNotificationPrefs } from "@/lib/limits";
import {
	__resetReminderEmailWarningForTests,
	isReminderEmailConfigured,
	sendReminderEmail,
} from "@/lib/notify/email";
import prisma from "@/lib/prisma";

const POND = {
	id: "pond-1",
	name: "Pond A",
	farmId: "farm-1",
	ownerId: "owner-1",
	notificationPrefs: {
		missedFeeding: true,
		deviceOffline: true,
		hopperLow: true,
	},
	sampleIntervalDays: 14,
	createdAt: new Date("2026-09-01T00:00:00.000Z"),
};

const CYCLE = {
	id: "cycle-1",
	pondId: "pond-1",
	label: "Batch A",
	stockingDate: new Date("2026-10-01T00:00:00.000Z"),
	targetHarvestDate: new Date("2026-11-01T00:00:00.000Z"),
};

const mockCycle = vi.mocked(prisma.cropCycle);
const mockPond = vi.mocked(prisma.pond);
const mockBiomass = vi.mocked(prisma.biomassLog);
const mockUser = vi.mocked(prisma.user);
const mockReminderLog = vi.mocked(prisma.reminderLog);
const mockNotification = vi.mocked(prisma.notification);
const mockTransaction = vi.mocked(prisma.$transaction) as unknown as {
	mockImplementation: (fn: unknown) => void;
};

let seenKeys: Set<string>;

beforeEach(() => {
	vi.clearAllMocks();
	seenKeys = new Set();

	mockCycle.findMany.mockResolvedValue([CYCLE] as never);
	mockPond.findMany.mockResolvedValue([POND] as never);
	mockBiomass.groupBy.mockResolvedValue([] as never);
	mockUser.findMany.mockResolvedValue([{ farmId: "owner-1", email: "owner@example.com" }] as never);
	mockReminderLog.findMany.mockResolvedValue([] as never);
	mockReminderLog.update.mockResolvedValue({} as never);

	mockReminderLog.create.mockImplementation((async (args: unknown) => {
		const data = (args as { data: { dedupeKey: string } }).data;
		if (seenKeys.has(data.dedupeKey)) {
			throw Object.assign(new Error("Unique constraint failed on dedupeKey"), {
				code: "P2002",
			});
		}
		seenKeys.add(data.dedupeKey);
		return { id: data.dedupeKey };
	}) as never);

	mockNotification.create.mockResolvedValue({} as never);

	mockTransaction.mockImplementation(async (input: unknown) => {
		if (typeof input !== "function") return Promise.all(input as Promise<unknown>[]);
		return (input as (tx: unknown) => Promise<unknown>)({
			reminderLog: { create: mockReminderLog.create },
			notification: { create: mockNotification.create },
		});
	});
});

afterEach(() => {
	vi.unstubAllEnvs();
	__resetReminderEmailWarningForTests();
});

describe("harvest reminder windows", () => {
	it("fires at 14, 7, 3, 1 and 0 days before harvest", () => {
		expect(harvestOccurrence(14)).toEqual({ kind: "harvest_d14", token: "d14" });
		expect(harvestOccurrence(7)).toEqual({ kind: "harvest_d7", token: "d7" });
		expect(harvestOccurrence(3)).toEqual({ kind: "harvest_d3", token: "d3" });
		expect(harvestOccurrence(1)).toEqual({ kind: "harvest_d1", token: "d1" });
		expect(harvestOccurrence(0)).toEqual({ kind: "harvest_d0", token: "d0" });
	});

	it("fires at 1, 3 and 7 days overdue", () => {
		expect(harvestOccurrence(-1)).toEqual({
			kind: "harvest_overdue_1",
			token: "overdue_1",
		});
		expect(harvestOccurrence(-3)).toEqual({
			kind: "harvest_overdue_3",
			token: "overdue_3",
		});
		expect(harvestOccurrence(-7)).toEqual({
			kind: "harvest_overdue_7",
			token: "overdue_7",
		});
	});

	it("is silent outside the configured windows", () => {
		expect(harvestOccurrence(13)).toBeNull();
		expect(harvestOccurrence(2)).toBeNull();
		expect(harvestOccurrence(-2)).toBeNull();
		expect(harvestOccurrence(-8)).toBeNull();
	});

	it("stays silent when the pond disables harvest reminders", () => {
		const candidates = computeReminderCandidates({
			today: "2026-10-18",
			cycles: [CYCLE],
			ponds: [
				{
					...POND,
					notificationPrefs: { ...POND.notificationPrefs, harvestReminders: false },
				},
			],
		});
		expect(candidates).toHaveLength(0);
	});

	it("computes the target and overdue candidates from the cycle date", () => {
		const dueSoon = computeReminderCandidates({
			today: "2026-10-18",
			cycles: [CYCLE],
			ponds: [POND],
		});
		expect(dueSoon).toHaveLength(1);
		expect(dueSoon[0]).toMatchObject({
			kind: "harvest_d14",
			category: "harvest",
			daysRemaining: 14,
			tier: "INFO",
			dateLabel: "2026-11-01",
		});

		const overdue = computeReminderCandidates({
			today: "2026-11-08",
			cycles: [CYCLE],
			ponds: [POND],
		});
		expect(overdue).toHaveLength(1);
		expect(overdue[0]).toMatchObject({
			kind: "harvest_overdue_7",
			daysRemaining: -7,
			tier: "CRITICAL",
			timingLabel: "Harvest overdue by 7 days",
		});
	});
});

describe("sampling reminder windows", () => {
	it("fires 3 days before and on the next due date", () => {
		expect(samplingOccurrence(3)).toEqual({ kind: "sampling_d3" });
		expect(samplingOccurrence(0)).toEqual({ kind: "sampling_due" });
		expect(samplingOccurrence(2)).toBeNull();
		expect(samplingOccurrence(-1)).toBeNull();
	});

	it("uses the latest biomass sample plus the pond interval", () => {
		expect(
			nextSamplingDueDate({
				lastSampleAt: new Date("2026-10-10T00:00:00.000Z"),
				stockingDate: new Date("2026-10-01T00:00:00.000Z"),
				pondCreatedAt: new Date("2026-09-01T00:00:00.000Z"),
				sampleIntervalDays: 14,
			}),
		).toBe("2026-10-24");
	});

	it("falls back to the active cycle stocking date, then the pond creation date", () => {
		expect(
			nextSamplingDueDate({
				lastSampleAt: null,
				stockingDate: new Date("2026-10-01T00:00:00.000Z"),
				pondCreatedAt: new Date("2026-09-01T00:00:00.000Z"),
				sampleIntervalDays: 14,
			}),
		).toBe("2026-10-15");

		expect(
			nextSamplingDueDate({
				pondCreatedAt: new Date("2026-09-01T00:00:00.000Z"),
				sampleIntervalDays: 14,
			}),
		).toBe("2026-09-15");
	});

	it("stays silent when the pond disables sampling reminders", () => {
		const candidates = computeReminderCandidates({
			today: "2026-10-12",
			cycles: [CYCLE],
			ponds: [
				{
					...POND,
					notificationPrefs: { ...POND.notificationPrefs, samplingReminders: false },
				},
			],
		});
		expect(candidates).toHaveLength(0);
	});

	it("computes the d-3 and due-day candidates", () => {
		const lead = computeReminderCandidates({
			today: "2026-10-12",
			cycles: [CYCLE],
			ponds: [POND],
		});
		expect(lead).toHaveLength(1);
		expect(lead[0]).toMatchObject({
			kind: "sampling_d3",
			category: "sampling",
			dateLabel: "2026-10-15",
			timingLabel: "Sampling due in 3 days",
		});

		const due = computeReminderCandidates({
			today: "2026-10-15",
			cycles: [CYCLE],
			ponds: [POND],
		});
		expect(due).toHaveLength(1);
		expect(due[0]).toMatchObject({ kind: "sampling_due", tier: "WARNING" });
	});

	it("uses the latest sample instead of the stocking date when available", () => {
		const candidates = computeReminderCandidates({
			today: "2026-10-24",
			cycles: [CYCLE],
			ponds: [POND],
			latestSampleByPond: new Map([["pond-1", new Date("2026-10-10T00:00:00.000Z")]]),
		});
		expect(candidates).toHaveLength(1);
		expect(candidates[0]).toMatchObject({
			kind: "sampling_due",
			dateLabel: "2026-10-24",
		});
	});
});

describe("reminder dedupe keys", () => {
	it("uses cycle + occurrence + channel for harvest", () => {
		const [candidate] = computeReminderCandidates({
			today: "2026-10-18",
			cycles: [CYCLE],
			ponds: [POND],
		});
		expect(candidate).toBeDefined();
		expect(reminderDedupeKey(candidate as never, "in_app")).toBe("harvest:cycle-1:d14:in_app");
		expect(reminderDedupeKey(candidate as never, "email")).toBe("harvest:cycle-1:d14:email");
	});

	it("uses pond + occurrence date + channel for sampling", () => {
		const [candidate] = computeReminderCandidates({
			today: "2026-10-12",
			cycles: [CYCLE],
			ponds: [POND],
		});
		expect(candidate).toBeDefined();
		expect(reminderDedupeKey(candidate as never, "in_app")).toBe(
			"sampling:pond-1:2026-10-12:in_app",
		);
		expect(reminderDedupeKey(candidate as never, "email")).toBe("sampling:pond-1:2026-10-12:email");
	});

	it("keeps the d-3 and due-day sampling occurrences distinct", () => {
		const lead = computeReminderCandidates({
			today: "2026-10-12",
			cycles: [CYCLE],
			ponds: [POND],
		})[0];
		const due = computeReminderCandidates({
			today: "2026-10-15",
			cycles: [CYCLE],
			ponds: [POND],
		})[0];
		expect(reminderDedupeKey(lead as never, "in_app")).not.toBe(
			reminderDedupeKey(due as never, "in_app"),
		);
	});
});

describe("legacy notification prefs", () => {
	it("merges missing keys with true for a legacy row", () => {
		expect(normalizeNotificationPrefs({ missedFeeding: false })).toEqual({
			missedFeeding: false,
			deviceOffline: true,
			hopperLow: true,
			harvestReminders: true,
			samplingReminders: true,
			emailReminders: true,
		});
	});

	it("defaults everything to true for null or malformed JSON", () => {
		const defaults = {
			missedFeeding: true,
			deviceOffline: true,
			hopperLow: true,
			harvestReminders: true,
			samplingReminders: true,
			emailReminders: true,
		};
		expect(normalizeNotificationPrefs(null)).toEqual(defaults);
		expect(normalizeNotificationPrefs("legacy")).toEqual(defaults);
		expect(normalizeNotificationPrefs([true, false])).toEqual(defaults);
		expect(normalizeNotificationPrefs({ harvestReminders: "yes" })).toEqual(defaults);
	});

	it("respects explicit false values", () => {
		expect(
			normalizeNotificationPrefs({
				harvestReminders: false,
				samplingReminders: false,
				emailReminders: false,
			}),
		).toEqual({
			missedFeeding: true,
			deviceOffline: true,
			hopperLow: true,
			harvestReminders: false,
			samplingReminders: false,
			emailReminders: false,
		});
	});
});

describe("email configuration and recipients", () => {
	it("reports configured only when all three email vars exist", () => {
		expect(isReminderEmailConfigured({} as unknown as NodeJS.ProcessEnv)).toBe(false);
		expect(
			isReminderEmailConfigured({
				RESEND_API_KEY: "re_test",
				REMINDER_FROM_EMAIL: "reminders@example.com",
			} as unknown as NodeJS.ProcessEnv),
		).toBe(false);
		expect(
			isReminderEmailConfigured({
				RESEND_API_KEY: "re_test",
				REMINDER_FROM_EMAIL: "reminders@example.com",
				NEXT_PUBLIC_BASE_URL: "https://app.example.com",
			} as unknown as NodeJS.ProcessEnv),
		).toBe(true);
	});

	it("skips email without configuration instead of throwing", async () => {
		vi.stubEnv("RESEND_API_KEY", "");
		vi.stubEnv("REMINDER_FROM_EMAIL", "");
		vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");

		const result = await sendReminderEmail({
			to: ["owner@example.com"],
			pondName: "Pond A",
			cycleLabel: "Batch A",
			eventLabel: "Harvest",
			dateLabel: "2026-11-01",
			timingLabel: "Harvest in 14 days",
		});
		expect(result).toEqual({ ok: false, error: "email_not_configured", skipped: true });
	});

	it("deduplicates recipient addresses case-insensitively", () => {
		expect(
			dedupeEmailAddresses([
				"Owner@Example.com",
				"owner@example.com",
				" admin@example.com ",
				null,
				"",
			]),
		).toEqual(["Owner@Example.com", "admin@example.com"]);
	});

	it("groups and deduplicates recipients by pond owner", () => {
		const grouped = collectRecipientsByOwner([
			{ farmId: "owner-1", email: "owner@example.com" },
			{ farmId: "owner-1", email: "OWNER@example.com" },
			{ farmId: "owner-1", email: "admin@example.com" },
			{ farmId: "owner-2", email: "other@example.com" },
		]);
		expect(grouped.get("owner-1")).toEqual(["owner@example.com", "admin@example.com"]);
		expect(grouped.get("owner-2")).toEqual(["other@example.com"]);
	});
});

describe("processCropReminders idempotency", () => {
	it("creates one in-app reminder and a rerun creates zero duplicates", async () => {
		const first = await processCropReminders({ today: "2026-10-18", emailConfigured: false });
		expect(first).toMatchObject({
			candidates: 1,
			inAppCreated: 1,
			inAppSkipped: 0,
			emailsSent: 0,
		});
		expect(mockNotification.create).toHaveBeenCalledTimes(1);
		expect(mockNotification.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				pondId: "pond-1",
				category: "harvest",
				tier: "INFO",
				linkTo: "/dashboard/harvest",
			}),
		});
		expect(seenKeys.has("harvest:cycle-1:d14:in_app")).toBe(true);
		expect(seenKeys.has("harvest:cycle-1:d14:email")).toBe(false);

		const second = await processCropReminders({ today: "2026-10-18", emailConfigured: false });
		expect(second).toMatchObject({
			candidates: 1,
			inAppCreated: 0,
			inAppSkipped: 1,
			emailsSent: 0,
		});
		expect(mockNotification.create).toHaveBeenCalledTimes(1);
	});

	it("sends email once and a rerun creates no duplicate email", async () => {
		const sendEmail = vi.fn().mockResolvedValue({ ok: true });

		const first = await processCropReminders({
			today: "2026-10-18",
			emailConfigured: true,
			sendEmail,
		});
		expect(first).toMatchObject({ inAppCreated: 1, emailsSent: 1, emailsFailed: 0 });
		expect(seenKeys.has("harvest:cycle-1:d14:email")).toBe(true);

		const second = await processCropReminders({
			today: "2026-10-18",
			emailConfigured: true,
			sendEmail,
		});
		expect(second).toMatchObject({
			inAppCreated: 0,
			inAppSkipped: 1,
			emailsSent: 0,
			emailsSkipped: 1,
		});
		expect(sendEmail).toHaveBeenCalledTimes(1);
	});

	it("keeps in-app delivery when the pond disables email reminders", async () => {
		mockPond.findMany.mockResolvedValue([
			{
				...POND,
				notificationPrefs: { ...POND.notificationPrefs, emailReminders: false },
			},
		] as never);
		const sendEmail = vi.fn().mockResolvedValue({ ok: true });

		const summary = await processCropReminders({
			today: "2026-10-18",
			emailConfigured: true,
			sendEmail,
		});
		expect(summary).toMatchObject({ inAppCreated: 1, emailsSent: 0, emailsSkipped: 0 });
		expect(sendEmail).not.toHaveBeenCalled();
		expect(seenKeys.has("harvest:cycle-1:d14:email")).toBe(false);
	});

	it("records an email failure and retries it on a later run", async () => {
		const failingSend = vi.fn().mockResolvedValue({ ok: false, error: "Resend unavailable" });

		const first = await processCropReminders({
			today: "2026-10-18",
			emailConfigured: true,
			sendEmail: failingSend,
		});
		expect(first).toMatchObject({
			inAppCreated: 1,
			emailsSent: 0,
			emailsFailed: 1,
		});
		expect(mockReminderLog.update).toHaveBeenCalledWith({
			where: { dedupeKey: "harvest:cycle-1:d14:email" },
			data: expect.objectContaining({
				status: "FAILED",
				attempts: 1,
				lastError: "Resend unavailable",
			}),
		});

		// The next day is d13, so there is no new candidate. The retry pass still
		// picks up the FAILED d14 email and sends it exactly once.
		mockReminderLog.findMany.mockResolvedValue([
			{
				id: "log-email-1",
				pondId: "pond-1",
				cropCycleId: "cycle-1",
				kind: "harvest_d14",
				dedupeKey: "harvest:cycle-1:d14:email",
				attempts: 1,
			},
		] as never);
		const retrySend = vi.fn().mockResolvedValue({ ok: true });

		const second = await processCropReminders({
			today: "2026-10-19",
			emailConfigured: true,
			sendEmail: retrySend,
		});
		expect(second).toMatchObject({
			candidates: 0,
			emailRetries: 1,
			emailRetriesSent: 1,
			emailRetriesFailed: 0,
		});
		expect(retrySend).toHaveBeenCalledTimes(1);
		expect(mockReminderLog.update).toHaveBeenCalledWith({
			where: { id: "log-email-1" },
			data: expect.objectContaining({ status: "SENT", attempts: 2, lastError: null }),
		});
	});

	it("asks the database only for failures below three attempts", async () => {
		const sendEmail = vi.fn().mockResolvedValue({ ok: true });

		const summary = await processCropReminders({
			today: "2026-10-19",
			emailConfigured: true,
			sendEmail,
		});

		expect(mockReminderLog.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					channel: "email",
					status: "FAILED",
					attempts: { lt: 3 },
				}),
			}),
		);
		expect(summary.emailRetries).toBe(0);
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it("keeps the in-app notification when email is unconfigured", async () => {
		const summary = await processCropReminders({
			today: "2026-10-18",
			emailConfigured: false,
		});
		expect(summary).toMatchObject({
			candidates: 1,
			inAppCreated: 1,
			emailsSent: 0,
			emailsSkipped: 1,
		});
		expect(seenKeys.has("harvest:cycle-1:d14:email")).toBe(false);
	});
});
