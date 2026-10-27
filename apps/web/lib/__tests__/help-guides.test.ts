import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
	HELP_SECTIONS,
	currentSectionIds,
	helpKeys,
	helpTargets,
	sectionsFor,
} from "@/lib/help/guides";
import { itemRoute, matchesRoute } from "@/lib/help/types";
import { describe, expect, it } from "vitest";

/**
 * The help centre's integrity checks.
 *
 * The sheet is only useful if every "Show me" points at a control that exists,
 * and a control anchored for help is explained somewhere. Both directions are
 * checked against the source, so a renamed button fails a test instead of
 * quietly breaking a step.
 */

const ROOTS = ["app", "components"];
const WEB_ROOT = process.cwd();
const CHROME_ANCHORS = new Set(["help-button", "help-sheet"]);
const ANCHOR_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function sourceFiles(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const entries = readdirSync(dir, { withFileTypes: true });
	return entries.flatMap((entry) => {
		if (entry.isDirectory()) {
			if (entry.name.startsWith(".") || entry.name === "node_modules") return [];
			return sourceFiles(join(dir, entry.name));
		}
		return /\.(ts|tsx)$/.test(entry.name) ? [join(dir, entry.name)] : [];
	});
}

let sourceAnchors: Map<string, string[]> | null = null;

/** Every anchor written in `app/` or `components/`, with the files that carry it. */
function anchorsInSource(): Map<string, string[]> {
	if (sourceAnchors) return sourceAnchors;
	const found = new Map<string, string[]>();
	for (const root of ROOTS) {
		for (const file of sourceFiles(join(WEB_ROOT, root))) {
			const text = readFileSync(file, "utf8");
			for (const match of text.matchAll(/data-help="([a-z0-9-]+)"/g)) {
				const anchor = match[1];
				if (!anchor) continue;
				const relative = file.replace(WEB_ROOT, "").replace(/\\/g, "/");
				found.set(anchor, [...(found.get(anchor) ?? []), relative]);
			}
		}
	}
	sourceAnchors = found;
	return found;
}

function loadMessages(locale: "en" | "hil"): Record<string, unknown> {
	return JSON.parse(readFileSync(join(WEB_ROOT, "messages", `${locale}.json`), "utf8")) as Record<
		string,
		unknown
	>;
}

function resolve(messages: Record<string, unknown>, key: string): string | undefined {
	const value = key.split(".").reduce<unknown>((node, part) => {
		if (typeof node !== "object" || node === null) return undefined;
		return (node as Record<string, unknown>)[part];
	}, messages.help);
	return typeof value === "string" ? value : undefined;
}

describe("help guides", () => {
	it("gives every section an id, roles, routes, copy and at least one item", () => {
		for (const section of HELP_SECTIONS) {
			expect(section.id, "a section has no id").toBeTruthy();
			expect(section.roles.length, `${section.id} has no role`).toBeGreaterThan(0);
			expect(section.routes.length, `${section.id} has no route`).toBeGreaterThan(0);
			expect(section.items.length, `${section.id} has no items`).toBeGreaterThan(0);
			for (const item of section.items) {
				expect(item.text, `${section.id} has an item with no text key`).toMatch(/^items\./);
			}
		}
	});

	it("keeps section ids unique", () => {
		const ids = HELP_SECTIONS.map((section) => section.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("points every target at a control that exists in app/ or components/", () => {
		const inSource = anchorsInSource();
		for (const target of helpTargets()) {
			expect(inSource.has(target), `no data-help="${target}" anywhere in app/ or components/`).toBe(
				true,
			);
		}
	});

	it("leaves no data-help attribute that no guide explains", () => {
		const explained = new Set(helpTargets());
		for (const [anchor, files] of anchorsInSource()) {
			if (CHROME_ANCHORS.has(anchor)) continue;
			expect(
				explained.has(anchor),
				`data-help="${anchor}" in ${files.join(", ")} is in no guide`,
			).toBe(true);
		}
	});

	it("uses anchor-shaped names only, because they reach a CSS selector", () => {
		for (const target of helpTargets()) {
			expect(target).toMatch(ANCHOR_PATTERN);
		}
	});

	it("knows the route of every item that points at a control", () => {
		for (const section of HELP_SECTIONS) {
			for (const item of section.items) {
				if (!item.target) continue;
				const route = itemRoute(section, item);
				expect(route, `${section.id} points at ${item.target} with no route`).toBeTruthy();
				expect(route).toMatch(/^\//);
			}
		}
	});

	it("has copy for every key in both locales", () => {
		for (const locale of ["en", "hil"] as const) {
			const messages = loadMessages(locale);
			for (const key of helpKeys()) {
				const value = resolve(messages, key);
				expect(value, `${locale}: help.${key} is missing`).toBeTruthy();
				expect(value?.trim().length, `${locale}: help.${key} is empty`).toBeGreaterThan(0);
			}
		}
	});

	it("has the sheet's own words in both locales", () => {
		for (const locale of ["en", "hil"] as const) {
			const messages = loadMessages(locale);
			for (const key of [
				"button",
				"title",
				"subtitle",
				"close",
				"showMe",
				"missing",
				"onThisPage",
				"takeTour",
				"more",
			]) {
				expect(resolve(messages, key), `${locale}: help.${key} is missing`).toBeTruthy();
			}
		}
	});
});

describe("which sections a role sees", () => {
	it("shows a farmer only the farmer sections", () => {
		const ids = sectionsFor("farmer", "/dashboard").map((section) => section.id);
		expect(ids).toContain("dashboard");
		expect(ids).not.toContain("admin.devices");
		expect(ids).not.toContain("superadmin.users");
	});

	it("shows an owner the farmer and admin sections, never the platform console", () => {
		const ids = sectionsFor("owner", "/admin/settings").map((section) => section.id);
		expect(ids).toContain("admin.members");
		expect(ids).toContain("dashboard");
		expect(ids).not.toContain("superadmin.devices");
	});

	it("shows a superadmin the platform sections", () => {
		const ids = sectionsFor("superadmin", "/superadmin/devices").map((section) => section.id);
		expect(ids).toContain("superadmin.devices");
		expect(ids).not.toContain("dashboard");
	});

	it("puts the sections for the current page first", () => {
		const sections = sectionsFor("owner", "/admin/settings");
		expect(sections.slice(0, 2).map((section) => section.id)).toEqual([
			"admin.members",
			"admin.settings",
		]);
	});

	it("reports every section that is about the current page", () => {
		expect(currentSectionIds("owner", "/admin/settings")).toEqual([
			"admin.members",
			"admin.settings",
		]);
		expect(currentSectionIds("farmer", "/dashboard/settings/hardware")).toEqual(["settings"]);
		expect(currentSectionIds("farmer", "/dashboard/schedule")).toEqual(["schedule"]);
	});

	it("treats a record under a route as part of it, but not a different route", () => {
		expect(matchesRoute("/superadmin/users/u-1", "/superadmin/users")).toBe(true);
		expect(matchesRoute("/superadmin/users-old", "/superadmin/users")).toBe(false);
	});
});
