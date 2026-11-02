import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Issue #518: Pakoy is reachable from every authenticated shell, not only the
 * farmer dashboard, and its role is still resolved on the server.
 *
 * These are source guards on purpose: the layouts are async server components
 * behind auth gates, so rendering them in a unit test would prove less than
 * reading the mount points the router actually uses.
 */

const webRoot = join(__dirname, "../..");

function read(path: string): string {
	return readFileSync(join(webRoot, path), "utf8");
}

const adminLayout = read("app/[locale]/(admin)/layout.tsx");
const superadminLayout = read("app/[locale]/(superadmin)/superadmin/layout.tsx");
const dashboardLayout = read("app/[locale]/(dashboard)/layout.tsx");

describe("Pakoy availability across shells", () => {
	it("mounts the widget with the tenant-admin role on /admin", () => {
		expect(adminLayout).toContain('from "@/components/chat/chat-widget"');
		expect(adminLayout).toContain('const assistantRole = "owner" as const;');
		expect(adminLayout).toContain("<ChatWidgetProvider role={assistantRole}>");
		expect(adminLayout).toContain("<ChatWidget />");
	});

	it("mounts the widget with the superadmin role on /superadmin", () => {
		expect(superadminLayout).toContain('from "@/components/chat/chat-widget"');
		expect(superadminLayout).toContain('const assistantRole = "superadmin" as const;');
		expect(superadminLayout).toContain("<ChatWidgetProvider role={assistantRole}>");
		expect(superadminLayout).toContain("<ChatWidget />");
	});

	it("keeps the role resolution server-side on the farmer dashboard", () => {
		expect(dashboardLayout).toContain(
			'isPlatformAdmin ? "superadmin" : isTenantAdmin ? "owner" : "farmer"',
		);
	});
});

describe("calendar colours are an assistant capability (#365)", () => {
	const catalog = read("lib/assistant/catalog/records.ts");

	it("accepts a #RRGGBB colour when adding and updating an item", () => {
		const colourChecks = catalog.match(/regex\(\/\^#\[0-9a-fA-F\]\{6\}\$\//g) ?? [];
		expect(colourChecks.length).toBeGreaterThanOrEqual(2);
		expect(catalog).toContain('color?: "#RRGGBB"');
	});

	it("forwards the colour to the calendar action", () => {
		expect(catalog).toContain('color: typeof payload.color === "string" ? payload.color : null');
		expect(catalog).toContain('typeof payload.color === "string" ? { color: payload.color } : {}');
	});

	it("tells the planner to pass a named colour instead of refusing", () => {
		const planner = read("lib/assistant/planner.ts");
		expect(planner).toContain("Calendar items accept an optional colour");
		expect(planner).toContain('never answer "I don\'t have access" when a matching tool exists');
	});
});
