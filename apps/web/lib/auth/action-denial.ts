/**
 * Stable, non-sensitive authorization outcomes for server actions (#336).
 *
 * Guards refuse a caller in three ways: `redirect()` (pages), a typed error
 * with a `code` (`StepUpRequiredError`, `ViewAsReadOnlyError`), or a plain
 * `Error` (`assertPasswordChanged`, `requirePermission`). A server action that
 * wraps its body in a catch-all used to flatten all of them into one generic
 * "Failed to …" sentence, so an authorization failure was indistinguishable
 * from a database error in the UI, the logs and the tests.
 *
 * `actionDenialResult()` turns a refusal into a result the action can return:
 * a stable machine `code` plus one fixed sentence per reason. The sentences are
 * deliberately coarse — they never include a role list, an org name, an id or
 * any other detail that would help a caller probe the system.
 *
 * A navigation outcome (Next's `NEXT_REDIRECT` / `NEXT_NOT_FOUND` digest) is
 * NOT a failure: `rethrowIfNavigationError()` passes it through so the
 * framework can navigate and the redirect is never turned into an inline error.
 */

export const ACTION_DENIED_CODE = "action_denied";

export type ActionDenialReason =
	| "not_authenticated"
	| "password_change_required"
	| "wrong_role"
	| "org_suspended"
	| "view_as_read_only"
	| "step_up_required"
	| "forbidden";

const DENIAL_MESSAGES: Record<ActionDenialReason, string> = {
	not_authenticated: "Your session has ended. Sign in again to continue.",
	password_change_required: "Change your temporary password before making changes.",
	wrong_role: "You do not have permission to make this change.",
	org_suspended: "Your organization is suspended, so changes are paused.",
	view_as_read_only: "This is a read-only view-as session. Exit view-as to make changes.",
	step_up_required: "Re-enter your password to continue. This action needs a fresh 5-minute check.",
	forbidden: "You do not have permission to do that.",
};

export type ActionDenial = {
	success: false;
	error: string;
	code: ActionDenialReason;
};

/** Duck-typed so it still matches when it crossed a module boundary or a test double. */
export class ActionDeniedError extends Error {
	readonly code = ACTION_DENIED_CODE;
	readonly reason: ActionDenialReason;

	constructor(reason: ActionDenialReason) {
		super(DENIAL_MESSAGES[reason]);
		this.name = "ActionDeniedError";
		this.reason = reason;
	}
}

export function isActionDeniedError(
	error: unknown,
): error is { code: typeof ACTION_DENIED_CODE; reason: ActionDenialReason; message: string } {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === ACTION_DENIED_CODE
	);
}

const KNOWN_REASONS = new Set<string>(Object.keys(DENIAL_MESSAGES));

function asReason(value: unknown): ActionDenialReason | null {
	return typeof value === "string" && KNOWN_REASONS.has(value)
		? (value as ActionDenialReason)
		: null;
}

/** The fixed sentence for a reason, also used by tests and UI copy reviews. */
export function denialMessage(reason: ActionDenialReason): string {
	return DENIAL_MESSAGES[reason];
}

/**
 * Classify a thrown guard failure. Returns null for anything that is not an
 * authorization outcome (a validation error, a database failure, a bug), which
 * the action keeps reporting through its own generic path.
 */
export function actionDenialResult(error: unknown): ActionDenial | null {
	const reason = denialReasonOf(error);
	if (!reason) return null;
	return { success: false, error: DENIAL_MESSAGES[reason], code: reason };
}

function denialReasonOf(error: unknown): ActionDenialReason | null {
	if (typeof error !== "object" || error === null) return null;
	const candidate = error as { code?: unknown; reason?: unknown; message?: unknown };

	if (candidate.code === ACTION_DENIED_CODE) {
		return asReason(candidate.reason);
	}
	// The shared step-up and view-as guards already carry a stable code.
	if (candidate.code === "step_up_required") return "step_up_required";
	if (candidate.code === "view_as_read_only") return "view_as_read_only";
	if (typeof candidate.message !== "string") return null;

	// Compatibility bridge for the guards that still throw a plain Error
	// (assertPasswordChanged, requirePermission) and for test doubles that
	// reproduce their historical sentences. Keep these in sync with the guard
	// source; the typed errors above are the primary contract.
	const message = candidate.message.trim().replace(/\.$/, "");
	if (message === "Not authenticated") return "not_authenticated";
	if (message === "Password change required") return "password_change_required";
	if (message.startsWith("Write access required")) return "wrong_role";
	if (message === "Forbidden") return "forbidden";
	return null;
}

/**
 * Rethrow a Next navigation digest instead of reporting it as a failure.
 *
 * Server actions that wrap their whole body in a catch need this: swallowing a
 * guard's redirect is exactly the bug in #336.
 */
export function rethrowIfNavigationError(error: unknown): void {
	if (typeof error !== "object" || error === null || !("digest" in error)) return;
	const digest = (error as { digest?: unknown }).digest;
	if (
		typeof digest === "string" &&
		(digest.startsWith("NEXT_REDIRECT") ||
			digest === "NEXT_NOT_FOUND" ||
			digest.startsWith("NEXT_HTTP_ERROR_FALLBACK"))
	) {
		throw error;
	}
}
