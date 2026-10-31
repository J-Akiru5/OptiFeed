import {
	ACTION_DENIED_CODE,
	ActionDeniedError,
	actionDenialResult,
	denialMessage,
	isActionDeniedError,
	rethrowIfNavigationError,
} from "@/lib/auth/action-denial";
import { describe, expect, it } from "vitest";

/**
 * The guard-refusal bridge (#336): every refusal reason keeps a stable code and
 * one fixed sentence, an unrelated error is never mistaken for a refusal, and a
 * Next navigation digest is rethrown instead of becoming an inline error.
 */

const REASONS = [
	"not_authenticated",
	"password_change_required",
	"wrong_role",
	"org_suspended",
	"view_as_read_only",
	"step_up_required",
	"forbidden",
] as const;

describe("actionDenialResult", () => {
	it.each(REASONS)("maps %s to its own code and sentence", (reason) => {
		expect(actionDenialResult(new ActionDeniedError(reason))).toEqual({
			success: false,
			error: denialMessage(reason),
			code: reason,
		});
	});

	it("gives every reason a distinct, non-empty sentence", () => {
		const messages = REASONS.map((reason) => denialMessage(reason));
		expect(messages.every((message) => message.length > 0)).toBe(true);
		expect(new Set(messages).size).toBe(REASONS.length);
	});

	it("recognises the shared step-up and view-as coded errors", () => {
		const stepUp = Object.assign(new Error("Re-enter your password."), {
			code: "step_up_required",
		});
		const viewAs = Object.assign(new Error("Read-only view-as."), {
			code: "view_as_read_only",
		});

		expect(actionDenialResult(stepUp)).toMatchObject({ code: "step_up_required" });
		expect(actionDenialResult(viewAs)).toMatchObject({ code: "view_as_read_only" });
	});

	it("still recognises the guards that throw a plain Error", () => {
		// assertPasswordChanged and requirePermission have no typed error yet;
		// their historical sentences are the compatibility bridge.
		expect(actionDenialResult(new Error("Not authenticated"))).toMatchObject({
			code: "not_authenticated",
		});
		expect(actionDenialResult(new Error("Not authenticated."))).toMatchObject({
			code: "not_authenticated",
		});
		expect(actionDenialResult(new Error("Password change required"))).toMatchObject({
			code: "password_change_required",
		});
		expect(
			actionDenialResult(new Error("Write access required (ADMIN or OPERATOR)")),
		).toMatchObject({ code: "wrong_role" });
		expect(actionDenialResult(new Error("Forbidden"))).toMatchObject({ code: "forbidden" });
	});

	it("returns null for anything that is not an authorization outcome", () => {
		expect(actionDenialResult(new Error("db down"))).toBeNull();
		expect(actionDenialResult(new Error("Failed to update the daily feed ceiling"))).toBeNull();
		expect(actionDenialResult(null)).toBeNull();
		expect(actionDenialResult("nope")).toBeNull();
		// A result-shaped object must not be mistaken for a thrown refusal.
		expect(actionDenialResult({ success: false, error: "x" })).toBeNull();
	});

	it("duck-types the error so a module or test-double copy still matches", () => {
		const copy = Object.assign(new Error("permission denied"), {
			code: ACTION_DENIED_CODE,
			reason: "wrong_role",
		});

		expect(isActionDeniedError(copy)).toBe(true);
		expect(actionDenialResult(copy)).toMatchObject({ code: "wrong_role" });
		expect(actionDenialResult({ code: ACTION_DENIED_CODE, reason: "unknown" })).toBeNull();
	});
});

describe("rethrowIfNavigationError", () => {
	it("rethrows a redirect so the framework can navigate", () => {
		const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
			digest: "NEXT_REDIRECT;replace;/dashboard;307;",
		});

		expect(() => rethrowIfNavigationError(redirect)).toThrow(redirect);
	});

	it.each(["NEXT_NOT_FOUND", "NEXT_HTTP_ERROR_FALLBACK;404"])("rethrows %s", (digest) => {
		const error = Object.assign(new Error(digest), { digest });
		expect(() => rethrowIfNavigationError(error)).toThrow(error);
	});

	it("does not throw for an ordinary failure or a non-digest value", () => {
		expect(() => rethrowIfNavigationError(new Error("db down"))).not.toThrow();
		expect(() => rethrowIfNavigationError({ digest: 42 })).not.toThrow();
		expect(() => rethrowIfNavigationError(null)).not.toThrow();
	});
});
