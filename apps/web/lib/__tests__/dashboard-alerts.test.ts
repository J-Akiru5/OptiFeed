import { describe, expect, it } from "vitest";

import {
	DASHBOARD_ALERT_DESTINATIONS,
	DASHBOARD_ALERT_IDS,
	type DashboardAlertInput,
	type DashboardAlertTranslate,
	buildDashboardAlerts,
} from "@/lib/dashboard/alerts";

/**
 * #819: an alert without a destination is dead text. These tests pin the
 * mapping for every kind and fail the moment a new alert ships without a page
 * to fix it.
 */

const t: DashboardAlertTranslate = (key, values) =>
	values ? `${key} ${Object.values(values).join(" ")}` : key;

const ALL_ON: DashboardAlertInput = {
	deviceId: "dev-1",
	deviceName: "Feeder 1",
	isOffline: true,
	hopperLevelPercent: 12,
	hopperLow: true,
	rtcOk: false,
	pendingCommandCount: 1,
	recalibration: { isOverdue: true, daysOverdue: 4 },
	drift: { status: "drift", diffPct: -22.4 },
	offlineDuration: "2h 5m",
};

describe("dashboard alert destinations (#819)", () => {
	it("builds every kind with a real route and an action label", () => {
		const alerts = buildDashboardAlerts(ALL_ON, t);

		expect(alerts.map((alert) => alert.id)).toEqual([
			"offline",
			"hopper-low",
			"rtc",
			"pending-command",
			"recalibration",
			"drift",
		]);

		for (const alert of alerts) {
			expect(alert.href, `${alert.id} has no destination`).toMatch(/^\/dashboard(\/|$)/);
			expect(alert.href, `${alert.id} points at a placeholder`).not.toBe("#");
			expect(alert.linkLabel, `${alert.id} has no action label`).not.toBe("");
			expect(alert.title, `${alert.id} has no title`).not.toBe("");
			expect(alert.detail, `${alert.id} has no detail`).not.toBe("");
		}
	});

	it("maps each kind to the screen that fixes it", () => {
		const alerts = buildDashboardAlerts(ALL_ON, t);
		const href = (id: string) => alerts.find((alert) => alert.id === id)?.href;

		expect(href("offline")).toBe(
			"/dashboard/settings/hardware?device=dev-1&tab=network#wifi-setup",
		);
		expect(href("hopper-low")).toBe("/dashboard/settings/pond");
		expect(href("rtc")).toBe("/dashboard/schedule#schedule-calibration");
		expect(href("pending-command")).toBe("/dashboard/schedule");
		expect(href("recalibration")).toBe(
			"/dashboard/settings/hardware?device=dev-1&tab=calibration#recalibration",
		);
		expect(href("drift")).toBe(
			"/dashboard/settings/hardware?device=dev-1&tab=calibration#recalibration",
		);
	});

	it("declares a destination function for every alert id", () => {
		for (const id of DASHBOARD_ALERT_IDS) {
			const href = DASHBOARD_ALERT_DESTINATIONS[id]("dev-1");
			expect(href, `${id} destination is empty`).toMatch(/^\/dashboard(\/|$)/);
			expect(href, `${id} destination is a placeholder`).not.toBe("#");
		}
	});

	it("does not invent alerts when the feeder is healthy", () => {
		const alerts = buildDashboardAlerts(
			{
				...ALL_ON,
				isOffline: false,
				hopperLevelPercent: 68,
				hopperLow: false,
				rtcOk: true,
				pendingCommandCount: 0,
				recalibration: { isOverdue: false, daysOverdue: 0 },
				drift: { status: "ok", diffPct: 2 },
			},
			t,
		);

		expect(alerts).toEqual([]);
	});

	it("does not route device alerts anywhere without a device", () => {
		// Every device-specific alert must have a device to point at; otherwise
		// the link would fall back to a generic settings page.
		const alerts = buildDashboardAlerts({ ...ALL_ON, deviceId: null }, t);

		expect(alerts).toEqual([]);
	});
});
