import { withApi } from "@/lib/api/instrumentation";
import { verifyDeviceToken } from "@/lib/device-auth";
import {
	createReleaseDownloadUrl,
	noUpdateResponse,
	otaResponse,
	readStableChannel,
	shouldOfferUpdate,
} from "@/lib/firmware/ota";
import { checkDeviceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Signed remote-firmware check for ESP32 feeders (T-12b).
 *
 * The device sends `?device_id=<MAC>&version=<FW_VERSION>` with its provisioned
 * `X-Device-Token`. This route answers `{update:false}` or the signed release
 * envelope described in `firmware/README.md` and `lib/firmware/ota.ts`.
 *
 * `/api/v1/firmware/check` resolves to this same handler through the
 * `beforeFiles` rewrite in `next.config.ts`; there is no duplicate route file.
 *
 * Delivery only — the device verifies the ECDSA signature, board, version,
 * size and SHA-256 itself. A missing/untargeted/older release, a malformed
 * channel or an unavailable Storage signed URL all answer `{update:false}` so
 * the unit retries on its normal 30-minute cadence instead of backing off.
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

		// Separate fail-open bucket: a check every 30 minutes is far below the
		// ceiling, and a limiter blip must never stop an update check.
		const { success } = await checkDeviceRateLimit(deviceId, "firmware");
		if (!success) {
			return new Response("Too Many Requests", { status: 429 });
		}

		const device = await verifyDeviceToken(token);
		if (!device || device.mac !== deviceId) {
			return new Response("Unauthorized", { status: 401 });
		}

		const channel = await readStableChannel();
		if (!channel || !shouldOfferUpdate(channel, version, device.mac)) {
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
