#!/usr/bin/env node
/**
 * Publish a signed firmware release to Storage, with verification and rollback.
 *
 * The signer (`sign-release.mjs`) produces `channels/stable.json`; this script
 * is the only supported way to put it in front of the fleet. It exists because
 * the previous procedure was two hand-written `curl` calls, which is exactly
 * how a channel and an image drift apart.
 *
 * What it refuses to do:
 *   - upload a channel whose `size`/`sha256` disagree with the local binary;
 *   - upload a signature that does not verify against the committed public key;
 *   - upload a manifest whose own fields disagree with the envelope around it;
 *   - publish a version that is not newer than the live channel, unless
 *     `--allow-downgrade` is passed deliberately (a rollback);
 *   - claim success without re-downloading both objects and re-checking them.
 *
 * Usage:
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/ota/publish-release.mjs \
 *     --channel ota-out/channels/stable.json \
 *     --bin firmware/.pio/build/esp32dev-gpio5/firmware.bin \
 *     --bucket firmware
 *
 *   ... --dry-run                 # verify everything, upload nothing
 *   ... --allow-downgrade         # publish an older version (rollback path)
 *   node scripts/ota/publish-release.mjs --rollback 1.9.0 --bucket firmware
 *
 * Channel history is kept at `channels/history/<version>.json` on every
 * publish, so a rollback repoints `stable.json` at a release that was already
 * signed and verified, without re-signing anything.
 *
 * Exit codes: 0 published (or dry run verified), 1 refused or failed, 2 usage.
 * Failures set `process.exitCode` rather than calling `process.exit()`; exiting
 * while the HTTP pool still has sockets trips a libuv assertion on Windows and
 * reports the wrong status to a caller.
 */

import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SEMVER = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:[-+][0-9A-Za-z.-]+)?$/;
const SHA256 = /^[0-9a-f]{64}$/;

export class PublishError extends Error {
	constructor(message, code = 1) {
		super(message);
		this.code = code;
	}
}

export function parseSemver(text) {
	const match = SEMVER.exec(String(text ?? "").trim());
	return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** >0 when a is newer than b, 0 equal, <0 older, null unparsable. */
export function compareVersions(a, b) {
	const left = parseSemver(a);
	const right = parseSemver(b);
	if (!left || !right) return null;
	for (let index = 0; index < 3; index += 1) {
		if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
	}
	return 0;
}

/**
 * Every check that can be made without touching the network. Returns a list of
 * problems; empty means the envelope is internally consistent.
 */
export function validateChannel(channel, binary) {
	const problems = [];
	if (!channel || typeof channel !== "object") return ["channel is not an object"];

	const version = parseSemver(channel.version);
	if (!version) problems.push(`version is not X.Y.Z: ${String(channel.version)}`);
	if (typeof channel.storage_path !== "string" || !channel.storage_path.startsWith("releases/")) {
		problems.push("storage_path must start with releases/");
	}
	if (!Number.isInteger(channel.size) || channel.size <= 0) problems.push("size must be a positive integer");
	if (typeof channel.sha256 !== "string" || !SHA256.test(channel.sha256)) {
		problems.push("sha256 must be 64 lowercase hex characters");
	}
	if (channel.key_id !== "primary" && channel.key_id !== "spare") problems.push("key_id must be primary or spare");
	if (!Array.isArray(channel.targets) && channel.targets !== "*") problems.push("targets must be * or an array of MACs");

	if (binary) {
		const actualSha = createHash("sha256").update(binary).digest("hex");
		if (channel.size !== binary.length) problems.push(`size ${channel.size} does not match binary ${binary.length}`);
		if (channel.sha256 !== actualSha) problems.push(`sha256 ${channel.sha256} does not match binary ${actualSha}`);
	}

	let manifest = null;
	try {
		manifest = JSON.parse(channel.manifest);
	} catch {
		problems.push("manifest is not valid JSON");
	}
	if (manifest) {
		if (manifest.version !== channel.version) problems.push("manifest.version disagrees with the envelope");
		if (manifest.size !== channel.size) problems.push("manifest.size disagrees with the envelope");
		if (manifest.sha256 !== channel.sha256) problems.push("manifest.sha256 disagrees with the envelope");
		if (manifest.key_id !== channel.key_id) problems.push("manifest.key_id disagrees with the envelope");
		if (channel.variant !== undefined && manifest.variant !== channel.variant) {
			problems.push("manifest.variant disagrees with the envelope");
		}
		if (manifest.relay_gpio !== 5 && manifest.relay_gpio !== 25) {
			problems.push("manifest.relay_gpio must be 5 or 25");
		}
		if (manifest.variant === "gpio5" && manifest.relay_gpio !== 5) {
			problems.push("variant gpio5 must declare relay_gpio 5");
		}
		if (manifest.variant === "gpio25" && manifest.relay_gpio !== 25) {
			problems.push("variant gpio25 must declare relay_gpio 25");
		}
	}
	return problems;
}

/** True when the signature verifies over the exact manifest bytes. */
export function verifyChannelSignature(channel, publicKeyPem) {
	const key = createPublicKey(publicKeyPem);
	return verifySignature(
		"sha256",
		Buffer.from(channel.manifest, "utf8"),
		{ key, dsaEncoding: "der" },
		Buffer.from(channel.signature, "base64"),
	);
}

const arg = (argv, name, fallback = undefined) => {
	const index = argv.indexOf(`--${name}`);
	if (index === -1) return fallback;
	const value = argv[index + 1];
	return value && !value.startsWith("--") ? value : true;
};

const required = (argv, name) => {
	const value = arg(argv, name);
	if (!value || value === true) throw new PublishError(`--${name} is required`, 2);
	return value;
};

const storageUrl = (base, bucket, path) =>
	`${base.replace(/\/+$/, "")}/storage/v1/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;

async function getObject(base, key, bucket, path) {
	const response = await fetch(storageUrl(base, bucket, path), {
		headers: { Authorization: `Bearer ${key}`, apikey: key },
	});
	if (response.status === 404) return null;
	if (!response.ok) throw new PublishError(`download ${path}: HTTP ${response.status}`);
	return Buffer.from(await response.arrayBuffer());
}

async function putObject(base, key, bucket, path, body, contentType) {
	const response = await fetch(storageUrl(base, bucket, path), {
		method: "POST",
		headers: {
			Authorization: `Bearer ${key}`,
			apikey: key,
			"Content-Type": contentType,
			"x-upsert": "true",
		},
		body,
	});
	if (!response.ok) throw new PublishError(`upload ${path}: HTTP ${response.status} ${await response.text()}`);
}

function loadPublicKey(keyId) {
	const path = join(REPO_ROOT, "firmware", "keys", `pakaonai-ota-${keyId}-public.pem`);
	if (!existsSync(path)) throw new PublishError(`public key for "${keyId}" not found at ${path}`);
	return readFileSync(path, "utf8");
}

async function publishChannel(base, key, bucket, channelBuffer, label) {
	await putObject(base, key, bucket, "channels/stable.json", channelBuffer, "application/json");
	const readBack = await getObject(base, key, bucket, "channels/stable.json");
	if (!readBack || !readBack.equals(channelBuffer)) {
		throw new PublishError("channel read-back does not match what was uploaded");
	}
	console.log(`[ota:publish] channel ${label} published and re-downloaded byte-for-byte`);
}

async function main(argv) {
	const bucket = arg(argv, "bucket", "firmware");
	const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
	const dryRun = Boolean(arg(argv, "dry-run", false));
	const allowDowngrade = Boolean(arg(argv, "allow-downgrade", false));
	const rollbackTo = arg(argv, "rollback");

	if (!base) throw new PublishError("SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) is required", 2);
	if (!key) throw new PublishError("SUPABASE_SERVICE_ROLE_KEY is required", 2);

	if (rollbackTo && rollbackTo !== true) {
		const history = await getObject(base, key, bucket, `channels/history/${rollbackTo}.json`);
		if (!history) throw new PublishError(`no archived channel for ${rollbackTo}; cannot roll back to it`);
		const channel = JSON.parse(history.toString("utf8"));
		const problems = validateChannel(channel);
		if (problems.length) throw new PublishError(`archived channel is invalid: ${problems.join("; ")}`);
		if (!verifyChannelSignature(channel, loadPublicKey(channel.key_id))) {
			throw new PublishError("archived channel signature does not verify");
		}
		const image = await getObject(base, key, bucket, channel.storage_path);
		if (!image) throw new PublishError(`${channel.storage_path} is missing; cannot roll back`);
		const sha = createHash("sha256").update(image).digest("hex");
		if (sha !== channel.sha256) throw new PublishError(`stored image hash ${sha} does not match the archived channel`);
		if (dryRun) {
			console.log(`[ota:publish] dry run: would repoint stable.json at ${channel.version}`);
			return;
		}
		await publishChannel(base, key, bucket, history, `rollback to ${channel.version}`);
		return;
	}

	if (rollbackTo === true) throw new PublishError("--rollback needs a version", 2);

	const channelPath = required(argv, "channel");
	const binaryPath = required(argv, "bin");
	const binary = readFileSync(binaryPath);
	const channelBuffer = readFileSync(channelPath);
	const channel = JSON.parse(channelBuffer.toString("utf8"));

	const problems = validateChannel(channel, binary);
	if (problems.length) {
		throw new PublishError(`refusing to publish:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
	}
	if (!verifyChannelSignature(channel, loadPublicKey(channel.key_id))) {
		throw new PublishError(`signature does not verify against the committed "${channel.key_id}" public key`);
	}

	const current = await getObject(base, key, bucket, "channels/stable.json");
	if (current) {
		const live = JSON.parse(current.toString("utf8"));
		const order = compareVersions(channel.version, live.version);
		if (order === null) throw new PublishError("cannot compare versions with the live channel");
		if (order <= 0 && !allowDowngrade) {
			throw new PublishError(
				`live channel is already ${live.version}; refusing to publish ${channel.version}. Pass --allow-downgrade for a deliberate rollback.`,
			);
		}
	}

	console.log(
		`[ota:publish] verified ${channel.version} ${channel.variant ?? ""} sha256=${channel.sha256} size=${channel.size} targets=${Array.isArray(channel.targets) ? channel.targets.join(",") : "*"}`,
	);

	if (dryRun) {
		console.log("[ota:publish] dry run: verified, uploaded nothing");
		return;
	}

	await putObject(base, key, bucket, channel.storage_path, binary, "application/octet-stream");
	const readBack = await getObject(base, key, bucket, channel.storage_path);
	const readBackSha = readBack ? createHash("sha256").update(readBack).digest("hex") : null;
	if (readBackSha !== channel.sha256) {
		throw new PublishError(`uploaded image read-back hash ${readBackSha} does not match ${channel.sha256}`);
	}

	await putObject(base, key, bucket, `channels/history/${channel.version}.json`, channelBuffer, "application/json");
	await publishChannel(base, key, bucket, channelBuffer, channel.version);
	console.log(
		`[ota:publish] done: ${channel.version} is live for ${Array.isArray(channel.targets) ? "the listed units" : "all units"}`,
	);
}

if (process.argv[1] && process.argv[1].endsWith("publish-release.mjs")) {
	main(process.argv.slice(2)).catch((error) => {
		console.error(`[ota:publish] ${error.message}`);
		process.exitCode = error instanceof PublishError ? error.code : 1;
	});
}
