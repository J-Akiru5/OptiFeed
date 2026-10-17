import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SupabaseCreateArgs = [
	string,
	string,
	{ auth: { autoRefreshToken: boolean; persistSession: boolean } },
];

const { createClientMock } = vi.hoisted(() => ({
	createClientMock: vi.fn((..._args: SupabaseCreateArgs) => ({ client: "stub" })),
}));

vi.mock("@supabase/supabase-js", () => ({
	createClient: createClientMock,
}));

import { createAdminClient } from "@/lib/supabase/admin";

const URL = "https://example.supabase.co";
const ANON_KEY = "anon-key-public";
const SERVICE_KEY = "service-role-key-secret";

const ORIGINAL_ENV = {
	NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
	NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
	SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

function setEnv(entries: Record<string, string | undefined>): void {
	for (const [key, value] of Object.entries(entries)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

describe("createAdminClient", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setEnv({
			NEXT_PUBLIC_SUPABASE_URL: URL,
			NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
			SUPABASE_SERVICE_ROLE_KEY: undefined,
		});
	});

	afterEach(() => {
		setEnv(ORIGINAL_ENV);
	});

	it("throws when SUPABASE_SERVICE_ROLE_KEY is missing", () => {
		expect(() => createAdminClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
		// The anon key must never be used as a fallback — that is the bug this
		// module exists to prevent.
		expect(createClientMock).not.toHaveBeenCalled();
	});

	it("does not fall back to NEXT_PUBLIC_SUPABASE_ANON_KEY", () => {
		setEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY });
		expect(() => createAdminClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
		expect(createClientMock).not.toHaveBeenCalled();
	});

	it("throws when the Supabase URL is missing", () => {
		setEnv({ NEXT_PUBLIC_SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY });
		expect(() => createAdminClient()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
		expect(createClientMock).not.toHaveBeenCalled();
	});

	it("constructs the client with the service role key, never the anon key", () => {
		setEnv({ SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY });

		const client = createAdminClient();

		expect(client).toEqual({ client: "stub" });
		expect(createClientMock).toHaveBeenCalledTimes(1);
		const [url, key, options] = createClientMock.mock.calls[0] as SupabaseCreateArgs;
		expect(url).toBe(URL);
		expect(key).toBe(SERVICE_KEY);
		expect(key).not.toBe(ANON_KEY);
		expect(options.auth).toEqual({ autoRefreshToken: false, persistSession: false });
	});
});
