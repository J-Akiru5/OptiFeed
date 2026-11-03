import { withApi } from "@/lib/api/instrumentation";
import { isDeviceApproved, verifyDeviceToken } from "@/lib/device-auth";
import {
	createReleaseDownloadUrl,
	isOtaHwVariant,
	noUpdateResponse,
	otaResponse,
	readStableChannel,
	relayGpioForVariant,
	shouldOfferUpdate,
} from "@/lib/firmware/ota";
import { checkDeviceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Signed remote-firmware check for ESP32 feeders (T-12b).
 *
 * The device sends `?device_id=<MAC>&version=<FW_VERSION>&variant=<gpio5|gpio25>
 * &relay_gpio=<n>` with its provisioned `X-Device-Token`. This route answers
 * `{update:false}` or the signed release envelope described in
 * `firmware/README.md` and `lib/firmware/ota.ts`.
 *
 * `/api/v1/firmware/check` resolves to this same handler through the
 * `beforeFiles` rewrite in `next.config.ts`; there is no duplicate route file.
 *
 * Delivery only — the device verifies the ECDSA signature, board, variant,
 * relay GPIO, version, size and SHA-256 itself. A missing/untargeted/older
 * release, a missing or mismatched hardware variant, a malformed channel or an
 * unavailable Storage signed URL all answer `{update:false}` so the unit
 * retries on its normal 30-minute cadence instead of backing off.
 */
export const GET = withApi(
	async (request: Request) => {
		const token = request.headers.get("x-device-token");
		if (!token) {
			return new Response("Unauthorized", { status: 401 });
		}

		const { searchParams } = new URL(request.url);
		const deviceId = searchParams.get("device_id");
		const version = searchParams.get("version");
		if (!deviceId || !version) {
			return new Response("Unprocessable Entity", { status: 422 });
		}

		// Fail-open bucket, but only for a verified device: a check every 30
		// minutes is far below the ceiling, and a limiter blip must never stop
		// an update check. Limiting before verification would let anyone who
		// knows a MAC hold that unit out of the OTA channel (#364).
		const device = await verifyDeviceToken(token);
		if (!device || device.mac !== deviceId) {
			return new Response("Unauthorized", { status: 401 });
		}

		if (!isDeviceApproved(device)) {
			return new Response("Forbidden", { status: 403 });
		}

		const { success } = await checkDeviceRateLimit(device.mac, "firmware");
		if (!success) {
			return new Response("Too Many Requests", { status: 429 });
		}

		// #582: an image is only installable on the exact relay wiring it was
		// built for. The device declares its variant and pin; without a valid,
		// self-consistent declaration the server offers nothing rather than
		// risk a wrong-pin image. Old firmware (no query fields) therefore
		// receives {update:false} until it is bootstrapped over USB. Kept after
		// auth so an unauthenticated request still gets 401, not a 200 hint.
		const variantParam = searchParams.get("variant");
		const relayGpioParam = searchParams.get("relay_gpio");
		if (!isOtaHwVariant(variantParam) || relayGpioParam === null) {
			return noUpdateResponse();
		}
		const relayGpio = Number(relayGpioParam);
		if (!Number.isInteger(relayGpio) || relayGpio !== relayGpioForVariant(variantParam)) {
			return noUpdateResponse();
		}

		const channel = await readStableChannel();
		if (!channel || !shouldOfferUpdate(channel, version, device.mac, variantParam)) {
			return noUpdateResponse();
		}

		const url = await createReleaseDownloadUrl(channel.storage_path);
		if (!url) {
			return noUpdateResponse();
		}

		return otaResponse({
			update: true,
			version: channel.version,
			url,
			size: channel.size,
			sha256: channel.sha256,
			// The exact signed string: the device verifies these bytes, not a
			// re-serialized copy.
			manifest: channel.manifest,
			signature: channel.signature,
			key_id: channel.key_id,
			// #582: repeat the signed hardware target at the envelope level so
			// operators and the app can report it without parsing the manifest.
			variant: channel.manifestValues.variant,
			relay_gpio: channel.manifestValues.relay_gpio,
		});
	},
	// Device (ESP32) contract: this flat JSON body is external and exempt from
	// the §4 envelope. Instrumentation headers still apply.
	{
		route: "GET /api/firmware/check",
		shape: "passthrough",
		cacheControl: "no-store",
		timeoutMs: 5_000,
	},
);
