import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

/**
 * Server half of the signed remote-update contract (T-12b).
 *
 * The firmware side of this contract lives in
 * `firmware/firmware-main/firmware-main.ino` (`checkForUpdate`,
 * `verifyManifestSignature`) and is described in `firmware/README.md` and
 * `docs/firmware-ota-plan.md` §4-§5. Nothing here may drift from it:
 *
 *  - `GET /api/firmware/check?device_id=…&version=…` with `X-Device-Token`.
 *  - `{update:false}` or `{update:true, version, url, size, sha256, manifest,
 *    signature, key_id}` where `manifest` is the exact signed JSON *string*.
 *  - The response declares `Content-Length` and stays under 8 KB.
 *
 * No Prisma schema change is involved: releases are described by one JSON
 * channel file in the private Supabase Storage bucket `firmware`.
 */

export const OTA_CHECK_BUCKET = "firmware";
export const OTA_CHANNEL_PATH = "channels/stable.json";
/** The firmware treats a signed Storage URL as single-use for the download. */
export const OTA_SIGNED_URL_TTL_SECONDS = 10 * 60;
/** `OTA_MAX_CHECK_RESPONSE_BYTES` in firmware-main.ino. */
export const OTA_MAX_CHECK_RESPONSE_BYTES = 8 * 1024;
/** `min_spiffs.csv` app slot size — an image larger than this cannot install. */
export const OTA_MAX_IMAGE_BYTES = 1_966_080;
/** `FW_BOARD` in firmware-main.ino. */
export const OTA_BOARD = "wroom32u";

/**
 * Hardware variants a signed image may target (issue #582). The relay GPIO is
 * part of the physical unit, so an image built for the other pin boots and
 * heartbeats normally while never closing the relay. `firmware/platformio.ini`
 * defines one environment per variant and the sketch static_asserts that the
 * variant name and relay pin agree.
 */
export const OTA_HW_VARIANTS = ["gpio5", "gpio25"] as const;
export type OtaHwVariant = (typeof OTA_HW_VARIANTS)[number];
export const OTA_VARIANT_RELAY_GPIO: Readonly<Record<OtaHwVariant, number>> = {
	gpio5: 5,
	gpio25: 25,
};

/** Type guard for a `?variant=` query value. */
export function isOtaHwVariant(value: string | null | undefined): value is OtaHwVariant {
	return typeof value === "string" && (OTA_HW_VARIANTS as readonly string[]).includes(value);
}

/** Relay GPIO that must accompany a variant in the signed manifest. */
export function relayGpioForVariant(variant: OtaHwVariant): number {
	return OTA_VARIANT_RELAY_GPIO[variant];
}

const SEMVER_PATTERN = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:[-+][0-9A-Za-z.-]+)?$/;
const MAC_PATTERN = /^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/i;
const SHA256_PATTERN = /^[0-9a-fA-F]{64}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export type Semver = [number, number, number];

/**
 * Numeric X.Y.Z parse matching the firmware's `parseSemver`: at most six
 * digits per part, an optional `-pre`/`+build` suffix that is ignored for
 * ordering. `null` means "cannot compare", which the route treats as "no
 * update" rather than guessing.
 */
export function parseSemver(text: string): Semver | null {
	const match = SEMVER_PATTERN.exec(text.trim());
	if (!match) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** >0 when `a` is newer, 0 when equal, <0 when older. `null` if unparsable. */
export function compareSemver(a: string, b: string): number | null {
	const left = parseSemver(a);
	const right = parseSemver(b);
	if (!left || !right) return null;
	for (let index = 0; index < 3; index++) {
		if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
	}
	return 0;
}

/**
 * A release targets either every unit (`"*"`) or an explicit MAC allowlist
 * (canary/staged rollout). Comparison is case-insensitive because the firmware
 * reports the eFuse MAC in upper case while operators often type lower case.
 */
export function isReleaseTargeted(targets: "*" | string[], mac: string): boolean {
	if (targets === "*") return true;
	const normalized = mac.trim().toUpperCase();
	return targets.some((target) => target.trim().toUpperCase() === normalized);
}

const channelSchema = z.object({
	version: z.string().regex(SEMVER_PATTERN),
	storage_path: z
		.string()
		.min(1)
		.max(256)
		.refine(
			(path) =>
				!path.startsWith("/") &&
				!path.includes("..") &&
				!path.includes("\\") &&
				/^releases\/[A-Za-z0-9][A-Za-z0-9._/-]*\.bin$/.test(path),
			"storage_path must be a relative releases/*.bin object path",
		),
	size: z.number().int().positive().max(OTA_MAX_IMAGE_BYTES),
	sha256: z.string().regex(SHA256_PATTERN),
	manifest: z.string().min(2).max(4096),
	signature: z.string().min(1).max(1024).regex(BASE64_PATTERN),
	key_id: z.enum(["primary", "spare"]),
	// Optional unsigned copy of the signed variant, for operators listing the
	// channel. When present it must agree with the signed manifest.
	variant: z.enum(OTA_HW_VARIANTS).optional(),
	targets: z.union([z.literal("*"), z.array(z.string().regex(MAC_PATTERN)).max(10_000)]),
});

const manifestSchema = z
	.object({
		board: z.literal(OTA_BOARD),
		// #582: the signed manifest names the exact relay wiring. The device
		// refuses a release whose variant or relay GPIO does not match its own
		// provisioned variant.
		variant: z.enum(OTA_HW_VARIANTS),
		relay_gpio: z.number().int().positive(),
		version: z.string().regex(SEMVER_PATTERN),
		size: z.number().int().positive(),
		sha256: z.string().regex(SHA256_PATTERN),
		key_id: z.enum(["primary", "spare"]),
		min_from_version: z.string().regex(SEMVER_PATTERN).optional(),
	})
	.superRefine((manifest, ctx) => {
		if (OTA_VARIANT_RELAY_GPIO[manifest.variant] !== manifest.relay_gpio) {
			ctx.addIssue({
				code: "custom",
				message: "manifest variant and relay_gpio disagree",
			});
		}
	});

export type FirmwareChannel = z.infer<typeof channelSchema> & {
	manifestValues: z.infer<typeof manifestSchema>;
};

/**
 * Validate `channels/stable.json`. Returns `null` for anything the device
 * would refuse, so a corrupted or half-uploaded release is simply not offered.
 *
 * The channel envelope must agree with the signed manifest: the firmware
 * rejects the whole update when `version`, `size`, `sha256`, `key_id`,
 * `board`, `variant` or `relay_gpio` disagree, so offering a mismatched file
 * only buys a pointless download and a 24 h backoff.
 */
export function parseChannel(raw: unknown): FirmwareChannel | null {
	const parsed = channelSchema.safeParse(raw);
	if (!parsed.success) return null;

	let manifestRaw: unknown;
	try {
		manifestRaw = JSON.parse(parsed.data.manifest);
	} catch {
		return null;
	}

	const manifest = manifestSchema.safeParse(manifestRaw);
	if (!manifest.success) return null;

	if (parsed.data.variant !== undefined && parsed.data.variant !== manifest.data.variant) {
		return null;
	}

	if (
		manifest.data.version !== parsed.data.version ||
		manifest.data.size !== parsed.data.size ||
		manifest.data.sha256.toLowerCase() !== parsed.data.sha256.toLowerCase() ||
		manifest.data.key_id !== parsed.data.key_id
	) {
		return null;
	}

	return { ...parsed.data, manifestValues: manifest.data };
}

/**
 * Decide whether this device may be offered this release. Mirrors the device
 * gates the server can evaluate: targeting, a strictly newer semantic version,
 * a satisfied `min_from_version`, and the hardware variant (#582).
 *
 * The variant gate is fail-closed: a device that does not declare a variant
 * (firmware before this change) is never offered a hardware-specific image,
 * because the server cannot prove the relay pin matches. A wrong-pin image is
 * a silent physical failure, not an inconvenience.
 */
export function shouldOfferUpdate(
	channel: FirmwareChannel,
	deviceVersion: string,
	mac: string,
	deviceVariant: OtaHwVariant | null,
): boolean {
	if (!isReleaseTargeted(channel.targets, mac)) return false;
	if (deviceVariant === null) return false;
	if (channel.manifestValues.variant !== deviceVariant) return false;

	const order = compareSemver(deviceVersion, channel.version);
	if (order === null || order >= 0) return false;

	const minFrom = channel.manifestValues.min_from_version;
	if (minFrom) {
		const minOrder = compareSemver(deviceVersion, minFrom);
		if (minOrder === null || minOrder < 0) return false;
	}

	return true;
}

export type OtaCheckResponse =
	| { update: false }
	| {
			update: true;
			version: string;
			url: string;
			size: number;
			sha256: string;
			manifest: string;
			signature: string;
			key_id: string;
			/** Hardware the signed image targets (#582); also inside `manifest`. */
			variant: OtaHwVariant;
			relay_gpio: number;
	  };

function jsonWithLength(body: string): Response {
	return new Response(body, {
		status: 200,
		headers: {
			"content-type": "application/json; charset=utf-8",
			// The firmware refuses an unknown length (`https.getSize() < 0`).
			"content-length": String(Buffer.byteLength(body, "utf8")),
		},
	});
}

/** The only "nothing to do" answer; tiny and always under the 8 KB bound. */
export function noUpdateResponse(): Response {
	return jsonWithLength(JSON.stringify({ update: false } satisfies OtaCheckResponse));
}

/**
 * Serialize a check answer with an explicit Content-Length. A body over the
 * firmware's 8 KB cap is never sent — the unit would reject it, so answer
 * "no update" and retry on the next check instead of breaking the ladder.
 */
export function otaResponse(payload: OtaCheckResponse): Response {
	const body = JSON.stringify(payload);
	if (Buffer.byteLength(body, "utf8") > OTA_MAX_CHECK_RESPONSE_BYTES) {
		return noUpdateResponse();
	}
	return jsonWithLength(body);
}

/**
 * Read the release channel from the private `firmware` bucket with the
 * service-role client. Any failure (missing object, invalid JSON, invalid
 * channel) is "no update" — never a broken release offered to a feeder.
 */
export async function readStableChannel(): Promise<FirmwareChannel | null> {
	try {
		const { data, error } = await createAdminClient()
			.storage.from(OTA_CHECK_BUCKET)
			.download(OTA_CHANNEL_PATH);
		if (error || !data) {
			console.warn("[firmware-check] channel unavailable", error?.message ?? "empty response");
			return null;
		}
		const text = await data.text();
		return parseChannel(JSON.parse(text));
	} catch (error) {
		console.warn(
			"[firmware-check] channel read failed",
			error instanceof Error ? error.message : String(error),
		);
		return null;
	}
}

/**
 * Mint a short-lived signed HTTPS URL for the release image. The firmware
 * deliberately does not send its device token to the storage host, so the
 * signature is the only capability the URL carries.
 */
export async function createReleaseDownloadUrl(storagePath: string): Promise<string | null> {
	try {
		const { data, error } = await createAdminClient()
			.storage.from(OTA_CHECK_BUCKET)
			.createSignedUrl(storagePath, OTA_SIGNED_URL_TTL_SECONDS);
		if (error || !data?.signedUrl) {
			console.warn("[firmware-check] signed URL unavailable", error?.message ?? "empty response");
			return null;
		}
		if (!data.signedUrl.startsWith("https://")) {
			console.warn("[firmware-check] signed URL is not HTTPS");
			return null;
		}
		return data.signedUrl;
	} catch (error) {
		console.warn(
			"[firmware-check] signed URL failed",
			error instanceof Error ? error.message : String(error),
		);
		return null;
	}
}
