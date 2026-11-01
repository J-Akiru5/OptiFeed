import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the platform (superadmin) console copy (T-10).
 *
 * Every page in `app/[locale]/(superadmin)`, every superadmin component and
 * both navigation shells must take user-visible strings from the message
 * catalogue. The Hiligaynon draft must keep the same keys and placeholders as
 * English, and the retired English copy must not creep back into the JSX.
 *
 * The physical device sticker is English only by design and lives under
 * `components/admin`, outside this scan.
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

const en = flatten(load("en"));
const hil = flatten(load("hil"));

/** Sub-namespaces the console renders, one per page or shared surface. */
const NAMESPACES = [
	"superadmin.common",
	"superadmin.roles",
	"superadmin.orgTypes",
	"superadmin.orgStatuses",
	"superadmin.pondStatuses",
	"superadmin.permissions",
	"superadmin.shell",
	"superadmin.loading",
	"superadmin.error",
	"superadmin.overview",
	"superadmin.users",
	"superadmin.userActions",
	"superadmin.stepUp",
	"superadmin.viewAs",
	"superadmin.viewAsBanner",
	"superadmin.orgs",
	"superadmin.orgDetail",
	"superadmin.orgMembers",
	"superadmin.ponds",
	"superadmin.calendar",
	"superadmin.devices",
	"superadmin.registerDevice",
	"superadmin.rotateToken",
	"superadmin.tokenOnce",
	"superadmin.remoteFeeder",
	"superadmin.createOrg",
	"superadmin.newAccount",
	"superadmin.aiProviders",
	"superadmin.operations",
];

/** Page-specific keys that must exist in both locales. */
const REQUIRED = [
	"superadmin.overview.title",
	"superadmin.users.title",
	"superadmin.users.emptyTitle",
	"superadmin.userActions.titles.grant",
	"superadmin.stepUp.title",
	"superadmin.viewAs.button",
	"superadmin.viewAsBanner.exit",
	"superadmin.orgs.manageMembers",
	"superadmin.orgMembers.invite",
	"superadmin.ponds.title",
	"superadmin.calendar.title",
	"superadmin.calendar.filters.orgsLabel",
	"superadmin.devices.printSelected",
	"superadmin.registerDevice.button",
	"superadmin.rotateToken.button",
	"superadmin.tokenOnce.title",
	"superadmin.remoteFeeder.refused",
	"superadmin.createOrg.submit",
	"superadmin.newAccount.submit",
	"superadmin.aiProviders.reset",
	"superadmin.shell.nav.organizations",
	"superadmin.shell.shortNav.organizations",
	"superadmin.shell.groups.commandCenter",
	"superadmin.shell.groups.platformControl",
	"superadmin.shell.scope.global",
	"superadmin.shell.scope.organization",
	"superadmin.shell.nav.operations",
	"superadmin.shell.shortNav.operations",
	"superadmin.operations.health.title",
	"superadmin.operations.audit.title",
	"superadmin.operations.announcements.title",
	"superadmin.error.retry",
	"superadmin.loading.message",
];

describe("superadmin console strings exist in every locale", () => {
	it("covers every console namespace", () => {
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
			expect(hil[key], `hil is missing ${key}`).toBeTruthy();
		}
	});

	it("keeps Hiligaynon in step with English for the whole superadmin namespace", () => {
		const englishKeys = Object.keys(en).filter((key) => key.startsWith("superadmin."));
		expect(englishKeys.length).toBeGreaterThan(200);
		for (const key of englishKeys) {
			expect(hil[key], `hil is missing ${key}`).toBeTruthy();
			expect(placeholders(hil[key]), `hil placeholders differ for ${key}`).toEqual(
				placeholders(en[key]),
			);
		}
	});

	it("does not leave English-only keys in Hiligaynon", () => {
		for (const key of Object.keys(hil).filter((key) => key.startsWith("superadmin."))) {
			expect(en[key], `en is missing hil key ${key}`).toBeTruthy();
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

/**
 * Presentational files that receive every string as a prop, or that hold only
 * classes and design tokens. `dialog-theme.ts` has no copy of its own (#321);
 * it is still scanned for retired literals and hard-coded attributes.
 * `scope-banner.tsx` takes its crumb labels and its accessible name as props
 * from the layout banner and the organization page, which translate them.
 */
const PROPS_ONLY = new Set([
	"ui.tsx",
	"dialog-shell.tsx",
	"list-chrome.tsx",
	"dialog-theme.ts",
	"scope-banner.tsx",
]);

const consoleFiles = [
	...walk(join(webRoot, "app/[locale]/(superadmin)")),
	...walk(join(webRoot, "components/superadmin")),
	join(webRoot, "components/superadmin-sidebar.tsx"),
	join(webRoot, "components/superadmin-bottom-nav.tsx"),
].filter((file) => !file.includes(".test."));

/** Copy that used to be hard-coded in the console and must stay translated. */
const RETIRED_LITERALS = [
	"Platform Overview",
	"Scope of this console",
	"All Users",
	"New Account",
	"No users registered.",
	"No organization",
	"No organizations yet.",
	"No ponds registered.",
	"No devices registered yet.",
	"Clear search",
	"Manage members",
	"Print selected stickers",
	"Print sticker",
	"Rotate token",
	"Remote control",
	"Invite member",
	"Confirm revoke",
	"Create Organization",
	"Reset to Defaults",
	"Reset chain",
	"Sign Out",
	"Back to Dashboard",
	"Platform Console",
	"Try again",
	"Confirm your password",
	"Loading the platform console",
	"Grant platform access",
	"Disable account",
	"Read-only view as",
	"God-mode member management",
	"Search users by farm ID",
	"Key detected",
	"using built-in default",
	"Saved. The audit log has one new membership row.",
	"I have set it on the unit",
	"Enter it as",
	"Every write is disabled.",
	"Reason must be at least",
];

describe("the superadmin console reads its copy from the catalogue", () => {
	it("scans the console files", () => {
		expect(consoleFiles.length).toBeGreaterThan(18);
	});

	it("no longer hard-codes retired English copy", () => {
		for (const file of consoleFiles) {
			const content = readFileSync(file, "utf8");
			for (const literal of RETIRED_LITERALS) {
				expect(content.includes(literal), `${file} still contains "${literal}"`).toBe(false);
			}
		}
	});

	it("has no hard-coded English text in aria-label, placeholder or title attributes", () => {
		const hardCoded = /(?:aria-label|placeholder|title)="[A-Za-z][^"]*"/;
		for (const file of consoleFiles) {
			const content = readFileSync(file, "utf8");
			expect(hardCoded.test(content), `${file} has a hard-coded English attribute`).toBe(false);
		}
	});

	it("reads copy through next-intl, except the prop-only primitives", () => {
		for (const file of consoleFiles) {
			const name = file.split(/[\\/]/).pop() ?? "";
			if (PROPS_ONLY.has(name)) continue;
			// The create-account route only fetches options and renders the form.
			if (file.endsWith(join("users", "create", "page.tsx"))) continue;
			const content = readFileSync(file, "utf8");
			expect(content, `${file} does not import next-intl`).toMatch(/from "next-intl(?:\/server)?"/);
		}
	});
});
