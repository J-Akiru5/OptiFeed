import { describe, expect, it } from "vitest";
import { todayDateOnly } from "../lib/crop-cycle/dates";
import {
	TENANT_B_ADMIN_FARM_ID,
	TENANT_B_DEVICE_MACS,
	TENANT_B_OPERATOR_FARM_ID,
	TENANT_B_POND_IDS,
	buildTenantBDemoData,
	deviceLastSeenAt,
} from "./tenant-b-demo-data";

/**
 * The Tenant B demo dataset (issue #418).
 *
 * These tests pin the properties the presentation depends on: the dataset is a
 * pure function of `now`, every row belongs to a demo pond or a demo feeder,
 * and the history is shaped so the dashboard charts have something to draw.
 */

const NOW = new Date("2026-10-31T08:00:00.000Z");

describe("buildTenantBDemoData", () => {
	it("is a pure function of `now`", () => {
		expect(buildTenantBDemoData(NOW)).toEqual(buildTenantBDemoData(NOW));
	});

	it("produces the same dataset for the same instant and a different one for another", () => {
		const later = new Date("2026-11-30T08:00:00.000Z");
		const first = buildTenantBDemoData(NOW);
		const second = buildTenantBDemoData(later);
		expect(second.ponds).toEqual(first.ponds);
		expect(second.feedPairs[0].receivedAt.getTime()).toBeGreaterThan(
			first.feedPairs[0].receivedAt.getTime(),
		);
	});

	it("covers both members with three ponds on two farms", () => {
		const data = buildTenantBDemoData(NOW);
		expect(data.ponds).toHaveLength(3);
		expect(new Set(data.ponds.map((pond) => pond.ownerFarmId))).toEqual(
			new Set([TENANT_B_ADMIN_FARM_ID, TENANT_B_OPERATOR_FARM_ID]),
		);
		expect(data.ponds.filter((pond) => pond.ownerFarmId === TENANT_B_ADMIN_FARM_ID)).toHaveLength(
			2,
		);
	});

	it("gives every pond a feeder and every feeder a pond that exists", () => {
		const data = buildTenantBDemoData(NOW);
		const pondIds = new Set(data.ponds.map((pond) => pond.id));
		expect(data.devices).toHaveLength(3);
		for (const device of data.devices) {
			expect(pondIds.has(device.pondId)).toBe(true);
		}
	});

	it("uses MAC addresses that no other fixture uses", () => {
		const macs = Object.values(TENANT_B_DEVICE_MACS);
		expect(new Set(macs).size).toBe(3);
		// demo-farmer-1 uses DE:AD:DE:MO:00:01 and the e2e suite E2:E0:00:00:00:0x.
		for (const mac of macs) {
			expect(mac).not.toBe("DE:AD:DE:MO:00:01");
			expect(mac.startsWith("E2:E0:")).toBe(false);
		}
	});

	it("references only known devices and ponds from every row", () => {
		const data = buildTenantBDemoData(NOW);
		const macs = new Set(data.devices.map((device) => device.mac));
		const pondIds = new Set(data.ponds.map((pond) => pond.id));

		for (const row of data.feedPairs) expect(macs.has(row.deviceMac)).toBe(true);
		for (const row of data.feedLevelLogs) expect(macs.has(row.deviceMac)).toBe(true);
		for (const row of data.waterTempLogs) expect(macs.has(row.deviceMac)).toBe(true);
		for (const row of data.deviceStateEvents) expect(macs.has(row.deviceMac)).toBe(true);
		for (const row of data.scheduleCommands) expect(macs.has(row.deviceMac)).toBe(true);
		for (const row of data.calibrationRuns) expect(macs.has(row.deviceMac)).toBe(true);
		for (const row of data.biomassLogs) expect(pondIds.has(row.pondId)).toBe(true);
		for (const row of data.fcrReports) expect(pondIds.has(row.pondId)).toBe(true);
		for (const row of data.cropCycles) expect(pondIds.has(row.pondId)).toBe(true);
		for (const row of data.pondEvents) expect(pondIds.has(row.pondId)).toBe(true);
		for (const row of data.notifications) expect(pondIds.has(row.pondId)).toBe(true);
	});

	it("gives every pond an active cycle with a harvest date after the stocking date", () => {
		const data = buildTenantBDemoData(NOW);
		expect(data.cropCycles).toHaveLength(data.ponds.length);
		for (const cycle of data.cropCycles) {
			expect(cycle.targetHarvestDate.getTime()).toBeGreaterThan(cycle.stockingDate.getTime());
			expect(cycle.stockingCount).toBeGreaterThan(0);
			expect(cycle.stockingDate.getTime()).toBeLessThan(NOW.getTime());
		}
	});

	it("gives every pond a stocking, a sampling and a harvest calendar event", () => {
		const data = buildTenantBDemoData(NOW);
		for (const pond of data.ponds) {
			const events = data.pondEvents.filter((event) => event.pondId === pond.id);
			expect(events.map((event) => event.type).sort()).toEqual([
				"HARVEST_PLANNED",
				"SAMPLING",
				"STOCKING",
			]);
		}
	});

	it("puts the harvest event on the cycle's target harvest date", () => {
		const data = buildTenantBDemoData(NOW);
		for (const cycle of data.cropCycles) {
			const harvest = data.pondEvents.find(
				(event) => event.pondId === cycle.pondId && event.type === "HARVEST_PLANNED",
			);
			expect(harvest?.startsAt.toISOString()).toBe(cycle.targetHarvestDate.toISOString());
		}
	});

	it("declines the feed level over time and keeps it inside 0-100", () => {
		const data = buildTenantBDemoData(NOW);
		for (const device of data.devices) {
			const levels = data.feedLevelLogs.filter((row) => row.deviceMac === device.mac);
			expect(levels.length).toBeGreaterThan(0);
			for (const level of levels) {
				expect(level.levelPercent).toBeGreaterThanOrEqual(0);
				expect(level.levelPercent).toBeLessThanOrEqual(100);
			}
			const first = levels[0];
			const last = levels[levels.length - 1];
			expect(last.levelPercent).toBeLessThan(first.levelPercent);
		}
	});

	it("keeps every history row in the past", () => {
		const data = buildTenantBDemoData(NOW);
		for (const row of data.feedPairs) expect(row.receivedAt.getTime()).toBeLessThan(NOW.getTime());
		for (const row of data.feedLevelLogs)
			expect(row.recordedAt.getTime()).toBeLessThan(NOW.getTime());
		for (const row of data.biomassLogs)
			expect(row.recordedAt.getTime()).toBeLessThan(NOW.getTime());
	});

	it("mixes the feed sources so the chart is not a single band", () => {
		const data = buildTenantBDemoData(NOW);
		const sources = new Set(data.feedPairs.map((pair) => pair.source));
		expect(sources).toEqual(new Set(["scheduled", "dashboard", "button"]));
	});

	it("reports one offline feeder so the fleet health chart is not uniform", () => {
		const data = buildTenantBDemoData(NOW);
		const silent = data.devices.filter((device) => device.silenceMinutes > 30);
		expect(silent).toHaveLength(1);
		expect(silent[0].waterTempC).toBeNull();
		expect(silent[0].wifiRssiDbm).toBeNull();
	});

	it("gives the silent feeder a CRITICAL notification and the others a warning", () => {
		const data = buildTenantBDemoData(NOW);
		const critical = data.notifications.filter((row) => row.tier === "CRITICAL");
		expect(critical).toHaveLength(1);
		expect(critical[0].category).toBe("connectivity");
		expect(data.notifications.filter((row) => row.tier === "WARNING")).toHaveLength(2);
	});

	it("labels every biomass log with a batch so the growth chart has series", () => {
		const data = buildTenantBDemoData(NOW);
		for (const log of data.biomassLogs) {
			expect(log.batchLabel).toBeTruthy();
			expect(log.fish.length).toBe(log.sampleCount);
		}
	});

	it("records every pond's stocking date in the farm timezone, not UTC", () => {
		const data = buildTenantBDemoData(NOW);
		const today = todayDateOnly(NOW);
		for (const cycle of data.cropCycles) {
			expect(cycle.stockingDate.toISOString().slice(0, 10) <= today).toBe(true);
		}
	});
});

describe("deviceLastSeenAt", () => {
	it("places the last heartbeat the configured number of minutes in the past", () => {
		const data = buildTenantBDemoData(NOW);
		for (const device of data.devices) {
			const lastSeenAt = deviceLastSeenAt(device, NOW);
			const minutes = Math.round((NOW.getTime() - lastSeenAt.getTime()) / 60000);
			expect(minutes).toBe(device.silenceMinutes);
		}
	});
});

describe("demo identifiers", () => {
	it("keeps the pond ids distinct and prefixed", () => {
		const ids = Object.values(TENANT_B_POND_IDS);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) expect(id.startsWith("demo-tenant-b-")).toBe(true);
	});
});
