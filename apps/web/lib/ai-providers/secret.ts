// Server-only AES-256-GCM helpers for AI provider keys stored in Postgres.
//
// The master key is base64 (exactly 32 bytes) in AI_SECRET_KEY; a previous key
// may be supplied in AI_SECRET_KEY_PREVIOUS so a rotation can still decrypt old
// rows. `keyVersion` records which of the two encrypted a row: 1 = current,
// 0 = previous. The additional authenticated data binds a ciphertext to one
// provider row and one key version, so bytes copied between rows fail closed.
//
// Nothing here ever returns or logs key material. Failures are typed and carry
// a stable code only; the caller decides whether to fall back to an env var.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const SECRET_ALGORITHM = "aes-256-gcm";
export const CURRENT_KEY_VERSION = 1;
export const PREVIOUS_KEY_VERSION = 0;

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const MASTER_KEY_LENGTH = 32;

export type SecretFailureCode =
	| "missing_master_key"
	| "invalid_master_key"
	| "invalid_key_version"
	| "invalid_record"
	| "decrypt_failed";

export class SecretCryptoError extends Error {
	readonly code: SecretFailureCode;

	constructor(code: SecretFailureCode, message: string) {
		super(message);
		this.name = "SecretCryptoError";
		this.code = code;
	}
}

/** The four database columns that together form one encrypted secret. */
export interface SecretRecord {
	keyCiphertext: Uint8Array | null;
	keyIv: Uint8Array | null;
	keyTag: Uint8Array | null;
	keyVersion: number | null;
}

export interface EncryptedSecret {
	keyCiphertext: Buffer;
	keyIv: Buffer;
	keyTag: Buffer;
	keyVersion: number;
}

export type SecretDecryptResult =
	| { ok: true; plaintext: string }
	| { ok: false; code: SecretFailureCode };

function secretError(code: SecretFailureCode, message: string): SecretCryptoError {
	return new SecretCryptoError(code, message);
}

function decodeMasterKey(value: string): Buffer | null {
	// Buffer.from(value, "base64") accepts junk and ignores extra characters.
	// Require a canonical encoding so a typo cannot silently produce a key.
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
	const decoded = Buffer.from(value, "base64");
	if (decoded.length !== MASTER_KEY_LENGTH) return null;
	const canonical = decoded.toString("base64").replace(/=+$/, "");
	if (canonical !== value.replace(/=+$/, "")) return null;
	return decoded;
}

function masterKeyForVersion(version: number): Buffer {
	const envName =
		version === CURRENT_KEY_VERSION
			? "AI_SECRET_KEY"
			: version === PREVIOUS_KEY_VERSION
				? "AI_SECRET_KEY_PREVIOUS"
				: null;
	if (!envName) {
		throw secretError("invalid_key_version", "Unsupported AI provider key version.");
	}

	const raw = process.env[envName]?.trim();
	if (!raw) {
		throw secretError("missing_master_key", `${envName} is not configured.`);
	}

	const decoded = decodeMasterKey(raw);
	if (!decoded) {
		throw secretError(
			"invalid_master_key",
			`${envName} must be base64 of exactly ${MASTER_KEY_LENGTH} bytes.`,
		);
	}
	return decoded;
}

/** AAD is `${provider}:${keyVersion}`; exporting it keeps callers consistent. */
export function secretAad(provider: string, keyVersion: number): string {
	return `${provider}:${keyVersion}`;
}

/**
 * Encrypt with the current master key. Throws `SecretCryptoError` when the
 * master key is missing or malformed — never with key or plaintext material.
 */
export function encryptSecret(plaintext: string, aad: string): EncryptedSecret {
	if (!plaintext || !aad) {
		throw secretError("invalid_record", "A provider key and its provider id are required.");
	}

	const masterKey = masterKeyForVersion(CURRENT_KEY_VERSION);
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(SECRET_ALGORITHM, masterKey, iv);
	cipher.setAAD(Buffer.from(aad, "utf8"));
	const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();

	return {
		keyCiphertext: ciphertext,
		keyIv: iv,
		keyTag: tag,
		keyVersion: CURRENT_KEY_VERSION,
	};
}

/**
 * Decrypt one stored record. Every failure — missing master key, malformed
 * record, tampered bytes, wrong AAD — returns `{ ok: false, code }`; it never
 * throws and never returns partial plaintext.
 */
export function decryptSecret(record: SecretRecord, aad: string): SecretDecryptResult {
	const { keyCiphertext, keyIv, keyTag, keyVersion } = record;
	if (
		!keyCiphertext ||
		!keyIv ||
		!keyTag ||
		keyVersion === null ||
		keyCiphertext.length === 0 ||
		keyIv.length !== IV_LENGTH ||
		keyTag.length !== TAG_LENGTH ||
		!aad
	) {
		return { ok: false, code: "invalid_record" };
	}

	let masterKey: Buffer;
	try {
		masterKey = masterKeyForVersion(keyVersion);
	} catch (error) {
		if (error instanceof SecretCryptoError) return { ok: false, code: error.code };
		return { ok: false, code: "decrypt_failed" };
	}

	try {
		const decipher = createDecipheriv(SECRET_ALGORITHM, masterKey, Buffer.from(keyIv));
		decipher.setAAD(Buffer.from(aad, "utf8"));
		decipher.setAuthTag(Buffer.from(keyTag));
		const plaintext = Buffer.concat([
			decipher.update(Buffer.from(keyCiphertext)),
			decipher.final(),
		]).toString("utf8");
		if (!plaintext) return { ok: false, code: "decrypt_failed" };
		return { ok: true, plaintext };
	} catch {
		return { ok: false, code: "decrypt_failed" };
	}
}

/** True when the current master key is present and well formed. */
export function hasUsableMasterKey(): boolean {
	try {
		masterKeyForVersion(CURRENT_KEY_VERSION);
		return true;
	} catch {
		return false;
	}
}
