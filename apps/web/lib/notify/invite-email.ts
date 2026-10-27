import { Resend } from "resend";

/**
 * Member invitation email delivery (mission T-15, plan decision O13).
 *
 * An invite provisions (or attaches) a login on the synthetic pond domain. The
 * inviter types the member's real address; this module sends the login
 * details there through Resend from the verified syntaxure.dev domain.
 *
 * Delivery is best-effort by design: the one-time temporary password is still
 * returned to the inviter and shown once in the UI when email is unconfigured
 * or Resend fails. A failed email must never roll back a successful invite.
 *
 * The temporary password is only ever placed in the message payload. It is
 * never logged, returned by this module's result, or written to an audit row.
 */

const EMAIL_TIMEOUT_MS = 5_000;
const MAX_ERROR_LENGTH = 300;

let warnedMissingConfig = false;

export interface InviteEmailInput {
	/** The address the inviter typed. */
	to: string;
	/** Login ID (the part before @ in the account's pond address). */
	loginId: string;
	temporaryPassword: string;
	orgName?: string;
	inviterName?: string;
}

export type InviteEmailResult = { ok: true } | { ok: false; error: string; skipped?: boolean };

/**
 * A deliverable address needs a local part, an @, and a dotted domain. This is
 * stricter than the login-id derivation (which only needs the local part) and
 * keeps an invitation from being sent to an obvious typo.
 */
export function isDeliverableEmail(value: string): boolean {
	if (typeof value !== "string") return false;
	const trimmed = value.trim();
	if (trimmed.length > 254) return false;
	return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(trimmed);
}

export function isInviteEmailConfigured(
	env: Record<string, string | undefined> = process.env,
): boolean {
	return Boolean(env.RESEND_API_KEY && env.INVITE_FROM_EMAIL && env.NEXT_PUBLIC_BASE_URL);
}

/** Test helper: let the next missing-config call log again. */
export function __resetInviteEmailWarningForTests(): void {
	warnedMissingConfig = false;
}

export function warnInviteEmailNotConfiguredOnce(): void {
	if (warnedMissingConfig) return;
	warnedMissingConfig = true;
	console.warn(
		"[email] invite email skipped: RESEND_API_KEY, INVITE_FROM_EMAIL or NEXT_PUBLIC_BASE_URL is not configured. The one-time password is still shown once to the inviter.",
	);
}

/**
 * Send the invitation. Returns a result instead of throwing so the invite
 * action can report delivery honestly without failing the membership.
 */
export async function sendInviteEmail(
	input: InviteEmailInput,
	env: Record<string, string | undefined> = process.env,
): Promise<InviteEmailResult> {
	if (!isInviteEmailConfigured(env)) {
		warnInviteEmailNotConfiguredOnce();
		return { ok: false, error: "email_not_configured", skipped: true };
	}
	if (!isDeliverableEmail(input.to)) {
		return { ok: false, error: "invalid_recipient" };
	}

	const baseUrl = (env.NEXT_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
	const loginUrl = `${baseUrl}/login`;

	try {
		const resend = new Resend(env.RESEND_API_KEY);
		const response = await withTimeout(
			resend.emails.send({
				from: env.INVITE_FROM_EMAIL as string,
				to: [input.to.trim()],
				subject: buildSubject(input),
				html: buildHtml(input, loginUrl),
				text: buildText(input, loginUrl),
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

/**
 * Invite helper for the two provisioning actions. Only a freshly created
 * account has a one-time password; attaching an existing account has nothing
 * new to send, so it deliberately does not email that address.
 */
export async function deliverMemberInviteEmail(
	input: InviteEmailInput,
	env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
	if (!input.temporaryPassword) return false;

	const result = await sendInviteEmail(input, env);
	if (!result.ok && !result.skipped) {
		// The provider error is safe to log; the password is never in it.
		console.warn("[email] invite delivery failed:", result.error);
	}
	return result.ok;
}

function buildSubject(input: InviteEmailInput): string {
	const org = input.orgName?.trim();
	return org ? `Your PakaonAI invitation for ${org}` : "Your PakaonAI invitation";
}

/**
 * Branded HTML. Every dynamic value is escaped; the caller never passes markup.
 */
function buildHtml(input: InviteEmailInput, loginUrl: string): string {
	const loginId = escapeHtml(input.loginId);
	const password = escapeHtml(input.temporaryPassword);
	const org = input.orgName?.trim() ? escapeHtml(input.orgName.trim()) : "your organization";
	const inviter = input.inviterName?.trim()
		? escapeHtml(input.inviterName.trim())
		: "Your farm admin";
	const url = escapeHtml(loginUrl);

	return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3f7f4;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f7f4;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="background:#1E7B34;padding:20px 24px;color:#ffffff;">
                <div style="font-size:13px;letter-spacing:1px;text-transform:uppercase;opacity:.85;">PakaonAI</div>
                <div style="font-size:22px;font-weight:bold;margin-top:4px;">You are invited to ${org}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <p style="margin:0 0 16px;font-size:16px;">
                  ${inviter} invited you to join <strong>${org}</strong> on PakaonAI, the smart feeding platform for fish farms.
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#374151;background:#f4f7f6;border-radius:8px;">
                  <tr>
                    <td style="padding:10px 14px;color:#6b7280;">Login ID</td>
                    <td style="padding:10px 14px;text-align:right;font-family:Consolas,monospace;font-weight:bold;">${loginId}</td>
                  </tr>
                  <tr>
                    <td style="padding:10px 14px;color:#6b7280;">Temporary password</td>
                    <td style="padding:10px 14px;text-align:right;font-family:Consolas,monospace;font-weight:bold;">${password}</td>
                  </tr>
                </table>
                <p style="margin:24px 0 0;">
                  <a href="${url}" style="display:inline-block;background:#1E7B34;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;">Sign in to PakaonAI</a>
                </p>
                <p style="margin:16px 0 0;font-size:13px;color:#374151;">
                  Sign in at <a href="${url}" style="color:#1E7B34;">${url}</a> with the login ID above.
                  You must change the temporary password the first time you sign in.
                </p>
                <p style="margin:20px 0 0;font-size:12px;color:#6b7280;">
                  If you were not expecting this invitation, you can ignore this email.
                  Do not forward the temporary password.
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

function buildText(input: InviteEmailInput, loginUrl: string): string {
	const org = input.orgName?.trim() || "your organization";
	const inviter = input.inviterName?.trim() || "Your farm admin";

	return [
		`${inviter} invited you to join ${org} on PakaonAI, the smart feeding platform for fish farms.`,
		"",
		`Login ID: ${input.loginId}`,
		`Temporary password: ${input.temporaryPassword}`,
		"",
		`Sign in at: ${loginUrl}`,
		"You must change the temporary password the first time you sign in.",
		"",
		"If you were not expecting this invitation, you can ignore this email.",
		"Do not forward the temporary password.",
	].join("\n");
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
