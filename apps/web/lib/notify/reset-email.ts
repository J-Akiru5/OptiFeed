import { Resend } from "resend";

/**
 * Self-service password-reset email delivery (issue #411).
 *
 * The link is generated in code (Supabase admin `generateLink`, type
 * "recovery") and delivered through Resend from the verified sending domain —
 * the same best-effort shape as `invite-email.ts`. Delivery is never assumed:
 * the caller records `emailSent` on the platform audit row and the UI tells
 * the user to ask a platform administrator when no mail arrives.
 *
 * The reset URL is only ever placed in the message payload. It is never
 * logged, returned by this module's result, or written to an audit row.
 */

const EMAIL_TIMEOUT_MS = 5_000;
const MAX_ERROR_LENGTH = 300;

let warnedMissingConfig = false;

export interface ResetEmailInput {
	/** The account's login address (pond domain). */
	to: string;
	/** Login ID (the part before @ in the account's pond address). */
	farmId: string;
	/** The one-time recovery URL produced by Supabase. */
	resetUrl: string;
}

export type ResetEmailResult = { ok: true } | { ok: false; error: string; skipped?: boolean };

/**
 * `RESET_FROM_EMAIL` is optional and falls back to `INVITE_FROM_EMAIL`: both
 * send from the same verified domain, and one override is enough to keep.
 */
export function resetFromAddress(
	env: Record<string, string | undefined> = process.env,
): string | null {
	return env.RESET_FROM_EMAIL || env.INVITE_FROM_EMAIL || null;
}

export function isResetEmailConfigured(
	env: Record<string, string | undefined> = process.env,
): boolean {
	return Boolean(env.RESEND_API_KEY && resetFromAddress(env) && env.NEXT_PUBLIC_BASE_URL);
}

/** Test helper: let the next missing-config call log again. */
export function __resetResetEmailWarningForTests(): void {
	warnedMissingConfig = false;
}

export function warnResetEmailNotConfiguredOnce(
	env: Record<string, string | undefined> = process.env,
): void {
	if (warnedMissingConfig) return;
	warnedMissingConfig = true;
	console.warn(
		`[email] password reset email skipped: ${[
			!env.RESEND_API_KEY && "RESEND_API_KEY",
			!resetFromAddress(env) && "RESET_FROM_EMAIL/INVITE_FROM_EMAIL",
			!env.NEXT_PUBLIC_BASE_URL && "NEXT_PUBLIC_BASE_URL",
		]
			.filter(Boolean)
			.join(", ")} is not configured.`,
	);
}

/**
 * Send the reset link. Returns a result instead of throwing so the request
 * action can record delivery honestly without failing the audit row.
 */
export async function sendPasswordResetEmail(
	input: ResetEmailInput,
	env: Record<string, string | undefined> = process.env,
): Promise<ResetEmailResult> {
	if (!isResetEmailConfigured(env)) {
		warnResetEmailNotConfiguredOnce(env);
		return { ok: false, error: "email_not_configured", skipped: true };
	}

	const from = resetFromAddress(env) as string;
	const loginUrl = `${(env.NEXT_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "")}/login`;

	try {
		const resend = new Resend(env.RESEND_API_KEY);
		const response = await withTimeout(
			resend.emails.send({
				from,
				to: [input.to.trim()],
				subject: "Reset your PakaonAI password",
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
 * Send and report only whether it landed. A failed email never fails the
 * reset request itself — the administrator-driven reset stays available.
 */
export async function deliverPasswordResetEmail(
	input: ResetEmailInput,
	env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
	const result = await sendPasswordResetEmail(input, env);
	if (!result.ok && !result.skipped) {
		// The provider error is safe to log; the reset URL is never in it.
		console.warn("[email] password reset delivery failed:", result.error);
	}
	return result.ok;
}

function buildHtml(input: ResetEmailInput, loginUrl: string): string {
	const farmId = escapeHtml(input.farmId);
	const url = escapeHtml(input.resetUrl);
	const login = escapeHtml(loginUrl);

	return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3f7f4;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f7f4;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="background:#0A3D62;padding:20px 24px;color:#ffffff;">
                <div style="font-size:13px;letter-spacing:1px;text-transform:uppercase;opacity:.85;">PakaonAI</div>
                <div style="font-size:22px;font-weight:bold;margin-top:4px;">Reset your password</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <p style="margin:0 0 16px;font-size:16px;">
                  A password reset was requested for the account <strong>${farmId}</strong>. Choose a new password using the button below.
                </p>
                <p style="margin:24px 0 0;">
                  <a href="${url}" style="display:inline-block;background:#E85A2A;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;">Set a new password</a>
                </p>
                <p style="margin:16px 0 0;font-size:13px;color:#374151;">
                  The link is single-use and expires. If the button does not work, open
                  <a href="${url}" style="color:#0A3D62;">this link</a> directly.
                </p>
                <p style="margin:16px 0 0;font-size:13px;color:#374151;">
                  If you did not request this, you can ignore this email and sign in as usual at
                  <a href="${login}" style="color:#0A3D62;">${login}</a> — your password is unchanged.
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

function buildText(input: ResetEmailInput, loginUrl: string): string {
	return [
		`A password reset was requested for the PakaonAI account ${input.farmId}.`,
		"",
		`Set a new password: ${input.resetUrl}`,
		"",
		"The link is single-use and expires.",
		`If you did not request this, ignore this email and sign in as usual at ${loginUrl} — your password is unchanged.`,
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
