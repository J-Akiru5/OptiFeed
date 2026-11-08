/**
 * Prove the publish guard both ways: a consistent envelope passes, and every
 * way a channel can lie about its image is refused before anything is uploaded.
 *
 * Run: node --test scripts/ota/__tests__/publish-release.test.mjs
 */

import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { describe, it } from "node:test";
import { compareVersions, validateChannel, verifyChannelSignature } from "../publish-release.mjs";

const binary = Buffer.from("not a real firmware image, but stable bytes");

function envelope(overrides = {}) {
	const sha256 = createHash("sha256").update(binary).digest("hex");
	const manifest = {
		board: "wroom32u",
		variant: "gpio5",
		relay_gpio: 5,
		key_id: "primary",
		min_from_version: "1.9.0",
		sha256,
		size: binary.length,
		version: "1.10.0",
		...overrides.manifest,
	};
	return {
		version: "1.10.0",
		storage_path: "releases/1.10.0/firmware.bin",
		size: binary.length,
		sha256,
		manifest: JSON.stringify(manifest),
		signature: "MEUCIQ",
		key_id: "primary",
		variant: "gpio5",
		targets: "*",
		...overrides.envelope,
	};
}

describe("channel validation", () => {
	it("accepts a consistent envelope", () => {
		assert.deepEqual(validateChannel(envelope(), binary), []);
	});

	it("refuses when the envelope sha256 does not match the binary", () => {
		const problems = validateChannel(envelope({ envelope: { sha256: "0".repeat(64) } }), binary);
		assert.ok(problems.some((p) => p.includes("does not match binary")));
	});

	it("refuses when the size does not match the binary", () => {
		const problems = validateChannel(envelope({ envelope: { size: binary.length + 1 } }), binary);
		assert.ok(problems.some((p) => p.includes("does not match binary")));
	});

	it("refuses when the manifest disagrees with the envelope", () => {
		const problems = validateChannel(envelope({ envelope: { version: "1.10.1" } }), binary);
		assert.ok(problems.some((p) => p.includes("manifest.version")));
	});

	it("refuses a gpio5 manifest that declares the other relay pin", () => {
		const problems = validateChannel(envelope({ manifest: { relay_gpio: 25 } }), binary);
		assert.ok(problems.some((p) => p.includes("variant gpio5 must declare relay_gpio 5")));
	});

	it("refuses a storage path outside releases/", () => {
		const problems = validateChannel(envelope({ envelope: { storage_path: "../secrets.bin" } }), binary);
		assert.ok(problems.some((p) => p.includes("storage_path")));
	});

	it("refuses an unknown key id", () => {
		const problems = validateChannel(envelope({ envelope: { key_id: "tertiary" } }), binary);
		assert.ok(problems.some((p) => p.includes("key_id")));
	});
});

describe("signature", () => {
	it("verifies a signature over the exact manifest bytes", () => {
		const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
		const channel = envelope();
		channel.signature = sign("sha256", Buffer.from(channel.manifest, "utf8"), {
			key: privateKey,
			dsaEncoding: "der",
		}).toString("base64");
		const pem = publicKey.export({ type: "spki", format: "pem" });
		assert.equal(verifyChannelSignature(channel, pem), true);
	});

	it("rejects a signature made over different bytes", () => {
		const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
		const channel = envelope();
		channel.signature = sign("sha256", Buffer.from(`${channel.manifest} `, "utf8"), {
			key: privateKey,
			dsaEncoding: "der",
		}).toString("base64");
		const pem = publicKey.export({ type: "spki", format: "pem" });
		assert.equal(verifyChannelSignature(channel, pem), false);
	});
});

describe("version ordering", () => {
	it("orders releases numerically, not lexically", () => {
		assert.equal(compareVersions("1.10.0", "1.9.0"), 1);
		assert.equal(compareVersions("1.9.0", "1.10.0"), -1);
		assert.equal(compareVersions("1.10.0", "1.10.0"), 0);
		assert.equal(compareVersions("2.0.0", "1.99.99"), 1);
	});

	it("returns null for something that is not a version", () => {
		assert.equal(compareVersions("latest", "1.0.0"), null);
	});
});
