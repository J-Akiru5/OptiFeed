import { type Page, expect, test } from "@playwright/test";

import { login } from "./helpers";

/** Collects URLs of POSTs (server-action calls) to routes containing `pathPart`. */
function trackActionPosts(page: Page, pathPart: string) {
	const urls: string[] = [];
	page.on("request", (req) => {
		if (req.method() === "POST" && req.url().includes(pathPart)) {
			urls.push(req.url());
		}
	});
	return urls;
}

test.describe("Paginated search tables (regression: no action spam)", () => {
	for (const [route, placeholder] of [
		["/en/dashboard/growth", /Search by date/i],
		["/en/dashboard/history", /Filter by source/i],
	] as const) {
		test(`idle page issues no repeated server actions: ${route}`, async ({ page }) => {
			await login(page);
			await page.goto(route);
			await expect(page.getByPlaceholder(placeholder)).toBeVisible({ timeout: 15_000 });

			const posts = trackActionPosts(page, route);
			// Settle first (a stray initial call is tolerated), then watch an idle window.
			await page.waitForTimeout(1_500);
			posts.length = 0;
			await page.waitForTimeout(3_500);
			// The bug spammed an identical action ~every 400ms; ≤1 allows a
			// legitimate one-off refresh without letting a loop back in.
			expect(posts.length).toBeLessThanOrEqual(1);
		});

		test(`typing a search fires exactly one debounced action: ${route}`, async ({ page }) => {
			await login(page);
			await page.goto(route);
			const input = page.getByPlaceholder(placeholder);
			await expect(input).toBeVisible({ timeout: 15_000 });

			const posts = trackActionPosts(page, route);
			await page.waitForTimeout(1_000);
			posts.length = 0;

			await input.fill("2026-10-01");
			await page.waitForTimeout(1_500);
			expect(posts.length).toBe(1);
		});
	}

	test("growth tables have no horizontal scrollbar on desktop", async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await login(page);
		await page.goto("/en/dashboard/growth");

		const biomass = page
			.locator("div.overflow-x-auto")
			.filter({ has: page.getByRole("columnheader", { name: "ABW" }) })
			.first();
		const summary = page
			.locator("div.overflow-x-auto")
			.filter({ has: page.getByRole("columnheader", { name: "Avg Weight" }) })
			.first();
		await expect(biomass).toBeVisible({ timeout: 15_000 });
		await expect(summary).toBeVisible({ timeout: 15_000 });

		for (const size of [
			{ width: 1280, height: 800 },
			{ width: 1440, height: 900 },
			{ width: 1920, height: 1080 },
		]) {
			await page.setViewportSize(size);
			await page.waitForTimeout(300);
			for (const [name, table] of [
				["biomass", biomass],
				["summary", summary],
			] as const) {
				const overflow = await table.evaluate((el) => el.scrollWidth - el.clientWidth);
				expect(
					overflow,
					`${name} table horizontal overflow at ${size.width}px`,
				).toBeLessThanOrEqual(1);
			}
		}
	});
});
