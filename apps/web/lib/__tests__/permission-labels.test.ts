import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * #189 regression guard.
 *
 * The permission editor renders `dashboard.adminUsers.permission.<name>` for
 * every entry in `PERMISSIONS`. A missing translation silently shows the raw
 * key (`dashboard.adminUsers.permission.manage_crop_cycle`), so this test
 * asserts every permission has a non-empty label in both shipped locales.
 */

vi.mock("@/lib/prisma", () => ({
	default: {
		membership: { findMany: vi.fn() },
		organization: { findMany: vi.fn() },
		membershipPermission: { findMany: vi.fn() },
	},
}));

vi.mock("@/lib/auth/session", () => ({
	getCurrentUser: vi.fn(),
	assertPasswordChanged: vi.fn().mockResolvedValue(undefined),
}));

import { PERMISSIONS } from "@/lib/auth/permissions";

function permissionLabels(locale: "en" | "hil"): Record<string, string> {
	const raw = JSON.parse(
		readFileSync(join(__dirname, "../../messages", `${locale}.json`), "utf8"),
	) as {
		dashboard?: { adminUsers?: { permission?: Record<string, string> } };
	};
	return raw.dashboard?.adminUsers?.permission ?? {};
}

describe.each(["en", "hil"] as const)("permission labels (%s)", (locale) => {
	it("has a non-empty label for every known permission", () => {
		const labels = permissionLabels(locale);
		const missing = PERMISSIONS.filter((permission) => {
			const label = labels[permission];
			return typeof label !== "string" || label.trim() === "";
		});

		expect(missing).toEqual([]);
	});
});
