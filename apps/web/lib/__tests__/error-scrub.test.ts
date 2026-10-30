import {
	REDACTED,
	REDACTED_EMAIL,
	REDACTED_TOKEN,
	errorDetails,
	scrubContext,
	scrubText,
	scrubValue,
} from "@/lib/error-scrub";
import { describe, expect, it } from "vitest";

const DEVICE_TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const BEARER_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.not-a-real-signature";
const SUPABASE_SECRET = "sb_secret_abcdefghijklmnopqrstuvwxyz";
const EMAIL = "farmer.juan@example.com";

describe("scrubText", () => {
	it("removes an X-Device-Token header value", () => {
		const scrubbed = scrubText(`ingest failed; X-Device-Token: ${DEVICE_TOKEN}`);

		expect(scrubbed).not.toContain(DEVICE_TOKEN);
		expect(scrubbed).toContain(REDACTED);
	});

	it("removes an Authorization bearer credential", () => {
		const scrubbed = scrubText(`Authorization: Bearer ${BEARER_TOKEN}`);

		expect(scrubbed).not.toContain(BEARER_TOKEN);
		expect(scrubbed).toContain("Authorization");
		expect(scrubbed).toContain(REDACTED);
	});

	it("keeps a bare bearer scheme greppable", () => {
		const scrubbed = scrubText(`fetch failed with Bearer ${BEARER_TOKEN}`);

		expect(scrubbed).not.toContain(BEARER_TOKEN);
		expect(scrubbed).toContain("Bearer");
		expect(scrubbed).toContain(REDACTED);
	});

	it("removes passwords in query strings and JSON", () => {
		const scrubbed = scrubText(
			`password=hunter2 and {"password":"correct horse battery staple"} and pwd: "letmein"`,
		);

		expect(scrubbed).not.toContain("hunter2");
		expect(scrubbed).not.toContain("correct horse battery staple");
		expect(scrubbed).not.toContain("letmein");
	});

	it("removes e-mail addresses", () => {
		const scrubbed = scrubText(`No account for ${EMAIL}; invite bounced`);

		expect(scrubbed).not.toContain(EMAIL);
		expect(scrubbed).toContain(REDACTED_EMAIL);
		expect(scrubbed).toContain("No account for");
	});

	it("removes Supabase JWTs, secret keys and long hex tokens", () => {
		const jwt = scrubText(`key=${SUPABASE_SECRET}`);
		const legacy = scrubText(
			"anon eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJl",
		);
		const hex = scrubText(`device token ${DEVICE_TOKEN} rejected`);

		expect(jwt).not.toContain("sb_secret_");
		expect(legacy).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
		expect(hex).not.toContain(DEVICE_TOKEN);
		expect(hex).toContain(REDACTED_TOKEN);
	});

	it("leaves ordinary diagnostics alone", () => {
		const text =
			"PrismaClientKnownRequestError: Unique constraint failed on the fields: (`farmId`)";

		expect(scrubText(text)).toBe(text);
	});
});

describe("scrubValue and scrubContext", () => {
	it("redacts sensitive keys and keeps structural context", () => {
		const scrubbed = scrubContext({
			route: "ingest",
			deviceId: "dev_123",
			deviceToken: DEVICE_TOKEN,
			headers: { authorization: `Bearer ${BEARER_TOKEN}`, accept: "application/json" },
			nested: { email: EMAIL, note: "heartbeat parsed" },
		});

		expect(scrubbed).toEqual({
			route: "ingest",
			deviceId: "dev_123",
			deviceToken: REDACTED,
			headers: { authorization: REDACTED, accept: "application/json" },
			nested: { email: REDACTED, note: "heartbeat parsed" },
		});
	});

	it("scrubs a sensitive value hidden inside a string field", () => {
		const scrubbed = scrubContext({ reason: `token=${DEVICE_TOKEN}` });

		expect(JSON.stringify(scrubbed)).not.toContain(DEVICE_TOKEN);
	});

	it("survives circular references and dates", () => {
		const context: Record<string, unknown> = {
			at: new Date("2026-10-29T10:00:00.000Z"),
		};
		context.self = context;

		const scrubbed = scrubContext(context) as Record<string, unknown>;

		expect(scrubbed.at).toBe("2026-10-29T10:00:00.000Z");
		expect(scrubbed.self).toBe("[circular]");
	});

	it("caps depth instead of walking forever", () => {
		let deep: unknown = "leaf";
		for (let index = 0; index < 10; index += 1) deep = { next: deep };

		expect(() => scrubValue(deep)).not.toThrow();
		expect(JSON.stringify(scrubValue(deep))).toContain(REDACTED);
	});
});

describe("errorDetails", () => {
	it("reads an Error message and stack", () => {
		const details = errorDetails(new Error("hopper sensor missing"));

		expect(details.message).toBe("hopper sensor missing");
		expect(details.stack).toContain("hopper sensor missing");
	});

	it("accepts a thrown string and a thrown object", () => {
		expect(errorDetails("plain failure").message).toBe("plain failure");
		expect(errorDetails({ code: "E_FAIL", status: 500 }).message).toContain("E_FAIL");
	});

	it("never returns an empty message", () => {
		expect(errorDetails(new Error("")).message).toBe("Error");
		expect(errorDetails("   ").message).toBe("Unknown error");
	});
});
