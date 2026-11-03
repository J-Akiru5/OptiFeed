import { Resend } from "resend";

/**
 * Alert email delivery — CRITICAL episodes and the daily warning digest.
 *
 * The in-app `Notification` row is the source of truth; this module only mirrors
 * it into a mailbox. Delivery is best-effort and never throws: the caller runs
 * inside the `device-watch` cron, and a Resend outage must not fail the sweep or
 * lose the alert.
 *
 * The sender is the reminder sender, with the invite sender as a fallback, so a
 * deployment that already sends reminders needs no new variable. `ALERT_FROM_EMAIL`
 * overrides both when the product wants a dedicated address.
 */

const EMAIL_TIMEOUT_MS = 2_000;
const MAX_ERROR_LENGTH = 300;

let warnedMissingConfig = false;

export function alertFromAddress(
	env: Record<string, string | undefined> = process.env,
): string | null {
	return env.ALERT_FROM_EMAIL || env.REMINDER_FROM_EMAIL || env.INVITE_FROM_EMAIL || null;
}

export function isAlertEmailConfigured(
	env: Record<string, string | undefined> = process.env,
): boolean {
	return Boolean(env.RESEND_API_KEY && alertFromAddress(env));
}

export function warnAlertEmailNotConfiguredOnce(
	env: Record<string, string | undefined> = process.env,
): void {
	if (warnedMissingConfig) return;
	warnedMissingConfig = true;
	console.warn(
		`[email] alert email skipped: ${[
			!env.RESEND_API_KEY && "RESEND_API_KEY",
			!alertFromAddress(env) && "ALERT_FROM_EMAIL/REMINDER_FROM_EMAIL/INVITE_FROM_EMAIL",
		]
			.filter(Boolean)
			.join(", ")} is not configured. In-app alerts still run.`,
	);
}

/** Test helper: let the next missing-config call log again. */
export function __resetAlertEmailWarningForTests(): void {
	warnedMissingConfig = false;
}

export type AlertEmailResult = { ok: true } | { ok: false; error: string; skipped?: boolean };

export interface CriticalAlertEmailInput {
	/** Deliverable addresses, already deduplicated by the caller. */
	to: string[];
	pondName: string;
	farmId: string;
	tier: string;
	message: string;
	/** Absolute URL of the in-app notification list. */
	linkUrl: string;
	occurredAt: Date;
}

export interface DigestItem {
	pondName: string;
	tier: string;
	message: string;
	occurredAt: Date;
}

export interface DigestAlertEmailInput {
	to: string[];
	items: DigestItem[];
	/** Absolute URL of the in-app notification list. */
	linkUrl: string;
	/** The completed Manila day the digest covers, e.g. "2 November 2026". */
	dayLabel: string;
}

export async function sendCriticalAlertEmail(
	input: CriticalAlertEmailInput,
	env: Record<string, string | undefined> = process.env,
): Promise<AlertEmailResult> {
	return send(
		{
			to: input.to,
			subject: `${singleLine(input.pondName)} — ${tierWord(input.tier)}`,
			html: criticalHtml(input),
			text: criticalText(input),
		},
		env,
	);
}

export async function sendAlertDigestEmail(
	input: DigestAlertEmailInput,
	env: Record<string, string | undefined> = process.env,
): Promise<AlertEmailResult> {
	if (input.items.length === 0) return { ok: false, error: "empty_digest", skipped: true };
	return send(
		{
			to: input.to,
			subject: `Daily alert summary — ${singleLine(input.dayLabel)}`,
			html: digestHtml(input),
			text: digestText(input),
		},
		env,
	);
}

async function send(
	message: { to: string[]; subject: string; html: string; text: string },
	env: Record<string, string | undefined>,
): Promise<AlertEmailResult> {
	const from = alertFromAddress(env);
	if (!env.RESEND_API_KEY || !from) {
		warnAlertEmailNotConfiguredOnce(env);
		return { ok: false, error: "email_not_configured", skipped: true };
	}

	try {
		const resend = new Resend(env.RESEND_API_KEY);
		const response = await withTimeout(resend.emails.send({ from, ...message }), EMAIL_TIMEOUT_MS);
		if (response.error) return { ok: false, error: sanitizeError(response.error.message) };
		return { ok: true };
	} catch (error) {
		return { ok: false, error: sanitizeError(error) };
	}
}

interface ShellInput {
	heading: string;
	preheader: string;
	body: string;
	linkUrl: string;
	footer: string;
}

function shell(input: ShellInput): string {
	const link = escapeHtml(input.linkUrl);
	return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3f7f4;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;">${escapeHtml(input.preheader)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f7f4;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="background:#0A3D62;padding:20px 24px;color:#ffffff;">
                <div style="font-size:13px;letter-spacing:1px;text-transform:uppercase;opacity:.85;">PakaonAI</div>
                <div style="font-size:22px;font-weight:bold;margin-top:4px;">${escapeHtml(input.heading)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                ${input.body}
                <p style="margin:24px 0 0;">
                  <a href="${link}" style="display:inline-block;background:#E85A2A;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;">Open notifications</a>
                </p>
                <p style="margin:20px 0 0;font-size:12px;color:#6b7280;">${escapeHtml(input.footer)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function criticalHtml(input: CriticalAlertEmailInput): string {
	const pond = escapeHtml(input.pondName);
	const tier = escapeHtml(input.tier);
	const message = escapeHtml(input.message);
	const when = escapeHtml(input.occurredAt.toUTCString());
	return shell({
		heading: "Feeder alert",
		preheader: `${input.pondName}: ${input.message}`,
		linkUrl: input.linkUrl,
		footer:
			"You receive this because your role is on this organization's alert list. Change it under Organization settings.",
		body: `
                <p style="margin:0 0 16px;font-size:16px;">
                  <strong style="color:#C42B3A;">${tier}</strong> alert for <strong>${pond}</strong>.
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#374151;">
                  <tr><td style="padding:6px 0;color:#6b7280;">Pond</td><td style="padding:6px 0;text-align:right;font-weight:bold;">${pond}</td></tr>
                  <tr><td style="padding:6px 0;color:#6b7280;">Account</td><td style="padding:6px 0;text-align:right;font-family:monospace;">${escapeHtml(input.farmId)}</td></tr>
                  <tr><td style="padding:6px 0;color:#6b7280;">Detected</td><td style="padding:6px 0;text-align:right;">${when}</td></tr>
                </table>
                <p style="margin:16px 0 0;padding:12px;background:#FDF3E7;border-radius:8px;font-size:14px;">${message}</p>`,
	});
}

function criticalText(input: CriticalAlertEmailInput): string {
	return [
		`${input.tier} alert for ${input.pondName}.`,
		"",
		input.message,
		"",
		`Account: ${input.farmId}`,
		`Detected: ${input.occurredAt.toUTCString()}`,
		`Open notifications: ${input.linkUrl}`,
	].join("\n");
}

function digestHtml(input: DigestAlertEmailInput): string {
	const rowsByPond = new Map<string, DigestItem[]>();
	for (const item of input.items) {
		const list = rowsByPond.get(item.pondName) ?? [];
		list.push(item);
		rowsByPond.set(item.pondName, list);
	}

	const sections = [...rowsByPond.entries()]
		.map(([pondName, items]) => {
			const rows = items
				.slice(0, 8)
				.map(
					(item) =>
						`<li style="margin:4px 0;font-size:14px;">${escapeHtml(item.message)} <span style="color:#6b7280;">(${escapeHtml(item.tier.toLowerCase())})</span></li>`,
				)
				.join("");
			const more =
				items.length > 8
					? `<p style="margin:4px 0 0;font-size:12px;color:#6b7280;">and ${items.length - 8} more</p>`
					: "";
			return `<div style="margin:0 0 16px;">
                  <p style="margin:0 0 6px;font-size:15px;font-weight:bold;color:#0A3D62;">${escapeHtml(pondName)}</p>
                  <ul style="margin:0;padding-left:18px;">${rows}</ul>${more}
                </div>`;
		})
		.join("");

	return shell({
		heading: "Daily alert summary",
		preheader: `${input.items.length} warnings on ${input.dayLabel}`,
		linkUrl: input.linkUrl,
		footer:
			"Low-hopper and missed-feeding warnings are summarized once a day. Change the alert roles under Organization settings.",
		body: `
                <p style="margin:0 0 16px;font-size:16px;">
                  ${input.items.length} warning${input.items.length === 1 ? "" : "s"} on <strong>${escapeHtml(input.dayLabel)}</strong>.
                </p>
                ${sections}`,
	});
}

function digestText(input: DigestAlertEmailInput): string {
	const lines = [`Daily alert summary for ${input.dayLabel}.`, ""];
	for (const item of input.items) {
		lines.push(`- ${item.pondName}: ${item.message} (${item.tier.toLowerCase()})`);
	}
	lines.push("", `Open notifications: ${input.linkUrl}`);
	return lines.join("\n");
}

function tierWord(tier: string): string {
	if (tier.toUpperCase() === "CRITICAL") return "Critical alert";
	if (tier.toUpperCase() === "WARNING") return "Warning";
	return "Alert";
}

/** Strip line breaks so tenant-controlled text cannot inject a mail header. */
function singleLine(value: string): string {
	return value.replace(/[\r\n]+/g, " ").trim();
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
