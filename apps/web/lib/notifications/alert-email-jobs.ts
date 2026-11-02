import { manilaDayRange } from "@/lib/feed/day";
import { resolvePondAlertAudiences } from "@/lib/notifications/alert-recipients";
import {
	type DigestItem,
	isAlertEmailConfigured,
	sendAlertDigestEmail,
	sendCriticalAlertEmail,
} from "@/lib/notify/alert-email";
import { reportError } from "@/lib/observability";
import prisma from "@/lib/prisma";

/**
 * Alert email jobs, run by the existing `device-watch` cron.
 *
 * Two jobs, both bounded and best-effort:
 *
 * 1. **Critical, one email per episode.** Open `CRITICAL` notifications in the
 *    `connectivity` and `system` categories (device offline, safe mode, faults).
 *    The in-app row is written by ingest/cron in real time; this job mirrors it
 *    within one cron interval, so no device request ever waits on Resend.
 *    `ReminderLog` (channel `email`, unique `dedupeKey`) gives at-most-once
 *    delivery per notification row and a retry for a transient failure.
 * 2. **Daily digest.** Low-hopper and missed-feeding warnings are not worth a
 *    mailbox ding each (182 of 203 notifications in a week). Once per Manila
 *    day, the previous completed day is summarized into one email per recipient.
 *    A `PlatformSetting` marker (`alerts.digest`) keeps it once-per-day.
 *
 * Both jobs skip silently when alert email is not configured, so enabling the
 * sender later starts them without backfilling old rows (the critical scan is
 * limited to the last 24 hours).
 */

const CRITICAL_CATEGORIES = ["connectivity", "system"] as const;
const DIGEST_CATEGORIES = ["pellet", "feeding"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const CRITICAL_LOOKBACK_MS = DAY_MS;
const MAX_CRITICAL_PER_RUN = 10;
const MAX_DIGEST_RECIPIENTS = 20;
const MAX_DIGEST_NOTIFICATIONS = 500;
const MAX_ATTEMPTS = 3;

export const ALERT_DIGEST_SETTING_KEY = "alerts.digest";

type CriticalScanResult = { sent: number; failed: number; skipped: number };
type DigestResult = { sent: number; failed: number; day: string | null };

export async function sendCriticalAlertEmails(
	now: Date = new Date(),
	env: Record<string, string | undefined> = process.env,
): Promise<CriticalScanResult> {
	const result: CriticalScanResult = { sent: 0, failed: 0, skipped: 0 };
	if (!isAlertEmailConfigured(env)) return result;

	const since = new Date(now.getTime() - CRITICAL_LOOKBACK_MS);
	const rows = await prisma.notification.findMany({
		where: {
			tier: "CRITICAL",
			category: { in: [...CRITICAL_CATEGORIES] },
			resolvedAt: null,
			autoCleared: false,
			createdAt: { gte: since },
		},
		orderBy: { createdAt: "asc" },
		take: MAX_CRITICAL_PER_RUN,
		select: {
			id: true,
			pondId: true,
			category: true,
			tier: true,
			message: true,
			createdAt: true,
		},
	});
	if (rows.length === 0) return result;

	const dedupeKeys = rows.map((row) => criticalDedupeKey(row.id));
	const existing = await prisma.reminderLog.findMany({
		where: { dedupeKey: { in: dedupeKeys } },
		select: { dedupeKey: true, status: true, attempts: true },
	});
	const terminal = new Set(
		existing
			.filter(
				(row) => row.status === "SENT" || row.status === "SKIPPED" || row.attempts >= MAX_ATTEMPTS,
			)
			.map((row) => row.dedupeKey),
	);

	const pending = rows.filter((row) => !terminal.has(criticalDedupeKey(row.id)));
	if (pending.length === 0) return result;

	const audiences = await resolvePondAlertAudiences(pending.map((row) => row.pondId));
	const linkUrl = `${alertBaseUrl(env)}/dashboard/notifications`;

	for (const row of pending) {
		const audience = audiences.get(row.pondId);
		const dedupeKey = criticalDedupeKey(row.id);
		const recipients = audience?.emails ?? [];

		if (recipients.length === 0) {
			await recordAttempt({
				dedupeKey,
				pondId: row.pondId,
				kind: `alert:${row.category}`,
				recipients: [],
				status: "SKIPPED",
				error: null,
			});
			result.skipped += 1;
			continue;
		}

		const delivery = await sendCriticalAlertEmail(
			{
				to: recipients,
				pondName: audience?.pondName ?? row.pondId,
				farmId: audience?.farmId ?? "",
				tier: row.tier,
				message: row.message,
				linkUrl,
				occurredAt: row.createdAt,
			},
			env,
		);

		await recordAttempt({
			dedupeKey,
			pondId: row.pondId,
			kind: `alert:${row.category}`,
			recipients,
			status: delivery.ok ? "SENT" : "FAILED",
			error: delivery.ok ? null : delivery.error,
		});
		if (delivery.ok) result.sent += 1;
		else result.failed += 1;
	}

	return result;
}

export async function sendDailyAlertDigest(
	now: Date = new Date(),
	env: Record<string, string | undefined> = process.env,
): Promise<DigestResult> {
	if (!isAlertEmailConfigured(env)) return { sent: 0, failed: 0, day: null };

	// Summarize the previous completed Manila day, once, on the first cron run
	// after it ended.
	const today = manilaDayRange(now.getTime());
	const previousStart = new Date(today.start.getTime() - DAY_MS);
	const dayKey = manilaDayKey(previousStart);

	const marker = await prisma.platformSetting.findUnique({
		where: { key: ALERT_DIGEST_SETTING_KEY },
		select: { value: true },
	});
	if (digestMarkerDay(marker?.value) === dayKey) return { sent: 0, failed: 0, day: dayKey };

	const rows = await prisma.notification.findMany({
		where: {
			category: { in: [...DIGEST_CATEGORIES] },
			tier: { in: ["WARNING", "CRITICAL"] },
			createdAt: { gte: previousStart, lt: today.start },
		},
		orderBy: { createdAt: "asc" },
		take: MAX_DIGEST_NOTIFICATIONS,
		select: { pondId: true, tier: true, message: true, createdAt: true },
	});
	if (rows.length === 0) {
		await markDigestSent(dayKey);
		return { sent: 0, failed: 0, day: dayKey };
	}

	const audiences = await resolvePondAlertAudiences([...new Set(rows.map((row) => row.pondId))]);

	// Invert to one email per recipient: a person who manages several ponds gets
	// a single summary, not one message per pond.
	const itemsByEmail = new Map<string, DigestItem[]>();
	for (const row of rows) {
		const audience = audiences.get(row.pondId);
		if (!audience) continue;
		for (const email of audience.emails) {
			const list = itemsByEmail.get(email) ?? [];
			list.push({
				pondName: audience.pondName,
				tier: row.tier,
				message: row.message,
				occurredAt: row.createdAt,
			});
			itemsByEmail.set(email, list);
		}
	}

	const recipients = [...itemsByEmail.keys()].slice(0, MAX_DIGEST_RECIPIENTS);
	const linkUrl = `${alertBaseUrl(env)}/dashboard/notifications`;
	const dayLabel = manilaDayLabel(previousStart);
	let sent = 0;
	let failed = 0;

	for (const email of recipients) {
		const delivery = await sendAlertDigestEmail(
			{ to: [email], items: itemsByEmail.get(email) ?? [], linkUrl, dayLabel },
			env,
		);
		if (delivery.ok) sent += 1;
		else failed += 1;
	}

	await markDigestSent(dayKey);
	return { sent, failed, day: dayKey };
}

function criticalDedupeKey(notificationId: string): string {
	return `alert-email:${notificationId}`;
}

async function recordAttempt(input: {
	dedupeKey: string;
	pondId: string;
	kind: string;
	recipients: string[];
	status: "SENT" | "FAILED" | "SKIPPED";
	error: string | null;
}): Promise<void> {
	try {
		await prisma.reminderLog.upsert({
			where: { dedupeKey: input.dedupeKey },
			update: {
				status: input.status,
				lastError: input.error,
				attempts: { increment: 1 },
				sentAt: new Date(),
			},
			create: {
				pondId: input.pondId,
				kind: input.kind,
				channel: "email",
				dedupeKey: input.dedupeKey,
				recipient: input.recipients.join(","),
				status: input.status,
				lastError: input.error,
				attempts: 1,
			},
		});
	} catch (error) {
		// The unique dedupe key is the correctness guard; losing the bookkeeping
		// row must not fail the sweep.
		reportError(error, { action: "alertEmail.recordAttempt", dedupeKey: input.dedupeKey });
	}
}

async function markDigestSent(dayKey: string): Promise<void> {
	await prisma.platformSetting
		.upsert({
			where: { key: ALERT_DIGEST_SETTING_KEY },
			update: { value: { day: dayKey } },
			create: { key: ALERT_DIGEST_SETTING_KEY, value: { day: dayKey } },
		})
		.catch((error: unknown) => reportError(error, { action: "alertEmail.markDigest" }));
}

function digestMarkerDay(value: unknown): string | null {
	if (typeof value !== "object" || value === null) return null;
	const day = (value as { day?: unknown }).day;
	return typeof day === "string" ? day : null;
}

function alertBaseUrl(env: Record<string, string | undefined>): string {
	const configured =
		env.NEXT_PUBLIC_BASE_URL || env.NEXT_PUBLIC_SITE_URL || "https://pakaonai.syntaxure.dev";
	return configured.replace(/\/+$/, "");
}

/** `YYYY-MM-DD` in Asia/Manila, matching the day boundaries in `manilaDayRange`. */
function manilaDayKey(date: Date): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Manila",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(date);
}

function manilaDayLabel(date: Date): string {
	return new Intl.DateTimeFormat("en-GB", {
		timeZone: "Asia/Manila",
		day: "numeric",
		month: "long",
		year: "numeric",
	}).format(date);
}
