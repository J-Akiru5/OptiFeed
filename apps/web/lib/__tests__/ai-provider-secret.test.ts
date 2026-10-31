import { randomBytes } from "node:crypto";
import {
	CURRENT_KEY_VERSION,
	PREVIOUS_KEY_VERSION,
	type SecretRecord,
	decryptSecret,
	encryptSecret,
	hasUsableMasterKey,
	secretAad,
} from "@/lib/ai-providers/secret";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * AES-256-GCM storage for provider keys (issue #432).
 *
 * The key must only decrypt with the same master key, provider and key version.
 * Every failure returns a typed code and never an error that embeds the
 * plaintext, the master key or any part of the record.
 */

const CURRENT = randomBytes(32).toString("base64");
const PREVIOUS = randomBytes(32).toString("base64");
const PLAINTEXT = "sk-live-SENTINEL-1234";

function record(overrides: Partial<SecretRecord> = {}): SecretRecord {
	return {
		keyCiphertext: null,
		keyIv: null,
		keyTag: null,
		keyVersion: null,
		...overrides,
	};
}

beforeEach(() => {
	process.env.AI_SECRET_KEY = CURRENT;
	process.env.AI_SECRET_KEY_PREVIOUS = "";
});

afterEach(() => {
	process.env.AI_SECRET_KEY = "";
	process.env.AI_SECRET_KEY_PREVIOUS = "";
});

describe("encryptSecret / decryptSecret", () => {
	it("round-trips with the current master key", () => {
		const encrypted = encryptSecret(PLAINTEXT, secretAad("opencode-go", CURRENT_KEY_VERSION));
		const result = decryptSecret(
			{
				keyCiphertext: encrypted.keyCiphertext,
				keyIv: encrypted.keyIv,
				keyTag: encrypted.keyTag,
				keyVersion: encrypted.keyVersion,
			},
			secretAad("opencode-go", CURRENT_KEY_VERSION),
		);

		expect(encrypted.keyVersion).toBe(CURRENT_KEY_VERSION);
		expect(encrypted.keyIv).toHaveLength(12);
		expect(encrypted.keyTag).toHaveLength(16);
		expect(result).toEqual({ ok: true, plaintext: PLAINTEXT });
	});

	it("fails closed when the AAD names a different provider or version", () => {
		const encrypted = encryptSecret(PLAINTEXT, secretAad("opencode-go", CURRENT_KEY_VERSION));
		const stored = {
			keyCiphertext: encrypted.keyCiphertext,
			keyIv: encrypted.keyIv,
			keyTag: encrypted.keyTag,
			keyVersion: encrypted.keyVersion,
		};

		expect(decryptSecret(stored, secretAad("gemini", CURRENT_KEY_VERSION))).toEqual({
			ok: false,
			code: "decrypt_failed",
		});
	});

	it("fails closed when the ciphertext is tampered with", () => {
		const encrypted = encryptSecret(PLAINTEXT, secretAad("opencode-go", 1));
		const ciphertext = Buffer.from(encrypted.keyCiphertext);
		ciphertext[0] ^= 0xff;

		expect(
			decryptSecret(
				{ ...encrypted, keyCiphertext: ciphertext },
				secretAad("opencode-go", CURRENT_KEY_VERSION),
			),
		).toEqual({ ok: false, code: "decrypt_failed" });
	});

	it("fails closed when the authentication tag is tampered with", () => {
		const encrypted = encryptSecret(PLAINTEXT, secretAad("opencode-go", 1));
		const tag = Buffer.from(encrypted.keyTag);
		tag[0] ^= 0xff;

		expect(
			decryptSecret({ ...encrypted, keyTag: tag }, secretAad("opencode-go", CURRENT_KEY_VERSION)),
		).toEqual({ ok: false, code: "decrypt_failed" });
	});

	it("decrypts a record encrypted by the previous master key", () => {
		process.env.AI_SECRET_KEY = PREVIOUS;
		const encrypted = encryptSecret(PLAINTEXT, secretAad("gemini", PREVIOUS_KEY_VERSION));

		// After a rotation the previous key is the new PREVIOUS and the current
		// key is different; keyVersion 0 must still select PREVIOUS.
		process.env.AI_SECRET_KEY = CURRENT;
		process.env.AI_SECRET_KEY_PREVIOUS = PREVIOUS;

		const result = decryptSecret(
			{ ...encrypted, keyVersion: PREVIOUS_KEY_VERSION },
			secretAad("gemini", PREVIOUS_KEY_VERSION),
		);
		expect(result).toEqual({ ok: true, plaintext: PLAINTEXT });
	});

	it("reports a missing previous key instead of falling back to the current one", () => {
		process.env.AI_SECRET_KEY = PREVIOUS;
		const encrypted = encryptSecret(PLAINTEXT, secretAad("gemini", PREVIOUS_KEY_VERSION));
		process.env.AI_SECRET_KEY_PREVIOUS = "";
		process.env.AI_SECRET_KEY = CURRENT;

		expect(
			decryptSecret(
				{ ...encrypted, keyVersion: PREVIOUS_KEY_VERSION },
				secretAad("gemini", PREVIOUS_KEY_VERSION),
			),
		).toEqual({ ok: false, code: "missing_master_key" });
	});
});

describe("fail-closed master-key handling", () => {
	it("throws a typed error when AI_SECRET_KEY is missing", () => {
		process.env.AI_SECRET_KEY = "";

		expect(() => encryptSecret(PLAINTEXT, secretAad("opencode-go", 1))).toThrowError(
			expect.objectContaining({ code: "missing_master_key" }),
		);
		expect(hasUsableMasterKey()).toBe(false);
	});

	it("throws a typed error when the master key is not 32 bytes", () => {
		process.env.AI_SECRET_KEY = randomBytes(31).toString("base64");

		expect(() => encryptSecret(PLAINTEXT, secretAad("opencode-go", 1))).toThrowError(
			expect.objectContaining({ code: "invalid_master_key" }),
		);
		expect(hasUsableMasterKey()).toBe(false);
	});

	it("rejects a non-base64 master key", () => {
		process.env.AI_SECRET_KEY = "not base64 at all";

		expect(() => encryptSecret(PLAINTEXT, secretAad("opencode-go", 1))).toThrowError(
			expect.objectContaining({ code: "invalid_master_key" }),
		);
	});

	it("returns missing_master_key from decrypt instead of throwing", () => {
		const encrypted = encryptSecret(PLAINTEXT, secretAad("opencode-go", 1));
		process.env.AI_SECRET_KEY = "";

		expect(
			decryptSecret(
				{ ...encrypted, keyVersion: CURRENT_KEY_VERSION },
				secretAad("opencode-go", CURRENT_KEY_VERSION),
			),
		).toEqual({ ok: false, code: "missing_master_key" });
	});

	it("rejects an unsupported key version", () => {
		expect(
			decryptSecret(
				record({
					keyCiphertext: Buffer.from("x"),
					keyIv: Buffer.alloc(12),
					keyTag: Buffer.alloc(16),
					keyVersion: 7,
				}),
				secretAad("opencode-go", 7),
			),
		).toEqual({ ok: false, code: "invalid_key_version" });
	});

	it("rejects a malformed record without touching the master key", () => {
		expect(decryptSecret(record(), secretAad("opencode-go", 1))).toEqual({
			ok: false,
			code: "invalid_record",
		});
		expect(
			decryptSecret(
				record({
					keyCiphertext: Buffer.from("x"),
					keyIv: Buffer.alloc(11),
					keyTag: Buffer.alloc(16),
					keyVersion: 1,
				}),
				secretAad("opencode-go", 1),
			),
		).toEqual({ ok: false, code: "invalid_record" });
		expect(
			decryptSecret(
				record({
					keyCiphertext: Buffer.from("x"),
					keyIv: Buffer.alloc(12),
					keyTag: Buffer.alloc(15),
					keyVersion: 1,
				}),
				secretAad("opencode-go", 1),
			),
		).toEqual({ ok: false, code: "invalid_record" });
		expect(
			decryptSecret(
				record({
					keyCiphertext: Buffer.from("x"),
					keyIv: Buffer.alloc(12),
					keyTag: Buffer.alloc(16),
					keyVersion: 1,
				}),
				"",
			),
		).toEqual({ ok: false, code: "invalid_record" });
	});

	it("never puts the master key or plaintext in an error message", () => {
		process.env.AI_SECRET_KEY = randomBytes(31).toString("base64");

		try {
			encryptSecret(PLAINTEXT, secretAad("opencode-go", 1));
			throw new Error("encryptSecret should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			const message = (error as Error).message;
			expect(message).not.toContain(PLAINTEXT);
			expect(message).not.toContain(process.env.AI_SECRET_KEY ?? "");
		}
	});

	it("rejects empty input instead of encrypting nothing", () => {
		expect(() => encryptSecret("", secretAad("opencode-go", 1))).toThrowError(
			expect.objectContaining({ code: "invalid_record" }),
		);
		expect(() => encryptSecret(PLAINTEXT, "")).toThrowError(
			expect.objectContaining({ code: "invalid_record" }),
		);
	});
});
