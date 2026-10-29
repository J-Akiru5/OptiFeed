import { type Locator, type Page, expect, test } from "@playwright/test";

import { login } from "./helpers";

/**
 * Responsive checks for the authenticated dashboard.
 *
 * This is the dashboard half of the compatibility criterion (ISO 25010):
 * phone/tablet/desktop keep their layout, and the floating chat control never
 * leaves the viewport or sits on top of the mobile bottom navigation. It runs
 * in the authenticated suite, so it is Chromium-only and needs the `e2e-`
 * fixture; the public half (all three engines) is e2e/smoke/public.spec.ts.
 */
const VIEWPORTS = [
	{ name: "phone", width: 390, height: 844 },
	{ name: "tablet", width: 834, height: 1112 },
	{ name: "desktop", width: 1440, height: 900 },
] as const;

const chatToggle = (page: Page) =>
	page.locator('button[class*="ofd-fab-size"][aria-label*="chat" i]');
const bottomNav = (page: Page) => page.locator('nav[class*="bottom-0"]');

function overlaps(
	a: Awaited<ReturnType<Locator["boundingBox"]>>,
	b: Awaited<ReturnType<Locator["boundingBox"]>>,
): boolean {
	if (!a || !b) return false;
	return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

test.describe("dashboard responsive layout", () => {
	for (const viewport of VIEWPORTS) {
		test(`dashboard keeps its layout at ${viewport.name} (${viewport.width}px)`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: viewport.width, height: viewport.height });
			await login(page);
			await expect(page).toHaveURL(/\/dashboard/);

			const context = `/dashboard at ${viewport.width}px`;

			// No sideways page scroll. The shell clips horizontals on purpose
			// (`overflow-x-clip`), so a regression here is a layout defect.
			const { scrollWidth, clientWidth } = await page.evaluate(() => ({
				scrollWidth: document.documentElement.scrollWidth,
				clientWidth: document.documentElement.clientWidth,
			}));
			expect(
				scrollWidth,
				`${context}: page overflows horizontally (scrollWidth ${scrollWidth} > clientWidth ${clientWidth})`,
			).toBeLessThanOrEqual(clientWidth + 1);

			const toggle = chatToggle(page);
			await expect(toggle, `${context}: chat toggle`).toBeVisible();
			const toggleBox = await toggle.boundingBox();
			if (!toggleBox) throw new Error(`${context}: chat toggle has no box`);
			expect(toggleBox.x, `${context}: chat toggle left edge`).toBeGreaterThanOrEqual(0);
			expect(
				toggleBox.x + toggleBox.width,
				`${context}: chat toggle right edge`,
			).toBeLessThanOrEqual(viewport.width + 1);
			expect(
				toggleBox.y + toggleBox.height,
				`${context}: chat toggle bottom edge`,
			).toBeLessThanOrEqual(viewport.height + 1);

			const nav = bottomNav(page);
			if (viewport.width < 1024) {
				await expect(nav, `${context}: bottom nav`).toBeVisible();
				// --ofd-fab-anchor lifts the toggle above the bar; they must not
				// share pixels at any of the canonical widths.
				expect(
					overlaps(toggleBox, await nav.boundingBox()),
					`${context}: chat toggle overlaps the bottom nav`,
				).toBe(false);
			} else {
				await expect(nav, `${context}: bottom nav`).toBeHidden();
			}
		});
	}
});
