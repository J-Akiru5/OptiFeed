import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The wiki mirror is generated from the repository, so it cannot invent a
 * second source of truth. These tests pin the properties that keep it honest:
 * every page carries the source commit banner, the sidebar links every page,
 * and every repository link points at a file that actually exists.
 */

import { buildWiki } from "../../../../scripts/docs/build-wiki.mjs";

const ROOT = resolve(__dirname, "../../../..");
const SHA = "0123456789abcdef0123456789abcdef01234567";
const outDir = mkdtempSync(join(tmpdir(), "optifeed-wiki-"));

afterAll(() => {
	rmSync(outDir, { recursive: true, force: true });
});

buildWiki({ outDir, sha: SHA, date: "2026-11-02", root: ROOT });

const page = (name: string) => readFileSync(join(outDir, name), "utf8");

describe("generated wiki", () => {
	it("writes the navigation pages and the pinned header", () => {
		for (const name of [
			"Home.md",
			"Plan.md",
			"Decisions.md",
			"Missions.md",
			"Deployment.md",
			"Quality.md",
			"_Sidebar.md",
			"_Footer.md",
		]) {
			expect(existsSync(join(outDir, name)), name).toBe(true);
		}

		expect(page("Home.md")).toContain("Generated mirror — do not edit this page");
		expect(page("Home.md")).toContain("docs/README.md");
		expect(page("Home.md")).toContain(SHA);
		expect(page("_Footer.md")).toContain("do not edit this page");
	});

	it("links every page from the sidebar", () => {
		const sidebar = page("_Sidebar.md");
		for (const name of ["Home", "Plan", "Decisions", "Missions", "Deployment", "Quality"]) {
			expect(sidebar, name).toContain(`(${name})`);
		}
	});

	it("lists every decision and mission from the repository", () => {
		const adrs = readdirSync(join(ROOT, "docs/adr")).filter(
			(name) => name.endsWith(".md") && name !== "README.md" && name !== "template.md",
		);
		for (const name of adrs) expect(page("Decisions.md"), name).toContain(name);

		const missions = readdirSync(join(ROOT, "docs/missions")).filter((name) =>
			name.endsWith(".md"),
		);
		for (const name of missions) expect(page("Missions.md"), name).toContain(name);
	});

	it("only links repository paths that exist", () => {
		const link = /https:\/\/github\.com\/J-Akiru5\/OptiFeed\/blob\/[0-9a-f]+\/([^)\s]+)/g;
		const missing: string[] = [];

		for (const name of [
			"Home.md",
			"Plan.md",
			"Decisions.md",
			"Missions.md",
			"Deployment.md",
			"Quality.md",
		]) {
			for (const match of page(name).matchAll(link)) {
				const path = match[1]
					.split("/")
					.map((segment) => decodeURIComponent(segment))
					.join("/");
				if (!existsSync(join(ROOT, path))) missing.push(`${name}: ${path}`);
			}
		}

		expect(missing).toEqual([]);
	});
});
