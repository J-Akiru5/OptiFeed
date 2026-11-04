import type { FeederDeviceDetail } from "@/lib/feeder/detail";
import type { FeederStatus } from "@/lib/feeder/feeder-parts";

/**
 * The live-status DTO the device viewer polls (#620).
 *
 * It is a pure projection of `getDeviceDetail`, so the fields the page shows on
 * load and the fields the poll refreshes cannot drift apart. Before this, the
 * poll omitted the water probe entirely and the RTC bit only existed on the
 * server render, so both stayed frozen for as long as the tab was open.
 */
export interface FeederStatePayload {
	deviceId: string;
	status: FeederStatus;
	lastSeenAt: string | null;
	lastFedAt: string | null;
	lastFedGrams: number | null;
	feedLevelPercent: number | null;
	/** Raw ultrasonic distance in cm (#659), for the calibration form. */
	feedLevelCm: number | null;
	/** When the hopper level was measured, for the stale/age treatment. */
	feedLevelUpdatedAt: string | null;
	/** The unit is reachable but its ultrasonic sensor is not answering (#810). */
	sensorOffline: boolean;
	hopperCapacityG: number | null;
	gramsPerFeeding: number;
	/** Fresh Wi-Fi signal, or null when the stored reading is stale/absent. */
	signalDbm: number | null;
	firmwareVersion: string | null;
	rtcOk: boolean;
	waterTempOk: boolean;
	waterTempC: number | null;
	waterTempUpdatedAt: string | null;
	/** How old a reading may be before the viewer calls it stale. */
	staleAfterMs: number;
	isPaused: boolean;
	/**
	 * A feed request is still pending or dispatched (#731). The viewer polls at
	 * the heartbeat cadence while it is true so the dispense and the new hopper
	 * level appear without a manual refresh.
	 */
	pendingFeedRequest: boolean;
}

function iso(date: Date | null): string | null {
	return date ? date.toISOString() : null;
}

export function toStatePayload(detail: FeederDeviceDetail): FeederStatePayload {
	return {
		deviceId: detail.id,
		status: detail.status,
		lastSeenAt: iso(detail.lastSeenAt),
		lastFedAt: iso(detail.lastFedAt),
		lastFedGrams: detail.lastFedGrams,
		feedLevelPercent: detail.feedLevelPercent,
		feedLevelCm: detail.feedLevelCm,
		feedLevelUpdatedAt: iso(detail.feedLevelUpdatedAt),
		sensorOffline: detail.sensorOffline,
		hopperCapacityG: detail.hopperCapacityG,
		gramsPerFeeding: detail.gramsPerFeeding,
		signalDbm: detail.signalDbm,
		firmwareVersion: detail.firmwareVersion,
		rtcOk: detail.rtcOk,
		waterTempOk: detail.waterTempOk,
		waterTempC: detail.waterTempC,
		waterTempUpdatedAt: iso(detail.waterTempUpdatedAt),
		staleAfterMs: detail.staleAfterMs,
		isPaused: detail.isPaused,
		pendingFeedRequest: detail.pendingFeedRequest,
	};
}
