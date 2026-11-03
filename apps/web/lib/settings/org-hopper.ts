import prisma from "@/lib/prisma";
import { getOrgSettingsForFarm } from "./org";
import { ORG_SETTINGS_DEFAULTS } from "./org-shared";

/**
 * #456: the organization's hopper-low threshold, sent to the device.
 *
 * `OrgSetting.hopperLowPct` (5-50 %, schema default 20) already backs the
 * low-hopper ingest alert. Firmware 1.7.0 accepts the same threshold as
 * `hopper_low_pct` (envelope 1-90) and applies it through
 * `configureHopperFilter`, but the poll never set it, so every unit fell back
 * to the compile-time 20 %.
 *
 * Resolution mirrors ingest: `EnergyDevice.pondId` -> `Pond.ownerId` (a farm
 * slug) -> active organization (`getOrgSettingsForFarm`) ->
 * `settings.hopperLowPct`.
 *
 * This runs inside the 5-second poll response, so it must never throw. A
 * rejected read would reach the route's catch and fail the whole poll with a
 * 503 (#724), which is an outage for every 1.7.0 unit. Every failure path logs
 * a warning and returns the schema default instead, and a resolved value is
 * cached per device for
 * `ORG_HOPPER_CACHE_TTL_MS` so the org chain does not run on every poll.
 */

export const ORG_HOPPER_CACHE_TTL_MS = 60_000;

/** Cap on the per-device cache; the least recently used entry is dropped. */
export const ORG_HOPPER_CACHE_MAX_ENTRIES = 500;

type CacheEntry = { pct: number; at: number };

const cache = new Map<string, CacheEntry>();

/** Test hook: drop every cached threshold. */
export function clearOrgHopperCache(): void {
	cache.clear();
}

/** Schema default — also the value older firmware ignores safely. */
function defaultPct(): number {
	return ORG_SETTINGS_DEFAULTS.hopperLowPct;
}

function readCache(deviceId: string, now: number): number | null {
	const entry = cache.get(deviceId);
	if (!entry) return null;
	if (now - entry.at >= ORG_HOPPER_CACHE_TTL_MS) {
		cache.delete(deviceId);
		return null;
	}
	// Refresh recency so a device that keeps polling is not evicted first.
	cache.delete(deviceId);
	cache.set(deviceId, entry);
	return entry.pct;
}

function writeCache(deviceId: string, pct: number, now: number): void {
	cache.delete(deviceId);
	while (cache.size >= ORG_HOPPER_CACHE_MAX_ENTRIES) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) break;
		cache.delete(oldest);
	}
	cache.set(deviceId, { pct, at: now });
}

/**
 * The `hopper_low_pct` to send to one device.
 *
 * Never throws: a missing pond, an unassigned device, an unreadable settings
 * chain or a malformed value all return `ORG_SETTINGS_DEFAULTS.hopperLowPct`
 * (20) with a warning, so the poll keeps answering with a complete config.
 */
export async function getOrgHopperLowPctForDevice(
	device: { id: string; pondId: string | null },
	now = Date.now(),
): Promise<number> {
	const cached = readCache(device.id, now);
	if (cached !== null) return cached;

	// An unassigned unit has no org to ask: use the schema default, not a guess.
	if (!device.pondId) return defaultPct();

	try {
		// Only the farm slug is needed; this never reads token or auth columns.
		const pond = await prisma.pond.findUnique({
			where: { id: device.pondId },
			select: { ownerId: true },
		});
		if (!pond) {
			console.warn(`[org-hopper] device ${device.id} points at a missing pond`);
			return defaultPct();
		}

		const org = await getOrgSettingsForFarm(pond.ownerId);
		const pct = org.settings.hopperLowPct;
		if (typeof pct !== "number" || !Number.isFinite(pct)) {
			console.warn(`[org-hopper] device ${device.id} has no usable org hopper threshold`);
			return defaultPct();
		}

		writeCache(device.id, pct, now);
		return pct;
	} catch (error) {
		// Never let an org read abort the poll: the caller still returns 200.
		console.warn(
			`[org-hopper] could not resolve the hopper threshold for device ${device.id}`,
			error,
		);
		return defaultPct();
	}
}
