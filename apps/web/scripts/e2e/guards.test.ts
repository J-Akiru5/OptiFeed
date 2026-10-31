import { describe, expect, it } from "vitest";
import {
	E2E_CONFIRM_VALUE,
	E2E_LOCAL_HOSTS,
	E2E_LOCAL_STACK_VALUE,
	assertCiLocalStackTarget,
	assertE2eEnvironment,
	isLocalE2eHost,
	requireE2ePassword,
} from "./guards";

/**
 * The guard decides whether the e2e suite may touch a database. These tests
 * pin both branches:
 *
 * - the disposable local stack (CI + local development) is accepted with the
 *   explicit local opt-in and a loopback host;
 * - any remote host still requires the allow-list and the production
 *   acknowledgement — the local opt-in cannot weaken that.
 */

const LOCAL_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const REMOTE_URL = "postgresql://postgres:secret@db.abcdefghijkl.supabase.co:5432/postgres";
const REMOTE_HOST = "db.abcdefghijkl.supabase.co";

const localEnv = (overrides: Record<string, string> = {}) => ({
	DATABASE_URL: LOCAL_URL,
	E2E_ALLOW_LOCAL_STACK: E2E_LOCAL_STACK_VALUE,
	...overrides,
});

const remoteEnv = (overrides: Record<string, string> = {}) => ({
	DATABASE_URL: REMOTE_URL,
	...overrides,
});

describe("assertE2eEnvironment — local stack", () => {
	it("accepts a loopback host with the explicit local opt-in and no acknowledgement", () => {
		expect(assertE2eEnvironment(localEnv())).toEqual({ host: "127.0.0.1", mode: "local" });
	});

	it("accepts localhost and IPv6 loopback", () => {
		expect(
			assertE2eEnvironment(localEnv({ DATABASE_URL: "postgresql://postgres@localhost:54322/db" }))
				.mode,
		).toBe("local");
		expect(isLocalE2eHost("localhost")).toBe(true);
		expect(isLocalE2eHost("::1")).toBe(true);
		expect(isLocalE2eHost("[::1]")).toBe(true);
	});

	it("trims the opt-in value and treats any other value as off", () => {
		expect(
			assertE2eEnvironment(localEnv({ E2E_ALLOW_LOCAL_STACK: ` ${E2E_LOCAL_STACK_VALUE} ` })).mode,
		).toBe("local");
		expect(() => assertE2eEnvironment(localEnv({ E2E_ALLOW_LOCAL_STACK: "true" }))).toThrow(
			/E2E_ALLOWED_DB_HOST is not set/,
		);
		expect(() => assertE2eEnvironment(localEnv({ E2E_ALLOW_LOCAL_STACK: "" }))).toThrow(
			/E2E_ALLOWED_DB_HOST is not set/,
		);
	});

	it.each(["127.0.0.1.example.com", "localhost.evil", "local", "10.0.0.5"])(
		"does not accept the look-alike host %s as local",
		(host) => {
			expect(isLocalE2eHost(host)).toBe(false);
			expect(() =>
				assertE2eEnvironment({
					DATABASE_URL: `postgresql://postgres:secret@${host}:5432/postgres`,
					E2E_ALLOW_LOCAL_STACK: E2E_LOCAL_STACK_VALUE,
				}),
			).toThrow(/only authorises a loopback DATABASE_URL host/);
		},
	);

	it("documents every accepted loopback host", () => {
		for (const host of E2E_LOCAL_HOSTS) expect(isLocalE2eHost(host)).toBe(true);
	});
});

describe("assertE2eEnvironment — remote hosts are never relaxed", () => {
	it("refuses a remote host when the local opt-in is set but nothing is acknowledged", () => {
		expect(() =>
			assertE2eEnvironment(remoteEnv({ E2E_ALLOW_LOCAL_STACK: E2E_LOCAL_STACK_VALUE })),
		).toThrow(/only authorises a loopback DATABASE_URL host/);
	});

	it("refuses a remote host with the allow-list but no production acknowledgement", () => {
		expect(() =>
			assertE2eEnvironment(
				remoteEnv({
					E2E_ALLOW_LOCAL_STACK: E2E_LOCAL_STACK_VALUE,
					E2E_ALLOWED_DB_HOST: REMOTE_HOST,
				}),
			),
		).toThrow(/E2E_CONFIRM_PRODUCTION must be "yes"/);
	});

	it("refuses a remote host whose host does not match the allow-list", () => {
		expect(() =>
			assertE2eEnvironment(
				remoteEnv({
					E2E_ALLOWED_DB_HOST: "db.other.supabase.co",
					E2E_CONFIRM_PRODUCTION: E2E_CONFIRM_VALUE,
				}),
			),
		).toThrow(/is not the allow-listed host/);
	});

	it("accepts an acknowledged remote host (the unchanged production-fixture path)", () => {
		expect(
			assertE2eEnvironment(
				remoteEnv({
					E2E_ALLOWED_DB_HOST: REMOTE_HOST,
					E2E_CONFIRM_PRODUCTION: E2E_CONFIRM_VALUE,
				}),
			),
		).toEqual({ host: REMOTE_HOST, mode: "remote" });
		expect(
			assertE2eEnvironment(
				remoteEnv({
					E2E_ALLOW_LOCAL_STACK: E2E_LOCAL_STACK_VALUE,
					E2E_ALLOWED_DB_HOST: REMOTE_HOST,
					E2E_CONFIRM_PRODUCTION: E2E_CONFIRM_VALUE,
				}),
			).mode,
		).toBe("remote");
	});
});

describe("assertE2eEnvironment — malformed input", () => {
	it("refuses a missing DATABASE_URL", () => {
		expect(() => assertE2eEnvironment({})).toThrow(/DATABASE_URL is not set/);
	});

	it("refuses a DATABASE_URL that is not a URL", () => {
		expect(() =>
			assertE2eEnvironment({ DATABASE_URL: "not-a-url", E2E_ALLOW_LOCAL_STACK: "yes" }),
		).toThrow(/not a valid URL/);
	});

	it("refuses an empty DATABASE_URL", () => {
		expect(() => assertE2eEnvironment({ DATABASE_URL: "   " })).toThrow(/DATABASE_URL is not set/);
	});
});

describe("assertCiLocalStackTarget (issue #317)", () => {
	const ciEnv = (overrides: Record<string, string> = {}) => ({
		CI: "true",
		...localEnv(),
		...overrides,
	});

	it("accepts a loopback stack in CI", () => {
		expect(assertCiLocalStackTarget(ciEnv())).toEqual({ host: "127.0.0.1", mode: "local" });
	});

	it("refuses the preflight outside CI, even with a loopback stack", () => {
		expect(() => assertCiLocalStackTarget(localEnv())).toThrow(/CI must be "true"/);
		expect(() => assertCiLocalStackTarget(ciEnv({ CI: "false" }))).toThrow(/CI must be "true"/);
	});

	it("refuses a CI run without the local-stack opt-in", () => {
		expect(() => assertCiLocalStackTarget(ciEnv({ E2E_ALLOW_LOCAL_STACK: "" }))).toThrow(
			/E2E_ALLOW_LOCAL_STACK must be "yes"/,
		);
	});

	it("refuses a misconfigured DATABASE_URL pointing at a real project", () => {
		// A stray hosted URL in CI must fail before `prisma migrate deploy`.
		expect(() => assertCiLocalStackTarget(ciEnv({ DATABASE_URL: REMOTE_URL }))).toThrow(
			/not a loopback host/,
		);
	});

	it("never lets the production acknowledgement make a remote host eligible in CI", () => {
		expect(() =>
			assertCiLocalStackTarget(
				ciEnv({
					DATABASE_URL: REMOTE_URL,
					E2E_ALLOWED_DB_HOST: REMOTE_HOST,
					E2E_CONFIRM_PRODUCTION: E2E_CONFIRM_VALUE,
				}),
			),
		).toThrow(/CI only runs against the disposable local stack/);
	});

	it("refuses a missing or malformed DATABASE_URL", () => {
		expect(() => assertCiLocalStackTarget(ciEnv({ DATABASE_URL: "" }))).toThrow(
			/DATABASE_URL is not set/,
		);
		expect(() => assertCiLocalStackTarget(ciEnv({ DATABASE_URL: "not-a-url" }))).toThrow(
			/not a valid URL/,
		);
	});
});

describe("requireE2ePassword", () => {
	it("returns the configured password", () => {
		expect(requireE2ePassword({ E2E_PASSWORD: "s3cret" })).toBe("s3cret");
	});

	it("refuses an empty password", () => {
		expect(() => requireE2ePassword({ E2E_PASSWORD: "" })).toThrow(/E2E_PASSWORD is not set/);
		expect(() => requireE2ePassword({})).toThrow(/E2E_PASSWORD is not set/);
	});
});
