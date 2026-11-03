import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("@/i18n/routing", () => ({
	Link: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
		<a href={href} {...rest}>
			{children}
		</a>
	),
	usePathname: () => "/dashboard",
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import { FeedLevelCard } from "@/components/FeedLevelCard";
import { FeedLevelDisplay } from "@/components/feed-level-display";
import { resolveHopperSensorOffline, toHopperSnapshot } from "@/lib/device-hopper";
import {
	DEFAULT_DEVICE_STATUS_POLICY,
	type DeviceStatusPolicy,
	deviceStatusPolicyFromValue,
} from "@/lib/device-status";
import { getFeedLevelDisplay } from "@/lib/feed-level";

const now = new Date("2026-11-02T12:00:00.000Z");
const policy: DeviceStatusPolicy = DEFAULT_DEVICE_STATUS_POLICY;

describe("resolveHopperSensorOffline (#574)", () => {
	it("flags the sensor when the firmware reports the hopper_sensor fault", () => {
		expect(
			resolveHopperSensorOffline({
				deviceOffline: false,
				levelUpdatedAt: now,
				sensorFault: true,
				now,
				policy,
			}),
		).toBe(true);
	});

	it("keeps a fresh online reading live", () => {
		expect(
			resolveHopperSensorOffline({
				deviceOffline: false,
				levelUpdatedAt: new Date(now.getTime() - 5_000),
				now,
				policy,
			}),
		).toBe(false);
	});

	it("falls back to age twice the offline window for firmware without diag", () => {
		const staleAt = policy.offlineAfterMs * 2 + 1;

		expect(
			resolveHopperSensorOffline({
				deviceOffline: false,
				levelUpdatedAt: new Date(now.getTime() - staleAt),
				now,
				policy,
			}),
		).toBe(true);
		expect(
			resolveHopperSensorOffline({
				deviceOffline: false,
				levelUpdatedAt: new Date(now.getTime() - staleAt + 2),
				now,
				policy,
			}),
		).toBe(false);
	});

	it("never calls a fully offline unit 'sensor offline'", () => {
		expect(
			resolveHopperSensorOffline({
				deviceOffline: true,
				levelUpdatedAt: now,
				sensorFault: true,
				now,
				policy,
			}),
		).toBe(false);
	});

	it("does not invent a sensor fault before the first reading", () => {
		expect(
			resolveHopperSensorOffline({
				deviceOffline: false,
				levelUpdatedAt: null,
				now,
				policy,
			}),
		).toBe(false);
	});
});

describe("toHopperSnapshot sensor state (#574)", () => {
	const row = {
		id: "dev-1",
		feedLevelPercent: 82,
		feedLevelUpdatedAt: now,
		lastSeenAt: now,
		hopperCapacityG: 10_000,
		gramsPerFeeding: 100,
	};

	it("keeps the last known level while marking only the sensor offline", () => {
		const snapshot = toHopperSnapshot(row, now, policy, true);

		expect(snapshot.levelPercent).toBe(82);
		expect(snapshot.isOffline).toBe(false);
		expect(snapshot.sensorOffline).toBe(true);
	});

	it("reports a normal online reading when the sensor answers", () => {
		const snapshot = toHopperSnapshot(row, now, policy, false);

		expect(snapshot.isOffline).toBe(false);
		expect(snapshot.sensorOffline).toBe(false);
	});

	it("uses the configured offline window for the age fallback", () => {
		const slowPolicy = deviceStatusPolicyFromValue({
			weakAfterMin: 2,
			offlineAfterMin: 30,
			graceMin: 0,
		});
		const aged = { ...row, feedLevelUpdatedAt: new Date(now.getTime() - 40 * 60 * 1000) };

		expect(toHopperSnapshot(aged, now, slowPolicy).sensorOffline).toBe(false);
		expect(toHopperSnapshot(aged, now, policy).sensorOffline).toBe(true);
	});
});

describe("feed-level presentation while the sensor is offline (#574)", () => {
	const base = {
		hopperCapacityG: 10_000,
		gramsPerFeeding: 100,
		feedsPerDay: 2,
	};

	it("treats the last reading as stale but keeps the unit online", () => {
		const display = getFeedLevelDisplay({
			...base,
			levelPercent: 82,
			isDeviceOffline: false,
			isSensorOffline: true,
		});

		expect(display.state).toBe("stale");
		expect(display.percent).toBe(82);
		expect(display.isOffline).toBe(false);
		expect(display.isSensorOffline).toBe(true);
		expect(display.daysRemaining).toBeNull();
	});

	it("renders 'Ultrasonic offline' with the last known value in the card", () => {
		const html = renderToStaticMarkup(
			<FeedLevelCard
				levelPercent={82}
				updatedAt={now}
				hopperCapacityG={10_000}
				gramsPerFeeding={100}
				feedsPerDay={2}
				isSensorOffline
			/>,
		);

		expect(html).toContain("Last known 82%");
		expect(html).toContain("Ultrasonic offline");
		expect(html).not.toContain("hopper-low-pulse");
	});

	it("renders 'Ultrasonic offline' in the shared display component", () => {
		const html = renderToStaticMarkup(
			<FeedLevelDisplay levelPercent={82} updatedAt={now} isOffline={false} sensorOffline />,
		);

		expect(html).toContain("Last known 82%");
		expect(html).toContain("Ultrasonic offline");
	});

	it("still says plain Offline when the unit itself is offline", () => {
		const html = renderToStaticMarkup(
			<FeedLevelDisplay levelPercent={82} updatedAt={now} isOffline sensorOffline={false} />,
		);

		expect(html).toContain("Offline");
		expect(html).not.toContain("Ultrasonic offline");
	});
});
