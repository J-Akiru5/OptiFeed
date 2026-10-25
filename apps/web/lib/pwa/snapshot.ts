export const DASHBOARD_SNAPSHOT_KEY = "optifeed:pwa:dashboard:v1";
export const DASHBOARD_SNAPSHOT_VERSION = 1;

export type DashboardSnapshotInput = {
	pondName: string;
	deviceName: string;
	deviceStatus: "online" | "offline" | "missing";
	lastSeenAt: string | null;
	feedLevelPercent: number | null;
	feedLevelUpdatedAt: string | null;
	waterTempC: number | null;
	waterTempOk: boolean | null;
	waterTempUpdatedAt: string | null;
	population: number;
	avgWeightG: number | null;
	latestFcr: number | null;
	nextFeedingTime: string | null;
	nextFeedingVolumeG: number | null;
	daysUntilSample: number;
	activeCycleLabel: string | null;
	targetHarvestDate: string | null;
	isPaused: boolean;
};

export type DashboardSnapshot = DashboardSnapshotInput & {
	version: typeof DASHBOARD_SNAPSHOT_VERSION;
	savedAt: string;
};

export function writeDashboardSnapshot(input: DashboardSnapshotInput): void {
	if (typeof window === "undefined") return;

	try {
		const snapshot: DashboardSnapshot = {
			version: DASHBOARD_SNAPSHOT_VERSION,
			savedAt: new Date().toISOString(),
			...input,
		};
		window.localStorage.setItem(DASHBOARD_SNAPSHOT_KEY, JSON.stringify(snapshot));
	} catch {
		// Private browsing and storage quotas can reject writes; the app still works online.
	}
}

export function clearDashboardSnapshot(): void {
	if (typeof window === "undefined") return;

	try {
		window.localStorage.removeItem(DASHBOARD_SNAPSHOT_KEY);
	} catch {
		// Nothing to clear when storage is unavailable.
	}
}
