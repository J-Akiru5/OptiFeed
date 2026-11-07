import { createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Contract constants and source-drift checks for the bench harness.
 *
 * Nothing here decides product behaviour: the route and the firmware remain
 * the authority. The values below are the transport facts the harness has to
 * know to build a fixture (bucket name, TTL, 8 KB cap, variant -> GPIO) and
 * `checkSourceContract()` fails the run if the source of truth has moved, so a
 * silently re-derived copy cannot drift for long.
 */

export const OTA_CONTRACT = {
	bucket: "firmware",
	channelPath: "channels/stable.json",
	checkPath: "/api/firmware/check",
	/** apps/web/lib/firmware/ota.ts -> OTA_SIGNED_URL_TTL_SECONDS */
	signedUrlTtlSeconds: 10 * 60,
	/** apps/web/lib/firmware/ota.ts -> OTA_MAX_CHECK_RESPONSE_BYTES */
	maxCheckResponseBytes: 8 * 1024,
	/** apps/web/lib/firmware/ota.ts -> OTA_MAX_IMAGE_BYTES (min_spiffs.csv slot) */
	maxImageBytes: 1_966_080,
	board: "wroom32u",
	/** apps/web/lib/firmware/ota.ts -> OTA_VARIANT_RELAY_GPIO */
	variantRelayGpio: { gpio5: 5, gpio25: 25 },
	heartbeatIntervalMs: 30 * 60 * 1000,
};

const SHA256_PATTERN = /^[0-9a-fA-F]{64}$/;
const SEMVER_PATTERN = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:[-+][0-9A-Za-z.-]+)?$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const MAC_PATTERN = /^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/i;

export function isOtaVariant(value) {
	return Object.hasOwn(OTA_CONTRACT.variantRelayGpio, value);
}

export function relayGpioForVariant(variant) {
	return OTA_CONTRACT.variantRelayGpio[variant];
}

function parseSemver(text) {
	const match = SEMVER_PATTERN.exec(String(text).trim());
	if (!match) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Mirrors `compareSemver` in ota.ts and firmware-main.ino. */
export function compareSemver(left, right) {
	const a = parseSemver(left);
	const b = parseSemver(right);
	if (!a || !b) return null;
	for (let index = 0; index < 3; index++) {
		if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
	}
	return 0;
}

/** A version strictly above `current`, used so the channel always looks newer. */
export function nextMajorVersion(current) {
	const parsed = parseSemver(current);
	if (!parsed) throw new Error(`cannot parse firmware version "${current}"`);
	return `${parsed[0] + 1}.0.0`;
}

export function isLoopbackHost(hostname) {
	const value = hostname.toLowerCase();
	return (
		value === "localhost" ||
		value === "127.0.0.1" ||
		value === "::1" ||
		value === "[::1]" ||
		value.endsWith(".localhost")
	);
}

/**
 * Read the actual source files and assert the transport facts the harness
 * depends on. A failure means the harness must be updated with the contract,
 * not that the product is wrong.
 */
export function checkSourceContract(repoRoot) {
	const read = (relative) => readFileSync(join(repoRoot, relative), "utf8");
	const ota = read("apps/web/lib/firmware/ota.ts");
	const checkRoute = read("apps/web/app/api/firmware/check/route.ts");
	const commands = read("apps/web/lib/feed/commands.ts");
	const feedRoute = read("apps/web/app/api/feed-command/route.ts");
	const ingest = read("apps/web/app/api/ingest/route.ts");
	const firmware = read("firmware/firmware-main/firmware-main.ino");
	const firmwareConfig = read("firmware/firmware-main/config.h");

	const checks = [
		{
			name: "bucket name is firmware",
			ok: /OTA_CHECK_BUCKET\s*=\s*"firmware"/.test(ota),
		},
		{
			name: "channel path is channels/stable.json",
			ok: /OTA_CHANNEL_PATH\s*=\s*"channels\/stable\.json"/.test(ota),
		},
		{
			name: "signed URL TTL is 10 minutes",
			ok: /OTA_SIGNED_URL_TTL_SECONDS\s*=\s*10\s*\*\s*60/.test(ota),
		},
		{
			name: "check response cap is 8 KB",
			ok: /OTA_MAX_CHECK_RESPONSE_BYTES\s*=\s*8\s*\*\s*1024/.test(ota),
		},
		{
			name: "OTA image cap is the min_spiffs slot",
			ok: /OTA_MAX_IMAGE_BYTES\s*=\s*1_966_080/.test(ota),
		},
		{
			name: "board is wroom32u",
			ok: /OTA_BOARD\s*=\s*"wroom32u"/.test(ota),
		},
		{
			name: "variants are gpio5 and gpio25",
			ok: /OTA_HW_VARIANTS\s*=\s*\[\s*"gpio5"\s*,\s*"gpio25"\s*\]/.test(ota),
		},
		{
			name: "relay GPIO map is 5 / 25",
			ok: /gpio5:\s*5[\s\S]{0,80}gpio25:\s*25/.test(ota),
		},
		{
			name: "check route gates on variant and relay_gpio",
			ok:
				/isOtaHwVariant\(variantParam\)/.test(checkRoute) &&
				/relayGpio\s*!==\s*relayGpioForVariant\(variantParam\)/.test(checkRoute),
		},
		{
			name: "check route offers only through shouldOfferUpdate",
			ok: /shouldOfferUpdate\(channel,\s*version,\s*device\.mac,\s*variantParam\)/.test(checkRoute),
		},
		{
			name: "check route requires an HTTPS signed URL",
			ok: /startsWith\("https:\/\/"\)/.test(ota) && /createReleaseDownloadUrl/.test(checkRoute),
		},
		{
			name: "feed claim is a compare-and-set",
			ok:
				/updateMany\(\{[\s\S]{0,200}status:\s*"pending"[\s\S]{0,200}status:\s*"dispatched"/.test(
					commands,
				) && /claimPendingFeedRequest/.test(feedRoute),
		},
		{
			name: "ingest completes only dispatched requests",
			ok:
				/status:\s*"completed"/.test(ingest) &&
				/status:\s*"dispatched"/.test(ingest) &&
				/isUniqueConstraintError/.test(ingest),
		},
		{
			name: "firmware check cap matches 8 KB",
			ok: /#define OTA_MAX_CHECK_RESPONSE_BYTES 8192/.test(firmware),
		},
		{
			name: "firmware board matches wroom32u",
			ok: /#define FW_BOARD "wroom32u"/.test(firmware),
		},
		{
			name: "firmware verifies the signed manifest",
			ok: /bool verifyManifestSignature\(/.test(firmware),
		},
		{
			name: "firmware defers the pending-verify decision",
			ok:
				/verifyRollbackLater\(\)\s*\{/.test(firmware) &&
				/ESP_OTA_IMG_PENDING_VERIFY/.test(firmware) &&
				/esp_ota_mark_app_valid_cancel_rollback/.test(firmware) &&
				/esp_ota_mark_app_invalid_rollback_and_reboot/.test(firmware),
		},
		{
			name: "firmware health-check timeout is dashboard config",
			ok: /otaHealthCheckTimeoutMs/.test(firmwareConfig),
		},
		{
			name: "firmware heartbeat reports ota_state",
			ok: /doc\["ota_state"\]\s*=\s*otaState/.test(firmware),
		},
		...["primary", "spare"].map((keyId) => {
			const constant = keyId === "primary" ? "OTA_KEY_PRIMARY_PEM" : "OTA_KEY_SPARE_PEM";
			const pem = readFileSync(
				join(repoRoot, "firmware", "keys", `pakaonai-ota-${keyId}-public.pem`),
				"utf8",
			)
				.replace(/\r\n/g, "\n")
				.trim();
			const embedded = new RegExp(`${constant}\\s*=\\s*R"KEY\\(([\\s\\S]*?)\\)KEY";`)
				.exec(firmware)?.[1]
				?.replace(/\r\n/g, "\n")
				.trim();
			let parsed = null;
			try {
				const key = createPublicKey(pem);
				parsed =
					key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1";
			} catch {
				parsed = null;
			}
			return {
				name: `firmware embeds the committed ${keyId} P-256 public key`,
				ok: parsed === true && embedded === pem,
			};
		}),
	];

	return checks;
}

/**
 * Independent verification of the fixture the signer produced. The route's
 * `parseChannel` is still the authority for what it will offer; this catches a
 * broken fixture before the network round-trip and mirrors the envelope checks
 * the firmware performs in `checkForUpdate`.
 */
export function assertChannelEnvelope(channel, variant) {
	const problems = [];
	const require = (condition, message) => {
		if (!condition) problems.push(message);
	};

	require(channel && typeof channel === "object", "channel is not an object");
	if (!channel || typeof channel !== "object") return problems;

	require(SEMVER_PATTERN.test(channel.version), "version is not X.Y.Z");
	require(typeof channel.storage_path === "string" &&
		!channel.storage_path.startsWith("/") &&
		!channel.storage_path.includes("..") &&
		!channel.storage_path.includes("\\") &&
		/^releases\/[A-Za-z0-9][A-Za-z0-9._/-]*\.bin$/.test(
			channel.storage_path,
		), "storage_path is not a relative releases/*.bin path");
	require(Number.isInteger(channel.size) && channel.size > 0, "size is not a positive integer");
	require(channel.size <= OTA_CONTRACT.maxImageBytes, "image exceeds the min_spiffs slot");
	require(SHA256_PATTERN.test(channel.sha256), "sha256 is not 64 hex characters");
	require(typeof channel.manifest === "string" && channel.manifest.length > 0, "manifest is empty");
	require(channel.manifest.length <= 4096, "manifest exceeds the channel schema cap");
	require(typeof channel.signature === "string" &&
		BASE64_PATTERN.test(channel.signature), "signature is not base64");
	require(channel.key_id === "primary" ||
		channel.key_id === "spare", "key_id is not primary/spare");
	require(variant === undefined ||
		channel.variant === variant, "channel variant does not match the request");
	require(channel.targets === "*" ||
		(Array.isArray(channel.targets) &&
			channel.targets.every((mac) =>
				MAC_PATTERN.test(mac),
			)), "targets is neither * nor a MAC list");

	let manifest = null;
	try {
		manifest = JSON.parse(channel.manifest);
	} catch {
		problems.push("manifest is not JSON");
	}
	if (manifest) {
		require(manifest.board === OTA_CONTRACT.board, "manifest board is not wroom32u");
		require(isOtaVariant(manifest.variant), "manifest variant is not gpio5/gpio25");
		require(manifest.relay_gpio ===
			relayGpioForVariant(manifest.variant), "manifest variant and relay_gpio disagree");
		require(manifest.version === channel.version, "manifest version disagrees with the envelope");
		require(manifest.size === channel.size, "manifest size disagrees with the envelope");
		require(String(manifest.sha256).toLowerCase() ===
			channel.sha256.toLowerCase(), "manifest sha256 disagrees with the envelope");
		require(manifest.key_id === channel.key_id, "manifest key_id disagrees with the envelope");
		if (manifest.min_from_version) {
			require(compareSemver(manifest.min_from_version, channel.version) <=
				0, "manifest min_from_version is newer than the release");
		}
	}

	return problems;
}

/** Exactly the firmware's `verifyManifestSignature` check, in Node. */
export function verifyChannelSignature(channel, publicKeyPem) {
	try {
		return verify(
			"sha256",
			Buffer.from(channel.manifest, "utf8"),
			createPublicKey(publicKeyPem),
			Buffer.from(channel.signature, "base64"),
		);
	} catch {
		return false;
	}
}

/** The exact response envelope the route builds (`otaResponse`). */
export function buildExpectedCheckResponse(channel, signedUrl) {
	const manifest = JSON.parse(channel.manifest);
	return {
		update: true,
		version: channel.version,
		url: signedUrl,
		size: channel.size,
		sha256: channel.sha256,
		manifest: channel.manifest,
		signature: channel.signature,
		key_id: channel.key_id,
		variant: manifest.variant,
		relay_gpio: manifest.relay_gpio,
	};
}

export function responseByteLength(payload) {
	return Buffer.byteLength(JSON.stringify(payload), "utf8");
}

/**
 * Decode the Supabase signed-URL token without logging it. The storage JWT
 * carries `iat`/`exp`; `ttl` is what the firmware's 10-minute window relies on.
 */
export function signedUrlTtl(signedUrl) {
	try {
		const token = new URL(signedUrl).searchParams.get("token");
		if (!token) return null;
		const payload = token.split(".")[1];
		if (!payload) return null;
		const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
		if (typeof decoded.exp !== "number") return null;
		const now = Math.floor(Date.now() / 1000);
		return {
			exp: decoded.exp,
			iat: typeof decoded.iat === "number" ? decoded.iat : null,
			ttl: typeof decoded.iat === "number" ? decoded.exp - decoded.iat : null,
			remaining: decoded.exp - now,
		};
	} catch {
		return null;
	}
}

/** Strip the query (the capability) before anything is printed. */
export function redactUrl(value) {
	try {
		const url = new URL(value);
		return `${url.protocol}//${url.host}${url.pathname}`;
	} catch {
		return "<unparseable-url>";
	}
}
