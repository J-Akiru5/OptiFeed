import { resolveOrgScope } from "@/lib/auth/org-scope";
import { getCurrentPondOwnerIdSafe, getCurrentUser } from "@/lib/auth/session";
import { resolveRssiDbm } from "@/lib/device-status";
import { MACHINE_FEED_SOURCES } from "@/lib/feed-figures";
import { type FeederStatus, feederStatus } from "@/lib/feeder/feeder-parts";
import prisma from "@/lib/prisma";
import { getDeviceStatusPolicy } from "@/lib/settings/device-status";

/**
 * One guarded read for the device detail / 3D viewer (plan v1.1.0).
 *
 * Tenant admins see every pond in their organization; every other member sees
 * the active ponds they own (view-as resolves to the target farm through
 * `getCurrentPondOwnerIdSafe`). A device outside that scope returns null, and
 * the page turns that into notFound() — unknown and out-of-scope are the same
 * answer.
 */
export interface FeederDeviceDetail {
	id: string;
	label: string;
	mac: string;
	lastSeenAt: Date | null;
	rtcOk: boolean;
	/** Water-temperature probe health as last reported. */
	waterTempOk: boolean;
	/** Last calibrated temperature the probe reported; null when it never did. */
	waterTempC: number | null;
	/** Last time the probe reported; null when the firmware never sent one. */
	waterTempUpdatedAt: Date | null;
	/** Freshness window for a reported reading, from the device status policy. */
	staleAfterMs: number;
	/** Latest sanitised firmware diagnostics object (issue #454); null until a heartbeat carries one. */
	diag: Record<string, unknown> | null;
	/** Firmware version reported in `diag`, when present. */
	firmwareVersion: string | null;
	/** Fresh Wi-Fi signal in dBm, or null when the last reading is old/absent. */
	signalDbm: number | null;
	isPaused: boolean;
	feedLevelPercent: number | null;
	/** When the hopper level was measured; the freshness basis for that reading. */
	feedLevelUpdatedAt: Date | null;
	hopperCapacityG: number | null;
	gramsPerFeeding: number;
	pond: { id: string; name: string };
	lastFedAt: Date | null;
	lastFedGrams: number | null;
	status: FeederStatus;
}

export async function getDeviceDetail(
	deviceId: string,
	now: Date = new Date(),
): Promise<FeederDeviceDetail | null> {
	const user = await getCurrentUser();
	if (!user) return null;

	let pondIds: string[];
	const orgPondIds = (await resolveOrgScope()).pondIds;
	if (orgPondIds.length > 0) {
		pondIds = orgPondIds;
	} else {
		const ownerId = await getCurrentPondOwnerIdSafe();
		if (!ownerId) return null;
		const ponds = await prisma.pond.findMany({
			where: { ownerId, status: "ACTIVE" },
			select: { id: true },
			take: 200,
		});
		pondIds = ponds.map((pond) => pond.id);
	}
	if (pondIds.length === 0) return null;

	const device = await prisma.energyDevice.findFirst({
		where: { id: deviceId, pondId: { in: pondIds } },
		select: {
			id: true,
			label: true,
			mac: true,
			lastSeenAt: true,
			rtcOk: true,
			waterTempOk: true,
			waterTempC: true,
			waterTempUpdatedAt: true,
			diag: true,
			isPaused: true,
			feedLevelPercent: true,
			feedLevelUpdatedAt: true,
			wifiRssiDbm: true,
			wifiRssiUpdatedAt: true,
			hopperCapacityG: true,
			gramsPerFeeding: true,
			pond: { select: { id: true, name: true } },
		},
	});
	if (!device?.pond) return null;

	const latestFeed = await prisma.feedEvent.findFirst({
		where: {
			deviceId: device.id,
			eventType: "feed_dispensed",
			source: { in: [...MACHINE_FEED_SOURCES] },
		},
		orderBy: { receivedAt: "desc" },
		select: { receivedAt: true, grams: true },
	});

	const policy = await getDeviceStatusPolicy();
	const diag = (device.diag as Record<string, unknown> | null) ?? null;

	return {
		...device,
		// Prisma types the Json column as a loose JsonValue; the sanitizer at
		// ingest guarantees the object shape, so this cast stays safe.
		diag,
		firmwareVersion: typeof diag?.version === "string" ? diag.version : null,
		// A stale RSSI is not a current signal, so the resolver drops it rather
		// than letting a wall display show a bar from an hour ago.
		signalDbm: resolveRssiDbm({
			rssiDbm: device.wifiRssiDbm,
			updatedAt: device.wifiRssiUpdatedAt,
			now,
			policy,
		}),
		pond: device.pond,
		staleAfterMs: policy.offlineAfterMs,
		lastFedAt: latestFeed?.receivedAt ?? null,
		lastFedGrams: latestFeed?.grams ?? null,
		status: feederStatus({
			isPaused: device.isPaused,
			lastSeenAt: device.lastSeenAt,
			lastFedAt: latestFeed?.receivedAt ?? null,
			now,
			policy,
		}),
	};
}
