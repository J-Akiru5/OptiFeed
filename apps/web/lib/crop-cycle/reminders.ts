import { farmDateTimeToUtcDate, utcDateToFarmDateTime } from "@/lib/calendar/datetime";
import { expandOccurrences } from "@/lib/calendar/recurrence";
import { normalizeNotificationPrefs } from "@/lib/limits";
import {
	type ReminderEmailInput,
	type ReminderEmailResult,
	isReminderEmailConfigured,
	sendReminderEmail,
	warnReminderEmailNotConfiguredOnce,
} from "@/lib/notify/email";
import prisma from "@/lib/prisma";
import { addDays, dateToFarmDateOnly, daysBetween, formatDateOnly, todayDateOnly } from "./dates";

/**
 * Crop reminder calculation and delivery (plan §4.3 / §9).
 *
 * `computeReminderCandidates` is pure and owns the trigger windows and dedupe
 * keys. `processCropReminders` is the cron service: it batches reads, inserts
 * `ReminderLog` rows as the idempotency gate, creates in-app notifications, and
 * sends email best-effort. Re-running it produces no duplicate reminder.
 */

export const HARVEST_REMINDER_DAYS = [14, 7, 3, 1, 0] as const;
export const HARVEST_OVERDUE_DAYS = [1, 3, 7] as const;
export const SAMPLING_LEAD_DAYS = 3;
export const MAX_EMAIL_ATTEMPTS = 3;

const EMAIL_RETRY_LIMIT = 25;
const EMAIL_CONCURRENCY = 4;
// Stop starting new sends at 5 s. A send that starts just before the deadline
// is bounded by the email layer's 2 s timeout, keeping the whole job under the
// route's 8 s cap even after the in-app writes.
const ROUTE_BUDGET_MS = 5_000;
const MAX_ERROR_LENGTH = 300;
const REMINDER_LINK = "/dashboard/harvest";

export type NotificationTier = "INFO" | "WARNING" | "CRITICAL";
export type ReminderCategory = "harvest" | "sampling" | "event";
export type ReminderChannel = "in_app" | "email";

export interface ReminderCycleInput {
	id: string;
	pondId: string;
	label: string | null;
	stockingDate: Date | string;
	targetHarvestDate: Date | string;
}

export interface ReminderPondInput {
	id: string;
	name: string;
	farmId: string | null;
	ownerId: string;
	notificationPrefs: unknown;
	sampleIntervalDays: number;
	createdAt: Date | string;
}

export interface ReminderCandidate {
	pondId: string;
	pondName: string;
	farmId: string | null;
	cropCycleId: string | null;
	cycleLabel: string | null;
	category: ReminderCategory;
	kind: string;
	/** `d14` / `overdue_1` for harvest, the occurrence date for sampling. */
	occurrenceToken: string;
	tier: NotificationTier;
	message: string;
	timingLabel: string;
	dateLabel: string;
	daysRemaining: number;
}

export interface ReminderCandidateInput {
	today: string;
	cycles: ReminderCycleInput[];
	ponds: ReminderPondInput[];
	latestSampleByPond?: ReadonlyMap<string, Date | string>;
}

export interface EventReminderSource {
	id: string;
	pondId: string;
	title: string;
	kind: "EVENT" | "TASK";
	allDay: boolean;
	startsAt: Date | string;
	endsAt: Date | string | null;
	recurrenceFreq: "DAILY" | "WEEKLY" | "MONTHLY" | null;
	recurrenceInterval: number;
	recurrenceUntil: Date | string | null;
	reminderMinutes: number[];
	completedOccurrences: Array<Date | string>;
	status: string;
}

export interface EventReminderCandidate {
	eventId: string;
	pondId: string;
	pondName: string;
	farmId: string | null;
	title: string;
	itemKind: "EVENT" | "TASK";
	occurrenceKey: string;
	occurrenceDate: string;
	minutes: number;
	category: "event";
	kind: string;
	occurrenceToken: string;
	tier: NotificationTier;
	message: string;
	timingLabel: string;
	dateLabel: string;
}

export interface EventReminderCandidateInput {
	today: string;
	events: EventReminderSource[];
	ponds: ReminderPondInput[];
}

export interface CropWatchSummary {
	date: string;
	activeCycles: number;
	activePonds: number;
	candidates: number;
	inAppCreated: number;
	inAppSkipped: number;
	emailsSent: number;
	emailsFailed: number;
	emailsSkipped: number;
	emailsDeferred: number;
	emailRetries: number;
	emailRetriesSent: number;
	emailRetriesFailed: number;
	eventCandidates: number;
	eventInAppCreated: number;
	eventInAppSkipped: number;
	eventEmailsSent: number;
	eventEmailsFailed: number;
	eventEmailsSkipped: number;
}

export type ReminderEmailSender = (input: ReminderEmailInput) => Promise<ReminderEmailResult>;

export interface CropWatchOptions {
	today?: string;
	emailConfigured?: boolean;
	sendEmail?: ReminderEmailSender;
}

interface FailedEmailLog {
	id: string;
	pondId: string;
	cropCycleId: string | null;
	kind: string;
	dedupeKey: string;
	attempts: number;
}

/**
 * Harvest occurrence for a whole-day distance from the target date. Positive
 * values are days remaining, zero is the target day, negative values are
 * overdue. Returns null outside the configured trigger windows.
 */
export function harvestOccurrence(daysToHarvest: number): { kind: string; token: string } | null {
	if (daysToHarvest >= 0) {
		if (!(HARVEST_REMINDER_DAYS as readonly number[]).includes(daysToHarvest)) return null;
		return { kind: `harvest_d${daysToHarvest}`, token: `d${daysToHarvest}` };
	}

	const overdue = Math.abs(daysToHarvest);
	if (!(HARVEST_OVERDUE_DAYS as readonly number[]).includes(overdue)) return null;
	return { kind: `harvest_overdue_${overdue}`, token: `overdue_${overdue}` };
}

/** Sampling fires 3 days before the next due date and on the due date. */
export function samplingOccurrence(daysUntilDue: number): { kind: string } | null {
	if (daysUntilDue === SAMPLING_LEAD_DAYS) return { kind: "sampling_d3" };
	if (daysUntilDue === 0) return { kind: "sampling_due" };
	return null;
}

/**
 * Latest biomass sample + the pond's sampling interval. With no sample, the
 * active cycle's stocking date is the anchor; with no active cycle, the pond's
 * creation date is. The fallback keeps legacy ponds on a sampling cadence.
 */
export function nextSamplingDueDate(input: {
	lastSampleAt?: Date | string | null;
	stockingDate?: Date | string | null;
	pondCreatedAt: Date | string;
	sampleIntervalDays: number;
}): string {
	const anchor = input.lastSampleAt ?? input.stockingDate ?? input.pondCreatedAt;
	const interval =
		Number.isFinite(input.sampleIntervalDays) && input.sampleIntervalDays > 0
			? Math.round(input.sampleIntervalDays)
			: 14;
	return addDays(formatDateOnly(anchor), interval);
}

/**
 * `harvest:<cycleId>:<token>:<channel>` for harvest;
 * `sampling:<pondId>:<occurrenceDate>:<channel>` for sampling.
 *
 * The sampling token is the day the reminder fires, not the due date. Using the
 * due date for both the d-3 and due-day triggers would collapse them into one
 * dedupe key and suppress the due-day reminder.
 */
export function reminderDedupeKey(candidate: ReminderCandidate, channel: ReminderChannel): string {
	return candidate.category === "harvest"
		? `harvest:${candidate.cropCycleId}:${candidate.occurrenceToken}:${channel}`
		: `sampling:${candidate.pondId}:${candidate.occurrenceToken}:${channel}`;
}

/**
 * The brief's identity is `event:<id>:<occurrence ISO>:<minutes>`. The channel
 * suffix is appended because `ReminderLog.dedupeKey` is unique per row and the
 * in-app and email rows are separate rows (the same pattern as harvest and
 * sampling reminders).
 */
export function eventReminderDedupeKey(
	candidate: Pick<EventReminderCandidate, "eventId" | "occurrenceKey" | "minutes">,
	channel: ReminderChannel,
): string {
	return `event:${candidate.eventId}:${candidate.occurrenceKey}:${candidate.minutes}:${channel}`;
}

export function eventReminderTimingLabel(minutes: number): string {
	if (minutes >= 1440) {
		const days = Math.round(minutes / 1440);
		return days === 1 ? "Starts in 1 day" : `Starts in ${days} days`;
	}
	if (minutes >= 60) {
		const hours = Math.round(minutes / 60);
		return hours === 1 ? "Starts in 1 hour" : `Starts in ${hours} hours`;
	}
	return "Starts soon";
}

/**
 * Day-window due check. The daily cron is day-based: a reminder is due when
 * the farm-local date of `occurrenceStart - minutes` is today. This keeps a
 * 1-hour and a 1-day reminder for the same all-day occurrence on different
 * days and makes reruns idempotent through the dedupe key.
 */
export function isEventReminderDue(
	occurrenceStartUtc: Date,
	minutes: number,
	today: string,
): boolean {
	if (!Number.isFinite(minutes) || minutes < 0) return false;
	const triggerAt = new Date(occurrenceStartUtc.getTime() - minutes * 60_000);
	return dateToFarmDateOnly(triggerAt) === today;
}

export function computeEventReminderCandidates(
	input: EventReminderCandidateInput,
): EventReminderCandidate[] {
	const { today, events, ponds } = input;
	const pondById = new Map(ponds.map((pond) => [pond.id, pond]));
	// A 1-day reminder for tomorrow's occurrence fires today; widen the
	// expansion window by a day on each side so the trigger date is exhaustive.
	const window = { from: addDays(today, -1), to: addDays(today, 2) };
	const candidates: EventReminderCandidate[] = [];

	for (const event of events) {
		const minutesList = event.reminderMinutes ?? [];
		if (minutesList.length === 0) continue;
		if (event.status === "DONE" || event.status === "CANCELLED") continue;

		const pond = pondById.get(event.pondId);
		if (!pond) continue;

		const anchorDate = formatDateOnly(event.startsAt);
		const anchor = event.allDay ? anchorDate : utcDateToFarmDateTime(new Date(event.startsAt));
		const end = event.endsAt
			? event.allDay
				? formatDateOnly(event.endsAt)
				: utcDateToFarmDateTime(new Date(event.endsAt))
			: null;
		const completed = new Set(
			event.completedOccurrences.map((value) => new Date(value).toISOString()),
		);

		const { occurrences } = expandOccurrences({
			start: anchor,
			end,
			allDay: event.allDay,
			recurrence: event.recurrenceFreq
				? {
						freq: event.recurrenceFreq,
						interval: event.recurrenceInterval,
						until: event.recurrenceUntil ? formatDateOnly(event.recurrenceUntil) : null,
					}
				: null,
			window,
		});

		for (const occurrence of occurrences) {
			if (completed.has(occurrence.occurrenceKey)) continue;
			// An all-day item starts at farm midnight, not UTC midnight; its
			// "1 hour before" reminder belongs to the previous farm evening.
			const triggerBaseUtc = event.allDay
				? farmDateTimeToUtcDate(`${occurrence.start.slice(0, 10)}T00:00`)
				: occurrence.startUtc;
			for (const minutes of minutesList) {
				if (!isEventReminderDue(triggerBaseUtc, minutes, today)) continue;
				const timingLabel = eventReminderTimingLabel(minutes);
				candidates.push({
					eventId: event.id,
					pondId: event.pondId,
					pondName: pond.name,
					farmId: pond.farmId,
					title: event.title,
					itemKind: event.kind,
					occurrenceKey: occurrence.occurrenceKey,
					occurrenceDate: occurrence.start.slice(0, 10),
					minutes,
					category: "event",
					kind: `event_${minutes}`,
					occurrenceToken: occurrence.occurrenceKey,
					tier: "INFO",
					message: `${timingLabel} — ${event.title} at ${pond.name}.`,
					timingLabel,
					dateLabel: occurrence.start.slice(0, 10),
				});
			}
		}
		// The day filter above bounds the expansion; `truncated` is only
		// relevant for the calendar grid's 500-occurrence cap.
	}

	return candidates;
}

export function buildEventReminderEmailInput(
	candidate: EventReminderCandidate,
	recipients: string[],
): ReminderEmailInput {
	return {
		to: recipients,
		pondName: candidate.pondName,
		cycleLabel: null,
		eventLabel: candidate.itemKind === "TASK" ? "Task" : "Event",
		dateLabel: candidate.dateLabel,
		timingLabel: candidate.timingLabel,
	};
}

export function dedupeEmailAddresses(values: Array<string | null | undefined>): string[] {
	const seen = new Set<string>();
	const emails: string[] = [];
	for (const value of values) {
		const email = value?.trim();
		if (!email) continue;
		const key = email.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		emails.push(email);
	}
	return emails;
}

export function collectRecipientsByOwner(
	users: Array<{ farmId: string; email: string | null }>,
): Map<string, string[]> {
	const grouped = new Map<string, string[]>();
	for (const user of users) {
		const email = user.email?.trim();
		if (!email) continue;
		const list = grouped.get(user.farmId) ?? [];
		list.push(email);
		grouped.set(user.farmId, list);
	}
	for (const [farmId, emails] of grouped) {
		grouped.set(farmId, dedupeEmailAddresses(emails));
	}
	return grouped;
}

export function computeReminderCandidates(input: ReminderCandidateInput): ReminderCandidate[] {
	const { today, cycles, ponds } = input;
	const pondById = new Map(ponds.map((pond) => [pond.id, pond]));
	const prefsByPond = new Map(
		ponds.map((pond) => [pond.id, normalizeNotificationPrefs(pond.notificationPrefs)]),
	);
	const cycleByPond = new Map<string, ReminderCycleInput>();
	for (const cycle of cycles) {
		if (!pondById.has(cycle.pondId) || cycleByPond.has(cycle.pondId)) continue;
		cycleByPond.set(cycle.pondId, cycle);
	}

	const candidates: ReminderCandidate[] = [];

	for (const cycle of cycles) {
		const pond = pondById.get(cycle.pondId);
		if (!pond) continue;
		if (!prefsByPond.get(pond.id)?.harvestReminders) continue;

		const targetDate = formatDateOnly(cycle.targetHarvestDate);
		const daysToHarvest = daysBetween(today, targetDate);
		const occurrence = harvestOccurrence(daysToHarvest);
		if (!occurrence) continue;

		candidates.push(buildHarvestCandidate(pond, cycle, daysToHarvest, occurrence.token));
	}

	for (const pond of ponds) {
		if (!prefsByPond.get(pond.id)?.samplingReminders) continue;

		const cycle = cycleByPond.get(pond.id) ?? null;
		const dueDate = nextSamplingDueDate({
			lastSampleAt: input.latestSampleByPond?.get(pond.id) ?? null,
			stockingDate: cycle?.stockingDate ?? null,
			pondCreatedAt: pond.createdAt,
			sampleIntervalDays: pond.sampleIntervalDays,
		});
		const daysUntilDue = daysBetween(today, dueDate);
		const occurrence = samplingOccurrence(daysUntilDue);
		if (!occurrence) continue;

		candidates.push(buildSamplingCandidate(pond, cycle, dueDate, daysUntilDue, today));
	}

	return candidates;
}

export function buildReminderEmailInput(
	candidate: ReminderCandidate,
	recipients: string[],
): ReminderEmailInput {
	return {
		to: recipients,
		pondName: candidate.pondName,
		cycleLabel: candidate.cycleLabel,
		eventLabel: candidate.category === "harvest" ? "Harvest" : "Sampling",
		dateLabel: candidate.dateLabel,
		timingLabel: candidate.timingLabel,
	};
}

export async function processCropReminders(
	options: CropWatchOptions = {},
): Promise<CropWatchSummary> {
	const today = options.today ?? todayDateOnly();
	const startedAt = Date.now();
	const summary: CropWatchSummary = {
		date: today,
		activeCycles: 0,
		activePonds: 0,
		candidates: 0,
		inAppCreated: 0,
		inAppSkipped: 0,
		emailsSent: 0,
		emailsFailed: 0,
		emailsSkipped: 0,
		emailsDeferred: 0,
		emailRetries: 0,
		emailRetriesSent: 0,
		emailRetriesFailed: 0,
		eventCandidates: 0,
		eventInAppCreated: 0,
		eventInAppSkipped: 0,
		eventEmailsSent: 0,
		eventEmailsFailed: 0,
		eventEmailsSkipped: 0,
	};

	const [cycles, ponds] = await Promise.all([
		prisma.cropCycle.findMany({
			where: { status: "ACTIVE", pond: { status: "ACTIVE" } },
			select: {
				id: true,
				pondId: true,
				label: true,
				stockingDate: true,
				targetHarvestDate: true,
			},
			take: 500,
		}),
		prisma.pond.findMany({
			where: { status: "ACTIVE", isFallow: false },
			select: {
				id: true,
				name: true,
				farmId: true,
				ownerId: true,
				notificationPrefs: true,
				sampleIntervalDays: true,
				createdAt: true,
			},
			take: 500,
		}),
	]);

	summary.activeCycles = cycles.length;
	summary.activePonds = ponds.length;
	if (ponds.length === 0) return summary;

	const pondIds = ponds.map((pond) => pond.id);
	const ownerIds = [...new Set(ponds.map((pond) => pond.ownerId))];
	const pondById = new Map(ponds.map((pond) => [pond.id, pond]));
	const cycleById = new Map(cycles.map((cycle) => [cycle.id, cycle]));
	const prefsByPond = new Map(
		ponds.map((pond) => [pond.id, normalizeNotificationPrefs(pond.notificationPrefs)]),
	);

	const [sampleGroups, users, failedEmails, reminderEvents] = await Promise.all([
		prisma.biomassLog.groupBy({
			by: ["pondId"],
			where: { pondId: { in: pondIds } },
			_max: { recordedAt: true },
		}),
		prisma.user.findMany({
			where: {
				email: { not: "" },
				OR: [
					{ farmId: { in: ownerIds } },
					{
						farm: { is: { ownerId: { in: ownerIds } } },
						role: { in: ["ADMIN", "OPERATOR"] },
					},
				],
			},
			select: { farmId: true, email: true },
		}),
		prisma.reminderLog.findMany({
			where: {
				channel: "email",
				status: "FAILED",
				attempts: { lt: MAX_EMAIL_ATTEMPTS },
				pondId: { in: pondIds },
			},
			orderBy: { sentAt: "asc" },
			take: EMAIL_RETRY_LIMIT,
			select: {
				id: true,
				pondId: true,
				cropCycleId: true,
				kind: true,
				dedupeKey: true,
				attempts: true,
			},
		}),
		prisma.pondEvent.findMany({
			where: {
				pondId: { in: pondIds },
				status: { in: ["PLANNED", "MISSED"] },
				source: "manual",
				reminderMinutes: { isEmpty: false },
			},
			orderBy: { startsAt: "asc" },
			take: 500,
			select: {
				id: true,
				pondId: true,
				title: true,
				kind: true,
				allDay: true,
				startsAt: true,
				endsAt: true,
				recurrenceFreq: true,
				recurrenceInterval: true,
				recurrenceUntil: true,
				reminderMinutes: true,
				completedOccurrences: true,
				status: true,
			},
		}),
	]);

	const latestSampleByPond = new Map<string, Date>();
	for (const group of sampleGroups) {
		if (group._max.recordedAt) latestSampleByPond.set(group.pondId, group._max.recordedAt);
	}
	const recipientsByOwner = collectRecipientsByOwner(users);
	const candidates = computeReminderCandidates({
		today,
		cycles,
		ponds,
		latestSampleByPond,
	});
	summary.candidates = candidates.length;

	const eventCandidates = computeEventReminderCandidates({
		today,
		events: reminderEvents,
		ponds,
	});
	summary.eventCandidates = eventCandidates.length;

	const emailConfigured = options.emailConfigured ?? isReminderEmailConfigured();
	const sendEmail = options.sendEmail ?? sendReminderEmail;

	// 1. In-app first: it is the guaranteed channel. The ReminderLog insert and
	//    the Notification insert share a transaction so a failed notification
	//    does not consume the idempotency key.
	for (const candidate of candidates) {
		const dedupeKey = reminderDedupeKey(candidate, "in_app");
		try {
			await prisma.$transaction(async (tx) => {
				await tx.reminderLog.create({
					data: {
						pondId: candidate.pondId,
						cropCycleId: candidate.cropCycleId,
						kind: candidate.kind,
						channel: "in_app",
						dedupeKey,
					},
				});
				await tx.notification.create({
					data: {
						pondId: candidate.pondId,
						farmId: candidate.farmId,
						tier: candidate.tier,
						category: candidate.category,
						message: candidate.message,
						linkTo: REMINDER_LINK,
					},
				});
			});
			summary.inAppCreated += 1;
		} catch (error) {
			if (isUniqueConstraintError(error)) {
				summary.inAppSkipped += 1;
				continue;
			}
			throw error;
		}
	}

	for (const candidate of eventCandidates) {
		const dedupeKey = eventReminderDedupeKey(candidate, "in_app");
		try {
			await prisma.$transaction(async (tx) => {
				await tx.reminderLog.create({
					data: {
						pondId: candidate.pondId,
						pondEventId: candidate.eventId,
						kind: candidate.kind,
						channel: "in_app",
						dedupeKey,
					},
				});
				await tx.notification.create({
					data: {
						pondId: candidate.pondId,
						farmId: candidate.farmId,
						tier: candidate.tier,
						category: "event",
						message: candidate.message,
						linkTo: REMINDER_LINK,
					},
				});
			});
			summary.eventInAppCreated += 1;
		} catch (error) {
			if (isUniqueConstraintError(error)) {
				summary.eventInAppSkipped += 1;
				continue;
			}
			throw error;
		}
	}

	const emailEligible = candidates.filter(
		(candidate) => prefsByPond.get(candidate.pondId)?.emailReminders,
	);
	const eventEmailEligible = eventCandidates.filter(
		(candidate) => prefsByPond.get(candidate.pondId)?.emailReminders,
	);

	if (!emailConfigured) {
		if (emailEligible.length > 0 || eventEmailEligible.length > 0) {
			warnReminderEmailNotConfiguredOnce();
			summary.emailsSkipped += emailEligible.length;
			summary.eventEmailsSkipped += eventEmailEligible.length;
		}
	}

	// 2. Retry email failures from earlier runs before claiming new occurrences.
	if (emailConfigured) {
		await retryFailedEmails({
			logs: failedEmails,
			pondById,
			cycleById,
			recipientsByOwner,
			prefsByPond,
			sendEmail,
			startedAt,
			summary,
		});
	}

	// 3. New email occurrences, only when configured and enabled per pond.
	const emailCandidates = emailConfigured ? emailEligible : [];
	if (emailCandidates.length > 0) {
		await mapWithConcurrency(emailCandidates, EMAIL_CONCURRENCY, async (candidate) => {
			if (Date.now() - startedAt > ROUTE_BUDGET_MS) {
				summary.emailsDeferred += 1;
				return;
			}

			const pond = pondById.get(candidate.pondId);
			if (!pond) return;
			const recipients = recipientsByOwner.get(pond.ownerId) ?? [];
			if (recipients.length === 0) {
				summary.emailsSkipped += 1;
				return;
			}

			const dedupeKey = reminderDedupeKey(candidate, "email");
			try {
				await prisma.reminderLog.create({
					data: {
						pondId: candidate.pondId,
						cropCycleId: candidate.cropCycleId,
						kind: candidate.kind,
						channel: "email",
						dedupeKey,
						recipient: recipients.join(", "),
						status: "FAILED",
						attempts: 0,
					},
				});
			} catch (error) {
				if (isUniqueConstraintError(error)) {
					summary.emailsSkipped += 1;
					return;
				}
				throw error;
			}

			const result = await sendEmail(buildReminderEmailInput(candidate, recipients));
			if (result.ok) {
				summary.emailsSent += 1;
				await updateReminderLog(dedupeKey, {
					status: "SENT",
					attempts: 1,
					lastError: null,
					sentAt: new Date(),
				});
			} else if (result.skipped) {
				summary.emailsSkipped += 1;
				await updateReminderLog(dedupeKey, {
					status: "FAILED",
					attempts: 1,
					lastError: "Email is not configured",
				});
			} else {
				summary.emailsFailed += 1;
				await updateReminderLog(dedupeKey, {
					status: "FAILED",
					attempts: 1,
					lastError: truncateError(result.error),
				});
			}
		});
	}

	const eventEmailCandidates = emailConfigured ? eventEmailEligible : [];
	if (eventEmailCandidates.length > 0) {
		await mapWithConcurrency(eventEmailCandidates, EMAIL_CONCURRENCY, async (candidate) => {
			if (Date.now() - startedAt > ROUTE_BUDGET_MS) {
				summary.emailsDeferred += 1;
				return;
			}

			const pond = pondById.get(candidate.pondId);
			if (!pond) return;
			const recipients = recipientsByOwner.get(pond.ownerId) ?? [];
			if (recipients.length === 0) {
				summary.eventEmailsSkipped += 1;
				return;
			}

			const dedupeKey = eventReminderDedupeKey(candidate, "email");
			try {
				await prisma.reminderLog.create({
					data: {
						pondId: candidate.pondId,
						pondEventId: candidate.eventId,
						kind: candidate.kind,
						channel: "email",
						dedupeKey,
						recipient: recipients.join(", "),
						status: "FAILED",
						attempts: 0,
					},
				});
			} catch (error) {
				if (isUniqueConstraintError(error)) {
					summary.eventEmailsSkipped += 1;
					return;
				}
				throw error;
			}

			const result = await sendEmail(buildEventReminderEmailInput(candidate, recipients));
			if (result.ok) {
				summary.eventEmailsSent += 1;
				await updateReminderLog(dedupeKey, {
					status: "SENT",
					attempts: 1,
					lastError: null,
					sentAt: new Date(),
				});
			} else if (result.skipped) {
				summary.eventEmailsSkipped += 1;
				await updateReminderLog(dedupeKey, {
					status: "FAILED",
					attempts: 1,
					lastError: "Email is not configured",
				});
			} else {
				summary.eventEmailsFailed += 1;
				await updateReminderLog(dedupeKey, {
					status: "FAILED",
					attempts: 1,
					lastError: truncateError(result.error),
				});
			}
		});
	}

	return summary;
}

async function retryFailedEmails(input: {
	logs: FailedEmailLog[];
	pondById: ReadonlyMap<string, ReminderPondInput>;
	cycleById: ReadonlyMap<string, ReminderCycleInput>;
	recipientsByOwner: ReadonlyMap<string, string[]>;
	prefsByPond: ReadonlyMap<string, ReturnType<typeof normalizeNotificationPrefs>>;
	sendEmail: ReminderEmailSender;
	startedAt: number;
	summary: CropWatchSummary;
}): Promise<void> {
	for (const log of input.logs) {
		if (Date.now() - input.startedAt > ROUTE_BUDGET_MS) {
			input.summary.emailsDeferred += 1;
			continue;
		}

		const pond = input.pondById.get(log.pondId);
		if (!pond) continue;

		if (!input.prefsByPond.get(pond.id)?.emailReminders) {
			await stopRetrying(log, "Email reminders are disabled");
			continue;
		}

		const cycle = log.cropCycleId ? (input.cycleById.get(log.cropCycleId) ?? null) : null;
		const candidate = candidateFromFailedLog(log, pond, cycle);
		if (!candidate) {
			await stopRetrying(log, "Reminder is no longer active");
			continue;
		}

		const recipients = input.recipientsByOwner.get(pond.ownerId) ?? [];
		if (recipients.length === 0) {
			await stopRetrying(log, "No email recipients");
			continue;
		}

		input.summary.emailRetries += 1;
		const result = await input.sendEmail(buildReminderEmailInput(candidate, recipients));
		if (!result.ok && result.skipped) {
			input.summary.emailsSkipped += 1;
			continue;
		}

		const attempts = Math.min(log.attempts + 1, MAX_EMAIL_ATTEMPTS);
		if (result.ok) {
			input.summary.emailRetriesSent += 1;
			await updateReminderLogById(log.id, {
				status: "SENT",
				attempts,
				lastError: null,
				sentAt: new Date(),
			});
		} else {
			input.summary.emailRetriesFailed += 1;
			await updateReminderLogById(log.id, {
				status: "FAILED",
				attempts,
				lastError: truncateError(result.error),
			});
		}
	}
}

function candidateFromFailedLog(
	log: FailedEmailLog,
	pond: ReminderPondInput,
	cycle: ReminderCycleInput | null,
): ReminderCandidate | null {
	const harvestMatch = /^harvest_(d(\d+)|overdue_(\d+))$/.exec(log.kind);
	if (harvestMatch) {
		if (!cycle) return null;
		const days = harvestMatch[2] ? Number(harvestMatch[2]) : -Number(harvestMatch[3]);
		const occurrence = harvestOccurrence(days);
		if (!occurrence) return null;
		return buildHarvestCandidate(pond, cycle, days, occurrence.token);
	}

	if (log.kind === "sampling_d3" || log.kind === "sampling_due") {
		const occurrenceToken = log.dedupeKey.split(":")[2];
		if (!occurrenceToken) return null;
		const dueDate =
			log.kind === "sampling_d3" ? addDays(occurrenceToken, SAMPLING_LEAD_DAYS) : occurrenceToken;
		return buildSamplingCandidate(
			pond,
			cycle,
			dueDate,
			log.kind === "sampling_d3" ? SAMPLING_LEAD_DAYS : 0,
			occurrenceToken,
		);
	}

	return null;
}

function buildHarvestCandidate(
	pond: ReminderPondInput,
	cycle: ReminderCycleInput,
	daysToHarvest: number,
	occurrenceToken: string,
): ReminderCandidate {
	const targetDate = formatDateOnly(cycle.targetHarvestDate);
	const timingLabel = harvestTimingLabel(daysToHarvest);
	const cycleLabel = cycleName(cycle);

	return {
		pondId: pond.id,
		pondName: pond.name,
		farmId: pond.farmId,
		cropCycleId: cycle.id,
		cycleLabel: cycle.label,
		category: "harvest",
		kind: `harvest_${occurrenceToken}`,
		occurrenceToken,
		tier: harvestTier(daysToHarvest),
		message: `${timingLabel} — ${cycleLabel} at ${pond.name} (target ${targetDate}).`,
		timingLabel,
		dateLabel: targetDate,
		daysRemaining: daysToHarvest,
	};
}

function buildSamplingCandidate(
	pond: ReminderPondInput,
	cycle: ReminderCycleInput | null,
	dueDate: string,
	timingDays: number,
	occurrenceToken: string,
): ReminderCandidate {
	const timingLabel =
		timingDays === SAMPLING_LEAD_DAYS
			? `Sampling due in ${SAMPLING_LEAD_DAYS} days`
			: "Sampling due today";

	return {
		pondId: pond.id,
		pondName: pond.name,
		farmId: pond.farmId,
		cropCycleId: cycle?.id ?? null,
		cycleLabel: cycle?.label ?? null,
		category: "sampling",
		kind: timingDays === SAMPLING_LEAD_DAYS ? "sampling_d3" : "sampling_due",
		occurrenceToken,
		tier: timingDays === 0 ? "WARNING" : "INFO",
		message: `${timingLabel} — ${pond.name} (due ${dueDate}).`,
		timingLabel,
		dateLabel: dueDate,
		daysRemaining: timingDays,
	};
}

function harvestTimingLabel(daysToHarvest: number): string {
	if (daysToHarvest > 0) {
		return `Harvest in ${daysToHarvest} day${daysToHarvest === 1 ? "" : "s"}`;
	}
	if (daysToHarvest === 0) return "Harvest due today";
	const overdue = Math.abs(daysToHarvest);
	return `Harvest overdue by ${overdue} day${overdue === 1 ? "" : "s"}`;
}

function harvestTier(daysToHarvest: number): NotificationTier {
	if (daysToHarvest < 0) return daysToHarvest <= -7 ? "CRITICAL" : "WARNING";
	if (daysToHarvest === 0) return "CRITICAL";
	if (daysToHarvest <= 1) return "WARNING";
	return "INFO";
}

function cycleName(cycle: ReminderCycleInput): string {
	const label = cycle.label?.trim();
	if (label) return label;
	return `Stocked ${formatDateOnly(cycle.stockingDate)}`;
}

async function updateReminderLog(
	dedupeKey: string,
	data: {
		status: string;
		attempts: number;
		lastError: string | null;
		sentAt?: Date;
	},
): Promise<void> {
	try {
		await prisma.reminderLog.update({ where: { dedupeKey }, data });
	} catch (error) {
		console.error("[crop-reminders] could not record email delivery status", error);
	}
}

async function updateReminderLogById(
	id: string,
	data: {
		status: string;
		attempts: number;
		lastError: string | null;
		sentAt?: Date;
	},
): Promise<void> {
	try {
		await prisma.reminderLog.update({ where: { id }, data });
	} catch (error) {
		console.error("[crop-reminders] could not record email retry status", error);
	}
}

async function stopRetrying(log: FailedEmailLog, reason: string): Promise<void> {
	await updateReminderLogById(log.id, {
		status: "FAILED",
		attempts: MAX_EMAIL_ATTEMPTS,
		lastError: reason,
	});
}

function truncateError(error: string): string {
	return error.replace(/\s+/g, " ").trim().slice(0, MAX_ERROR_LENGTH) || "Email delivery failed";
}

function isUniqueConstraintError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "P2002"
	);
}

async function mapWithConcurrency<T>(
	items: T[],
	limit: number,
	worker: (item: T) => Promise<void>,
): Promise<void> {
	let cursor = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (cursor < items.length) {
			const current = items[cursor];
			cursor += 1;
			if (current === undefined) continue;
			await worker(current);
		}
	});
	await Promise.all(workers);
}
