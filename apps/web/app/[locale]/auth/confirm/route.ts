import { RECOVERY_TOKEN_TYPE, resetPasswordPath } from "@/lib/auth/recovery-link";
import { createClient } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Consume a Supabase recovery link (#741).
 *
 * The emailed URL carries `token_hash`, not a session. This handler verifies
 * the hash with the server client — which writes the `@supabase/ssr` cookies —
 * and only then redirects to the reset form. A normal authenticated session
 * still has to present the signed proof from #718 before it can set a password.
 *
 * Failure is deliberately indistinguishable from an expired link: the visitor
 * lands on `/reset-password` without a proof and sees the same expired state.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ locale: string }> }) {
	const { locale } = await context.params;
	const params = request.nextUrl.searchParams;
	const tokenHash = params.get("token_hash");
	const tokenType = params.get("type");
	const resetToken = params.get("reset");

	const redirectToReset = (proof: string | null) =>
		NextResponse.redirect(new URL(resetPasswordPath(locale, proof), request.url));

	// Only a recovery hash is accepted here; a signup or magic-link hash must
	// not be redeemable through the password-reset route.
	if (tokenType !== RECOVERY_TOKEN_TYPE || !tokenHash) {
		return redirectToReset(null);
	}

	const supabase = await createClient();
	const { error } = await supabase.auth.verifyOtp({
		type: RECOVERY_TOKEN_TYPE,
		token_hash: tokenHash,
	});

	return redirectToReset(error ? null : resetToken);
}
