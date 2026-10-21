import { type Locator, type Page, expect, test } from "@playwright/test";

import { login } from "./helpers";

const VIEWPORTS = [
	{ width: 320, height: 640 },
	{ width: 375, height: 812 },
	{ width: 768, height: 1024 },
	{ width: 1280, height: 800 },
	{ width: 1920, height: 1080 },
];

// Settle time for the FAB cluster / chat panel 300ms transitions.
const TRANSITION_MS = 450;

function overlaps(
	a: Awaited<ReturnType<Locator["boundingBox"]>>,
	b: Awaited<ReturnType<Locator["boundingBox"]>>,
) {
	if (!a || !b) return false;
	return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

const chatFab = (page: Page) => page.locator('button[class*="ofd-fab-size"][aria-label*="chat" i]');
const helpFab = (page: Page) => page.getByRole("button", { name: "Start onboarding tour" });
const bottomNav = (page: Page) => page.locator('nav[class*="bottom-0"]');

test.describe("FAB cluster layout (workbench L1: no overlap)", () => {
	for (const vp of VIEWPORTS) {
		test(`chat closed: no FAB overlap at ${vp.width}px`, async ({ page }) => {
			await page.setViewportSize({ width: vp.width, height: vp.height });
			await login(page);

			const chat = chatFab(page);
			const help = helpFab(page);
			await expect(chat).toBeVisible();
			await expect(help).toBeVisible();

			expect(overlaps(await chat.boundingBox(), await help.boundingBox())).toBe(false);

			if (vp.width < 768) {
				const nav = bottomNav(page);
				await expect(nav).toBeVisible();
				expect(overlaps(await chat.boundingBox(), await nav.boundingBox())).toBe(false);
				expect(overlaps(await help.boundingBox(), await nav.boundingBox())).toBe(false);
			}
		});

		test(`chat open: cluster clears panel/sheet at ${vp.width}px`, async ({ page }) => {
			await page.setViewportSize({ width: vp.width, height: vp.height });
			await login(page);

			await chatFab(page).click();
			await page.waitForTimeout(TRANSITION_MS);

			if (vp.width < 768) {
				// The sheet owns the screen on mobile; the cluster hides.
				await expect(chatFab(page)).toBeHidden();
				await expect(helpFab(page)).toBeHidden();
			} else {
				const panel = page
					.locator("aside")
					.filter({ has: page.getByRole("button", { name: "Close chat" }) })
					.first();
				await expect(panel).toBeVisible();

				const chat = chatFab(page);
				const help = helpFab(page);
				await expect(chat).toBeVisible();
				await expect(help).toBeVisible();

				const panelBox = await panel.boundingBox();
				expect(overlaps(await chat.boundingBox(), panelBox)).toBe(false);
				expect(overlaps(await help.boundingBox(), panelBox)).toBe(false);
				expect(overlaps(await chat.boundingBox(), await help.boundingBox())).toBe(false);
			}
		});
	}
});
