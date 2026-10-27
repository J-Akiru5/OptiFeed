import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Guards the mobile redesign (E26).
 *
 * Three things must not regress: the five-tab bottom bar and its active state,
 * the quick menu's role-aware items (the only way a farmer reaches the pages
 * the bar dropped), and the status strip's counts and filters. The last block
 * pins every `data-help` / `data-onboard` target the help centre and the tour
 * highlight, so a layout rewrite cannot silently remove one.
 */

const { pathname } = vi.hoisted(() => ({ pathname: { current: "/dashboard" } }));

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("@/i18n/routing", async () => {
	const react = await import("react");
	return {
		Link: ({
			href,
			children,
			...rest
		}: {
			href: string | { pathname?: string };
			children?: React.ReactNode;
		} & Record<string, unknown>) =>
			react.createElement(
				"a",
				{ href: typeof href === "string" ? href : (href?.pathname ?? "#"), ...rest },
				children,
			),
		usePathname: () => pathname.current,
	};
});

import { AdminBottomNav } from "@/components/admin-bottom-nav";
import { BottomNav } from "@/components/bottom-nav";
import { ListChips } from "@/components/mobile/list-chips";
import { QuickMenu, quickMenuSections } from "@/components/mobile/quick-menu";
import { StatusStrip } from "@/components/mobile/status-strip";
import { pageTitleKey } from "@/components/mobile/use-page-title";
import {
	deviceListStatus,
	filterByStatus,
	orderRows,
	parseAttention,
	parseDeviceStatusFilter,
	parseListOrder,
	pondListStatus,
	summarizeStatuses,
} from "@/lib/mobile-list";
import { createTranslator } from "./helpers/messages";

const tMobile = createTranslator("dashboard.mobile") as unknown as (key: string) => string;
const tNavFarmer = createTranslator("nav") as unknown as (key: string) => string;
const tNavAdmin = createTranslator("dashboard.adminShell.nav") as unknown as (
	key: string,
) => string;
const tNavPlatform = createTranslator("superadmin.shell.nav") as unknown as (key: string) => string;

describe("farmer bottom bar (E26)", () => {
	beforeEach(() => {
		pathname.current = "/dashboard";
	});

	it("renders exactly five tabs and marks the active one", () => {
		const html = renderToStaticMarkup(<BottomNav />);

		expect(html.split("<a ").length - 1).toBe(5);
		expect(html.split('aria-current="page"').length - 1).toBe(1);

		for (const label of ["Overview", "Schedule", "Biomass Log", "Alerts", "Me"]) {
			expect(html).toContain(`>${label}<`);
		}
		// The bar clears the device safe area and never shows on desktop.
		expect(html).toContain("env(safe-area-inset-bottom)");
		expect(html).toContain("lg:hidden");
	});

	it("keeps the bar out of the way of the page content padding token", () => {
		// `.ofd-main` and the bar share one height token, so content is never
		// hidden behind the bar (see app/globals.css).
		expect(readFileSync(join(__dirname, "../../app/globals.css"), "utf8")).toContain(
			"calc(var(--ofd-bottom-nav-h) + env(safe-area-inset-bottom)",
		);
	});

	it("marks whichever tab the reader is on", () => {
		pathname.current = "/dashboard/schedule";
		const html = renderToStaticMarkup(<BottomNav />);
		const active = html.match(/<a [^>]*aria-current="page"[^>]*>/)?.[0] ?? "";
		expect(active).toContain('href="/dashboard/schedule"');
	});
});

describe("console bottom bars keep every destination", () => {
	it("admin bar keeps four primary sections plus More, at 44 px or more", () => {
		pathname.current = "/admin/ponds";
		const html = renderToStaticMarkup(<AdminBottomNav />);

		expect(html.split("<a ").length - 1).toBe(4);
		expect(html.split('data-mobile-trigger="more"').length - 1).toBe(1);
		expect(html.split("min-h-14").length - 1).toBeGreaterThanOrEqual(5);

		const active = html.match(/<a [^>]*aria-current="page"[^>]*>/)?.[0] ?? "";
		expect(active).toContain('href="/admin/ponds"');
	});

	it("admin More lists every remaining section", () => {
		pathname.current = "/admin/ponds";
		render(<AdminBottomNav />);
		fireEvent.click(screen.getByRole("button", { name: "More sections" }));

		expect(screen.getByRole("dialog", { name: "Quick menu" })).toBeTruthy();
		for (const label of [
			"Overview",
			"Calendar",
			"Users",
			"Ponds",
			"Devices",
			"Hierarchy",
			"Audit log",
			"Settings",
		]) {
			expect(screen.getAllByText(label).length).toBeGreaterThan(0);
		}
	});
});

describe("quick menu (E26)", () => {
	it("offers the admin quick actions in the tenant console", () => {
		const sections = quickMenuSections({
			shell: "admin",
			isTenantAdmin: true,
			t: tMobile,
			nav: tNavAdmin,
		});
		const actions = sections[0].items;

		expect(actions.map((item) => item.id)).toEqual(["add-pond", "add-feeder", "scan-sticker"]);
		expect(actions.map((item) => item.href)).toEqual([
			"/admin/ponds/new",
			"/admin/devices#add-feeder",
			"/admin/devices#add-feeder",
		]);
	});

	it("hides pond and feeder creation from a plain farmer", () => {
		const sections = quickMenuSections({
			shell: "farmer",
			isTenantAdmin: false,
			t: tMobile,
			nav: tNavFarmer,
		});
		const ids = sections.flatMap((section) => section.items.map((item) => item.id));

		expect(ids).not.toContain("add-pond");
		expect(ids).not.toContain("add-feeder");
		expect(ids).toContain("log-sample");
		expect(ids).toContain("pond-location");
	});

	it("keeps every page the five-tab bar dropped reachable", () => {
		const sections = quickMenuSections({
			shell: "farmer",
			isTenantAdmin: false,
			t: tMobile,
			nav: tNavFarmer,
		});
		const hrefs = sections
			.flatMap((section) => section.items.map((item) => item.href))
			.filter((href) => href.startsWith("/dashboard"));

		for (const href of [
			"/dashboard/history",
			"/dashboard/growth",
			"/dashboard/harvest",
			"/dashboard/audit",
			"/dashboard/settings",
		]) {
			expect(hrefs).toContain(href);
		}
	});

	it("registers feeders from the platform console", () => {
		const sections = quickMenuSections({
			shell: "platform",
			isTenantAdmin: false,
			t: tMobile,
			nav: tNavPlatform,
		});
		expect(sections[0].items[0]?.href).toBe("/superadmin/devices#register-device");
		const hrefs = sections[1].items.map((item) => item.href);
		for (const href of [
			"/superadmin",
			"/superadmin/calendar",
			"/superadmin/users",
			"/superadmin/orgs",
			"/superadmin/ponds",
			"/superadmin/devices",
			"/superadmin/operations",
			"/superadmin/ai-providers",
			"/superadmin/settings",
		]) {
			expect(hrefs).toContain(href);
		}
	});

	it("opens a searchable sheet and filters the items", () => {
		render(<QuickMenu shell="admin" isTenantAdmin trigger="plus" />);
		fireEvent.click(screen.getByRole("button", { name: "Quick actions" }));

		const dialog = screen.getByRole("dialog", { name: "Quick menu" });
		expect(dialog).toBeTruthy();
		expect(screen.getByText("Add pond")).toBeTruthy();

		fireEvent.change(screen.getByLabelText("Search pages and actions"), {
			target: { value: "feeder" },
		});
		expect(screen.queryByText("Add pond")).toBeNull();
		expect(screen.getByText("Add feeder")).toBeTruthy();
	});
});

describe("status strip and chips (E26)", () => {
	const counts = { all: 7, online: 4, alarm: 1, offline: 2 };
	const labels = { all: "All", online: "Online", alarm: "Alarm", offline: "Offline" };

	it("shows every count and links each tile to its filter", () => {
		const html = renderToStaticMarkup(
			<StatusStrip
				counts={counts}
				active="online"
				basePath="/admin/devices"
				params={{ order: "name" }}
				label="Filter by device status"
				labels={labels}
			/>,
		);

		expect(html).toContain(">7<");
		expect(html).toContain(">4<");
		expect(html).toContain(">1<");
		expect(html).toContain(">2<");
		expect(html).toContain('href="/admin/devices?order=name&amp;status=online"');
		expect(html).toContain('href="/admin/devices?order=name"');
		expect(html.split('aria-current="page"').length - 1).toBe(1);
	});

	it("offers ordering and a needs-attention filter", () => {
		const html = renderToStaticMarkup(
			<ListChips
				basePath="/admin/devices"
				params={{ status: "alarm" }}
				order="name"
				attention
				labels={{
					order: "Order",
					newest: "Newest",
					name: "Name",
					status: "Status",
					attention: "Needs attention",
					hint: "Ordering and filters apply to the items on this page.",
				}}
			/>,
		);

		expect(html).toContain('href="/admin/devices?status=alarm&amp;order=name"');
		expect(html).toContain('href="/admin/devices?status=alarm&amp;order=newest"');
		expect(html).toContain("Needs attention");
		expect(html).toContain("Ordering and filters apply to the items on this page.");
	});
});

describe("list grading helpers", () => {
	const now = new Date("2026-10-27T12:00:00.000Z");
	const minutesAgo = (minutes: number) =>
		new Date(now.getTime() - minutes * 60 * 1000).toISOString();

	it("treats a stale reading as offline even when the level is healthy", () => {
		expect(deviceListStatus({ lastSeenAt: minutesAgo(120), feedLevelPercent: 82 }, now)).toBe(
			"offline",
		);
		expect(deviceListStatus({ lastSeenAt: null, feedLevelPercent: 82 }, now)).toBe("offline");
	});

	it("raises an alarm for a live feeder with a low hopper", () => {
		expect(deviceListStatus({ lastSeenAt: minutesAgo(2), feedLevelPercent: 12 }, now)).toBe(
			"alarm",
		);
		expect(deviceListStatus({ lastSeenAt: minutesAgo(2), feedLevelPercent: 40 }, now)).toBe(
			"online",
		);
	});

	it("keeps a pending registration out of the online count", () => {
		expect(
			deviceListStatus(
				{ lastSeenAt: minutesAgo(1), feedLevelPercent: 50, approvalStatus: "PENDING" },
				now,
			),
		).toBe("offline");
	});

	it("grades a pond by its feeders", () => {
		expect(pondListStatus([], now)).toBe("offline");
		expect(
			pondListStatus(
				[
					{ lastSeenAt: minutesAgo(1), feedLevelPercent: 60 },
					{ lastSeenAt: minutesAgo(1), feedLevelPercent: 10 },
				],
				now,
			),
		).toBe("alarm");
		expect(pondListStatus([{ lastSeenAt: minutesAgo(1), feedLevelPercent: 60 }], now)).toBe(
			"online",
		);
		expect(pondListStatus([{ lastSeenAt: minutesAgo(1), feedLevelPercent: 60 }], now, true)).toBe(
			"offline",
		);
	});

	it("counts, filters and orders without changing the fetched rows", () => {
		const rows = [
			{ id: "b", name: "Beta", status: "online" as const },
			{ id: "c", name: "alpha", status: "offline" as const },
			{ id: "a", name: "Gamma", status: "alarm" as const },
		];
		const statusOf = (row: (typeof rows)[number]) => row.status;

		expect(summarizeStatuses(rows.map(statusOf))).toEqual({
			all: 3,
			online: 1,
			alarm: 1,
			offline: 1,
		});
		expect(filterByStatus(rows, "online", statusOf).map((row) => row.id)).toEqual(["b"]);
		expect(filterByStatus(rows, "all", statusOf)).toHaveLength(3);
		expect(orderRows(rows, "name", (row) => row, "en").map((row) => row.id)).toEqual([
			"c",
			"b",
			"a",
		]);
		expect(orderRows(rows, "status", (row) => row, "en").map((row) => row.id)).toEqual([
			"a",
			"c",
			"b",
		]);
		expect(orderRows(rows, "newest", (row) => row, "en")).toBe(rows);
	});

	it("only accepts the filter values the UI offers", () => {
		expect(parseDeviceStatusFilter("alarm")).toBe("alarm");
		expect(parseDeviceStatusFilter(["offline"])).toBe("offline");
		expect(parseDeviceStatusFilter("bogus")).toBe("all");
		expect(parseDeviceStatusFilter(undefined)).toBe("all");
		expect(parseListOrder("name")).toBe("name");
		expect(parseListOrder("bogus")).toBe("newest");
		expect(parseAttention("1")).toBe(true);
		expect(parseAttention(undefined)).toBe(false);
	});
});

describe("header band titles", () => {
	it("resolves the longest matching route for each shell", () => {
		expect(pageTitleKey("farmer", "/dashboard/settings/pond")).toBe("settings");
		expect(pageTitleKey("farmer", "/dashboard/schedule")).toBe("schedule");
		expect(pageTitleKey("admin", "/admin/ponds/new")).toBe("ponds");
		expect(pageTitleKey("admin", "/admin/settings/members/u1/permissions")).toBe("settings");
		expect(pageTitleKey("platform", "/superadmin/ai-providers")).toBe("aiProviders");
		expect(pageTitleKey("platform", "/superadmin")).toBe("overview");
		expect(pageTitleKey("farmer", "/elsewhere")).toBe("");
	});
});

describe("help and tour targets survive the mobile rewrite", () => {
	const webRoot = join(__dirname, "../..");
	const SKIP = new Set(["node_modules", ".next", "test-results", "playwright-report"]);

	function walk(dir: string, out: string[] = []): string[] {
		for (const entry of readdirSync(dir)) {
			if (SKIP.has(entry)) continue;
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) walk(full, out);
			else if (/\.(tsx|ts)$/.test(entry)) out.push(full);
		}
		return out;
	}

	const sources = [
		...walk(join(webRoot, "app")),
		...walk(join(webRoot, "components")),
		...walk(join(webRoot, "lib")),
	]
		.filter((file) => !file.includes("__tests__") && !file.includes(".test."))
		.map((file) => readFileSync(file, "utf8"))
		.join("\n");

	/** Every target the help guides and the tour pointed at on develop. */
	const HELP_TARGETS = [
		"admin-devices-list",
		"admin-invite-member",
		"admin-members-list",
		"admin-permissions-link",
		"ai-advisor",
		"biomass-batches",
		"biomass-form",
		"calibration-form",
		"dashboard-biomass-log",
		"dashboard-export",
		"dashboard-feed-log",
		"dashboard-hopper",
		"dashboard-water-temp",
		"device-token",
		"export-data",
		"fcr",
		"fcr-calculator",
		"feed-now",
		"growth-charts",
		"growth-history",
		"growth-plan",
		"harvest-add-event",
		"harvest-calendar",
		"harvest-cycle",
		"help-button",
		"help-sheet",
		"history-charts",
		"history-event-log",
		"history-import",
		"hopper-calibration",
		"next-feeding",
		"notification-prefs",
		"pond-settings-form",
		"print-label",
		"profile-password",
		"recalibration-interval",
		"schedule-calibration",
		"schedule-controls",
		"schedule-editor",
		"schedule-save",
		"settings-cards",
		"settings-farm-name",
		"superadmin-ai-providers",
		"superadmin-create-org",
		"superadmin-new-user",
		"superadmin-org-members",
		"superadmin-page-size",
		"superadmin-print-sticker",
		"superadmin-register-device",
		"superadmin-remote-feed",
		"superadmin-rotate-token",
		"superadmin-search",
		"superadmin-user-actions",
		"superadmin-view-as",
	];

	const ONBOARD_TARGETS = ["fcr", "feed-now", "next-feeding"];

	it("keeps every data-help target", () => {
		const missing = HELP_TARGETS.filter((target) => !sources.includes(`data-help="${target}"`));
		expect(missing).toEqual([]);
	});

	it("keeps every data-onboard target", () => {
		for (const target of ONBOARD_TARGETS) {
			expect(sources.includes(`data-onboard="${target}"`)).toBe(true);
		}
		// The Settings tour step is data-driven from the sidebar entry.
		expect(sources.includes('onboard: "settings"')).toBe(true);
	});
});
