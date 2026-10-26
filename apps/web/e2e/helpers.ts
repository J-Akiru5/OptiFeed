import { loadEnvFile } from "node:process";
import { type Page, expect, test } from "@playwright/test";
import {
	E2E_DEVICE_LABEL,
	E2E_DEVICE_MACS,
	E2E_LOGIN_IDS,
	E2E_ORG,
	E2E_POND,
	E2E_REGISTERED_DEVICE_LABEL,
	type E2eLoginRole,
	requireE2ePassword,
} from "../scripts/e2e/guards";

// Playwright does not read .env on its own; workers start in apps/web.
try {
	loadEnvFile(".env");
} catch {
	// The ambient environment may already hold every variable.
}

/** Fixture identifiers the specs share. All are reserved e2e- data. */
export const E2E = {
	orgId: E2E_ORG.id,
	orgName: E2E_ORG.name,
	pondId: E2E_POND.id,
	pondName: E2E_POND.name,
	farmerLogin: E2E_LOGIN_IDS.farmer,
	adminLogin: E2E_LOGIN_IDS.admin,
	platformLogin: E2E_LOGIN_IDS.platform,
	deviceMac: E2E_DEVICE_MACS[0],
	deviceLabel: E2E_DEVICE_LABEL,
	registerMac: E2E_DEVICE_MACS[1],
	registerLabel: E2E_REGISTERED_DEVICE_LABEL,
} as const;

const LANDING: Record<E2eLoginRole, RegExp> = {
	farmer: /\/dashboard/,
	admin: /\/dashboard/,
	platform: /\/superadmin/,
};

/** Setup SSID derived from a MAC (mirrors lib/provisioning-ap.ts). */
export function provisioningSsid(mac: string): string {
	let hex = (mac.match(/[0-9a-fA-F]/g) ?? []).join("").toUpperCase();
	while (hex.length < 4) hex = `0${hex}`;
	return `PakaonAI-${hex.slice(-4)}`;
}

/**
 * Shared e2e login using the isolated e2e- accounts.
 *
 * The login endpoint is rate-limited to 5 attempts per 60s per IP
 * (lib/rate-limit.ts checkLoginRateLimit), so a multi-worker suite overruns the
 * window. When the limiter responds we wait out the fixed 60s window and
 * retry; other failures (e.g. latency under parallel logins) retry directly.
 */
export async function login(page: Page, role: E2eLoginRole = "farmer"): Promise<void> {
	const password = requireE2ePassword();
	const loginId = E2E_LOGIN_IDS[role];
	const landing = LANDING[role];
	await page.addInitScript(() => localStorage.setItem("optifeed:onboarded", "true"));
	// A single round can cost a full rate-limit window + attempt time.
	test.setTimeout(300_000);

	const alreadySignedIn = async () =>
		landing.test(page.url()) && (await page.locator("#farmId").count()) === 0;

	if (await alreadySignedIn()) return;

	for (let attempt = 0; attempt < 4; attempt++) {
		await page.goto("/en/login");
		if (await alreadySignedIn()) return;

		await page.locator("#farmId").fill(loginId);
		await page.locator("#password").fill(password);
		await page.locator('button[type="submit"]').click();
		try {
			await expect(page).toHaveURL(landing, { timeout: 30_000 });
			await expect(page.locator("#farmId")).toHaveCount(0);
			return;
		} catch {
			const rateLimited = await page
				.getByText(/Too many (requests|attempts)/i)
				.isVisible()
				.catch(() => false);
			if (rateLimited) {
				// Fixed 60s window — wait for it to roll over, then retry.
				await page.waitForTimeout(61_000);
			}
		}
	}
	throw new Error(
		`login failed for ${loginId} after retries (rate limiter, missing seed or server not accepting logins)`,
	);
}

/**
 * Complete the step-up password dialog when it appears, and report whether it
 * did. A fresh 5-minute cookie means the dialog legitimately does not show.
 */
export async function completeStepUpIfPrompted(page: Page): Promise<boolean> {
	const input = page.locator("#stepup-password");
	const visible = await input
		.waitFor({ state: "visible", timeout: 15_000 })
		.then(() => true)
		.catch(() => false);
	if (!visible) return false;

	await input.fill(requireE2ePassword());
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(input)
		.toBeHidden({ timeout: 30_000 })
		.catch(() => undefined);
	return true;
}
