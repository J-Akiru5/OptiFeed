import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the tenant admin console copy.
 *
 * Every page in `app/[locale]/(admin)` and the admin-only components must take
 * its user-visible strings from the message catalogue, and the Hiligaynon
 * draft must keep the same keys and placeholders as English. A page that
 * hard-codes "Device Management" again fails the second block below.
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
	"dashboard.adminShell",
	"dashboard.adminCommon",
	"dashboard.adminOverview",
	"dashboard.adminUsers",
	"dashboard.adminDevices",
	"dashboard.adminPonds",
	"dashboard.adminCreatePond",
	"dashboard.adminPondForm",
	"dashboard.adminPondDetail",
	"dashboard.adminPondDelete",
	"dashboard.adminHierarchy",
	"dashboard.adminCalendar",
	"dashboard.adminAudit",
	"dashboard.adminSettings",
	"dashboard.adminError",
	"dashboard.adminMembers",
];

/** Page-specific keys that must exist in both locales. */
const REQUIRED = [
	"dashboard.adminUsers.title",
	"dashboard.adminUsers.emptyTitle",
	"dashboard.adminDevices.title",
	"dashboard.adminDevices.emptyTitle",
	"dashboard.adminDevices.columnLastSeen",
	"dashboard.adminPonds.title",
	"dashboard.adminCreatePond.submit",
	"dashboard.adminHierarchy.title",
	"dashboard.adminCalendar.readOnly",
	"dashboard.adminAudit.title",
	"dashboard.adminSettings.title",
	"dashboard.adminError.retry",
	"dashboard.adminShell.nav.settings",
];

const en = flatten(load("en"));
const hil = flatten(load("hil"));

describe("admin console strings exist in every locale", () => {
	it("covers all console namespaces", () => {
		for (const namespace of NAMESPACES) {
			expect(
				Object.keys(en).filter((key) => key.startsWith(`${namespace}.`)).length,
				`no messages under ${namespace}`,
			).toBeGreaterThan(0);
		}
	});

	it("has the page keys the console renders", () => {
		for (const key of REQUIRED) {
			expect(en[key], `en is missing ${key}`).toBeTruthy();
		}
	});

	it("keeps Hiligaynon in step with English for the console namespaces", () => {
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
});

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) walk(full, out);
		else if (/\.(tsx|ts)$/.test(entry)) out.push(full);
	}
	return out;
}

// The physical sticker is English only by design (guarded by its own test).
const ENGLISH_ONLY = new Set(["device-label-sheet.tsx", "device-sticker.tsx"]);

const consoleFiles = [
	...walk(join(webRoot, "app/[locale]/(admin)")),
	...walk(join(webRoot, "components/admin")).filter(
		(file) => !ENGLISH_ONLY.has(file.split(/[\\/]/).pop() ?? ""),
	),
	join(webRoot, "components/admin-sidebar.tsx"),
	join(webRoot, "components/admin-bottom-nav.tsx"),
].filter((file) => !file.includes(".test."));

/** Copy that used to be hard-coded in the console and must stay translated. */
const RETIRED_LITERALS = [
	"Device Management",
	"User Management",
	"Pond Management",
	"System Settings",
	"Farm Hierarchy",
	"Recent Activity",
	"No devices registered yet",
	"No ponds registered yet",
	"No users in this organization yet",
	"Last Seen",
	"Farmers are registered from",
	"Configuration coming in future update",
];

describe("the admin console reads its copy from the catalogue", () => {
	it("scans the console files", () => {
		expect(consoleFiles.length).toBeGreaterThan(15);
	});

	it("no longer hard-codes retired English copy", () => {
		for (const file of consoleFiles) {
			const content = readFileSync(file, "utf8");
			for (const literal of RETIRED_LITERALS) {
				expect(content.includes(literal), `${file} still contains "${literal}"`).toBe(false);
			}
		}
	});
});
