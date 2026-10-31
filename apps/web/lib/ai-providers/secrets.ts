import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encrypted provider API keys at rest (issue #432).
 *
 * The superadmin console can set, rotate and clear a key. The plaintext exists
 * only inside the request that writes it and inside the call that decrypts it;
 * no action, page, log line, audit row or backup export ever carries it.
 *
 * AES-256-GCM, a random 12-byte IV per write, the 16-byte tag stored beside the
 * ciphertext, and the provider slug bound as additional authenticated data so a
 * ciphertext copied onto another provider row fails to decrypt.
 *
 * The master key lives in `AI_SECRET_KEY` (base64 or 64 hex characters, 32
 * bytes). `AI_SECRET_KEY_VERSION` (default 1) labels the active generation and
 * `AI_SECRET_KEY_PREVIOUS` holds the generation before it, so a rotation can
 * re-encrypt rows lazily: old rows keep decrypting until they are written
 * again. A missing or malformed master key is reported by
 * `isSecretStorageConfigured()` and the caller falls back to the environment
 * variable, so the platform keeps working before the first deployment sets
 * the key.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface EncryptedProviderKey {
	ciphertext: Buffer;
	iv: Buffer;
	tag: Buffer;
	keyVersion: number;
}

/** The subset of an AiProviderConfig row that carries key material. */
export interface ProviderKeyRow {
	provider: string;
	keyCiphertext: Uint8Array | null;
	keyIv: Uint8Array | null;
	keyTag: Uint8Array | null;
	keyVersion: number | null;
}

function parseMasterKey(raw: string | undefined): Buffer | null {
	if (!raw) return null;
	const trimmed = raw.trim();
	if (trimmed.length === 0) return null;
	const key = /^[0-9a-fA-F]{64}$/.test(trimmed)
		? Buffer.from(trimmed, "hex")
		: Buffer.from(trimmed, "base64");
	return key.length === KEY_BYTES ? key : null;
}

function activeVersion(): number {
	const parsed = Number(process.env.AI_SECRET_KEY_VERSION ?? "1");
	return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function keyForVersion(version: number): Buffer | null {
	const active = activeVersion();
	if (version === active) return parseMasterKey(process.env.AI_SECRET_KEY);
	if (version === active - 1) return parseMasterKey(process.env.AI_SECRET_KEY_PREVIOUS);
	return null;
}

/** True when a usable master key is configured for new writes. */
export function isSecretStorageConfigured(): boolean {
	return parseMasterKey(process.env.AI_SECRET_KEY) !== null;
}

/** Domain-separated AAD so a ciphertext cannot move between rows. */
function additionalData(provider: string): Buffer {
	return Buffer.from(`optifeed:ai-provider:${provider}`, "utf8");
}

/**
 * Encrypt a key for one provider. Returns null when no valid master key is
 * configured or the value is empty; callers treat that as "cannot store".
 */
export function encryptProviderKey(
	provider: string,
	plaintext: string,
): EncryptedProviderKey | null {
	if (!plaintext) return null;
	const key = parseMasterKey(process.env.AI_SECRET_KEY);
	if (!key) return null;

	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
	cipher.setAAD(additionalData(provider));
	const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	return { ciphertext, iv, tag: cipher.getAuthTag(), keyVersion: activeVersion() };
}

/**
 * Decrypt one row. Any failure (missing master key, unknown generation,
 * tampered ciphertext, wrong provider) returns null and never throws, so a
 * broken row cannot take the whole provider chain down.
 */
export function decryptProviderKey(row: ProviderKeyRow): string | null {
	if (!row.keyCiphertext || !row.keyIv || !row.keyTag || row.keyVersion === null) return null;
	const key = keyForVersion(row.keyVersion);
	if (!key) return null;

	try {
		const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(row.keyIv), {
			authTagLength: TAG_BYTES,
		});
		decipher.setAAD(additionalData(row.provider));
		decipher.setAuthTag(Buffer.from(row.keyTag));
		const plaintext = Buffer.concat([
			decipher.update(Buffer.from(row.keyCiphertext)),
			decipher.final(),
		]).toString("utf8");
		return plaintext.length > 0 ? plaintext : null;
	} catch {
		return null;
	}
}

/** The only part of a secret the console is ever shown. */
export function keyHint(secret: string): string {
	return secret.slice(-4);
}

/** Shape returned to the console. Never contains the value. */
export function keyMaterialToColumns(encrypted: EncryptedProviderKey) {
	return {
		// Prisma's Bytes maps to Uint8Array; copy the Buffers so the stored
		// value cannot alias a caller-owned view.
		keyCiphertext: new Uint8Array(encrypted.ciphertext),
		keyIv: new Uint8Array(encrypted.iv),
		keyTag: new Uint8Array(encrypted.tag),
		keyVersion: encrypted.keyVersion,
	};
}
