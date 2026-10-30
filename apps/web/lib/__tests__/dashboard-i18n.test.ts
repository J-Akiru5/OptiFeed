import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the farmer dashboard copy (T-09b).
 *
 * Every page in `app/[locale]/(dashboard)` — except the settings pages owned by
 * T-09d — and the dashboard/harvest components it renders must take their
 * user-visible strings from the message catalogue, and the Hiligaynon draft
 * must keep the same keys and placeholders as English. The second block also
 * fails if a retired English literal or a raw `toLocaleString()` date creeps
 * back in.
 */

const messagesDir = join(__dirname, "../../messages");
const webRoot = join(__dirname, "../..");

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(tree)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (typeof value === "string") out[path] = value;
		else Object.assign(out, flatten(value, path));
	}
	return out;
}

function load(locale: string): Tree {
	return JSON.parse(readFileSync(join(messagesDir, `${locale}.json`), "utf8"));
}

function placeholders(message: string): string[] {
	return [...message.matchAll(/\{(\w+)/g)].map((match) => match[1]).sort();
}

const NAMESPACES = [
	"nav",
	"dashboard.feedLevel",
	"dashboard.common",
	"dashboard.pondSwitcher",
	"dashboard.home",
	"dashboard.growth",
	"dashboard.growth.history",
	"dashboard.history",
	"dashboard.logSample",
	"dashboard.schedule",
	"dashboard.notifications",
	"dashboard.audit",
	"dashboard.harvest",
	"dashboard.harvest.calendar",
	"dashboard.harvest.upcoming",
];

/** Keys the rewritten pages rely on; a rename without a message fails here. */
const REQUIRED = [
	"dashboard.feedLevel.lastKnown",
	"dashboard.feedLevel.noReadingYet",
	"dashboard.common.readOnlyTitle",
	"dashboard.common.readOnlyDesc",
	"dashboard.common.noPondTitle",
	"dashboard.common.noPondDesc",
	"dashboard.common.loading",
	"dashboard.common.deviceOnline",
	"dashboard.common.deviceOffline",
	"dashboard.common.skipToContent",
	"dashboard.common.lastSynced",
	"dashboard.common.lastSyncedNever",
	"dashboard.common.lastSyncedJustNow",
	"dashboard.common.lastSyncedMinutesAgo",
	"dashboard.common.lastSyncedHoursAgo",
	"dashboard.common.lastSyncedDaysAgo",
	"dashboard.pondSwitcher.labelNamed",
	"dashboard.pondSwitcher.listLabel",
	"dashboard.pondSwitcher.switching",
	"dashboard.pondSwitcher.switchFailed",
	"dashboard.home.welcome",
	"dashboard.home.monitoring",
	"dashboard.home.criticalTitle",
	"dashboard.home.durationDaysHours",
	"dashboard.home.fcrChartLabel",
	"dashboard.home.logFishCount",
	"dashboard.growth.noSamplesTitle",
	"dashboard.growth.chartSummary",
	"dashboard.growth.tableCaption",
	"dashboard.growth.history.emptyTitle",
	"dashboard.history.statsLabel",
	"dashboard.logSample.noBatchesTitle",
	"dashboard.logSample.formLabel",
	"dashboard.schedule.noDeviceTitle",
	"dashboard.notifications.filtersTierLabel",
	"dashboard.notifications.listLabel",
	"dashboard.audit.timelineLabel",
	"dashboard.harvest.calendar.eventsLabel",
	"dashboard.harvest.upcoming.listLabel",
	"nav.navLabel",
];

const en = flatten(load("en"));
const hil = flatten(load("hil"));

describe("dashboard strings exist in every locale", () => {
	it("covers all dashboard namespaces", () => {
		for (const namespace of NAMESPACES) {
			expect(
				Object.keys(en).filter((key) => key.startsWith(`${namespace}.`)).length,
				`no messages under ${namespace}`,
			).toBeGreaterThan(0);
		}
	});

	it("has the keys the dashboard pages render", () => {
		for (const key of REQUIRED) {
			expect(en[key], `en is missing ${key}`).toBeTruthy();
		}
	});

	it("keeps Hiligaynon in step with English for the dashboard namespaces", () => {
		for (const namespace of NAMESPACES) {
			const englishKeys = Object.keys(en).filter((key) => key.startsWith(`${namespace}.`));
			for (const key of englishKeys) {
				expect(hil[key], `hil is missing ${key}`).toBeTruthy();
				expect(placeholders(hil[key]), `hil placeholders differ for ${key}`).toEqual(
					placeholders(en[key]),
				);
			}
		}
	});

	// #316: the header prints "Last synced: 5 minutes ago". The sentence and the
	// plural both live in the catalogue so no locale inherits English word order.
	it("keeps the last-synced relative time in the catalogue with ICU plurals", () => {
		expect(en["dashboard.common.lastSynced"], "lastSynced must take {time}").toContain("{time}");
		for (const unit of ["Minutes", "Hours", "Days"]) {
			const key = `dashboard.common.lastSynced${unit}Ago`;
			expect(en[key], `en ${key} must use an ICU plural`).toContain("{count, plural,");
			expect(hil[key], `hil ${key} must use an ICU plural`).toContain("{count, plural,");
		}
	});
});

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			if (entry === "settings" && dir.includes("(dashboard)")) continue;
			walk(full, out);
		} else if (/\.(tsx|ts)$/.test(entry)) out.push(full);
	}
	return out;
}

const dashboardFiles = [
	...walk(join(webRoot, "app/[locale]/(dashboard)")),
	...walk(join(webRoot, "components/dashboard")),
	...walk(join(webRoot, "components/harvest")),
	join(webRoot, "components/sidebar.tsx"),
	join(webRoot, "components/bottom-nav.tsx"),
	join(webRoot, "components/header-actions.tsx"),
	join(webRoot, "components/pond-selector.tsx"),
	join(webRoot, "components/NotificationList.tsx"),
	join(webRoot, "components/FeedEventHistoryTable.tsx"),
].filter((file) => !file.includes(".test."));

/** Copy that used to be hard-coded in the dashboard and must stay translated. */
const RETIRED_LITERALS = [
	"Welcome Back!",
	"Monitoring <strong>",
	"Growth trend",
	"View Details",
	"Device offline for",
	"ESP32 node",
	"Western Visayas</strong>",
	"Pond Operator Menu",
	"No events in this range",
	"No feedings recorded yet",
	"No biomass samples recorded yet",
	"LAST SYNCED",
	"JUST NOW",
];

describe("the dashboard reads its copy from the catalogue", () => {
	it("scans the dashboard files", () => {
		expect(dashboardFiles.length).toBeGreaterThan(25);
	});

	it("no longer hard-codes retired English copy", () => {
		for (const file of dashboardFiles) {
			const content = readFileSync(file, "utf8");
			for (const literal of RETIRED_LITERALS) {
				expect(content.includes(literal), `${file} still contains "${literal}"`).toBe(false);
			}
		}
	});

	it("formats dates through lib/date-local, never toLocaleString", () => {
		for (const file of dashboardFiles) {
			const content = readFileSync(file, "utf8");
			expect(content.includes("toLocaleString("), `${file} uses toLocaleString`).toBe(false);
			expect(content.includes("toLocaleDateString("), `${file} uses toLocaleDateString`).toBe(
				false,
			);
		}
	});

	it("keeps the shared HarvestCalendar on the message catalogue", () => {
		const calendar = readFileSync(join(webRoot, "components/harvest/harvest-calendar.tsx"), "utf8");
		expect(calendar).toContain('useTranslations("dashboard.harvest")');
		expect(calendar).toContain("upcoming.listLabel");
		expect(calendar).toContain("calendar.eventsLabel");
	});

	it("keeps the header last-synced line and device status on the catalogue", () => {
		const header = readFileSync(join(webRoot, "components/header-actions.tsx"), "utf8");
		expect(header).toContain('useTranslations("dashboard.common")');
		expect(header).toContain('tCommon("lastSynced"');
		expect(header).toContain('tCommon("deviceOnline")');
		expect(header).toContain('tCommon("deviceOffline")');
		expect(header).toContain('tCommon("deviceMissing")');
	});
});
