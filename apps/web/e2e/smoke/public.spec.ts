import { type ConsoleMessage, type Page, expect, test } from "@playwright/test";

/**
 * Cross-browser smoke for the unauthenticated surface.
 *
 * The full suite (e2e/*.spec.ts) needs Supabase Auth and the production
 * `e2e-` fixture, so it stays on Chromium: tripling it would triple the
 * slowest, most rate-limit-sensitive part of CI. This spec is deliberately
 * narrow — every page here renders without a session — and runs on Chromium,
 * Firefox and WebKit so a rendering engine that cannot boot the app at all is
 * caught. See docs/compatibility.md for the split and the supported matrix.
 */

const PUBLIC_PAGES = [
	{ name: "landing", path: "/en", heading: "Know your pond is fed" },
	{ name: "login", path: "/en/login", heading: "Sign in to PakaonAI" },
	{ name: "privacy", path: "/en/privacy", heading: "Privacy Policy" },
	{ name: "terms", path: "/en/terms", heading: "Terms of Service" },
] as const;

const VIEWPORTS = [
	{ name: "phone", width: 390, height: 844 },
	{ name: "tablet", width: 834, height: 1112 },
	{ name: "desktop", width: 1440, height: 900 },
] as const;

/**
 * Console errors that are not application defects on a local or CI build:
 *
 * - Vercel Analytics / Speed Insights scripts are only served by the Vercel
 *   edge; off Vercel they 404 or are refused by the nosniff policy.
 * - The app ships a `Content-Security-Policy-Report-Only` without a
 *   `report-to` endpoint, so every browser logs the inline Next.js bootstrap
 *   script as a report-only violation. It is a report-only signal, not a
 *   blocked script; the enforced policy does not use it.
 *
 * The filter is narrow on purpose: any other console error fails the test.
 */
function isKnownPlatformNoise(message: ConsoleMessage): boolean {
	const text = message.text();
	const url = message.location().url ?? "";
	const fromVercelAssets = `${text} ${url}`.includes("/_vercel/");
	const reportOnlyCsp = /Report[- ]Only/i.test(text);
	return fromVercelAssets || reportOnlyCsp;
}

/** Attach listeners before navigation and return the collected defects. */
function collectRuntimeErrors(page: Page): string[] {
	const problems: string[] = [];
	page.on("pageerror", (error) => {
		problems.push(`uncaught exception: ${error.message}`);
	});
	page.on("console", (message) => {
		if (message.type() !== "error") return;
		if (isKnownPlatformNoise(message)) return;
		problems.push(`console.error: ${message.text()}`);
	});
	return problems;
}

async function openPublicPage(page: Page, path: string): Promise<void> {
	const response = await page.goto(path, { waitUntil: "networkidle" });
	expect(response?.status(), `${path} should return 200`).toBe(200);
	await expect(page.locator("h1")).toBeVisible();
}

/**
 * The page must not scroll sideways: `overflow-x-clip` sections and the
 * `overflow-x-auto` legal tables keep content inside the viewport. One pixel
 * of slack absorbs sub-pixel rounding differences between engines.
 */
async function expectNoHorizontalOverflow(page: Page, context: string): Promise<void> {
	const { scrollWidth, clientWidth } = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
	}));
	expect(
		scrollWidth,
		`${context} overflows horizontally (scrollWidth ${scrollWidth} > clientWidth ${clientWidth})`,
	).toBeLessThanOrEqual(clientWidth + 1);
}

test.describe("public pages render", () => {
	for (const { name, path, heading } of PUBLIC_PAGES) {
		test(`${name} renders without console errors`, async ({ page }) => {
			const problems = collectRuntimeErrors(page);
			await openPublicPage(page, path);

			await expect(page.getByRole("heading", { level: 1 })).toContainText(heading);
			await expect(page.locator("html")).toHaveAttribute("lang", "en");

			expect(problems, `runtime errors on ${path}:\n${problems.join("\n")}`).toEqual([]);
		});
	}
});

test.describe("responsive layout", () => {
	for (const viewport of VIEWPORTS) {
		for (const { name, path } of PUBLIC_PAGES) {
			test(`${name} at ${viewport.name} (${viewport.width}px)`, async ({ page }) => {
				await page.setViewportSize({ width: viewport.width, height: viewport.height });
				const problems = collectRuntimeErrors(page);
				await openPublicPage(page, path);

				const context = `${path} at ${viewport.width}px`;
				await expectNoHorizontalOverflow(page, context);

				if (name === "landing") {
					// The top-bar nav is lg-only; below that the menu button owns
					// the navigation and the language switcher moves into it.
					const topBarNav = page.locator("header > div > nav");
					const menuButton = page.locator('button[aria-controls="landing-mobile-menu"]');
					const headerLanguage = page
						.locator("header > div")
						.getByRole("button", { name: "Language: English" });
					const headerLogin = page.locator("header > div").getByRole("link", { name: "Sign in" });

					if (viewport.width >= 1024) {
						await expect(topBarNav, `${context}: top-bar nav`).toBeVisible();
						await expect(menuButton, `${context}: menu button`).toBeHidden();
						await expect(headerLanguage, `${context}: header language`).toBeVisible();
						await expect(headerLogin, `${context}: header sign in`).toBeVisible();
					} else {
						await expect(topBarNav, `${context}: top-bar nav`).toBeHidden();
						await expect(menuButton, `${context}: menu button`).toBeVisible();

						await menuButton.click();
						const mobileMenu = page.locator("#landing-mobile-menu");
						await expect(mobileMenu, `${context}: mobile menu`).toBeVisible();
						await expect(
							mobileMenu.getByRole("button", { name: "Language: English" }),
							`${context}: menu language`,
						).toBeVisible();
						await expect(
							mobileMenu.getByRole("link", { name: "Sign in" }),
							`${context}: menu sign in`,
						).toBeVisible();
						await page.keyboard.press("Escape");
						await expect(mobileMenu, `${context}: menu closes on Escape`).toBeHidden();

						if (viewport.width < 640) {
							// The header only exposes the switcher from `sm` up.
							await expect(headerLanguage, `${context}: header language`).toBeHidden();
							await expect(headerLogin, `${context}: header sign in`).toBeHidden();
						}
					}

					// Dashboard-like surface that is reachable without a session:
					// the hero's product preview. It must stay inside the viewport
					// (the overlap card is offset, not overflowing).
					const preview = page.locator("figure").first();
					await expect(preview, `${context}: dashboard preview`).toBeVisible();
					const box = await preview.boundingBox();
					expect(box, `${context}: dashboard preview has a box`).not.toBeNull();
					if (!box) throw new Error(`${context}: dashboard preview has no box`);
					expect(box.x, `${context}: preview left edge`).toBeGreaterThanOrEqual(0);
					expect(box.x + box.width, `${context}: preview right edge`).toBeLessThanOrEqual(
						viewport.width + 1,
					);
				}

				if (name === "login") {
					await expect(page.locator("#farmId"), `${context}: farm id field`).toBeVisible();
					await expect(page.locator("#password"), `${context}: password field`).toBeVisible();
					await expect(
						page.locator("main form").getByRole("button", { name: "Sign in" }),
						`${context}: submit`,
					).toBeVisible();

					// `Back to Home` is the header link from lg and the footer link
					// below it; exactly one of them may be on screen.
					const headerBack = page
						.locator("main > header")
						.getByRole("link", { name: "Back to Home" });
					const footerBack = page
						.locator("main > footer")
						.getByRole("link", { name: "Back to Home" });
					if (viewport.width >= 1024) {
						await expect(headerBack, `${context}: header back`).toBeVisible();
						await expect(footerBack, `${context}: footer back`).toBeHidden();
					} else {
						await expect(headerBack, `${context}: header back`).toBeHidden();
						await expect(footerBack, `${context}: footer back`).toBeVisible();
					}
				}

				if (name === "privacy" || name === "terms") {
					// The legal header always carries the switcher, and the section
					// tables scroll inside their own container instead of the page.
					await expect(
						page.locator("header").getByRole("button", { name: "Language: English" }),
						`${context}: legal language switcher`,
					).toBeVisible();

					const scrollers = page.locator(".overflow-x-auto");
					if ((await scrollers.count()) > 0) {
						const scroller = scrollers.first();
						await expect(scroller, `${context}: table scroller`).toBeVisible();
						const { overflowX, scrollWidth, clientWidth } = await scroller.evaluate((el) => ({
							overflowX: getComputedStyle(el).overflowX,
							scrollWidth: el.scrollWidth,
							clientWidth: el.clientWidth,
						}));
						expect(overflowX, `${context}: table scroller owns the scroll`).toBe("auto");
						if (viewport.width === 390) {
							// A 42rem-wide section table cannot fit a phone; it must
							// scroll inside this container instead of the page.
							expect(
								scrollWidth,
								`${context}: wide table scrolls inside its container`,
							).toBeGreaterThan(clientWidth);
						}
					}
				}

				expect(problems, `runtime errors on ${context}:\n${problems.join("\n")}`).toEqual([]);
			});
		}
	}
});

test.describe("language switch", () => {
	test("legal page switches to Hiligaynon and back", async ({ page }) => {
		const problems = collectRuntimeErrors(page);
		await openPublicPage(page, "/en/privacy");

		await page.getByRole("button", { name: "Language: English" }).click();
		await page.getByRole("menuitemradio", { name: "Hiligaynon" }).click();

		await expect(page).toHaveURL(/\/hil\/privacy$/);
		await expect(page.locator("html")).toHaveAttribute("lang", "hil");
		// `login.languageLabel` is translated for hil, so the trigger proves the
		// client bundle swapped locale, not just the URL.
		await expect(page.getByRole("button", { name: "Pulong: Hiligaynon" })).toBeVisible();

		await page.getByRole("button", { name: "Pulong: Hiligaynon" }).click();
		await page.getByRole("menuitemradio", { name: "English" }).click();

		await expect(page).toHaveURL(/\/en\/privacy$/);
		await expect(page.locator("html")).toHaveAttribute("lang", "en");

		expect(problems, `runtime errors during the switch:\n${problems.join("\n")}`).toEqual([]);
	});

	test("landing page switches to Tagalog", async ({ page }) => {
		const problems = collectRuntimeErrors(page);
		await openPublicPage(page, "/en");

		// The landing page renders the switcher twice (header and footer); the
		// header one is the primary control.
		await page.locator("header").getByRole("button", { name: "Language: English" }).click();
		await page.getByRole("menuitemradio", { name: "Tagalog" }).click();

		await expect(page).toHaveURL(/\/tl$/);
		await expect(page.locator("html")).toHaveAttribute("lang", "tl");
		// Tagalog landing copy falls back to English by design; the heading must
		// still render instead of a raw message key.
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

		expect(problems, `runtime errors during the switch:\n${problems.join("\n")}`).toEqual([]);
	});
});
