import { type Page, expect, test } from "@playwright/test";

import { login } from "./helpers";

/**
 * Issue #399: the dashboard fits one screen at 100 % zoom.
 *
 * The report was a laptop at 100 % zoom where the control room ran past the
 * viewport and the page itself scrolled. The layout now takes its height from
 * `ofd-control-room` (viewport minus the header and pane padding) and steps the
 * density down on short screens, so at every common laptop size:
 *
 *   - the document never scrolls;
 *   - the `main` pane never scrolls, i.e. its content fits its own box;
 *   - the hero, the pond canvas and all three charts are fully inside the
 *     pane — nothing is clipped by the shell or by an inner card;
 *   - the right rail is the only scroll container.
 *
 * Below `lg` the stacked, scrolling dashboard is unchanged, and this spec pins
 * that too so the desktop fix cannot flatten the phone layout.
 *
 * Height reasoning lives in `lib/__tests__/dashboard-fit.test.tsx`; this is the
 * real-browser check.
 */

const LAPTOPS = [
	{ name: "1366x768", width: 1366, height: 768 },
	{ name: "1440x900", width: 1440, height: 900 },
	{ name: "1536x864", width: 1536, height: 864 },
	{ name: "1903x873 (1920x1080 at 100 %)", width: 1903, height: 873 },
	{ name: "1920x1080", width: 1920, height: 1080 },
] as const;

const PHONE = { name: "phone", width: 390, height: 844 } as const;

interface Rect {
	top: number;
	bottom: number;
	height: number;
}

interface Geometry {
	documentScroll: number;
	documentClient: number;
	mainScroll: number;
	mainClient: number;
	mainTop: number;
	mainBottom: number;
	railOverflowY: string | null;
	roomHeight: number;
	hero: Rect | null;
	canvas: Rect | null;
	charts: Rect[];
}

function geometry(page: Page): Promise<Geometry> {
	return page.evaluate(() => {
		const toRect = (element: Element | null) => {
			if (!element) return null;
			const box = element.getBoundingClientRect();
			return { top: box.top, bottom: box.bottom, height: box.height };
		};

		const doc = document.documentElement;
		const main = document.querySelector<HTMLElement>("#main-content");
		const rail = document.querySelector<HTMLElement>('aside[aria-label="Pond controls"]');
		const room = document.querySelector<HTMLElement>(".ofd-control-room");
		const mainBox = main?.getBoundingClientRect();

		// The pond canvas is the first figure in the room; the charts follow it.
		const figures = room ? Array.from(room.querySelectorAll("figure")) : [];

		return {
			documentScroll: doc.scrollHeight,
			documentClient: doc.clientHeight,
			mainScroll: main?.scrollHeight ?? 0,
			mainClient: main?.clientHeight ?? 0,
			mainTop: mainBox?.top ?? 0,
			mainBottom: mainBox ? mainBox.bottom : 0,
			railOverflowY: rail ? getComputedStyle(rail).overflowY : null,
			roomHeight: room ? Math.round(room.getBoundingClientRect().height) : 0,
			hero: toRect(room?.querySelector("[data-onboard='next-feeding']") ?? null),
			canvas: toRect(figures[0] ?? null),
			charts: (room ? Array.from(room.querySelectorAll("figure.ofd-chart-card")) : []).map(
				(element) => toRect(element) as Rect,
			),
		};
	});
}

test("the dashboard fits one laptop screen and only the rail scrolls (#399)", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await login(page);
	await expect(page).toHaveURL(/\/dashboard/);
	await expect(page.locator(".ofd-control-room")).toBeVisible();

	for (const viewport of [...LAPTOPS, PHONE]) {
		await page.setViewportSize({ width: viewport.width, height: viewport.height });
		// One frame for the layout, the charts and the density tier to settle.
		await page.waitForTimeout(150);

		const context = `/dashboard at ${viewport.name}`;
		const state = await geometry(page);

		if (viewport.width < 1024) {
			// The phone keeps the stacked, scrolling dashboard on purpose.
			expect(state.mainScroll, `${context}: phone pane should scroll`).toBeGreaterThan(
				state.mainClient,
			);
			continue;
		}

		// The document itself never scrolls; the app frame is `100dvh`.
		expect(
			state.documentScroll,
			`${context}: the page scrolls (${state.documentScroll} > ${state.documentClient})`,
		).toBeLessThanOrEqual(state.documentClient + 1);

		// `main` is `overflow-y-auto`: it must not have anything to scroll.
		expect(
			state.mainScroll,
			`${context}: main scrolls (${state.mainScroll} > ${state.mainClient})`,
		).toBeLessThanOrEqual(state.mainClient + 1);

		// The rail is the one intended scroll container.
		expect(state.railOverflowY, `${context}: the rail must scroll vertically`).toBe("auto");

		// The room is the pane's content box (the pane pads 2 rem top and bottom).
		expect(state.roomHeight, `${context}: control-room height`).toBe(state.mainClient - 64);

		const blocks: Array<[string, Rect | null]> = [
			["hero", state.hero],
			["pond canvas", state.canvas],
			...state.charts.map((chart, index): [string, Rect] => [`chart ${index + 1}`, chart]),
		];

		for (const [name, block] of blocks) {
			expect(block, `${context}: ${name} is missing`).not.toBeNull();
			const rect = block as Rect;
			expect(rect.height, `${context}: ${name} has no height`).toBeGreaterThan(0);
			expect(rect.top, `${context}: ${name} starts above the pane`).toBeGreaterThanOrEqual(
				state.mainTop - 1,
			);
			expect(rect.bottom, `${context}: ${name} is clipped by the pane`).toBeLessThanOrEqual(
				state.mainBottom + 1,
			);
		}

		// All three charts are present and whole, not squeezed out of the grid.
		expect(state.charts, `${context}: chart count`).toHaveLength(3);

		// The pond canvas keeps a usable height (the height budget reserves 96 px).
		expect((state.canvas as Rect).height, `${context}: pond canvas height`).toBeGreaterThanOrEqual(
			60,
		);
	}
});

/**
 * Issue #475, second report: at 1903x873 the vertical squeeze is gone but the
 * *horizontal* labels were still being cut. The hero printed the pond as
 * "Demo P…", the volume orphaned its unit onto a second line, and the rail's
 * cycle row ellipsized "Wala sang aktibo nga siklo". Truncation that hides a
 * word is a layout failure, not a content problem, so pin it in a browser.
 */
test("the control room never truncates its labels at the reported viewport (#475)", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1903, height: 873 });
	await login(page);
	await expect(page).toHaveURL(/\/dashboard/);
	const room = page.locator(".ofd-control-room");
	await expect(room).toBeVisible();
	await page.waitForTimeout(150);

	const state = await page.evaluate(() => {
		const metrics = (selector: string) =>
			Array.from(document.querySelectorAll<HTMLElement>(selector)).map((element) => ({
				text: (element.textContent ?? "").trim(),
				clientWidth: element.clientWidth,
				clientHeight: element.clientHeight,
				scrollWidth: element.scrollWidth,
				scrollHeight: element.scrollHeight,
				lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight) || 0,
			}));

		const root = document.querySelector(".ofd-control-room");
		const canvas = root?.querySelector("figure") ?? null;
		const title = canvas?.querySelector<HTMLElement>("[data-fit='pond-title']") ?? null;

		return {
			pond: metrics("[data-fit='hero-pond']"),
			volume: metrics("[data-fit='hero-volume']"),
			rate: metrics("[data-fit='hero-rate']"),
			meta: metrics("[data-fit='pond-meta']"),
			canvasBottom: canvas ? canvas.getBoundingClientRect().bottom : 0,
			titleBottom: title ? title.getBoundingClientRect().bottom : 0,
		};
	});

	// The pond name must be readable, not ellipsized to "Demo P…".
	for (const pond of state.pond) {
		expect(pond.text, "the hero pond name is empty").not.toBe("");
		expect(
			pond.clientWidth,
			`hero pond column is crushed to ${pond.clientWidth}px`,
		).toBeGreaterThan(88);
		expect(
			pond.scrollHeight,
			`hero pond name is clamped: ${pond.scrollHeight} > ${pond.clientHeight}`,
		).toBeLessThanOrEqual(pond.clientHeight + 1);
	}

	// Number and unit share one line ("2110.06 g", never a lone "g" below).
	for (const stat of [...state.volume, ...state.rate]) {
		const oneLine = Math.max(stat.lineHeight * 1.6, stat.clientHeight);
		expect(
			stat.scrollHeight,
			`hero stat wraps: ${stat.scrollHeight} > ${oneLine}`,
		).toBeLessThanOrEqual(oneLine + 1);
	}

	// The rail's summary values wrap instead of ellipsizing.
	for (const entry of state.meta) {
		expect(
			entry.scrollWidth,
			`rail value is ellipsized: ${entry.scrollWidth} > ${entry.clientWidth}`,
		).toBeLessThanOrEqual(entry.clientWidth + 1);
	}

	// The pond overlay sits inside the canvas instead of being clipped by it.
	expect(state.canvasBottom, "pond canvas missing").toBeGreaterThan(0);
	expect(state.titleBottom, "pond title is clipped by the canvas").toBeLessThanOrEqual(
		state.canvasBottom + 1,
	);
});
