import { PELLET_CRITICAL_PCT, PELLET_LOW_PCT } from "@/lib/constants";
import type { NotificationPrefs } from "@/lib/limits";
import type { MemberRole } from "@prisma/client";
import type { OrgSettings } from "./org";

/**
 * Pure gates for organization-level alerts (issue #190 / decision E6).
 *
 * In-app `Notification` rows are pond-scoped, not user-scoped, so the org policy
 * cannot address an individual inbox. What it can do — and what these helpers
 * implement — is decide whether an alert is created at all:
 *
 * - `missedFeedingAlerts` switches missed-feeding alerts off entirely;
 * - `alertRoles` requires at least one active member of the pond's org to hold
 *   one of the selected roles (with no resolvable org the caller passes every
 *   role, keeping legacy behaviour);
 * - the pond's personal `notificationPrefs` still gate the three existing
 *   categories (hopper low, device offline, missed feeding).
 *
 * Keeping this policy pure means ingest, the cron job and the tests cannot
 * drift apart, and a threshold change is testable without a database.
 */

export type OrgAlertCategory = "hopper_low" | "device_offline" | "missed_feeding";

/** The pond-level personal preference that gates each category. */
export function personalPrefAllowsAlert(
	prefs: NotificationPrefs,
	category: OrgAlertCategory,
): boolean {
	switch (category) {
		case "hopper_low":
			return prefs.hopperLow;
		case "device_offline":
			return prefs.deviceOffline;
		case "missed_feeding":
			return prefs.missedFeeding;
	}
}

/** The org-level switch for a category. Only missed feeding has one today. */
export function alertCategoryEnabled(settings: OrgSettings, category: OrgAlertCategory): boolean {
	if (category === "missed_feeding") return settings.missedFeedingAlerts;
	return true;
}

/** True when the selected alert roles include this member role. */
export function roleReceivesAlert(settings: OrgSettings, role: MemberRole): boolean {
	return settings.alertRoles.includes(role);
}

/**
 * Whether one alert should be created for a pond.
 *
 * Fails closed on an empty role list (there is nobody to alert) but treats the
 * caller-provided role list as authoritative; callers pass every role when the
 * org cannot be resolved so an unlinkable pond keeps its legacy alerts.
 */
export function shouldCreatePondAlert(input: {
	settings: OrgSettings;
	category: OrgAlertCategory;
	prefs: NotificationPrefs;
	roles: readonly MemberRole[];
}): boolean {
	if (!alertCategoryEnabled(input.settings, input.category)) return false;
	if (!personalPrefAllowsAlert(input.prefs, input.category)) return false;
	if (input.roles.length === 0) return false;
	return input.roles.some((role) => roleReceivesAlert(input.settings, role));
}

/**
 * Hopper tier for a reading, using the org's `hopperLowPct` as the WARNING
 * threshold and the fixed critical ceiling for CRITICAL. A malformed threshold
 * falls back to the legacy 20 %, never to "never low".
 */
export function hopperAlertTier(
	levelPercent: number,
	hopperLowPct: number,
): "WARNING" | "CRITICAL" | null {
	if (!Number.isFinite(levelPercent)) return null;
	if (levelPercent <= PELLET_CRITICAL_PCT) return "CRITICAL";
	const low = Number.isFinite(hopperLowPct) ? hopperLowPct : PELLET_LOW_PCT;
	return levelPercent <= low ? "WARNING" : null;
}

/** The org's alert delay in milliseconds. */
export function offlineAlertThresholdMs(settings: OrgSettings): number {
	const minutes = Number.isFinite(settings.offlineAfterMin) ? settings.offlineAfterMin : 30;
	return Math.max(0, minutes) * 60 * 1000;
}

/**
 * True when a device has been silent long enough for the org's offline alert.
 *
 * `lastSeenAt` null means no heartbeat was ever received; the existing cron
 * skips those rows, so this returns false for them too.
 */
export function offlineAlertDue(
	lastSeenAt: Date | null | undefined,
	now: Date,
	settings: OrgSettings,
): boolean {
	if (!lastSeenAt) return false;
	return now.getTime() - lastSeenAt.getTime() >= offlineAlertThresholdMs(settings);
}
