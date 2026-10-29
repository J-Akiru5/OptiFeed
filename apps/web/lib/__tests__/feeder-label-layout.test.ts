import {
	FEEDER_LABEL_ANCHORS,
	FEEDER_LABEL_SLOTS,
	projectFeederAnchors,
} from "@/lib/feeder/feeder-label-layout";
import { describe, expect, it } from "vitest";

const COMPONENT_IDS = ["hopper", "sensor", "controller", "motor", "auger", "outlet"] as const;

describe("feeder ISO label slots", () => {
	it("holds the six components once each, in visual top-to-bottom order", () => {
		expect(FEEDER_LABEL_SLOTS.map(({ id }) => id)).toEqual([
			"sensor",
			"hopper",
			"controller",
			"motor",
			"auger",
			"outlet",
		]);
	});

	it("keeps the fixed art-directed side and vertical centre for every card", () => {
		expect(FEEDER_LABEL_SLOTS).toEqual([
			{ id: "sensor", side: "left", top: 14 },
			{ id: "hopper", side: "left", top: 34 },
			{ id: "controller", side: "right", top: 42 },
			{ id: "motor", side: "left", top: 58 },
			{ id: "auger", side: "left", top: 80 },
			{ id: "outlet", side: "right", top: 70 },
		]);
	});

	it("stacks each column downward and puts the lower callouts on opposite sides", () => {
		for (const side of ["left", "right"] as const) {
			const tops = FEEDER_LABEL_SLOTS.filter((slot) => slot.side === side).map(({ top }) => top);
			expect(tops, side).toEqual([...tops].sort((a, b) => a - b));
			expect(new Set(tops).size, side).toBe(tops.length);
		}

		const auger = FEEDER_LABEL_SLOTS.find(({ id }) => id === "auger");
		const outlet = FEEDER_LABEL_SLOTS.find(({ id }) => id === "outlet");
		expect(auger).toMatchObject({ side: "left", top: 80 });
		expect(outlet).toMatchObject({ side: "right", top: 70 });
	});
});

describe("feeder ISO anchor projection", () => {
	const desktop = projectFeederAnchors(720, 440);

	it("projects all six anchors inside a 720 × 440 stage", () => {
		expect(Object.keys(desktop).sort()).toEqual([...COMPONENT_IDS].sort());

		for (const id of COMPONENT_IDS) {
			const anchor = desktop[id];
			expect(Number.isFinite(anchor.x), id).toBe(true);
			expect(Number.isFinite(anchor.y), id).toBe(true);
			expect(anchor.visible, id).toBe(true);
			expect(anchor.x, id).toBeGreaterThanOrEqual(0);
			expect(anchor.x, id).toBeLessThanOrEqual(720);
			expect(anchor.y, id).toBeGreaterThanOrEqual(0);
			expect(anchor.y, id).toBeLessThanOrEqual(440);
		}
	});

	it("keeps the documented left/right and vertical relationships", () => {
		expect(desktop.hopper.x).toBeLessThan(desktop.controller.x);
		expect(desktop.sensor.y).toBeLessThan(desktop.hopper.y);
		expect(desktop.motor.y).toBeGreaterThan(desktop.hopper.y);
		expect(desktop.outlet.y).toBeGreaterThan(desktop.controller.y);
	});

	it("drops the auger and outlet into the lower band, auger left of outlet", () => {
		for (const id of ["auger", "outlet"] as const) {
			expect(desktop[id].y, id).toBeGreaterThan(440 * 0.75);
		}
		expect(desktop.auger.x).toBeLessThan(desktop.outlet.x);
		expect(desktop.auger.y).toBeLessThan(desktop.outlet.y);
		expect(desktop.outlet.x).toBeGreaterThan(720 / 2);
	});

	it("holds the same ordering on a 720 × 380 tablet stage", () => {
		const tablet = projectFeederAnchors(720, 380);

		for (const id of COMPONENT_IDS) {
			expect(tablet[id].visible, id).toBe(true);
			expect(tablet[id].x, id).toBeGreaterThanOrEqual(0);
			expect(tablet[id].x, id).toBeLessThanOrEqual(720);
			expect(tablet[id].y, id).toBeGreaterThanOrEqual(0);
			expect(tablet[id].y, id).toBeLessThanOrEqual(380);
		}

		expect(tablet.hopper.x).toBeLessThan(tablet.controller.x);
		expect(tablet.sensor.y).toBeLessThan(tablet.hopper.y);
		expect(tablet.motor.y).toBeGreaterThan(tablet.hopper.y);
		expect(tablet.outlet.y).toBeGreaterThan(tablet.controller.y);
		expect(tablet.auger.x).toBeLessThan(tablet.outlet.x);
		expect(tablet.auger.y).toBeLessThan(tablet.outlet.y);
	});

	it("returns finite numbers for the narrow mobile stage", () => {
		const mobile = projectFeederAnchors(390, 300);

		for (const id of COMPONENT_IDS) {
			expect(Number.isFinite(mobile[id].x), id).toBe(true);
			expect(Number.isFinite(mobile[id].y), id).toBe(true);
			expect(typeof mobile[id].visible, id).toBe("boolean");
		}
	});

	it("returns an inert layout for zero or negative stage sizes", () => {
		for (const [width, height] of [
			[0, 0],
			[0, 440],
			[-720, 440],
			[720, -1],
		] as const) {
			const projected = projectFeederAnchors(width, height);
			for (const id of COMPONENT_IDS) {
				expect(projected[id], `${id} at ${width} × ${height}`).toEqual({
					x: 0,
					y: 0,
					visible: false,
				});
			}
		}
	});

	it("keeps every documented anchor as a three-number model coordinate", () => {
		for (const id of COMPONENT_IDS) {
			expect(FEEDER_LABEL_ANCHORS[id], id).toHaveLength(3);
			for (const coordinate of FEEDER_LABEL_ANCHORS[id]) {
				expect(Number.isFinite(coordinate), id).toBe(true);
			}
		}
	});
});
