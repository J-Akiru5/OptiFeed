import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

import { E2E, login } from "./helpers";

/**
 * Release-critical QA flows.
 *
 * These are proposed additions; they are not a replacement for the existing
 * specs. They run against the isolated e2e- fixture and are deliberately
 * serial, like the rest of the authenticated suite.
 *
 * Flow 4 writes one Notification through the real ingest route, asserts the
 * exact user-visible text, then removes the rows it created. No real feeder is
 * contacted: the e2e device token is the seeded fake unit.
 */

const prisma = new PrismaClient();

test.describe("QA release-critical flows", () => {
	test.afterAll(async () => {
		await prisma.$disconnect();
	});

	test("01 — a farmer signs in and a protected URL requires a session", async ({ page }) => {
		await page.goto("/en/dashboard");
		await expect(page).toHaveURL(/\/en\/login/);

		await login(page);

		await expect(page).toHaveURL(/\/en\/dashboard/);
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
	});

	test("02 — a schedule change is saved and survives a reload", async ({ page }) => {
		await login(page);
		await page.goto("/en/dashboard/schedule");

		// The responsive schedule page can expose the same editor slot more than
		// once before hydration settles; scope every operation to the first
		// visible editor rather than matching two nodes.
		const feedsPerDay = page.locator("#feedsPerDay:visible").first();
		await expect(feedsPerDay).toBeVisible();
		const original = await feedsPerDay.inputValue();

		// Six meals keeps the seeded ration inside the device relay-time guard;
		// four meals makes the same daily ration too large for one 300 s pulse.
		await feedsPerDay.fill("6");
		await page.getByRole("button", { name: "Save Changes" }).first().click();

		await expect(page.getByText("Changes saved!")).toBeVisible({ timeout: 20_000 });

		// Pending commands are part of the current schedule, so the value and
		// the sync state must both survive a full server render.
		await page.reload();
		await expect(page.getByText("Pending device sync")).toBeVisible();
		await expect(page.locator("#feedsPerDay:visible").first()).toHaveValue("6");

		// Leave the fixture in its seeded state for the rest of the serial suite.
		await page.locator("#feedsPerDay:visible").first().fill(original);
		await page.getByRole("button", { name: "Save Changes" }).first().click();
		await expect(page.getByText("Changes saved!")).toBeVisible({ timeout: 20_000 });
	});

	test("03 — a biomass sample saves and is visible in growth", async ({ page }) => {
		await login(page);
		const batch = `qa-release-${Date.now()}`;

		await page.goto("/en/dashboard/log-sample");
		// Match the existing log-sample E2E fixture values: 250/25 can be
		// rejected by the ration safety guard, which legitimately hides the
		// "Feed to dispense per feeding" headline (#751).
		await page.locator("#weightGrams").fill("220");
		await page.locator("#lengthCm").fill("24");
		await page.locator("#sampleCount").fill("20");
		await page.locator("#batchLabel").fill(batch);

		await page.getByRole("button", { name: "Save Sample" }).click();

		// The ration may be applied, kept by the safety guard, or skipped. All
		// are valid outcomes for this fixture; the sample must still be saved.
		await expect(
			page.getByText(/Feed to dispense per feeding|Calculated dose .* not applied|Device schedule not changed/),
		).toBeVisible({ timeout: 20_000 });
		await expect(page.getByText("Saved to")).toBeVisible();
		await expect(page.getByText(batch, { exact: true }).first()).toBeVisible();

		await page.goto("/en/dashboard/growth");
		await expect(page.getByText("Latest ABW")).toBeVisible();
		await expect(page.locator("text=220.0").first()).toBeVisible();
	});

	test("04 — a feed notification appears with the exact user-visible text", async ({
		page,
		request,
	}) => {
		const device = await prisma.energyDevice.findUnique({
			where: { mac: E2E.deviceMac },
			select: { id: true, token: true },
		});
		if (!device?.token) {
			throw new Error("The seeded e2e device has no token; run scripts/e2e/seed-e2e.ts.");
		}

		const eventId = `qa-notify-${Date.now()}`;
		const grams = 123.4;
		const message = `Dashboard feed completed — ${grams}g dispensed by ${E2E.deviceLabel}`;

		try {
			// Make the ingest route's one-second device rate limit deterministic,
			// and remove an earlier copy if this spec was interrupted.
			await prisma.energyDevice.update({
				where: { id: device.id },
				data: { lastSeenAt: null },
			});
			await prisma.notification.deleteMany({
				where: { pondId: E2E.pondId, message },
			});

			const response = await request.post("/api/ingest", {
				headers: { "x-device-token": device.token },
				data: {
					device_id: E2E.deviceMac,
					event_type: "feed_dispensed",
					event_id: eventId,
					timestamp: new Date().toISOString(),
					grams,
					source: "dashboard",
				},
			});
			expect(response.status(), "ingest should accept the fake device event").toBe(204);

			await login(page);
			await page.goto("/en/dashboard/notifications");

			await expect(page.getByText(message, { exact: true }).first()).toBeVisible({
				timeout: 20_000,
			});
			await expect(page.getByText("Feeding", { exact: true }).first()).toBeVisible();
			await expect(page.getByText("SUCCESS", { exact: true }).first()).toBeVisible();
		} finally {
			await prisma.notification.deleteMany({
				where: { pondId: E2E.pondId, message },
			});
			await prisma.feedEvent.deleteMany({
				where: { deviceId: device.id, eventId },
			});
			await prisma.energyDevice.update({
				where: { id: device.id },
				data: { lastSeenAt: null },
			});
		}
	});

	test("05 — a farmer cannot open the admin or platform console", async ({ page }) => {
		await login(page);

		await page.goto("/en/admin");
		await expect(page).toHaveURL(/\/en\/dashboard/);

		await page.goto("/en/superadmin");
		await expect(page).toHaveURL(/\/en\/dashboard/);
	});

	test("06 — a platform admin can open the platform console", async ({ page }) => {
		await login(page, "platform");

		await page.goto("/en/superadmin");
		await expect(page).toHaveURL(/\/en\/superadmin/);
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
	});
});
