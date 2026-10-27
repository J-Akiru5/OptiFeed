import { DEFAULT_NOTIFICATION_PREFS } from "@/lib/limits";
import { ORG_SETTINGS_DEFAULTS, mergeOrgSettings } from "@/lib/settings/org";
import {
	alertCategoryEnabled,
	hopperAlertTier,
	offlineAlertDue,
	offlineAlertThresholdMs,
	personalPrefAllowsAlert,
	roleReceivesAlert,
	shouldCreatePondAlert,
} from "@/lib/settings/org-alerts";
import { describe, expect, it } from "vitest";

const PREFS = { ...DEFAULT_NOTIFICATION_PREFS };

describe("mergeOrgSettings", () => {
	it("returns the schema defaults when the org has no row", () => {
		expect(mergeOrgSettings(null)).toEqual(ORG_SETTINGS_DEFAULTS);
		expect(mergeOrgSettings(undefined)).toEqual(ORG_SETTINGS_DEFAULTS);
	});

	it("keeps stored values and fills missing fields from the defaults", () => {
		const merged = mergeOrgSettings({ defaultFeedingRatePct: 4.5, hopperLowPct: 35 });
		expect(merged).toEqual({
			...ORG_SETTINGS_DEFAULTS,
			defaultFeedingRatePct: 4.5,
			hopperLowPct: 35,
		});
	});

	it("falls back per field for malformed values", () => {
		const merged = mergeOrgSettings({
			defaultFeedingRatePct: Number.NaN,
			hopperLowPct: "30" as unknown as number,
			offlineAfterMin: 0,
			missedFeedingAlerts: "no" as unknown as boolean,
			alertRoles: ["NOT_A_ROLE" as never],
			deviceRegistration: "WHATEVER" as never,
		});

		expect(merged.defaultFeedingRatePct).toBe(ORG_SETTINGS_DEFAULTS.defaultFeedingRatePct);
		expect(merged.hopperLowPct).toBe(ORG_SETTINGS_DEFAULTS.hopperLowPct);
		// 0 is a real number: the writer validates the range, the reader only
		// needs a stable value.
		expect(merged.offlineAfterMin).toBe(0);
		expect(merged.missedFeedingAlerts).toBe(true);
		expect(merged.alertRoles).toEqual(["OWNER", "ADMIN"]);
		expect(merged.deviceRegistration).toBe("ADMIN_APPROVAL");
	});

	it("deduplicates alert roles and refuses an empty policy", () => {
		expect(mergeOrgSettings({ alertRoles: ["OWNER", "OWNER", "OPERATOR"] }).alertRoles).toEqual([
			"OWNER",
			"OPERATOR",
		]);
		expect(mergeOrgSettings({ alertRoles: [] }).alertRoles).toEqual(["OWNER", "ADMIN"]);
	});
});

describe("alert gates", () => {
	const settings = { ...ORG_SETTINGS_DEFAULTS };

	it("missed feeding is the only category with an org switch", () => {
		expect(
			alertCategoryEnabled({ ...settings, missedFeedingAlerts: false }, "missed_feeding"),
		).toBe(false);
		expect(alertCategoryEnabled({ ...settings, missedFeedingAlerts: false }, "hopper_low")).toBe(
			true,
		);
	});

	it("role membership decides whether an alert has an intended recipient", () => {
		expect(roleReceivesAlert(settings, "OWNER")).toBe(true);
		expect(roleReceivesAlert(settings, "ADMIN")).toBe(true);
		expect(roleReceivesAlert(settings, "OPERATOR")).toBe(false);
		expect(roleReceivesAlert({ ...settings, alertRoles: ["OPERATOR"] }, "OPERATOR")).toBe(true);
	});

	it("personal prefs gate the three alert categories by name", () => {
		const off = {
			...PREFS,
			hopperLow: false,
			deviceOffline: false,
			missedFeeding: false,
		};
		expect(personalPrefAllowsAlert(off, "hopper_low")).toBe(false);
		expect(personalPrefAllowsAlert(off, "device_offline")).toBe(false);
		expect(personalPrefAllowsAlert(off, "missed_feeding")).toBe(false);
		expect(personalPrefAllowsAlert(PREFS, "hopper_low")).toBe(true);
	});

	it("requires the org switch, the personal pref and a matching role", () => {
		const allowed = shouldCreatePondAlert({
			settings,
			category: "hopper_low",
			prefs: PREFS,
			roles: ["OPERATOR", "ADMIN"],
		});
		expect(allowed).toBe(true);

		expect(
			shouldCreatePondAlert({
				settings,
				category: "hopper_low",
				prefs: { ...PREFS, hopperLow: false },
				roles: ["ADMIN"],
			}),
		).toBe(false);

		expect(
			shouldCreatePondAlert({
				settings: { ...settings, alertRoles: ["VIEWER"] },
				category: "hopper_low",
				prefs: PREFS,
				roles: ["ADMIN"],
			}),
		).toBe(false);

		expect(
			shouldCreatePondAlert({
				settings: { ...settings, missedFeedingAlerts: false },
				category: "missed_feeding",
				prefs: PREFS,
				roles: ["ADMIN"],
			}),
		).toBe(false);

		expect(
			shouldCreatePondAlert({
				settings,
				category: "hopper_low",
				prefs: PREFS,
				roles: [],
			}),
		).toBe(false);
	});
});

describe("hopperAlertTier", () => {
	it("keeps the fixed critical ceiling", () => {
		expect(hopperAlertTier(5, 20)).toBe("CRITICAL");
		expect(hopperAlertTier(0, 20)).toBe("CRITICAL");
	});

	it("uses the org threshold for WARNING", () => {
		expect(hopperAlertTier(34, 35)).toBe("WARNING");
		expect(hopperAlertTier(35, 35)).toBe("WARNING");
		expect(hopperAlertTier(36, 35)).toBeNull();
		// A low org threshold tightens the warning band rather than widening it.
		expect(hopperAlertTier(6, 5)).toBeNull();
		expect(hopperAlertTier(5, 5)).toBe("CRITICAL");
	});

	it("falls back to 20 % for a malformed threshold", () => {
		expect(hopperAlertTier(20, Number.NaN)).toBe("WARNING");
		expect(hopperAlertTier(21, Number.NaN)).toBeNull();
	});

	it("ignores a non-numeric reading", () => {
		expect(hopperAlertTier(Number.NaN, 20)).toBeNull();
	});
});

describe("offlineAlertDue", () => {
	const now = new Date("2026-10-27T12:00:00.000Z");

	it("uses the org delay, not the 15-minute badge threshold", () => {
		const lastSeenAt = new Date(now.getTime() - 16 * 60 * 1000);
		expect(offlineAlertDue(lastSeenAt, now, ORG_SETTINGS_DEFAULTS)).toBe(false);
		expect(offlineAlertDue(lastSeenAt, now, { ...ORG_SETTINGS_DEFAULTS, offlineAfterMin: 5 })).toBe(
			true,
		);
	});

	it("is due exactly at the threshold and false with no heartbeat", () => {
		const lastSeenAt = new Date(now.getTime() - 30 * 60 * 1000);
		expect(offlineAlertDue(lastSeenAt, now, ORG_SETTINGS_DEFAULTS)).toBe(true);
		expect(offlineAlertDue(null, now, ORG_SETTINGS_DEFAULTS)).toBe(false);
	});

	it("converts minutes to milliseconds", () => {
		expect(offlineAlertThresholdMs({ ...ORG_SETTINGS_DEFAULTS, offlineAfterMin: 90 })).toBe(
			90 * 60 * 1000,
		);
	});
});
