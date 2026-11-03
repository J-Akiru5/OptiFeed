import { parseRecoveryConfirmation, recoveryRedirectPath } from "@/lib/auth/recovery-link";
import { reportError } from "@/lib/observability";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

/**
 * Recovery-link confirmation (#741).
 *
 * The emailed URL points here. `verifyOtp` (token_hash) or
 * `exchangeCodeForSession` (code) writes the `@supabase/ssr` cookies, so the
 * redirect that follows is an authenticated request to `/reset-password`.
 * The page still requires the signed single-use `reset` proof before it renders
 * the form, and `completePasswordReset` consumes that proof atomically (#718).
 *
 * Every failure path leads to the localized expired state: no error detail is
 * reflected into the redirect, and the only destination is a same-origin reset
 * page (no `next` parameter, so there is nothing to turn into an open redirect).
 */
export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ locale: string }> },
) {
	const { locale } = await params;
	const searchParams = request.nextUrl.searchParams;
	const resetToken = searchParams.get("reset");
	const confirmation = parseRecoveryConfirmation(searchParams);

	if (confirmation.action === "invalid") {
		redirect(recoveryRedirectPath(locale, null));
	}

	let failed = false;
	try {
		const supabase = await createClient();
		const { error } =
			confirmation.action === "exchange"
				? await supabase.auth.exchangeCodeForSession(confirmation.code)
				: await supabase.auth.verifyOtp({
						type: "recovery",
						token_hash: confirmation.tokenHash,
					});

		if (error) {
			failed = true;
			reportError(error, { action: "auth.confirm.recovery" });
		}
	} catch (error) {
		failed = true;
		reportError(error, { action: "auth.confirm.recovery" });
	}

	redirect(recoveryRedirectPath(locale, failed ? null : resetToken));
}
