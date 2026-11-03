import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The recovery confirmation route (#741).
 *
 * A recovery email must establish a session on the server before the reset form
 * is reachable. These tests pin the three security-relevant branches: a valid
 * recovery hash is redeemed and carries the #718 proof forward; a failed
 * redemption never forwards the proof; and a non-recovery hash is never sent to
 * `verifyOtp` at all.
 */

const verifyOtp = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
	createClient: vi.fn(async () => ({ auth: { verifyOtp } })),
}));

import { buildRecoveryConfirmUrl, resetPasswordPath } from "@/lib/auth/recovery-link";
import { GET } from "../../app/[locale]/auth/confirm/route";

const PROOF = "header.signature";

function callRoute(query: string, locale = "en"): Promise<Response> {
	return GET(new NextRequest(`https://app.example/${locale}/auth/confirm?${query}`), {
		params: Promise.resolve({ locale }),
	});
}

function location(response: Response): string {
	const value = response.headers.get("location");
	if (!value) throw new Error("response has no Location header");
	return new URL(value).pathname + new URL(value).search;
}

beforeEach(() => {
	verifyOtp.mockReset();
	verifyOtp.mockResolvedValue({ error: null });
});

describe("buildRecoveryConfirmUrl", () => {
	it("targets the confirmation route with the hash, type and proof", () => {
		const url = buildRecoveryConfirmUrl({
			appBaseUrl: "https://app.example///",
			locale: "hil",
			tokenHash: "hash-abc",
			resetToken: PROOF,
		});

		expect(url).toBe(
			"https://app.example/hil/auth/confirm?token_hash=hash-abc&type=recovery&reset=header.signature",
		);
	});

	it("falls back to the default locale instead of trusting an unknown one", () => {
		const url = buildRecoveryConfirmUrl({
			appBaseUrl: "https://app.example",
			locale: "../evil",
			tokenHash: "hash-abc",
			resetToken: PROOF,
		});

		expect(url).toBe(
			"https://app.example/en/auth/confirm?token_hash=hash-abc&type=recovery&reset=header.signature",
		);
	});

	it("builds only a same-origin reset path", () => {
		expect(resetPasswordPath("nope", PROOF)).toBe(`/en/reset-password?reset=${PROOF}`);
		expect(resetPasswordPath("hil")).toBe("/hil/reset-password");
	});
});

describe("GET /auth/confirm", () => {
	it("redeems a recovery hash and forwards the proof", async () => {
		const response = await callRoute(
			`token_hash=hash-abc&type=recovery&reset=${encodeURIComponent(PROOF)}`,
			"hil",
		);

		expect(verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "hash-abc" });
		expect(location(response)).toBe(`/hil/reset-password?reset=${PROOF}`);
	});

	it("does not forward the proof when redemption fails", async () => {
		verifyOtp.mockResolvedValue({ error: { message: "Token has expired" } });

		const response = await callRoute(
			`token_hash=hash-abc&type=recovery&reset=${encodeURIComponent(PROOF)}`,
		);

		expect(location(response)).toBe("/en/reset-password");
	});

	it("never redeems a non-recovery hash", async () => {
		const response = await callRoute(
			`token_hash=hash-abc&type=signup&reset=${encodeURIComponent(PROOF)}`,
		);

		expect(verifyOtp).not.toHaveBeenCalled();
		expect(location(response)).toBe("/en/reset-password");
	});

	it("rejects a missing hash without touching Supabase", async () => {
		const response = await callRoute("type=recovery");

		expect(verifyOtp).not.toHaveBeenCalled();
		expect(location(response)).toBe("/en/reset-password");
	});

	it("does not let an unknown locale escape the site", async () => {
		verifyOtp.mockResolvedValue({ error: null });

		const response = await callRoute(
			`token_hash=hash-abc&type=recovery&reset=${encodeURIComponent(PROOF)}`,
			"..",
		);

		expect(location(response)).toBe(`/en/reset-password?reset=${PROOF}`);
	});
});
