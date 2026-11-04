import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Issue #572: the dashboard bar claimed `position: sticky` and never stuck.
 *
 * The shell is a fixed-height app frame (`h-dvh` + `overflow-hidden`) and
 * `#main-content` is its only scroller, so the bar is pinned by sitting outside
 * the scroller — `sticky` never engaged. This is a CSS/layout fix: the header
 * is plain markup in the server layout, with no client wrapper and no scroll
 * listener, so the shared dashboard chunk does not grow. These checks lock
 * that contract, the box-stable separator, the height the control room and
 * calendar budgets subtract, and the phone safe-area/bottom-bar geometry.
 */

const webRoot = join(__dirname, "../..");
const read = (relative: string) => readFileSync(join(webRoot, relative), "utf8");

const layoutSource = read("app/[locale]/(dashboard)/layout.tsx");
const mobileHeaderSource = read("components/mobile/mobile-header.tsx");
const darkModeToggleSource = read("components/dark-mode-toggle.tsx");
const pondSelectorSource = read("components/pond-selector.tsx");
const bottomNavSource = read("components/bottom-nav.tsx");
const globalsCss = read("app/globals.css");

/** The dashboard bar's opening tag, exactly as the server renders it. */
const HEADER_OPEN =
	'<header className="z-30 w-full shrink-0 bg-[#0A3D62] shadow-[inset_0_-1px_0_rgba(255,255,255,0.14)]">';

/** Strip comments: explaining the old sticky claim is fine, making it is not. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");

describe("the dashboard bar is pinned by the shell, not by sticky (#572)", () => {
	it("stops claiming a sticky position", () => {
		expect(code(layoutSource)).not.toContain("sticky");
		expect(code(layoutSource)).not.toContain("<DashboardTopBar");
		expect(layoutSource).toContain(HEADER_OPEN);
	});

	it("keeps the pane as the shell's only scroll container", () => {
		expect(layoutSource).toContain("flex h-dvh flex-col overflow-hidden");
		expect(layoutSource).toContain(
			"ofd-main ofd-main-room relative z-10 min-h-0 min-w-0 flex-1 overflow-y-auto",
		);
	});

	it("keeps the height the control room and calendar already budget for", () => {
		// 64 px is load-bearing: the control-room height and the calendar shell
		// both subtract it. Growing the bar is a shell change, not a sticky fix.
		expect(layoutSource).toContain("h-16 w-full items-center justify-between");
		expect(globalsCss).toContain("--ofd-topbar-h: 4rem;");
	});
});

describe("the bar stays CSS-only so the shared dashboard chunk does not grow (#572)", () => {
	it("renders the header in the server layout, not through a client wrapper", () => {
		// The layout is a server component; a client wrapper here is what added
		// ~0.6 kB to every dashboard route and tripped the shared chunk budget.
		expect(layoutSource).not.toContain('"use client"');
		expect(layoutSource).not.toMatch(/<header className=\{/);
	});

	it("separates with an inset shadow instead of a border that changes height", () => {
		const header = layoutSource.match(/<header className="([^"]+)"/)?.[1] ?? "";
		expect(header).toContain("shadow-[inset_0_-1px_0_rgba(255,255,255,0.14)]");
		expect(header).not.toContain("shadow-md");
		expect(header).not.toMatch(/(^|\s)border(-\S+)?(\s|$)/);
	});
});

describe("phone geometry keeps the notch inset and clears the bottom bar (#572)", () => {
	it("pads the mobile band for the device inset", () => {
		expect(mobileHeaderSource).toContain("pt-[env(safe-area-inset-top)]");
	});

	it("leaves the fixed bottom layer to the bottom bar", () => {
		expect(code(layoutSource)).not.toContain("bottom-0");
		expect(bottomNavSource).toContain("fixed right-0 bottom-0 left-0 z-40");
		expect(bottomNavSource).toContain("lg:hidden");
	});

	it("reserves the bottom bar plus its inset in the content pane", () => {
		// #880: the floating monitoring HUD sits in the same band, so the pane
		// reserves its height as well as the bar's.
		const mainRule = /\.ofd-main \{[^}]*\}/.exec(globalsCss)?.[0] ?? "";
		expect(mainRule).toContain("var(--ofd-bottom-nav-h)");
		expect(mainRule).toContain("var(--ofd-hud-h)");
		expect(mainRule).toContain("env(safe-area-inset-bottom)");
	});
});

/**
 * The band's controls are the only header a phone gets. Before this, the theme
 * switch lived solely in the desktop row, which is `display: none` below `lg`,
 * so the toggle rendered at 0 px and a farmer could not change the mode at all.
 */
describe("the mobile band carries reachable, uniformly sized controls", () => {
	it("keeps the farmer band to search, notifications and the account control", () => {
		// The theme switch is still supported by the band, but the farmer band
		// hands it to the account menu so the bar does not grow a fourth control.
		expect(layoutSource).toContain('<MobileHeader shell="farmer" showTheme={false}>');
		expect(mobileHeaderSource).toContain(
			"{showTheme ? <DarkModeToggle className={BAND_PILL} /> : null}",
		);
		expect(mobileHeaderSource).toContain(
			'import { DarkModeToggle } from "@/components/dark-mode-toggle"',
		);
	});

	it("moves help and the theme switch into the account menu", () => {
		const headerActions = read("components/header-actions.tsx");
		const compact = headerActions.slice(
			headerActions.indexOf("export function CompactHeaderActions"),
		);
		// The bar itself is the bell and the avatar; help left the bar entirely.
		const bar = compact.slice(0, compact.indexOf("<ProfileMenu"));
		expect(bar).toContain("<NotificationBell");
		expect(bar).not.toContain("<HelpButton");
		// Both live in the menu, which is what the band opens.
		expect(compact).toContain("showTheme");
		expect(compact).toContain("helpAudience={helpEnabled ?");
		expect(headerActions).toContain('{tAccount("appearance")}');
		expect(headerActions).toContain('{tAccount("help")}');
	});

	it("folds the notification filters away on phones", () => {
		const page = read("app/[locale]/(dashboard)/dashboard/notifications/page.tsx");
		// A native details/summary keeps the disclosure keyboard-operable and
		// costs no client component; desktop keeps the chips inline.
		expect(page).toContain("<details");
		expect(page).toContain('{t("filtersToggle")}');
		expect(page).toContain('className="hidden lg:block">{filterLinks}</div>');
	});

	it("gives every icon control the same 44 px pill", () => {
		const pill = /const BAND_PILL =\s*\n?\s*"([^"]+)"/.exec(mobileHeaderSource)?.[1] ?? "";
		expect(pill).toContain("h-11 w-11");
		expect(pill).toContain("rounded-full");
	});

	it("is a contextual app bar: brand on destinations, back and title below them", () => {
		const routeInfo = read("components/mobile/use-page-title.ts");
		// Destinations are an explicit list, so a detail route can never render the
		// brand where a back arrow belongs.
		expect(routeInfo).toContain("useMobileRouteInfo");
		expect(routeInfo).toContain("TOP_LEVEL");
		expect(mobileHeaderSource).toContain("ChevronLeft");
		expect(mobileHeaderSource).toContain('t("back")');
		expect(mobileHeaderSource).toContain("router.back()");
		// Search is an action that opens the search sheet, not a permanent field.
		expect(mobileHeaderSource).toContain('<SearchTrigger variant="icon"');
		expect(mobileHeaderSource).not.toContain('variant="field"');
	});

	it("accepts the pill without losing the desktop size or the label", () => {
		// The desktop and superadmin rows render the toggle with no className, so
		// the default 36 px square has to stay the base of the merge.
		expect(darkModeToggleSource).toContain("className={cn(");
		expect(darkModeToggleSource).toContain("flex h-9 w-9");
		// The label names the action and is translated (en/hil/tl).
		expect(darkModeToggleSource).toContain("aria-label={label}");
		expect(darkModeToggleSource).toContain('t("themeToLight")');
		expect(darkModeToggleSource).toContain('t("themeToDark")');
	});

	it("gives the pond switcher a 44 px target instead of its text height", () => {
		// It measured 16 px tall: the widest tap target in the band and the
		// smallest hit area, which is backwards.
		expect(pondSelectorSource).toContain("inline-flex min-h-11 max-w-[14rem]");
	});
});
