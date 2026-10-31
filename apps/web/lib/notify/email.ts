import { Resend } from "resend";

/**
 * Harvest/sampling reminder email delivery (Phase 4).
 *
 * Email is deliberately best-effort: the in-app Notification row is the source
 * of truth, and a missing key, a Resend outage, or a timeout must never make a
 * reminder disappear. Every failure is returned as a result so the caller can
 * record it on `ReminderLog` and retry on later cron runs.
 */

const EMAIL_TIMEOUT_MS = 2_000;
const MAX_ERROR_LENGTH = 300;

let warnedMissingConfig = false;

export interface ReminderEmailInput {
	to: string[];
	pondName: string;
	cycleLabel: string | null;
	eventLabel: "Harvest" | "Sampling" | "Event" | "Task";
	dateLabel: string;
	timingLabel: string;
}

export type ReminderEmailResult = { ok: true } | { ok: false; error: string; skipped?: boolean };

export function isReminderEmailConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
	return Boolean(env.RESEND_API_KEY && env.REMINDER_FROM_EMAIL && env.NEXT_PUBLIC_BASE_URL);
}

/** Test helper: let the next missing-config call log again. */
export function __resetReminderEmailWarningForTests(): void {
	warnedMissingConfig = false;
}

/**
 * Log the missing-config state once per process. Exported so the cron service
 * can warn even when it skips email before calling `sendReminderEmail`.
 */
export function warnReminderEmailNotConfiguredOnce(): void {
	if (warnedMissingConfig) return;
	warnedMissingConfig = true;
	console.warn(
		"[email] reminder email skipped: RESEND_API_KEY, REMINDER_FROM_EMAIL or NEXT_PUBLIC_BASE_URL is not configured. In-app reminders still run.",
	);
}

export async function sendReminderEmail(
	input: ReminderEmailInput,
	env: NodeJS.ProcessEnv = process.env,
): Promise<ReminderEmailResult> {
	if (!isReminderEmailConfigured(env)) {
		warnReminderEmailNotConfiguredOnce();
		return { ok: false, error: "email_not_configured", skipped: true };
	}

	const baseUrl = (env.NEXT_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
	const link = `${baseUrl}/dashboard/calendar`;

	try {
		const resend = new Resend(env.RESEND_API_KEY);
		const response = await withTimeout(
			resend.emails.send({
				from: env.REMINDER_FROM_EMAIL as string,
				to: input.to,
				subject: buildSubject(input),
				html: buildHtml(input, link),
			}),
			EMAIL_TIMEOUT_MS,
		);

		if (response.error) {
			return { ok: false, error: sanitizeError(response.error.message) };
		}
		return { ok: true };
	} catch (error) {
		return { ok: false, error: sanitizeError(error) };
	}
}

function buildSubject(input: ReminderEmailInput): string {
	// Pond names are tenant-controlled: strip line breaks so a crafted name
	// cannot inject a header into the outbound message.
	return `${singleLine(input.timingLabel)} — ${singleLine(input.pondName)}`;
}

function singleLine(value: string): string {
	return value.replace(/[\r\n]+/g, " ").trim();
}

/**
 * Simple branded HTML. Every value is escaped; the caller never passes markup.
 */
function buildHtml(input: ReminderEmailInput, link: string): string {
	const pond = escapeHtml(input.pondName);
	const event = escapeHtml(input.eventLabel);
	const timing = escapeHtml(input.timingLabel);
	const date = escapeHtml(input.dateLabel);
	const cycle = input.cycleLabel ? escapeHtml(input.cycleLabel) : "Grow-out cycle";
	const article = /^[aeiou]/i.test(input.eventLabel) ? "an" : "a";

	return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3f7f4;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f7f4;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="background:#1E7B34;padding:20px 24px;color:#ffffff;">
                <div style="font-size:13px;letter-spacing:1px;text-transform:uppercase;opacity:.85;">OptiFeed</div>
                <div style="font-size:22px;font-weight:bold;margin-top:4px;">${timing}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <p style="margin:0 0 16px;font-size:16px;">${article} ${event.toLowerCase()} reminder for <strong>${pond}</strong>.</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#374151;">
                  <tr>
                    <td style="padding:6px 0;color:#6b7280;">Pond</td>
                    <td style="padding:6px 0;text-align:right;font-weight:bold;">${pond}</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;color:#6b7280;">Cycle</td>
                    <td style="padding:6px 0;text-align:right;">${cycle}</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;color:#6b7280;">Event</td>
                    <td style="padding:6px 0;text-align:right;">${event}</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;color:#6b7280;">Date</td>
                    <td style="padding:6px 0;text-align:right;">${date}</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;color:#6b7280;">Status</td>
                    <td style="padding:6px 0;text-align:right;font-weight:bold;">${timing}</td>
                  </tr>
                </table>
                <p style="margin:24px 0 0;">
                  <a href="${escapeHtml(link)}" style="display:inline-block;background:#1E7B34;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;">Open harvest calendar</a>
                </p>
                <p style="margin:20px 0 0;font-size:12px;color:#6b7280;">
                  You are receiving this because harvest or sampling reminders are enabled for this pond.
                  Change them in Settings → Profile → Notification Preferences.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function sanitizeError(error: unknown): string {
	const message =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: "Email delivery failed";
	return message.replace(/\s+/g, " ").trim().slice(0, MAX_ERROR_LENGTH) || "Email delivery failed";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error("Email provider timed out")), timeoutMs);
		(timer as { unref?: () => void }).unref?.();
	});

	try {
		return await Promise.race([promise, timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
