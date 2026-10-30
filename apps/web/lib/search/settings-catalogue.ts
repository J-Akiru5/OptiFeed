import type { Permission } from "@/lib/auth/permissions";
import type { SearchAudience, SearchRow, SearchShell } from "./types";

/**
 * The settings half of global search (#370).
 *
 * Issue #370: searching "feed ceiling" found nothing, because the palette only
 * knew about pages and records. Settings are the things people search for by
 * name ("daily feed ceiling", "hopper capacity", "low hopper"), so every field
 * is an entry with:
 *
 *  - the page and the exact control (`target` is the help/highlight anchor,
 *    `href` carries the hash so a reload still scrolls to it),
 *  - the role that may open it (`audiences`, plus an optional permission),
 *  - synonyms in English and Hiligaynon ("ceiling", "cap", "limit", "takda"),
 *    because the visible label alone is not how people search.
 *
 * The server filters this list before returning it. The dialog only translates
 * and matches text; it never decides whether an entry is allowed.
 */

export type SearchSetting = {
	id: string;
	/** Route plus hash: opens the page at the field. */
	href: string;
	/** Locale-less route, used by the navigate-then-highlight engine. */
	route: string;
	/** `data-help` anchor of the real control. */
	target: string;
	/** Message key under `search.settings...`. */
	titleKey: string;
	descriptionKey: string;
	/** Which navigation surface the entry belongs to. */
	shelf: SearchShell;
	audiences: readonly SearchAudience[];
	/** An extra grant the destination needs. */
	permission?: Permission;
	/** English + Hiligaynon synonyms the visible label does not contain. */
	keywords: readonly string[];
};

const FARMER_AUDIENCE = ["farmer", "tenantAdmin"] as const;
const HARDWARE = "/dashboard/settings/hardware";
const POND = "/dashboard/settings/pond";

export const SEARCH_SETTINGS: readonly SearchSetting[] = [
	// ── Pond settings (farmer and tenant admin on their own pond) ────────────
	{
		id: "pond-feeding-rate",
		href: `${POND}#feedingRate`,
		route: POND,
		target: "setting-pond-feeding-rate",
		titleKey: "search.settings.pondFeedingRate.title",
		descriptionKey: "search.settings.pondFeedingRate.description",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
		keywords: [
			"feeding rate",
			"daily feeding rate",
			"rate",
			"percentage",
			"feed",
			"lawog",
			"porsyento",
			"kalan-on",
		],
	},
	{
		id: "pond-feeds-per-day",
		href: `${POND}#feedsPerDay`,
		route: POND,
		target: "setting-pond-feeds-per-day",
		titleKey: "search.settings.pondFeedsPerDay.title",
		descriptionKey: "search.settings.pondFeedsPerDay.description",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
		keywords: [
			"feeds per day",
			"feeding times",
			"meals",
			"feeding schedule",
			"schedule",
			"pila ka beses",
			"oras sang pagpakaon",
		],
	},
	{
		id: "pond-sample-interval",
		href: `${POND}#sampleInterval`,
		route: POND,
		target: "setting-pond-sample-interval",
		titleKey: "search.settings.pondSampleInterval.title",
		descriptionKey: "search.settings.pondSampleInterval.description",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
		keywords: ["sample interval", "sampling", "sample", "days", "biomass", "timbang"],
	},
	{
		id: "pond-population",
		href: `${POND}#population`,
		route: POND,
		target: "setting-pond-population",
		titleKey: "search.settings.pondPopulation.title",
		descriptionKey: "search.settings.pondPopulation.description",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
		keywords: ["population", "fish count", "stock", "head count", "kadamu", "isda"],
	},
	{
		id: "pond-area",
		href: `${POND}#areaM2`,
		route: POND,
		target: "setting-pond-area",
		titleKey: "search.settings.pondArea.title",
		descriptionKey: "search.settings.pondArea.description",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
		keywords: ["pond area", "area", "size", "square meters", "density", "lawod"],
	},
	{
		id: "pond-depth",
		href: `${POND}#averageDepthM`,
		route: POND,
		target: "setting-pond-depth",
		titleKey: "search.settings.pondDepth.title",
		descriptionKey: "search.settings.pondDepth.description",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
		keywords: ["average depth", "depth", "deep", "meters", "lalom"],
	},
	{
		id: "pond-feed-price",
		href: `${POND}#feedPricePerKg`,
		route: POND,
		target: "setting-pond-feed-price",
		titleKey: "search.settings.pondFeedPrice.title",
		descriptionKey: "search.settings.pondFeedPrice.description",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
		keywords: ["feed price", "price", "cost", "php per kg", "budget", "presyo"],
	},

	// ── Feeding schedule ─────────────────────────────────────────────────────
	{
		id: "feeding-schedule",
		href: "/dashboard/schedule#schedule-editor",
		route: "/dashboard/schedule",
		target: "schedule-editor",
		titleKey: "search.settings.feedingSchedule.title",
		descriptionKey: "search.settings.feedingSchedule.description",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
		keywords: [
			"feeding schedule",
			"schedule",
			"start time",
			"end time",
			"feeding times",
			"oras",
			"iskedyul",
		],
	},

	// ── Hardware and calibration ─────────────────────────────────────────────
	{
		id: "daily-feed-ceiling",
		href: `${HARDWARE}#daily-ceiling`,
		route: HARDWARE,
		target: "device-daily-ceiling",
		titleKey: "search.settings.dailyFeedCeiling.title",
		descriptionKey: "search.settings.dailyFeedCeiling.description",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
		keywords: [
			"daily feed ceiling",
			"daily feed limit",
			"ceiling",
			"cap",
			"limit",
			"maximum feed",
			"daily cap",
			"takda",
			"limite",
		],
	},
	{
		id: "per-meal-ceiling",
		href: `${HARDWARE}#calibration`,
		route: HARDWARE,
		target: "calibration-form",
		titleKey: "search.settings.perMealCeiling.title",
		descriptionKey: "search.settings.perMealCeiling.description",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
		keywords: [
			"per-meal ceiling",
			"per meal",
			"dose",
			"feed amount",
			"grams per feeding",
			"portion",
			"ceiling",
			"cap",
			"limit",
			"takda",
		],
	},
	{
		id: "calibration",
		href: `${HARDWARE}#calibration`,
		route: HARDWARE,
		target: "calibration-form",
		titleKey: "search.settings.calibration.title",
		descriptionKey: "search.settings.calibration.description",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
		keywords: [
			"calibration",
			"calibrate",
			"grams per second",
			"g/s",
			"target check",
			"motor",
			"kalkula",
		],
	},
	{
		id: "hopper-calibration",
		href: `${HARDWARE}#hopper-calibration`,
		route: HARDWARE,
		target: "hopper-calibration",
		titleKey: "search.settings.hopperCalibration.title",
		descriptionKey: "search.settings.hopperCalibration.description",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
		keywords: [
			"hopper calibration",
			"hopper",
			"full distance",
			"empty distance",
			"ultrasonic",
			"calibrate",
		],
	},
	{
		id: "hopper-capacity",
		href: `${HARDWARE}#hopper-calibration`,
		route: HARDWARE,
		target: "hopper-calibration",
		titleKey: "search.settings.hopperCapacity.title",
		descriptionKey: "search.settings.hopperCapacity.description",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
		keywords: ["hopper capacity", "capacity", "kg", "grams", "silo", "sudlanan"],
	},
	{
		id: "recalibration-interval",
		href: `${HARDWARE}#recalibration`,
		route: HARDWARE,
		target: "recalibration-interval",
		titleKey: "search.settings.recalibrationInterval.title",
		descriptionKey: "search.settings.recalibrationInterval.description",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
		keywords: [
			"recalibration",
			"recalibration interval",
			"calibration reminder",
			"interval",
			"days",
			"reminder",
		],
	},
	{
		id: "temperature-calibration",
		href: `${HARDWARE}#temperature-calibration`,
		route: HARDWARE,
		target: "setting-temperature-calibration",
		titleKey: "search.settings.temperatureCalibration.title",
		descriptionKey: "search.settings.temperatureCalibration.description",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
		keywords: [
			"temperature calibration",
			"temperature",
			"water temperature",
			"thermometer",
			"probe",
			"offset",
			"init",
		],
	},
	{
		id: "notifications",
		href: "/dashboard/settings/profile#notification-prefs",
		route: "/dashboard/settings/profile",
		target: "notification-prefs",
		titleKey: "search.settings.notifications.title",
		descriptionKey: "search.settings.notifications.description",
		shelf: "farmer",
		audiences: FARMER_AUDIENCE,
		keywords: [
			"notifications",
			"alerts",
			"notification preferences",
			"missed feeding",
			"offline",
			"hopper low",
		],
	},

	// ── Organization settings (tenant admin) ─────────────────────────────────
	{
		id: "org-default-feeding-rate",
		href: "/admin/settings#defaultFeedingRatePct",
		route: "/admin/settings",
		target: "setting-org-feeding-rate",
		titleKey: "search.settings.orgDefaultFeedingRate.title",
		descriptionKey: "search.settings.orgDefaultFeedingRate.description",
		shelf: "admin",
		audiences: ["tenantAdmin"],
		permission: "manage_farms_ponds",
		keywords: [
			"default feeding rate",
			"organization feeding rate",
			"feeding rate",
			"rate",
			"percentage",
			"default",
		],
	},
	{
		id: "org-low-hopper-threshold",
		href: "/admin/settings#hopperLowPct",
		route: "/admin/settings",
		target: "setting-org-notifications",
		titleKey: "search.settings.orgLowHopper.title",
		descriptionKey: "search.settings.orgLowHopper.description",
		shelf: "admin",
		audiences: ["tenantAdmin"],
		permission: "manage_farms_ponds",
		keywords: [
			"low hopper threshold",
			"low hopper",
			"hopper low",
			"low level",
			"threshold",
			"limit",
			"alert",
			"takda",
		],
	},
	{
		id: "org-offline-threshold",
		href: "/admin/settings#offlineAfterMin",
		route: "/admin/settings",
		target: "setting-org-notifications",
		titleKey: "search.settings.orgOfflineThreshold.title",
		descriptionKey: "search.settings.orgOfflineThreshold.description",
		shelf: "admin",
		audiences: ["tenantAdmin"],
		permission: "manage_farms_ponds",
		keywords: ["offline threshold", "offline after", "offline", "minutes", "alert", "limit"],
	},
	{
		id: "org-missed-feeding-alerts",
		href: "/admin/settings#missedFeedingAlerts",
		route: "/admin/settings",
		target: "setting-org-notifications",
		titleKey: "search.settings.orgMissedFeeding.title",
		descriptionKey: "search.settings.orgMissedFeeding.description",
		shelf: "admin",
		audiences: ["tenantAdmin"],
		permission: "manage_farms_ponds",
		keywords: ["missed feeding", "missed feeding alerts", "alerts", "notifications", "feeding"],
	},
	{
		id: "org-device-registration",
		href: "/admin/settings#deviceRegistration",
		route: "/admin/settings",
		target: "setting-org-device-registration",
		titleKey: "search.settings.orgDeviceRegistration.title",
		descriptionKey: "search.settings.orgDeviceRegistration.description",
		shelf: "admin",
		audiences: ["tenantAdmin"],
		permission: "manage_farms_ponds",
		keywords: [
			"device registration",
			"device approval",
			"admin approval",
			"self register",
			"pairing",
			"feeder",
		],
	},

	// ── Platform configuration (superadmin) ──────────────────────────────────
	{
		id: "platform-page-size",
		href: "/superadmin/settings#lists",
		route: "/superadmin/settings",
		target: "superadmin-page-size",
		titleKey: "search.settings.platformPageSize.title",
		descriptionKey: "search.settings.platformPageSize.description",
		shelf: "platform",
		audiences: ["platform"],
		keywords: ["page size", "pagination", "rows per page", "list size", "page"],
	},
	{
		id: "platform-safety-caps",
		href: "/superadmin/settings#safety",
		route: "/superadmin/settings",
		target: "setting-platform-safety-caps",
		titleKey: "search.settings.platformSafetyCaps.title",
		descriptionKey: "search.settings.platformSafetyCaps.description",
		shelf: "platform",
		audiences: ["platform"],
		keywords: [
			"safety caps",
			"feeding safety caps",
			"relay time",
			"max dispense",
			"daily cap factor",
			"ceiling",
			"cap",
			"limit",
			"hard maximum",
		],
	},
	{
		id: "platform-org-defaults",
		href: "/superadmin/settings#defaults",
		route: "/superadmin/settings",
		target: "setting-platform-org-defaults",
		titleKey: "search.settings.platformOrgDefaults.title",
		descriptionKey: "search.settings.platformOrgDefaults.description",
		shelf: "platform",
		audiences: ["platform"],
		keywords: [
			"organization defaults",
			"org defaults",
			"default feeding rate",
			"low hopper",
			"offline after",
			"alert roles",
			"device registration",
		],
	},
	{
		id: "platform-feature-flags",
		href: "/superadmin/settings#flags",
		route: "/superadmin/settings",
		target: "setting-platform-flags",
		titleKey: "search.settings.platformFeatureFlags.title",
		descriptionKey: "search.settings.platformFeatureFlags.description",
		shelf: "platform",
		audiences: ["platform"],
		keywords: ["feature flags", "flags", "toggle", "enable", "disable", "features"],
	},
];

/**
 * The settings a caller may open, ordered for the shell they are in.
 *
 * Fails closed: an audience with no entry gets nothing, and a permission-gated
 * entry disappears when the grant is absent.
 */
export function settingsFor(
	audience: SearchAudience,
	permissions: ReadonlySet<Permission>,
	shell: SearchShell,
): SearchRow[] {
	return SEARCH_SETTINGS.filter(
		(setting) =>
			setting.audiences.includes(audience) &&
			(!setting.permission || permissions.has(setting.permission)),
	)
		.sort((left, right) => {
			const leftRank = left.shelf === shell ? 0 : 1;
			const rightRank = right.shelf === shell ? 0 : 1;
			return leftRank - rightRank;
		})
		.map((setting) => ({
			id: `settings:${setting.id}`,
			group: "settings" as const,
			title: "",
			titleKey: setting.titleKey,
			descriptionKey: setting.descriptionKey,
			keywords: [...setting.keywords],
			href: setting.href,
			settingTarget: setting.target,
			settingRoute: setting.route,
		}));
}

/** Every `data-help` anchor the catalogue deep-links to (used by the tests). */
export function settingTargets(): string[] {
	return SEARCH_SETTINGS.map((setting) => setting.target);
}
