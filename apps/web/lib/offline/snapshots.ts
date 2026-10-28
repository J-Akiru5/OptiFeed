export type OfflinePage = "dashboard" | "schedule" | "growth" | "harvest" | "history";

export interface OfflineSnapshotInput<T = unknown> {
	page: OfflinePage;
	/** Tenant/farm scope. Keeps different signed-in farms from mixing snapshots. */
	scope: string;
	pondId: string;
	pondName: string;
	data: T;
	/** Mark this pond as the active one for the offline shell. */
	active?: boolean;
}

export interface OfflineSnapshotRecord<T = unknown> extends OfflineSnapshotInput<T> {
	key: string;
	version: 1;
	savedAt: string;
}

export interface OfflineMeta {
	key: "active";
	scope: string;
	pondId: string;
	pondName: string;
	savedAt: string;
}

export interface DashboardSnapshotData {
	pondName: string;
	deviceName: string;
	deviceStatus: "online" | "offline" | "missing";
	lastSeenAt: string | null;
	feedLevelPercent: number | null;
	feedLevelUpdatedAt: string | null;
	waterTempC: number | null;
	waterTempOk: boolean | null;
	waterTempUpdatedAt: string | null;
	/** Live fish used for the feed figures; null when the pond records none. */
	population: number | null;
	avgWeightG: number | null;
	latestFcr: number | null;
	nextFeedingTime: string | null;
	nextFeedingVolumeG: number | null;
	daysUntilSample: number;
	activeCycleLabel: string | null;
	targetHarvestDate: string | null;
	isPaused: boolean;
}

export interface ScheduleSnapshotData {
	pondName: string;
	deviceName: string;
	deviceStatus: "online" | "offline";
	lastSeenAt: string | null;
	scheduleStart: string;
	scheduleEnd: string;
	feedsPerDay: number;
	feedingRatePct: number;
	gramsPerFeeding: number | null;
	isPaused: boolean;
	pendingCommandStatus: string | null;
	pendingCommandAt: string | null;
}

export interface GrowthSampleSnapshot {
	date: string;
	avgWeightG: number;
	lengthCm: number;
	batchLabel: string | null;
}

export interface GrowthSnapshotData {
	pondName: string;
	latestAbwG: number | null;
	latestFcr: number | null;
	latestSampleAt: string | null;
	cycleLabel: string | null;
	targetWeightG: number | null;
	targetDate: string | null;
	track: string | null;
	currentWeightG: number | null;
	expectedWeightG: number | null;
	projectedHarvestG: number | null;
	recommendedGrams: number | null;
	adjustmentAllowed: boolean | null;
	nextAdjustmentDate: string | null;
	confidence: string | null;
	samples: GrowthSampleSnapshot[];
}

export interface CycleSummarySnapshot {
	label: string | null;
	status: string;
	stockingDate: string;
	harvestDate: string;
	stockingCount: number;
	targetWeightG: number | null;
	growOutDay: number | null;
	daysToHarvest: number | null;
}

export interface HarvestEventSnapshot {
	title: string;
	date: string;
	type: string;
	status: string;
}

export interface HarvestSnapshotData {
	pondName: string;
	activeCycles: CycleSummarySnapshot[];
	recentCycles: CycleSummarySnapshot[];
	upcomingEvents: HarvestEventSnapshot[];
}

export interface HistoryEventSnapshot {
	at: string;
	grams: number | null;
	source: string | null;
}

export interface HistorySnapshotData {
	pondName: string;
	/** Every source, current Asia/Manila day — never a sum of cached rows. */
	todayDispensedG: number;
	feedLevelPercent: number | null;
	feedLevelUpdatedAt: string | null;
	events: HistoryEventSnapshot[];
}
