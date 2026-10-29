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
			pondEvent: { findMany: vi.fn() },
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
	buildEventReminderEmailInput,
	buildReminderEmailInput,
	collectRecipientsByOwner,
	computeEventReminderCandidates,
	computeReminderCandidates,
	eventReminderDedupeKey,
	eventReminderTimingLabel,
	isEventReminderDue,
	nextSamplingDueDate,
	processCropReminders,
} from "@/lib/crop-cycle/reminders";
import { __resetReminderEmailWarningForTests } from "@/lib/notify/email";
import prisma from "@/lib/prisma";

const POND = {
	id: "pond-1",
	name: "Pond A",
	farmId: "farm-1",
	ownerId: "owner-1",
	notificationPrefs: {},
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
const mockPondEvent = vi.mocked(prisma.pondEvent);

let seenKeys: Set<string>;

function allDayEvent(overrides: Record<string, unknown> = {}) {
	return {
		id: "event-1",
		pondId: "pond-1",
		title: "Check water quality",
		kind: "TASK" as const,
		allDay: true,
		startsAt: new Date("2026-10-19T00:00:00.000Z"),
		endsAt: null,
		recurrenceFreq: null,
		recurrenceInterval: 1,
		recurrenceUntil: null,
		reminderMinutes: [60],
		completedOccurrences: [] as Date[],
		status: "PLANNED",
		...overrides,
	};
}

function emailLogCalls() {
	return mockReminderLog.create.mock.calls
		.map((call) => call[0] as { data: Record<string, unknown> })
		.filter((call) => call.data.channel === "email");
}

function reminderUpdateCalls() {
	return mockReminderLog.update.mock.calls.map(
		(call) => call[0] as { where: Record<string, unknown>; data: Record<string, unknown> },
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	seenKeys = new Set();

	mockCycle.findMany.mockResolvedValue([CYCLE] as never);
	mockPond.findMany.mockResolvedValue([POND] as never);
	mockBiomass.groupBy.mockResolvedValue([] as never);
	mockUser.findMany.mockResolvedValue([{ farmId: "owner-1", email: "owner@example.com" }] as never);
	mockReminderLog.findMany.mockResolvedValue([] as never);
	mockReminderLog.update.mockResolvedValue({} as never);
	mockPondEvent.findMany.mockResolvedValue([] as never);

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
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	__resetReminderEmailWarningForTests();
});

describe("event reminder timing", () => {
	it("labels day, hour and near-term lead times", () => {
		expect(eventReminderTimingLabel(1440)).toBe("Starts in 1 day");
		expect(eventReminderTimingLabel(2880)).toBe("Starts in 2 days");
		expect(eventReminderTimingLabel(60)).toBe("Starts in 1 hour");
		expect(eventReminderTimingLabel(120)).toBe("Starts in 2 hours");
		expect(eventReminderTimingLabel(90)).toBe("Starts in 2 hours");
		expect(eventReminderTimingLabel(30)).toBe("Starts soon");
	});

	it("judges due dates on the Asia/Manila calendar day, not UTC", () => {
		// 23:30 on 18 Oct in Manila is 15:30 UTC on the same day.
		const lateEighteenth = new Date("2026-10-18T15:30:00.000Z");
		expect(isEventReminderDue(lateEighteenth, 0, "2026-10-18")).toBe(true);
		expect(isEventReminderDue(lateEighteenth, 0, "2026-10-19")).toBe(false);

		// 00:30 on 19 Oct in Manila is still 18 Oct in UTC.
		const earlyNineteenth = new Date("2026-10-18T16:30:00.000Z");
		expect(isEventReminderDue(earlyNineteenth, 0, "2026-10-19")).toBe(true);
		expect(isEventReminderDue(earlyNineteenth, 0, "2026-10-18")).toBe(false);
	});

	it("ignores negative or non-finite lead times", () => {
		const start = new Date("2026-10-19T01:00:00.000Z");
		expect(isEventReminderDue(start, -1, "2026-10-19")).toBe(false);
		expect(isEventReminderDue(start, Number.NaN, "2026-10-19")).toBe(false);
	});
});

describe("computeEventReminderCandidates", () => {
	const TODAY = "2026-10-18";

	it("skips events with no lead time, terminal status or unknown pond", () => {
		const candidates = computeEventReminderCandidates({
			today: TODAY,
			events: [
				allDayEvent({ id: "no-lead", reminderMinutes: [] }),
				allDayEvent({ id: "cancelled", status: "CANCELLED" }),
				allDayEvent({ id: "foreign", pondId: "pond-other" }),
			],
			ponds: [POND],
		});
		expect(candidates).toEqual([]);
	});

	it("fires a timed event reminder on the farm-local trigger day", () => {
		// 09:00 on 19 Oct in Manila is 01:00 UTC.
		const timed = allDayEvent({
			id: "event-timed",
			kind: "EVENT",
			allDay: false,
			startsAt: new Date("2026-10-19T01:00:00.000Z"),
			reminderMinutes: [60, 1440],
		});

		const onTheDay = computeEventReminderCandidates({
			today: "2026-10-19",
			events: [timed],
			ponds: [POND],
		});
		expect(onTheDay).toHaveLength(1);
		expect(onTheDay[0]).toMatchObject({
			eventId: "event-timed",
			itemKind: "EVENT",
			minutes: 60,
			category: "event",
			kind: "event_60",
			timingLabel: "Starts in 1 hour",
			occurrenceDate: "2026-10-19",
			dateLabel: "2026-10-19",
			tier: "INFO",
			message: "Starts in 1 hour — Check water quality at Pond A.",
		});

		const dayBefore = computeEventReminderCandidates({
			today: "2026-10-18",
			events: [timed],
			ponds: [POND],
		});
		expect(dayBefore).toHaveLength(1);
		expect(dayBefore[0]).toMatchObject({ minutes: 1440, timingLabel: "Starts in 1 day" });
	});

	it("treats an all-day item as starting at farm midnight", () => {
		// Farm midnight on 19 Oct is 16:00 UTC on 18 Oct. A 60-minute reminder
		// therefore fires at 23:00 Manila on 18 Oct.
		const event = allDayEvent({ reminderMinutes: [60] });
		const candidates = computeEventReminderCandidates({
			today: "2026-10-18",
			events: [event],
			ponds: [POND],
		});
		expect(candidates).toHaveLength(1);
		expect(candidates[0]).toMatchObject({
			occurrenceKey: "2026-10-19T00:00:00.000Z",
			occurrenceToken: "2026-10-19T00:00:00.000Z",
			dateLabel: "2026-10-19",
		});
	});
});

describe("computeReminderCandidates fallbacks", () => {
	it("ignores a cycle whose pond is not part of the loaded set", () => {
		const candidates = computeReminderCandidates({
			today: "2026-10-18",
			cycles: [{ ...CYCLE, pondId: "pond-other" }],
			ponds: [POND],
		});
		expect(candidates).toEqual([]);
	});

	it("keeps sampling on the pond creation cadence without an active cycle", () => {
		const candidates = computeReminderCandidates({
			today: "2026-09-12",
			cycles: [],
			ponds: [POND],
		});

		expect(candidates).toHaveLength(1);
		expect(candidates[0]).toMatchObject({
			category: "sampling",
			kind: "sampling_d3",
			cropCycleId: null,
			cycleLabel: null,
			dateLabel: "2026-09-15",
			daysRemaining: 3,
			tier: "INFO",
			message: "Sampling due in 3 days — Pond A (due 2026-09-15).",
		});
	});
});

describe("email input builders", () => {
	it("labels a task separately from an event", () => {
		const [taskCandidate] = computeEventReminderCandidates({
			today: "2026-10-18",
			events: [allDayEvent({ kind: "TASK" })],
			ponds: [POND],
		});
		const [eventCandidate] = computeEventReminderCandidates({
			today: "2026-10-18",
			events: [allDayEvent({ kind: "EVENT" })],
			ponds: [POND],
		});

		expect(buildEventReminderEmailInput(taskCandidate, ["a@example.com"])).toEqual({
			to: ["a@example.com"],
			pondName: "Pond A",
			cycleLabel: null,
			eventLabel: "Task",
			dateLabel: "2026-10-19",
			timingLabel: "Starts in 1 hour",
		});
		expect(buildEventReminderEmailInput(eventCandidate, ["a@example.com"]).eventLabel).toBe(
			"Event",
		);
	});

	it("labels harvest and sampling reminders", () => {
		const [harvest] = computeReminderCandidates({
			today: "2026-10-18",
			cycles: [CYCLE],
			ponds: [POND],
		});
		const [sampling] = computeReminderCandidates({
			today: "2026-10-12",
			cycles: [CYCLE],
			ponds: [POND],
		});

		expect(buildReminderEmailInput(harvest, ["a@example.com"])).toMatchObject({
			eventLabel: "Harvest",
			cycleLabel: "Batch A",
			dateLabel: "2026-11-01",
		});
		expect(buildReminderEmailInput(sampling, ["a@example.com"])).toMatchObject({
			eventLabel: "Sampling",
			dateLabel: "2026-10-15",
			timingLabel: "Sampling due in 3 days",
		});
	});
});

describe("sampling cadence fallbacks", () => {
	it("falls back to 14 days for a missing or invalid interval", () => {
		const anchor = { pondCreatedAt: "2026-09-01", sampleIntervalDays: 14 };
		expect(nextSamplingDueDate({ ...anchor, sampleIntervalDays: 0 })).toBe("2026-09-15");
		expect(nextSamplingDueDate({ ...anchor, sampleIntervalDays: -3 })).toBe("2026-09-15");
		expect(nextSamplingDueDate({ ...anchor, sampleIntervalDays: Number.NaN })).toBe("2026-09-15");
	});

	it("rounds a fractional interval and accepts a string stocking date", () => {
		expect(
			nextSamplingDueDate({
				lastSampleAt: null,
				stockingDate: "2026-10-01",
				pondCreatedAt: "2026-09-01",
				sampleIntervalDays: 13.6,
			}),
		).toBe("2026-10-15");
	});
});

describe("recipient grouping", () => {
	it("skips blank addresses and returns an empty map when nobody is reachable", () => {
		expect(
			collectRecipientsByOwner([
				{ farmId: "owner-1", email: null },
				{ farmId: "owner-1", email: "   " },
			]),
		).toEqual(new Map());
		expect(
			collectRecipientsByOwner([{ farmId: "owner-1", email: "  owner@example.com  " }]).get(
				"owner-1",
			),
		).toEqual(["owner@example.com"]);
	});
});

describe("processCropReminders delivery", () => {
	it("returns an empty summary without querying samples when no pond is active", async () => {
		mockPond.findMany.mockResolvedValue([] as never);

		const summary = await processCropReminders({ today: "2026-10-18", emailConfigured: true });

		expect(summary).toMatchObject({
			date: "2026-10-18",
			activeCycles: 1,
			activePonds: 0,
			candidates: 0,
			inAppCreated: 0,
		});
		expect(mockBiomass.groupBy).not.toHaveBeenCalled();
	});

	it("sends event emails once and skips the duplicates on a rerun", async () => {
		mockCycle.findMany.mockResolvedValue([] as never);
		mockPondEvent.findMany.mockResolvedValue([
			allDayEvent({ reminderMinutes: [60, 1440] }),
		] as never);
		const sendEmail = vi.fn().mockResolvedValue({ ok: true });

		const first = await processCropReminders({
			today: "2026-10-18",
			emailConfigured: true,
			sendEmail,
		});
		expect(first).toMatchObject({
			eventCandidates: 2,
			eventInAppCreated: 2,
			eventEmailsSent: 2,
			eventEmailsFailed: 0,
			emailsSent: 0,
		});
		expect(sendEmail).toHaveBeenCalledTimes(2);
		expect(emailLogCalls()).toHaveLength(2);
		expect(emailLogCalls()[0]?.data).toMatchObject({
			pondId: "pond-1",
			pondEventId: "event-1",
			channel: "email",
			recipient: "owner@example.com",
			status: "FAILED",
			attempts: 0,
		});
		expect(reminderUpdateCalls()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					where: { dedupeKey: "event:event-1:2026-10-19T00:00:00.000Z:60:email" },
					data: expect.objectContaining({ status: "SENT", attempts: 1, lastError: null }),
				}),
			]),
		);

		const second = await processCropReminders({
			today: "2026-10-18",
			emailConfigured: true,
			sendEmail,
		});
		expect(second).toMatchObject({
			eventCandidates: 2,
			eventInAppCreated: 0,
			eventInAppSkipped: 2,
			eventEmailsSent: 0,
			eventEmailsSkipped: 2,
		});
		expect(sendEmail).toHaveBeenCalledTimes(2);
	});

	it("records an event email that the provider declines as skipped", async () => {
		mockCycle.findMany.mockResolvedValue([] as never);
		mockPondEvent.findMany.mockResolvedValue([allDayEvent()] as never);
		const sendEmail = vi
			.fn()
			.mockResolvedValue({ ok: false, error: "not configured", skipped: true });

		const summary = await processCropReminders({
			today: "2026-10-18",
			emailConfigured: true,
			sendEmail,
		});

		expect(summary).toMatchObject({ eventEmailsSkipped: 1, eventEmailsSent: 0 });
		expect(reminderUpdateCalls()).toContainEqual({
			where: { dedupeKey: "event:event-1:2026-10-19T00:00:00.000Z:60:email" },
			data: expect.objectContaining({
				status: "FAILED",
				attempts: 1,
				lastError: "Email is not configured",
			}),
		});
	});

	it("records and truncates an event email failure", async () => {
		mockCycle.findMany.mockResolvedValue([] as never);
		mockPondEvent.findMany.mockResolvedValue([allDayEvent()] as never);
		const sendEmail = vi
			.fn()
			.mockResolvedValue({ ok: false, error: `Resend   down\n${"x".repeat(400)}` });

		const summary = await processCropReminders({
			today: "2026-10-18",
			emailConfigured: true,
			sendEmail,
		});

		expect(summary).toMatchObject({ eventEmailsFailed: 1, eventEmailsSent: 0 });
		const update = reminderUpdateCalls().find(
			(call) => call.data.status === "FAILED" && call.data.attempts === 1,
		);
		const lastError = update?.data.lastError as string;
		expect(lastError.startsWith("Resend down x")).toBe(true);
		expect(lastError).not.toContain("\n");
		expect(lastError).toHaveLength(300);
	});

	it("falls back to a readable error when the provider returns blank text", async () => {
		mockCycle.findMany.mockResolvedValue([] as never);
		mockPondEvent.findMany.mockResolvedValue([allDayEvent()] as never);
		const sendEmail = vi.fn().mockResolvedValue({ ok: false, error: "   " });

		await processCropReminders({ today: "2026-10-18", emailConfigured: true, sendEmail });

		expect(reminderUpdateCalls()).toContainEqual({
			where: { dedupeKey: "event:event-1:2026-10-19T00:00:00.000Z:60:email" },
			data: expect.objectContaining({ lastError: "Email delivery failed" }),
		});
	});

	it("counts an event email as skipped when no recipient exists", async () => {
		mockCycle.findMany.mockResolvedValue([] as never);
		mockPondEvent.findMany.mockResolvedValue([allDayEvent()] as never);
		mockUser.findMany.mockResolvedValue([] as never);
		const sendEmail = vi.fn().mockResolvedValue({ ok: true });

		const summary = await processCropReminders({
			today: "2026-10-18",
			emailConfigured: true,
			sendEmail,
		});

		expect(summary).toMatchObject({ eventInAppCreated: 1, eventEmailsSkipped: 1 });
		expect(sendEmail).not.toHaveBeenCalled();
		expect(emailLogCalls()).toHaveLength(0);
	});

	it("skips event emails without configuration but still writes the in-app reminder", async () => {
		mockCycle.findMany.mockResolvedValue([] as never);
		mockPondEvent.findMany.mockResolvedValue([allDayEvent()] as never);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		const summary = await processCropReminders({ today: "2026-10-18", emailConfigured: false });

		expect(summary).toMatchObject({ eventInAppCreated: 1, eventEmailsSkipped: 1 });
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("reminder email skipped"));
	});

	it("skips an event email already claimed by the dedupe key", async () => {
		mockCycle.findMany.mockResolvedValue([] as never);
		mockPondEvent.findMany.mockResolvedValue([allDayEvent()] as never);
		seenKeys.add("event:event-1:2026-10-19T00:00:00.000Z:60:email");
		const sendEmail = vi.fn().mockResolvedValue({ ok: true });

		const summary = await processCropReminders({
			today: "2026-10-18",
			emailConfigured: true,
			sendEmail,
		});

		expect(summary).toMatchObject({ eventEmailsSkipped: 1, eventEmailsSent: 0 });
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it("anchors the sampling window on the latest biomass sample", async () => {
		mockCycle.findMany.mockResolvedValue([] as never);
		mockBiomass.groupBy.mockResolvedValue([
			{ pondId: "pond-1", _max: { recordedAt: new Date("2026-10-10T00:00:00.000Z") } },
		] as never);

		const summary = await processCropReminders({ today: "2026-10-21", emailConfigured: false });

		expect(summary).toMatchObject({ candidates: 1, inAppCreated: 1 });
		expect(mockNotification.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				category: "sampling",
				message: "Sampling due in 3 days — Pond A (due 2026-10-24).",
			}),
		});
	});

	it("counts a harvest email as skipped when the owner has no address", async () => {
		mockUser.findMany.mockResolvedValue([] as never);
		const sendEmail = vi.fn().mockResolvedValue({ ok: true });

		const summary = await processCropReminders({
			today: "2026-10-18",
			emailConfigured: true,
			sendEmail,
		});

		expect(summary).toMatchObject({ inAppCreated: 1, emailsSkipped: 1, emailsSent: 0 });
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it("records a declined harvest email as skipped", async () => {
		const sendEmail = vi.fn().mockResolvedValue({ ok: false, error: "offline", skipped: true });

		const summary = await processCropReminders({
			today: "2026-10-18",
			emailConfigured: true,
			sendEmail,
		});

		expect(summary).toMatchObject({ emailsSkipped: 1, emailsSent: 0, emailsFailed: 0 });
		expect(reminderUpdateCalls()).toContainEqual({
			where: { dedupeKey: "harvest:cycle-1:d14:email" },
			data: expect.objectContaining({
				status: "FAILED",
				attempts: 1,
				lastError: "Email is not configured",
			}),
		});
	});

	it("still reports delivery when recording the email status fails", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		mockReminderLog.update.mockRejectedValueOnce(new Error("status write failed"));
		const sendEmail = vi.fn().mockResolvedValue({ ok: true });

		const summary = await processCropReminders({
			today: "2026-10-18",
			emailConfigured: true,
			sendEmail,
		});

		expect(summary).toMatchObject({ emailsSent: 1 });
		expect(consoleError).toHaveBeenCalledWith(
			"[crop-reminders] could not record email delivery status",
			expect.objectContaining({ message: "status write failed" }),
		);
	});

	it("defers both email batches once the route budget is spent", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-18T12:00:00.000Z"));
		mockPondEvent.findMany.mockResolvedValue([allDayEvent()] as never);
		mockNotification.create.mockImplementation((async () => {
			vi.advanceTimersByTime(6_000);
			return {};
		}) as never);
		const sendEmail = vi.fn().mockResolvedValue({ ok: true });

		const summary = await processCropReminders({
			today: "2026-10-18",
			emailConfigured: true,
			sendEmail,
		});

		expect(summary).toMatchObject({ inAppCreated: 1, eventInAppCreated: 1, emailsDeferred: 2 });
		expect(sendEmail).not.toHaveBeenCalled();
		expect(emailLogCalls()).toHaveLength(0);
	});
});

describe("processCropReminders email retries", () => {
	it("stops retrying when the pond disabled email reminders", async () => {
		mockPond.findMany.mockResolvedValue([
			{ ...POND, notificationPrefs: { emailReminders: false } },
		] as never);
		mockReminderLog.findMany.mockResolvedValue([
			{
				id: "log-1",
				pondId: "pond-1",
				cropCycleId: "cycle-1",
				kind: "harvest_d14",
				dedupeKey: "harvest:cycle-1:d14:email",
				attempts: 1,
			},
		] as never);
		const sendEmail = vi.fn().mockResolvedValue({ ok: true });

		const summary = await processCropReminders({
			today: "2026-10-19",
			emailConfigured: true,
			sendEmail,
		});

		expect(summary).toMatchObject({ emailRetries: 0, emailsSkipped: 0 });
		expect(sendEmail).not.toHaveBeenCalled();
		expect(reminderUpdateCalls()).toContainEqual({
			where: { id: "log-1" },
			data: {
				status: "FAILED",
				attempts: 3,
				lastError: "Email reminders are disabled",
			},
		});
	});

	it("stops retrying reminders that no longer map to an active occurrence", async () => {
		mockReminderLog.findMany.mockResolvedValue([
			{
				id: "log-1",
				pondId: "pond-1",
				cropCycleId: null,
				kind: "harvest_d14",
				dedupeKey: "harvest:null:d14:email",
				attempts: 1,
			},
			{
				id: "log-2",
				pondId: "pond-1",
				cropCycleId: "cycle-1",
				kind: "event_60",
				dedupeKey: "event:x:y:60:email",
				attempts: 1,
			},
			{
				id: "log-3",
				pondId: "pond-1",
				cropCycleId: "cycle-1",
				kind: "harvest_d5",
				dedupeKey: "harvest:cycle-1:d5:email",
				attempts: 1,
			},
		] as never);
		const sendEmail = vi.fn().mockResolvedValue({ ok: true });

		await processCropReminders({ today: "2026-10-19", emailConfigured: true, sendEmail });

		expect(sendEmail).not.toHaveBeenCalled();
		expect(reminderUpdateCalls()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					where: { id: "log-1" },
					data: expect.objectContaining({ lastError: "Reminder is no longer active" }),
				}),
				expect.objectContaining({
					where: { id: "log-2" },
					data: expect.objectContaining({ lastError: "Reminder is no longer active" }),
				}),
				expect.objectContaining({
					where: { id: "log-3" },
					data: expect.objectContaining({ lastError: "Reminder is no longer active" }),
				}),
			]),
		);
	});

	it("stops retrying a sampling reminder with an unreadable dedupe key", async () => {
		mockReminderLog.findMany.mockResolvedValue([
			{
				id: "log-1",
				pondId: "pond-1",
				cropCycleId: null,
				kind: "sampling_due",
				dedupeKey: "sampling:pond-1",
				attempts: 1,
			},
		] as never);
		const sendEmail = vi.fn().mockResolvedValue({ ok: true });

		await processCropReminders({ today: "2026-10-19", emailConfigured: true, sendEmail });

		expect(sendEmail).not.toHaveBeenCalled();
		expect(reminderUpdateCalls()).toContainEqual({
			where: { id: "log-1" },
			data: expect.objectContaining({ lastError: "Reminder is no longer active" }),
		});
	});

	it("stops retrying when no recipient is available", async () => {
		mockReminderLog.findMany.mockResolvedValue([
			{
				id: "log-1",
				pondId: "pond-1",
				cropCycleId: "cycle-1",
				kind: "harvest_d14",
				dedupeKey: "harvest:cycle-1:d14:email",
				attempts: 1,
			},
		] as never);
		mockUser.findMany.mockResolvedValue([] as never);
		const sendEmail = vi.fn().mockResolvedValue({ ok: true });

		await processCropReminders({ today: "2026-10-19", emailConfigured: true, sendEmail });

		expect(sendEmail).not.toHaveBeenCalled();
		expect(reminderUpdateCalls()).toContainEqual({
			where: { id: "log-1" },
			data: { status: "FAILED", attempts: 3, lastError: "No email recipients" },
		});
	});

	it("retries a due-day sampling reminder and records the second attempt", async () => {
		mockReminderLog.findMany.mockResolvedValue([
			{
				id: "log-1",
				pondId: "pond-1",
				cropCycleId: "cycle-1",
				kind: "sampling_due",
				dedupeKey: "sampling:pond-1:2026-10-15:email",
				attempts: 1,
			},
		] as never);
		const sendEmail = vi.fn().mockResolvedValue({ ok: true });

		const summary = await processCropReminders({
			today: "2026-10-19",
			emailConfigured: true,
			sendEmail,
		});

		expect(summary).toMatchObject({ emailRetries: 1, emailRetriesSent: 1 });
		expect(sendEmail).toHaveBeenCalledWith({
			to: ["owner@example.com"],
			pondName: "Pond A",
			cycleLabel: "Batch A",
			eventLabel: "Sampling",
			dateLabel: "2026-10-15",
			timingLabel: "Sampling due today",
		});
		expect(reminderUpdateCalls()).toContainEqual({
			where: { id: "log-1" },
			data: expect.objectContaining({ status: "SENT", attempts: 2, lastError: null }),
		});
	});

	it("reconstructs the due date for a d-3 sampling retry", async () => {
		mockReminderLog.findMany.mockResolvedValue([
			{
				id: "log-1",
				pondId: "pond-1",
				cropCycleId: null,
				kind: "sampling_d3",
				dedupeKey: "sampling:pond-1:2026-10-12:email",
				attempts: 1,
			},
		] as never);
		const sendEmail = vi.fn().mockResolvedValue({ ok: true });

		await processCropReminders({ today: "2026-10-19", emailConfigured: true, sendEmail });

		expect(sendEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				dateLabel: "2026-10-15",
				timingLabel: "Sampling due in 3 days",
				eventLabel: "Sampling",
				cycleLabel: null,
			}),
		);
	});

	it("reconstructs an overdue harvest retry from the kind token", async () => {
		mockReminderLog.findMany.mockResolvedValue([
			{
				id: "log-1",
				pondId: "pond-1",
				cropCycleId: "cycle-1",
				kind: "harvest_overdue_3",
				dedupeKey: "harvest:cycle-1:overdue_3:email",
				attempts: 1,
			},
		] as never);
		const sendEmail = vi.fn().mockResolvedValue({ ok: true });

		await processCropReminders({ today: "2026-10-19", emailConfigured: true, sendEmail });

		expect(sendEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				eventLabel: "Harvest",
				timingLabel: "Harvest overdue by 3 days",
				dateLabel: "2026-11-01",
			}),
		);
	});

	it("counts a declined retry as skipped without consuming an attempt", async () => {
		mockReminderLog.findMany.mockResolvedValue([
			{
				id: "log-1",
				pondId: "pond-1",
				cropCycleId: "cycle-1",
				kind: "harvest_d14",
				dedupeKey: "harvest:cycle-1:d14:email",
				attempts: 1,
			},
		] as never);
		const sendEmail = vi.fn().mockResolvedValue({ ok: false, error: "off", skipped: true });

		const summary = await processCropReminders({
			today: "2026-10-19",
			emailConfigured: true,
			sendEmail,
		});

		expect(summary).toMatchObject({ emailRetries: 1, emailRetriesSent: 0, emailsSkipped: 1 });
		expect(reminderUpdateCalls().some((call) => call.where.id === "log-1")).toBe(false);
	});

	it("caps the attempt count at three after another failure", async () => {
		mockReminderLog.findMany.mockResolvedValue([
			{
				id: "log-1",
				pondId: "pond-1",
				cropCycleId: "cycle-1",
				kind: "harvest_d7",
				dedupeKey: "harvest:cycle-1:d7:email",
				attempts: 2,
			},
		] as never);
		const sendEmail = vi.fn().mockResolvedValue({ ok: false, error: "still down" });

		const summary = await processCropReminders({
			today: "2026-10-19",
			emailConfigured: true,
			sendEmail,
		});

		expect(summary).toMatchObject({ emailRetries: 1, emailRetriesFailed: 1 });
		expect(reminderUpdateCalls()).toContainEqual({
			where: { id: "log-1" },
			data: { status: "FAILED", attempts: 3, lastError: "still down" },
		});
	});

	it("defers retries after the route budget is spent", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-19T12:00:00.000Z"));
		mockReminderLog.findMany.mockImplementation((async () => {
			vi.advanceTimersByTime(6_000);
			return [
				{
					id: "log-1",
					pondId: "pond-1",
					cropCycleId: "cycle-1",
					kind: "harvest_d14",
					dedupeKey: "harvest:cycle-1:d14:email",
					attempts: 1,
				},
			];
		}) as never);
		const sendEmail = vi.fn().mockResolvedValue({ ok: true });

		const summary = await processCropReminders({
			today: "2026-10-19",
			emailConfigured: true,
			sendEmail,
		});

		expect(summary).toMatchObject({ emailRetries: 0, emailsDeferred: 1 });
		expect(sendEmail).not.toHaveBeenCalled();
		expect(reminderUpdateCalls()).toHaveLength(0);
	});
});

describe("processCropReminders error propagation", () => {
	it("rethrows a non-unique in-app write failure", async () => {
		mockNotification.create.mockRejectedValueOnce(new Error("notification table down"));

		await expect(
			processCropReminders({ today: "2026-10-18", emailConfigured: false }),
		).rejects.toThrow("notification table down");
	});
});
