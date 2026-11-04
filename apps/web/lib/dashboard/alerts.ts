import { deviceSettingsHref } from "@/lib/settings/device-settings-tabs";

/**
 * The actionable alerts the farmer dashboard publishes to the shell (#819).
 *
 * The alert list used to sit in the dashboard body and the right rail. That
 * pushed the control room past the viewport on a laptop: the `main` pane grew
 * a scrollbar even though every panel already fit its own box. The list now
 * lives in the left sidebar, so it needs one stable shape the shared shell can
 * render and one destination per alert.
 *
 * Every alert carries a real `href` and a visible action label. There is no
 * "dead" alert: an alert whose remedy is not a page would be a bug, not a
 * reason to render plain text. `lib/__tests__/dashboard-alerts.test.ts` fails
 * if a kind loses its destination.
 */

export const DASHBOARD_ALERT_IDS = [
	"offline",
	"hopper-low",
	"rtc",
	"pending-command",
	"recalibration",
	"drift",
] as const;

export type DashboardAlertId = (typeof DASHBOARD_ALERT_IDS)[number];

export type DashboardAlertTone = "danger" | "warning" | "info";

export interface DashboardAlert {
	id: DashboardAlertId;
	tone: DashboardAlertTone;
	title: string;
	detail: string;
	/** A real route, never "#". */
	href: string;
	/** The action the link performs, visible and part of the accessible name. */
	linkLabel: string;
}

export interface DashboardAlertRecalibration {
	isOverdue: boolean;
	daysOverdue: number;
}

export interface DashboardAlertDrift {
	status: "ok" | "drift" | "insufficient_data";
	diffPct: number | null;
}

export interface DashboardAlertInput {
	deviceId: string | null;
	deviceName: string;
	isOffline: boolean;
	hopperLevelPercent: number | null;
	hopperLow: boolean;
	rtcOk: boolean | null;
	pendingCommandCount: number;
	recalibration: DashboardAlertRecalibration;
	drift: DashboardAlertDrift;
	/** Human-readable duration used in the offline title. */
	offlineDuration: string;
}

export type DashboardAlertTranslate = (
	key: string,
	values?: Record<string, string | number>,
) => string;

/** Where each alert kind is fixed. Exported so the mapping is testable on its own. */
export const DASHBOARD_ALERT_DESTINATIONS: Record<
	DashboardAlertId,
	(deviceId: string | null) => string
> = {
	// The unit is not reporting: its network setup is where an operator checks
	// Wi-Fi provisioning and the heartbeat.
	offline: (deviceId) => deviceSettingsHref({ deviceId, tab: "network", anchor: "wifi-setup" }),
	// Refilling is physical; the feeding configuration is the page that changes
	// how much the pond consumes before the next refill.
	"hopper-low": () => "/dashboard/settings/pond",
	// The clock is set on the schedule page's time-calibration card.
	rtc: () => "/dashboard/schedule#schedule-calibration",
	// A pending dose is visible with its retry/resync controls on the schedule.
	"pending-command": () => "/dashboard/schedule",
	// Recalibration and drift are both fixed with the calibration tools.
	recalibration: (deviceId) =>
		deviceSettingsHref({ deviceId, tab: "calibration", anchor: "recalibration" }),
	drift: (deviceId) =>
		deviceSettingsHref({ deviceId, tab: "calibration", anchor: "recalibration" }),
};

/**
 * Build the ordered list: danger first, then warnings, then the advisory
 * calibration alerts. Ordering is stable so the sidebar cannot reshuffle as
 * the page refreshes.
 */
export function buildDashboardAlerts(
	input: DashboardAlertInput,
	t: DashboardAlertTranslate,
): DashboardAlert[] {
	const alerts: DashboardAlert[] = [];
	const { deviceId } = input;
	const destination = (id: DashboardAlertId) => DASHBOARD_ALERT_DESTINATIONS[id](deviceId);

	if (input.isOffline && deviceId) {
		alerts.push({
			id: "offline",
			tone: "danger",
			title: t("controlRoom.alerts.offlineTitle", { duration: input.offlineDuration }),
			detail: t("controlRoom.alerts.offlineDetail", { device: input.deviceName }),
			href: destination("offline"),
			linkLabel: t("controlRoom.alerts.openHardware"),
		});
	}

	if (deviceId && input.hopperLevelPercent !== null && input.hopperLow) {
		alerts.push({
			id: "hopper-low",
			tone: "warning",
			title: t("controlRoom.alerts.lowHopperTitle", {
				percent: Math.round(input.hopperLevelPercent),
			}),
			detail: t("controlRoom.alerts.lowHopperDetail"),
			href: destination("hopper-low"),
			linkLabel: t("controlRoom.alerts.openFeedSettings"),
		});
	}

	if (deviceId && input.rtcOk === false) {
		alerts.push({
			id: "rtc",
			tone: "warning",
			title: t("controlRoom.alerts.rtcTitle"),
			detail: t("controlRoom.alerts.rtcDetail"),
			href: destination("rtc"),
			linkLabel: t("controlRoom.alerts.openScheduleCalibration"),
		});
	}

	if (deviceId && input.pendingCommandCount > 0) {
		alerts.push({
			id: "pending-command",
			tone: "warning",
			title: t("controlRoom.alerts.pendingCommandTitle"),
			detail: t("controlRoom.alerts.pendingCommandDetail"),
			href: destination("pending-command"),
			linkLabel: t("controlRoom.alerts.openSchedule"),
		});
	}

	if (deviceId && input.recalibration.isOverdue) {
		alerts.push({
			id: "recalibration",
			tone: "info",
			title: t("controlRoom.alerts.recalibrationTitle", {
				days: input.recalibration.daysOverdue,
			}),
			detail: t("controlRoom.alerts.recalibrationDetail"),
			href: destination("recalibration"),
			linkLabel: t("controlRoom.alerts.openCalibration"),
		});
	}

	if (deviceId && input.drift.status === "drift" && input.drift.diffPct !== null) {
		alerts.push({
			id: "drift",
			tone: "info",
			title: t("controlRoom.alerts.driftTitle", {
				percent: Math.abs(input.drift.diffPct).toFixed(1),
			}),
			detail: t("controlRoom.alerts.driftDetail"),
			href: destination("drift"),
			linkLabel: t("controlRoom.alerts.openCalibration"),
		});
	}

	return alerts;
}
