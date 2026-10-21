import { type Page, expect, test } from "@playwright/test";

/**
 * Shared e2e login.
 *
 * The login endpoint is rate-limited to 5 attempts per 60s per IP
 * (lib/rate-limit.ts checkLoginRateLimit), so a 4-worker suite overruns the
 * window. When the limiter responds we wait out the fixed 60s window and
 * retry; other failures (e.g. latency under parallel logins) retry directly.
 */
export async function login(page: Page) {
	await page.addInitScript(() => localStorage.setItem("optifeed:onboarded", "true"));
	const pin = process.env.DEMO_PIN ?? "1234";
	// A single round can cost a full rate-limit window + attempt time.
	test.setTimeout(300_000);

	for (let attempt = 0; attempt < 4; attempt++) {
		await page.goto("/en/login");
		await page.locator("#farmId").fill("demo-farmer-1");
		await page.locator("#pin").fill(pin);
		await page.locator('button[type="submit"]').click();
		try {
			await expect(page).toHaveURL(/dashboard/, { timeout: 30_000 });
			return;
		} catch {
			const rateLimited = await page
				.getByText(/Too many requests/i)
				.isVisible()
				.catch(() => false);
			if (rateLimited) {
				// Fixed 60s window — wait for it to roll over, then retry.
				await page.waitForTimeout(61_000);
			}
		}
	}
	throw new Error("login failed after retries (rate limiter or server not accepting logins)");
}
