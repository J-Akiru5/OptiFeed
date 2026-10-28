import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Calendar parity (E25): the farmer, tenant-admin and platform calendars are
 * one workspace. These guards read the sources so a future refactor cannot
 * silently reintroduce a second header, a second chip style or a divergent
 * view list.
 */

const webRoot = join(__dirname, "../..");
const read = (path: string) => readFileSync(join(webRoot, path), "utf8");

const PAGES = {
	farmer: "app/[locale]/(dashboard)/dashboard/calendar/page.tsx",
	admin: "app/[locale]/(admin)/admin/calendar/page.tsx",
	platform: "app/[locale]/(superadmin)/superadmin/calendar/page.tsx",
} as const;

describe("calendar parity", () => {
	it("uses the shared type-filter chips on both calendar families", () => {
		expect(read("components/harvest/harvest-calendar.tsx")).toContain("CalendarTypeFilters");
		expect(read("components/superadmin/platform-calendar.tsx")).toContain("CalendarTypeFilters");
	});

	it("lets the platform calendar inherit the shared view defaults", () => {
		const platform = read("components/superadmin/platform-calendar.tsx");
		expect(platform).not.toMatch(/toolbarViews=/);
		expect(platform).not.toMatch(/defaultView=/);
	});

	it("renders exactly one page heading per route", () => {
		// The console page owns the h1; the embedded calendar hides its own.
		expect(read(PAGES.farmer)).toContain("showHeader={false}");
		expect(read(PAGES.admin)).toContain("showHeader={false}");
		// The platform calendar never rendered an in-body heading.
		expect(read("components/superadmin/platform-calendar.tsx")).not.toContain("<h1");
	});

	it("shows the same capability badge on every calendar console", () => {
		for (const page of Object.values(PAGES)) {
			expect(read(page), page).toContain("CalendarCapabilityBadge");
		}
	});

	it("keeps one definition of the filter-chip sizing", () => {
		const controls = read("components/harvest/calendar-controls.tsx");
		expect(controls).toContain("min-h-11");
		expect(controls).toContain("text-[10px]");
		// The platform calendar must not define its own smaller chip size.
		expect(read("components/superadmin/platform-calendar.tsx")).not.toContain("min-h-9");
	});
});
