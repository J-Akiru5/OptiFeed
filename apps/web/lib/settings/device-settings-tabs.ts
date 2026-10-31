/**
 * Tabs and device selection for the device settings page (issue #403).
 *
 * Pure helpers shared by the server page, the client tabs and the links that
 * point into the page, so the tab ids and the old `#anchor` links agree in one
 * place.
 */

export const DEVICE_SETTINGS_ROUTE = "/dashboard/settings/hardware";

export const DEVICE_SETTINGS_TABS = ["overview", "feeding", "calibration", "network"] as const;

export type DeviceSettingsTab = (typeof DEVICE_SETTINGS_TABS)[number];

export const DEFAULT_DEVICE_SETTINGS_TAB: DeviceSettingsTab = "overview";

/**
 * Section anchors that existed before the page had tabs. Search results and
 * pond-conflict links still use them, so each one opens the tab that now holds
 * the section.
 */
export const DEVICE_SETTINGS_ANCHOR_TABS: Readonly<Record<string, DeviceSettingsTab>> = {
	"device-status": "overview",
	"daily-ceiling": "feeding",
	"hopper-calibration": "calibration",
	calibration: "calibration",
	recalibration: "calibration",
	"temperature-calibration": "calibration",
	"calibration-history": "calibration",
	"wifi-setup": "network",
};

export function isDeviceSettingsTab(value: unknown): value is DeviceSettingsTab {
	return typeof value === "string" && (DEVICE_SETTINGS_TABS as readonly string[]).includes(value);
}

/** An unknown or missing `?tab=` falls back to the default tab. */
export function parseDeviceSettingsTab(value: string | undefined): DeviceSettingsTab {
	return isDeviceSettingsTab(value) ? value : DEFAULT_DEVICE_SETTINGS_TAB;
}

/** The tab for a location hash such as `#daily-ceiling`, or null. */
export function tabForAnchor(hash: string): DeviceSettingsTab | null {
	const anchor = hash.startsWith("#") ? hash.slice(1) : hash;
	return DEVICE_SETTINGS_ANCHOR_TABS[anchor] ?? null;
}

/**
 * The query string for the page. The default tab and a missing device are left
 * out so the plain route stays the canonical link.
 */
export function deviceSettingsQuery(options: {
	deviceId?: string | null;
	tab?: DeviceSettingsTab;
}): Record<string, string> {
	const query: Record<string, string> = {};
	if (options.deviceId) query.device = options.deviceId;
	if (options.tab && options.tab !== DEFAULT_DEVICE_SETTINGS_TAB) query.tab = options.tab;
	return query;
}

export function deviceSettingsHref(options: {
	deviceId?: string | null;
	tab?: DeviceSettingsTab;
	anchor?: string;
}): string {
	const query = new URLSearchParams(deviceSettingsQuery(options)).toString();
	return `${DEVICE_SETTINGS_ROUTE}${query ? `?${query}` : ""}${options.anchor ? `#${options.anchor}` : ""}`;
}

/**
 * Which device the page configures.
 *
 * `devices` must already be limited to the caller's own ACTIVE ponds; the
 * requested id is only a hint and never selects a device outside that list.
 * Without a valid request the first device on the active pond wins (the
 * behaviour before the switcher), then the first device on any pond.
 */
export function resolveSelectedDevice<T extends { id: string; pondId: string | null }>(
	devices: readonly T[],
	requestedId: string | undefined,
	activePondId: string | null,
): T | null {
	if (requestedId) {
		const requested = devices.find((device) => device.id === requestedId);
		if (requested) return requested;
	}
	if (activePondId) {
		const onActivePond = devices.find((device) => device.pondId === activePondId);
		if (onActivePond) return onActivePond;
	}
	return devices[0] ?? null;
}
