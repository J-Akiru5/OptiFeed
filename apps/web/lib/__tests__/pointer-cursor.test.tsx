import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #244: clickable controls must show a hand cursor.
 *
 * Tailwind v4's preflight dropped the v3 `button { cursor: pointer }` rule, so
 * every plain button rendered the browser's default arrow. The login page's
 * "Back to Home" was reported, and it had a second problem: it was a `<button>`
 * calling `router.push("/")`, so it was not a link and could not be opened in a
 * new tab. These tests pin both halves of the fix: one base rule covers buttons
 * app-wide, and the login control is a real, locale-aware link to the home page.
 */

const cwd = process.cwd();
const webRoot = existsSync(join(cwd, "app", "globals.css")) ? cwd : join(cwd, "apps", "web");
const globalsCss = readFileSync(join(webRoot, "app", "globals.css"), "utf8");

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace),
		useLocale: () => "en",
	};
});

// The real `@/i18n/routing` re-exports next-intl's navigation, which resolves
// `next/navigation` through an ESM import vitest cannot load here. The mock
// therefore renders the `href` the page hands to the locale-aware `Link`
// verbatim; next-intl prefixes it with the active locale at runtime.
vi.mock("@/i18n/routing", () => ({
	Link: ({
		href,
		children,
		className,
	}: {
		href: string;
		children?: ReactNode;
		className?: string;
	}) => (
		<a href={href} className={className}>
			{children}
		</a>
	),
	useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
	usePathname: () => "/login",
}));

vi.mock("@/components/theme-provider", () => ({
	useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
	createClient: () => ({ auth: { getUser: vi.fn(async () => ({ data: { user: null } })) } }),
}));

vi.mock("@/lib/offline/db", () => ({ clearOfflineData: vi.fn() }));
vi.mock("@/lib/pwa/snapshot", () => ({ clearDashboardSnapshot: vi.fn() }));
vi.mock("@/lib/actions/auth", () => ({ loginWithPassword: vi.fn() }));

import LoginPage from "@/app/[locale]/login/page";

beforeEach(() => {
	// jsdom does not implement matchMedia; the page uses it to decide whether to
	// focus the farm-id field (mobile keyboards) on mount.
	window.matchMedia = vi.fn().mockImplementation((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		addListener: vi.fn(),
		removeListener: vi.fn(),
		dispatchEvent: vi.fn(),
	})) as unknown as typeof window.matchMedia;
	window.localStorage.clear();
});

describe("login 'Back to Home' (#244)", () => {
	it("renders as a link to the home route, not a button", () => {
		render(<LoginPage />);

		const links = screen.getAllByRole("link", { name: "Back to Home" });
		// One in the sign-in panel header (desktop) and one in the footer (mobile).
		expect(links).toHaveLength(2);
		for (const link of links) {
			// `/` is the home route; next-intl's Link prefixes the active locale.
			expect(link).toHaveAttribute("href", "/");
		}

		// The old control was a button, so no button may carry that label now.
		expect(screen.queryByRole("button", { name: "Back to Home" })).not.toBeInTheDocument();
	});

	it("leaves no router.push('/') control behind in the login page", () => {
		const pageSource = readFileSync(join(webRoot, "app/[locale]/login/page.tsx"), "utf8");

		expect(pageSource).not.toContain('router.push("/")');
		expect(pageSource.match(/<Link\s+href="\/"/g)).toHaveLength(2);
	});
});

describe("global pointer rule (#244)", () => {
	it("lives inside the base layer so per-element utilities still win", () => {
		const baseLayer = globalsCss.indexOf("@layer base {");
		const pointerRule = globalsCss.indexOf("button:not(:disabled)");

		expect(baseLayer).toBeGreaterThan(-1);
		expect(pointerRule).toBeGreaterThan(baseLayer);
		// The base layer closes before the unlayered list/card rules that must
		// beat Tailwind utilities (E2); the pointer rule has to precede that.
		expect(pointerRule).toBeLessThan(globalsCss.indexOf('[data-list-view="list"]'));
	});

	it("covers buttons, role=button, summary, label[for] and select", () => {
		expect(globalsCss).toContain("button:not(:disabled)");
		expect(globalsCss).toContain('[role="button"]:not([aria-disabled="true"])');
		expect(globalsCss).toMatch(/^\s*summary,$/m);
		expect(globalsCss).toMatch(/^\s*label\[for\],$/m);
		expect(globalsCss).toMatch(/^\s*select \{$/m);
	});

	it("shows not-allowed for disabled and aria-disabled controls", () => {
		expect(globalsCss).toMatch(
			/:disabled,\s*\n\s*\[aria-disabled="true"\] \{\s*\n\s*cursor: not-allowed;/,
		);
	});
});
