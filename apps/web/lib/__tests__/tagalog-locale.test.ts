import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Messages, mergeMessages } from "@/i18n/merge-messages";
import { formatDateTimeLocal } from "@/lib/date-local";
import { describe, expect, it } from "vitest";

/**
 * Tagalog locale behaviour (#327, I-104).
 *
 * The catalogue is complete and machine-drafted, but the locale still has to
 * behave like Filipino: `tl` must canonicalise to CLDR `fil` for dates,
 * numbers, relative times and plurals, and the overlay must fall back to
 * English if a key is later added to `en.json` before its translation lands.
 */

const messagesDir = join(__dirname, "../../messages");
const webRoot = join(__dirname, "../..");

type Tree = { [key: string]: string | Tree };

function load(locale: string): Tree {
	return JSON.parse(readFileSync(join(messagesDir, `${locale}.json`), "utf8"));
}

function flatten(tree: Tree, prefix = ""): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(tree)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (typeof value === "string") out[path] = value;
		else Object.assign(out, flatten(value, path));
	}
	return out;
}

const tl = flatten(load("tl"));

describe("Tagalog overlay fallback", () => {
	it("serves the English value for a key that is missing from Tagalog", () => {
		const english: Messages = { dashboard: { online: "Online", title: "Pond" } };
		const tagalog: Messages = { dashboard: { title: "Pond" } };
		expect(mergeMessages(english, tagalog)).toEqual({
			dashboard: { online: "Online", title: "Pond" },
		});
	});

	it("lets the Tagalog value win over English", () => {
		const merged = mergeMessages({ a: "Schedule" }, { a: "Iskedyul" });
		expect(merged).toEqual({ a: "Iskedyul" });
	});

	it("does not mutate the English base catalogue", () => {
		const english: Messages = { a: { b: "B" } };
		mergeMessages(english, { a: { c: "C" } });
		expect(english).toEqual({ a: { b: "B" } });
	});

	it("is wired into the request config for Tagalog only", () => {
		const request = readFileSync(join(webRoot, "i18n/request.ts"), "utf8");
		expect(request).toMatch(/locale === "tl"/);
		expect(request).toMatch(/mergeMessages\(/);
		expect(request).toMatch(/import\("\.\.\/messages\/tl\.json"\)/);
		// English and Hiligaynon stay standalone: they load their own file
		// through the dynamic import and never go through the merge.
		expect(request).toMatch(/messages\/\$\{locale\}\.json/);
	});
});

describe("Tagalog uses the Filipino (fil) CLDR locale", () => {
	it("canonicalises the tl subtag to fil", () => {
		expect(new Intl.DateTimeFormat("tl").resolvedOptions().locale).toBe("fil");
		expect(new Intl.NumberFormat("tl").resolvedOptions().locale).toBe("fil");
		expect(new Intl.PluralRules("tl").resolvedOptions().locale).toBe("fil");
	});

	it("groups and separates numbers the Filipino way", () => {
		const formatter = new Intl.NumberFormat("tl");
		expect(formatter.format(1234567.89)).toBe("1,234,567.89");
		expect(formatter.format(0.5)).toBe("0.5");
	});

	it("formats dates with Filipino month names", () => {
		const formatted = new Intl.DateTimeFormat("tl", {
			timeZone: "Asia/Manila",
			dateStyle: "long",
		}).format(new Date("2026-10-31T00:00:00Z"));
		expect(formatted).toContain("Oktubre");
	});

	it("keeps the catalogue's month and day labels equal to CLDR", () => {
		const months: Record<string, number> = {
			Jan: 0,
			Feb: 1,
			Mar: 2,
			Apr: 3,
			May: 4,
			Jun: 5,
			Jul: 6,
			Aug: 7,
			Sep: 8,
			Oct: 9,
			Nov: 10,
			Dec: 11,
		};
		const monthFormatter = new Intl.DateTimeFormat("fil", {
			month: "short",
			timeZone: "UTC",
		});
		for (const [key, index] of Object.entries(months)) {
			expect(tl[`dates.months.${key}`], `dates.months.${key}`).toBe(
				monthFormatter.format(new Date(Date.UTC(2026, index, 15))),
			);
		}

		const days: Record<string, number> = {
			Sun: 0,
			Mon: 1,
			Tue: 2,
			Wed: 3,
			Thu: 4,
			Fri: 5,
			Sat: 6,
		};
		const dayFormatter = new Intl.DateTimeFormat("fil", {
			weekday: "short",
			timeZone: "UTC",
		});
		// 1 November 2026 is a Sunday.
		for (const [key, offset] of Object.entries(days)) {
			expect(tl[`dates.days.${key}`], `dates.days.${key}`).toBe(
				dayFormatter.format(new Date(Date.UTC(2026, 10, 1 + offset))),
			);
		}
	});

	it("renders a farm wall-clock date with the Tagalog labels", () => {
		const tDates = (key: string) => tl[`dates.${key}`];
		// Wednesday 21 October 2026, 16:19 local time.
		const formatted = formatDateTimeLocal(new Date(2026, 9, 21, 16, 19), tDates);
		expect(formatted.date).toBe("Okt 21");
		expect(formatted.time).toBe("4:19 PM");
		expect(formatted.fullDate).toBe("Miy, Okt 21");
	});

	it("selects the Tagalog plural categories", () => {
		const rules = new Intl.PluralRules("tl");
		expect(rules.select(1)).toBe("one");
		expect(rules.select(2)).toBe("one");
		expect(rules.select(4)).toBe("other");
		expect(rules.select(0)).toBe("one");
	});

	it("formats relative time in Tagalog", () => {
		const formatter = new Intl.RelativeTimeFormat("tl");
		expect(formatter.format(-2, "day")).toMatch(/araw/);
		expect(formatter.format(-2, "day")).toMatch(/nakalipas/);
	});
});

describe("Tagalog draft labelling (#327)", () => {
	it("marks the language menu entry as Beta while drafts remain (#457)", () => {
		const switcher = readFileSync(join(webRoot, "components/locale-switcher.tsx"), "utf8");
		expect(switcher).toMatch(/tl: "Tagalog"/);
		expect(switcher).toMatch(/BETA_LOCALES: ReadonlySet<Locale> = new Set<Locale>\(\["tl"\]\)/);
		expect(switcher).toMatch(/Beta/);
	});

	it("offers Tagalog on the login page's compact locale toggle, labelled Beta", () => {
		const login = readFileSync(join(webRoot, "app/[locale]/login/page.tsx"), "utf8");
		expect(login).toMatch(/code: "tl", label: "TL", title: "Tagalog \(Beta\)"/);
	});
});
