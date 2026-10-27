import {
	type TourRect,
	type TourSize,
	clamp,
	computeTourPopoverPosition,
} from "@/components/onboarding-position";
import { describe, expect, it } from "vitest";

const POPOVER: TourSize = { width: 300, height: 150 };

describe("clamp", () => {
	it("keeps values inside the range", () => {
		expect(clamp(5, 10, 20)).toBe(10);
		expect(clamp(25, 10, 20)).toBe(20);
		expect(clamp(15, 10, 20)).toBe(15);
	});

	it("falls back to the minimum when the range is inverted", () => {
		expect(clamp(15, 20, 10)).toBe(20);
	});
});

describe("computeTourPopoverPosition — centred steps", () => {
	for (const viewport of [
		{ width: 320, height: 640 },
		{ width: 375, height: 812 },
		{ width: 768, height: 1024 },
		{ width: 1280, height: 800 },
		{ width: 1920, height: 1080 },
	]) {
		it(`centres the welcome card on both axes at ${viewport.width}x${viewport.height}`, () => {
			const position = computeTourPopoverPosition({
				target: null,
				popover: POPOVER,
				viewport,
			});

			expect(position.placement).toBe("center");
			expect(position.left).toBeCloseTo((viewport.width - POPOVER.width) / 2);
			expect(position.top).toBeCloseTo((viewport.height - POPOVER.height) / 2);
			expect(position.arrowOffset).toBe(0);
		});
	}

	it("treats a zero-sized target as centred", () => {
		const position = computeTourPopoverPosition({
			target: { top: 0, left: 0, width: 0, height: 0 },
			popover: POPOVER,
			viewport: { width: 1280, height: 800 },
		});

		expect(position.placement).toBe("center");
	});

	it("nudges a centred card above the FAB cluster on a short phone", () => {
		const fab: TourRect = { top: 348, left: 248, width: 56, height: 124 };
		const position = computeTourPopoverPosition({
			target: null,
			popover: POPOVER,
			viewport: { width: 320, height: 568 },
			avoid: [fab],
		});

		expect(position.placement).toBe("center");
		// The natural centre would end at y=359, inside the FAB cluster.
		expect(position.top + POPOVER.height).toBeLessThanOrEqual(fab.top - 12);
		expect(position.top).toBeGreaterThanOrEqual(12);
	});
});

describe("computeTourPopoverPosition — anchored steps", () => {
	it("puts the card below the target when there is room", () => {
		const position = computeTourPopoverPosition({
			target: { top: 100, left: 100, width: 200, height: 40 },
			popover: POPOVER,
			viewport: { width: 1280, height: 800 },
		});

		expect(position.placement).toBe("bottom");
		expect(position.top).toBe(152);
		expect(position.left).toBe(50);
		expect(position.arrowOffset).toBe(150);
	});

	it("flips above the target when the bottom edge is too close", () => {
		const position = computeTourPopoverPosition({
			target: { top: 650, left: 100, width: 200, height: 40 },
			popover: POPOVER,
			viewport: { width: 800, height: 800 },
		});

		expect(position.placement).toBe("top");
		expect(position.top).toBe(488);
		expect(position.left).toBe(50);
	});

	it("centres instead of sticking to the bottom when no side fits", () => {
		const position = computeTourPopoverPosition({
			target: { top: 10, left: 10, width: 780, height: 580 },
			popover: POPOVER,
			viewport: { width: 800, height: 600 },
		});

		expect(position.placement).toBe("center");
		expect(position.left).toBe(250);
		expect(position.top).toBe(225);
	});

	it("keeps a wide card fully inside a 320px viewport", () => {
		const position = computeTourPopoverPosition({
			target: { top: 50, left: 0, width: 100, height: 40 },
			popover: POPOVER,
			viewport: { width: 320, height: 640 },
		});

		expect(position.placement).toBe("bottom");
		expect(position.left).toBeGreaterThanOrEqual(0);
		expect(position.left + POPOVER.width).toBeLessThanOrEqual(320);
	});

	it("picks a different side rather than sitting under the FAB cluster", () => {
		const fab: TourRect = { top: 600, left: 1200, width: 56, height: 180 };
		const position = computeTourPopoverPosition({
			target: { top: 500, left: 1100, width: 100, height: 40 },
			popover: POPOVER,
			viewport: { width: 1280, height: 800 },
			avoid: [fab],
		});

		expect(position.placement).toBe("top");
		expect(position.top).toBe(338);
	});
});
