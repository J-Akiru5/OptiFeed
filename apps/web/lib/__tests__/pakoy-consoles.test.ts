import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #518 Pakoy in the consoles.
 *
 * The assistant already exists as one role-aware widget; the tenant-admin and
 * platform-admin shells simply never mounted it. These checks keep the one
 * implementation and prove both consoles render it with the right role.
 *
 * A platform admin without a tenant membership has no farm login for the chat
 * API (`withAuth`), so the platform widget is gated on `hasFarmDashboard`.
 * The platform-only context is recorded in the plan, not faked here.
 */

const webRoot = join(__dirname, "../..");

function layout(path: string): string {
	return readFileSync(join(webRoot, path), "utf8");
}

describe("Pakoy in the tenant-admin and platform-admin consoles (#518)", () => {
	it("mounts the owner-role widget on the tenant-admin shell", () => {
		const source = layout("app/[locale]/(admin)/layout.tsx");

		expect(source).toContain('<ChatWidgetProvider assistantRole="owner">');
		expect(source).toContain("<FabStack />");
		expect(source).toContain("<ChatWidget />");
		expect(source.match(/<ChatWidgetProvider/g)).toHaveLength(1);
	});

	it("mounts the superadmin-role widget on the platform shell", () => {
		const source = layout("app/[locale]/(superadmin)/superadmin/layout.tsx");

		expect(source).toContain('<ChatWidgetProvider assistantRole="superadmin">');
		expect(source).toContain("<FabStack />");
		expect(source).toContain("<ChatWidget />");
		expect(source.match(/<ChatWidgetProvider/g)).toHaveLength(1);
	});

	it("gates the platform widget on a farm context instead of showing a broken API", () => {
		const source = layout("app/[locale]/(superadmin)/superadmin/layout.tsx");

		expect(source).toContain("{hasFarmDashboard && (");
		expect(source).toContain("</ChatWidgetProvider>");
	});

	it("keeps the farmer dashboard widget and its role resolution", () => {
		const source = layout("app/[locale]/(dashboard)/layout.tsx");

		expect(source).toContain("<ChatWidgetProvider");
		expect(source).toContain("<FabStack />");
		expect(source).toContain("<ChatWidget />");
	});
});
