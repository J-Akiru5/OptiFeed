#!/usr/bin/env node
/**
 * Sign a PakaonAI firmware release for OTA (T-12b, decision OTA-4).
 *
 * Run on Jeff's machine only — never in CI, never on Vercel. The private key
 * lives offline outside this repository; the matching public PEM is committed
 * under `firmware/keys/` and embedded in the firmware build.
 *
 * The manifest is a JSON *string* signed with ECDSA P-256 / SHA-256 (DER,
 * base64). The firmware verifies exactly those bytes and then checks that the
 * envelope it received agrees with them, so this script signs the string it
 * writes into `manifest` and never re-serializes it afterwards.
 *
 * Usage:
 *   node scripts/ota/sign-release.mjs \
 *     --bin .pio/build/esp32dev/firmware.bin \
 *     --version 1.4.1 \
 *     --key ../ota-signing-keys/pakaonai-ota-primary-private.pem \
 *     --key-id primary \
 *     --min-from 1.4.0 \
 *     --targets all \
 *     --out ota-out
 *
 * `--public-key FILE` overrides the committed public PEM (tests and rotation
 * rehearsals only).
 */

import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BOARD = "wroom32u";
// min_spiffs.csv app slot (firmware/README.md "Partition table (OTA bootstrap)").
const MAX_IMAGE_BYTES = 1_966_080;
const SEMVER = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:[-+][0-9A-Za-z.-]+)?$/;
const MAC = /^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/i;
const KEY_IDS = new Set(["primary", "spare"]);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Numeric X.Y.Z order, mirroring the firmware's compareSemver. */
function semverOrder(left, right) {
	const a = SEMVER.exec(left);
	const b = SEMVER.exec(right);
	for (let part = 1; part <= 3; part++) {
		const difference = Number(a[part]) - Number(b[part]);
		if (difference !== 0) return difference > 0 ? 1 : -1;
	}
	return 0;
}

function fail(message) {
	console.error(`[ota] ${message}`);
	process.exit(1);
}

function parseArgs(argv) {
	const options = { keyId: "primary", targets: "all", out: "ota-out" };
	const flags = {
		"--bin": "bin",
		"--version": "version",
		"--key": "key",
		"--key-id": "keyId",
		"--min-from": "minFrom",
		"--targets": "targets",
		"--out": "out",
		"--public-key": "publicKey",
	};

	for (let index = 0; index < argv.length; index++) {
		const flag = argv[index];
		if (!flag.startsWith("--")) fail(`unexpected argument: ${flag}`);
		const name = flags[flag];
		if (!name) fail(`unknown option: ${flag}`);
		const value = argv[index + 1];
		if (value === undefined || value.startsWith("--")) fail(`missing value for ${flag}`);
		options[name] = value;
		index++;
	}

	for (const required of ["bin", "version", "key"]) {
		if (!options[required]) fail(`--${required} is required (see the header of this script)`);
	}
	if (!SEMVER.test(options.version)) fail(`--version must be X.Y.Z, got "${options.version}"`);
	if (options.minFrom && !SEMVER.test(options.minFrom)) {
		fail(`--min-from must be X.Y.Z, got "${options.minFrom}"`);
	}
	if (options.minFrom && semverOrder(options.minFrom, options.version) > 0) {
		fail(`--min-from ${options.minFrom} is newer than --version ${options.version}`);
	}
	if (!KEY_IDS.has(options.keyId))
		fail(`--key-id must be primary or spare, got "${options.keyId}"`);

	let targets = "*";
	if (options.targets !== "all") {
		targets = options.targets
			.split(",")
			.map((mac) => mac.trim().toUpperCase())
			.filter(Boolean);
		if (targets.length === 0) fail("--targets must be `all` or a comma-separated MAC list");
		for (const mac of targets) {
			if (!MAC.test(mac)) fail(`--targets contains an invalid MAC: "${mac}"`);
		}
	}

	return { ...options, targets };
}

function readPem(path, label) {
	if (!existsSync(path)) fail(`${label} not found: ${path}`);
	const pem = readFileSync(path, "utf8");
	if (!pem.includes("-----BEGIN")) fail(`${label} is not a PEM file: ${path}`);
	return pem;
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	const { targets } = options;

	if (!existsSync(options.bin)) fail(`firmware binary not found: ${options.bin}`);
	const image = readFileSync(options.bin);
	if (image.length === 0) fail("the firmware binary is empty");
	if (image.length > MAX_IMAGE_BYTES) {
		fail(`image is ${image.length} bytes; the OTA slot fits ${MAX_IMAGE_BYTES}`);
	}

	const size = image.length;
	const sha256 = createHash("sha256").update(image).digest("hex");

	// Key order is deliberate and stable: it is the exact signed string the
	// firmware hashes, and `JSON.stringify` here is the only serializer.
	const manifestObject = {
		board: BOARD,
		key_id: options.keyId,
		...(options.minFrom ? { min_from_version: options.minFrom } : {}),
		sha256,
		size,
		version: options.version,
	};
	const manifest = JSON.stringify(manifestObject);

	const privatePem = readPem(options.key, "private key");
	const publicKeyPath =
		options.publicKey ??
		join(repoRoot, "firmware", "keys", `pakaonai-ota-${options.keyId}-public.pem`);
	const publicPem = readPem(publicKeyPath, "public key");

	let privateKey;
	let publicKey;
	try {
		privateKey = createPrivateKey(privatePem);
		publicKey = createPublicKey(publicPem);
	} catch {
		// Never echo key material or parser detail: the path is enough to fix.
		fail(`could not load the key pair (${options.key} / ${publicKeyPath})`);
	}

	const signature = sign("sha256", Buffer.from(manifest, "utf8"), {
		key: privateKey,
		dsaEncoding: "der",
	});

	// Verify before writing: a private key that does not match the committed
	// public PEM would produce a release every field unit refuses.
	const valid = verify("sha256", Buffer.from(manifest, "utf8"), publicKey, signature);
	if (!valid) {
		fail(
			`the signature does not verify against ${publicKeyPath}; the private key does not match this key_id`,
		);
	}

	const channel = {
		version: options.version,
		storage_path: `releases/${options.version}/firmware.bin`,
		size,
		sha256,
		manifest,
		signature: signature.toString("base64"),
		key_id: options.keyId,
		targets,
	};

	const outPath = join(options.out, "channels", "stable.json");
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, `${JSON.stringify(channel, null, 2)}\n`, "utf8");

	console.log(`[ota] signed ${options.version} with key "${options.keyId}"`);
	console.log(`[ota] image ${size} bytes, sha256 ${sha256}`);
	console.log(`[ota] targets: ${targets === "*" ? "all units" : `${targets.length} MAC(s)`}`);
	console.log(`[ota] wrote ${outPath}`);
	console.log("");
	console.log('Upload these two objects to the PRIVATE Supabase Storage bucket "firmware":');
	console.log(`  1. ${options.bin} -> ${channel.storage_path}`);
	console.log(`  2. ${outPath} -> channels/stable.json`);
	console.log("Devices pick the release up on their next check (30 min by default).");
}

main();
