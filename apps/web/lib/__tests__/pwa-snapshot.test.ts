import { readFileSync } from "node:fs";
import path from "node:path";
import {
	DASHBOARD_SNAPSHOT_KEY,
	clearDashboardSnapshot,
	writeDashboardSnapshot,
} from "@/lib/pwa/snapshot";
import { afterEach, describe, expect, it } from "vitest";

const snapshot = {
	pondName: "ILO-POND-01",
	deviceName: "ESP32 Feeder",
	deviceStatus: "online" as const,
	lastSeenAt: "2026-10-25T08:00:00.000Z",
	feedLevelPercent: 72,
	feedLevelUpdatedAt: "2026-10-25T07:58:00.000Z",
	waterTempC: 28.4,
	waterTempOk: true,
	waterTempUpdatedAt: "2026-10-25T07:58:00.000Z",
	population: 1200,
	avgWeightG: 145.2,
	latestFcr: 1.34,
	nextFeedingTime: "6:00 AM",
	nextFeedingVolumeG: 330,
	daysUntilSample: 4,
	activeCycleLabel: "Cycle 3",
	targetHarvestDate: "2026-12-18",
	isPaused: false,
};

function publicFile(name: string): string {
	return readFileSync(path.join(process.cwd(), "public", name), "utf8");
}

describe("dashboard offline snapshot", () => {
	afterEach(() => {
		window.localStorage.clear();
	});

	it("writes a versioned snapshot with a save timestamp", () => {
		writeDashboardSnapshot(snapshot);

		const raw = window.localStorage.getItem(DASHBOARD_SNAPSHOT_KEY);
		expect(raw).toBeTruthy();

		const parsed = JSON.parse(raw as string);
		expect(parsed.version).toBe(1);
		expect(parsed.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(parsed.pondName).toBe("ILO-POND-01");
		expect(parsed.feedLevelPercent).toBe(72);
	});

	it("clears the snapshot on sign-out", () => {
		writeDashboardSnapshot(snapshot);
		clearDashboardSnapshot();
		expect(window.localStorage.getItem(DASHBOARD_SNAPSHOT_KEY)).toBeNull();
	});
});

describe("offline PWA assets", () => {
	it("uses the same storage key and disables feed commands offline", () => {
		const offline = publicFile("offline.html");
		expect(offline).toContain(DASHBOARD_SNAPSHOT_KEY);
		expect(offline).toContain("Feed commands are disabled offline");
		expect(offline).toContain("/icons/icon-192.png");
	});

	it("precaches the fallback and never handles API/auth traffic", () => {
		const sw = publicFile("sw.js");
		expect(sw).toContain('const OFFLINE_URL = "/offline.html"');
		expect(sw).toContain('request.method !== "GET"');
		expect(sw).toContain('url.pathname.startsWith("/api/")');
		expect(sw).toContain('url.pathname.startsWith("/auth/")');
	});
});
