import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	OTA_CONTRACT,
	assertChannelEnvelope,
	responseByteLength,
	verifyChannelSignature,
} from "./contract.mjs";

/**
 * Builds the exact release fixture the OTA check consumes:
 *
 *   releases/<version>/firmware.bin  +  channels/stable.json
 *
 * The channel is produced by the committed release signer
 * (`scripts/ota/sign-release.mjs`), not by a second serializer, so the harness
 * proves the real signing path. The private key is either the operator's
 * offline key (`BENCH_OTA_PRIVATE_KEY`) or a throwaway P-256 key generated in
 * a temp directory. No key material is ever printed, stored in the repository
 * or committed as a fixture.
 */

function writeKeyPair(workDir, name) {
	const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
	const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
	const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
	const privatePath = join(workDir, `${name}-private.pem`);
	const publicPath = join(workDir, `${name}-public.pem`);
	writeFileSync(privatePath, privatePem, { encoding: "utf8", mode: 0o600 });
	writeFileSync(publicPath, publicPem, { encoding: "utf8", mode: 0o644 });
	return { privatePath, publicPath, publicPem };
}

function runSigner({ repoRoot, args, redact }) {
	const script = join(repoRoot, "scripts", "ota", "sign-release.mjs");
	if (!existsSync(script)) throw new Error(`release signer not found: ${script}`);

	const result = spawnSync(process.execPath, [script, ...args], {
		cwd: repoRoot,
		encoding: "utf8",
		env: { ...process.env, NODE_OPTIONS: "" },
	});

	const stdout = redact(result.stdout ?? "");
	const stderr = redact(result.stderr ?? "");
	if (result.status !== 0) {
		throw new Error(
			`sign-release.mjs exited ${result.status}: ${(stderr || stdout).trim().slice(0, 1200)}`,
		);
	}
	// The signer prints key paths and hashes, never key material. Keep the
	// useful last line for the evidence column.
	return { stdout, lastLine: stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "" };
}

export function createOtaFixture({
	repoRoot,
	version,
	minFrom,
	variant = "gpio5",
	keyId = "primary",
	privateKeyPath = null,
	redact = String,
	keep = false,
}) {
	if (!Object.hasOwn(OTA_CONTRACT.variantRelayGpio, variant)) {
		throw new Error(`unknown hardware variant: ${variant}`);
	}

	const workDir = mkdtempSync(join(tmpdir(), "optifeed-bench-"));
	const outDir = join(workDir, "out");
	mkdirSync(outDir, { recursive: true });

	const image = randomBytes(64 * 1024);
	const binPath = join(workDir, "firmware.bin");
	writeFileSync(binPath, image);

	let signing = null;
	if (privateKeyPath) {
		// Real offline key: the public PEM that must match it is committed.
		const publicPath = join(repoRoot, "firmware", "keys", `pakaonai-ota-${keyId}-public.pem`);
		if (!existsSync(publicPath))
			throw new Error(`committed public key not found for key_id ${keyId}`);
		signing = {
			privatePath: privateKeyPath,
			publicPath,
			publicPem: readFileSync(publicPath, "utf8"),
			mode: `offline ${keyId}`,
		};
	} else {
		const generated = writeKeyPair(workDir, "bench-ephemeral");
		signing = { ...generated, mode: "ephemeral test key" };
	}

	const args = [
		"--bin",
		binPath,
		"--variant",
		variant,
		"--version",
		version,
		"--key",
		signing.privatePath,
		"--key-id",
		keyId,
		"--targets",
		"all",
		"--out",
		outDir,
		"--public-key",
		signing.publicPath,
	];
	if (minFrom) args.push("--min-from", minFrom);

	const signer = runSigner({ repoRoot, args, redact });
	const channelPath = join(outDir, "channels", "stable.json");
	if (!existsSync(channelPath))
		throw new Error("sign-release.mjs did not write channels/stable.json");
	const channel = JSON.parse(readFileSync(channelPath, "utf8"));

	const problems = assertChannelEnvelope(channel, variant);
	if (problems.length > 0) throw new Error(`signed channel is invalid: ${problems.join("; ")}`);

	const signatureValid = verifyChannelSignature(channel, signing.publicPem);
	if (!signatureValid) {
		throw new Error("the signed manifest does not verify against the matching public key");
	}
	if (
		createHash("sha256").update(image).digest("hex").toLowerCase() !== channel.sha256.toLowerCase()
	) {
		// Unreachable, kept explicit: the signer and this harness must agree on
		// the bytes before anything is uploaded.
		throw new Error("image hash disagrees with the signed channel");
	}

	return {
		workDir,
		outDir,
		binPath,
		image,
		channelPath,
		channel,
		signing,
		signerEvidence: signer.lastLine,
		version,
		minFrom,
		variant,
		keyId,
		channelBytes: readFileSync(channelPath),
		cleanup() {
			if (!keep) rmSync(workDir, { recursive: true, force: true });
		},
	};
}

/**
 * Re-serialize a channel with one field of the signed manifest changed. The
 * signature is now stale by construction, but the server-side `parseChannel`
 * rejects it earlier because the envelope and manifest disagree. The firmware
 * would reject it later at `verifyManifestSignature`/`checkForUpdate`; the
 * harness names both owners in its assertions.
 */
export function tamperChannelManifest(channel, mutate) {
	const manifest = JSON.parse(channel.manifest);
	mutate(manifest);
	return { ...channel, manifest: JSON.stringify(manifest) };
}

/** A structurally valid base64 signature that is not the real one. */
export function tamperChannelSignature(channel) {
	return { ...channel, signature: randomBytes(72).toString("base64") };
}

export function estimateResponseBytes(channel) {
	const placeholderUrl =
		`https://bench.local/storage/v1/object/sign/${OTA_CONTRACT.bucket}/${channel.storage_path}` +
		`?token=${"a".repeat(260)}`;
	return responseByteLength({
		update: true,
		version: channel.version,
		url: placeholderUrl,
		size: channel.size,
		sha256: channel.sha256,
		manifest: channel.manifest,
		signature: channel.signature,
		key_id: channel.key_id,
		variant: JSON.parse(channel.manifest).variant,
		relay_gpio: JSON.parse(channel.manifest).relay_gpio,
	});
}
