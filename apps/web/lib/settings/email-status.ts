/**
 * Email and invite configuration status (superadmin configuration centre I-14).
 *
 * The configuration centre shows whether the mail environment is ready without
 * ever reading a secret back into the UI. Only presence booleans and the
 * sender addresses the product actually uses leave this module; the Resend key
 * and the base URL are never returned.
 */

/** The documented fallback sender (`apps/web/.env.example`). */
export const DEFAULT_INVITE_FROM = "PakaonAI <invite@syntaxure.dev>";

export type EmailConfiguration = {
	/** Presence only — the key value is never returned. */
	resendConfigured: boolean;
	inviteFromConfigured: boolean;
	reminderFromConfigured: boolean;
	baseUrlConfigured: boolean;
	/** The sender address in use; the documented default when unset. */
	inviteFrom: string;
	/** The reminder sender, or null when reminders have no sender. */
	reminderFrom: string | null;
	/** Invites are sent only when all three required values are present. */
	inviteReady: boolean;
	/** Reminder email is skipped unless all three required values are present. */
	reminderReady: boolean;
};

type Env = Record<string, string | undefined>;

function present(value: string | undefined): boolean {
	return typeof value === "string" && value.trim().length > 0;
}

export function getEmailConfiguration(env: Env = process.env): EmailConfiguration {
	const resendConfigured = present(env.RESEND_API_KEY);
	const inviteFromConfigured = present(env.INVITE_FROM_EMAIL);
	const reminderFromConfigured = present(env.REMINDER_FROM_EMAIL);
	const baseUrlConfigured = present(env.NEXT_PUBLIC_BASE_URL);

	const inviteFrom = inviteFromConfigured
		? (env.INVITE_FROM_EMAIL as string).trim()
		: DEFAULT_INVITE_FROM;
	const reminderFrom = reminderFromConfigured ? (env.REMINDER_FROM_EMAIL as string).trim() : null;

	return {
		resendConfigured,
		inviteFromConfigured,
		reminderFromConfigured,
		baseUrlConfigured,
		inviteFrom,
		reminderFrom,
		inviteReady: resendConfigured && inviteFromConfigured && baseUrlConfigured,
		reminderReady: resendConfigured && reminderFromConfigured && baseUrlConfigured,
	};
}
