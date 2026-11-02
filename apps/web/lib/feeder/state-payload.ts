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
	/** When the hopper level was measured, for the stale/age treatment. */
	feedLevelUpdatedAt: string | null;
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
		feedLevelUpdatedAt: iso(detail.feedLevelUpdatedAt),
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
	};
}
