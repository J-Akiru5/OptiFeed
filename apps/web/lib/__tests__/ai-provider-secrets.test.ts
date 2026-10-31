import {
	decryptProviderKey,
	encryptProviderKey,
	isSecretStorageConfigured,
	keyHint,
	keyMaterialToColumns,
} from "@/lib/ai-providers/secrets";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #432: provider keys are encrypted at rest with AES-256-GCM and bound to
 * the provider row. These tests cover the properties that matter if the code
 * changes later: round-trip, tamper detection, cross-row replay and master-key
 * rotation.
 */

const TEST_SECRET = ["unit", "test", "secret", "1234"].join("-");
const LONGER_SECRET = ["unit", "test", "secret", "AIza"].join("-");
const MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
const PREVIOUS_KEY = Buffer.alloc(32, 9).toString("base64");

function rowFor(provider: string, encrypted: ReturnType<typeof encryptProviderKey>) {
	if (!encrypted) throw new Error("encryption returned null");
	const columns = keyMaterialToColumns(encrypted);
	return {
		provider,
		keyCiphertext: columns.keyCiphertext,
		keyIv: columns.keyIv,
		keyTag: columns.keyTag,
		keyVersion: columns.keyVersion,
	};
}

beforeEach(() => {
	vi.stubEnv("AI_SECRET_KEY", MASTER_KEY);
	vi.stubEnv("AI_SECRET_KEY_VERSION", "1");
	vi.stubEnv("AI_SECRET_KEY_PREVIOUS", "");
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("provider key encryption", () => {
	it("round-trips a key", () => {
		const encrypted = encryptProviderKey("opencode-go", TEST_SECRET);
		expect(encrypted).not.toBeNull();

		expect(decryptProviderKey(rowFor("opencode-go", encrypted))).toBe(TEST_SECRET);
	});

	it("never stores the plaintext in the ciphertext", () => {
		const encrypted = encryptProviderKey("gemini", LONGER_SECRET);
		const serialized = JSON.stringify(encrypted, (_key, value) =>
			value?.type === "Buffer" ? Buffer.from(value.data).toString("base64") : value,
		);
		expect(serialized).not.toContain(LONGER_SECRET);
	});

	it("binds the ciphertext to the provider row", () => {
		const encrypted = encryptProviderKey("opencode-go", TEST_SECRET);
		const row = rowFor("gemini", encrypted); // same bytes, different row
		expect(decryptProviderKey(row)).toBeNull();
	});

	it("rejects a tampered ciphertext instead of returning garbage", () => {
		const encrypted = encryptProviderKey("opencode-go", TEST_SECRET);
		const row = rowFor("opencode-go", encrypted);
		row.keyCiphertext = new Uint8Array(row.keyCiphertext);
		row.keyCiphertext[0] ^= 0xff;
		expect(decryptProviderKey(row)).toBeNull();
	});

	it("rejects a wrong master key", () => {
		const encrypted = encryptProviderKey("opencode-go", TEST_SECRET);
		const row = rowFor("opencode-go", encrypted);
		vi.stubEnv("AI_SECRET_KEY", Buffer.alloc(32, 1).toString("base64"));
		expect(decryptProviderKey(row)).toBeNull();
	});

	it("reports a missing master key instead of throwing", () => {
		vi.stubEnv("AI_SECRET_KEY", "");
		expect(isSecretStorageConfigured()).toBe(false);
		expect(encryptProviderKey("opencode-go", TEST_SECRET)).toBeNull();
		expect(
			decryptProviderKey({
				provider: "opencode-go",
				keyCiphertext: new Uint8Array([1, 2, 3]),
				keyIv: new Uint8Array(12),
				keyTag: new Uint8Array(16),
				keyVersion: 1,
			}),
		).toBeNull();
	});

	it("decrypts rows from the previous generation during a rotation", () => {
		const encrypted = encryptProviderKey("opencode-go", TEST_SECRET);
		const row = rowFor("opencode-go", encrypted);

		// Rotate: new active key, old key kept as previous, generation bumped.
		vi.stubEnv("AI_SECRET_KEY", PREVIOUS_KEY);
		vi.stubEnv("AI_SECRET_KEY_VERSION", "2");
		vi.stubEnv("AI_SECRET_KEY_PREVIOUS", MASTER_KEY);

		expect(decryptProviderKey(row)).toBe(TEST_SECRET);
	});

	it("shows only the last four characters", () => {
		expect(keyHint(TEST_SECRET)).toBe("1234");
	});

	it("accepts a 64-character hex master key", () => {
		vi.stubEnv("AI_SECRET_KEY", "ab".repeat(32));
		expect(isSecretStorageConfigured()).toBe(true);
	});

	it("rejects a master key of the wrong length", () => {
		vi.stubEnv("AI_SECRET_KEY", Buffer.alloc(16, 1).toString("base64"));
		expect(isSecretStorageConfigured()).toBe(false);
	});
});
