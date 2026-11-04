import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The large-screen route (#616): full-bleed, no dashboard chrome, and the 3D
 * viewer receives every live reading rather than a subset.
 */

const { getDeviceDetail } = vi.hoisted(() => ({ getDeviceDetail: vi.fn() }));

vi.mock("@/lib/feeder/detail", () => ({ getDeviceDetail }));

vi.mock("next-intl/server", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { getTranslations: async (namespace: string) => createTranslator(namespace) };
});

vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("NEXT_NOT_FOUND");
	},
}));

vi.mock("@/i18n/routing", () => ({
	Link: ({ href, children }: { href: string; children: ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

const viewerProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock("@/components/feeder/feeder-viewer-lazy", () => ({
	FeederViewerLazy: (props: Record<string, unknown>) => {
		viewerProps.current = props;
		return (
			<div
				data-testid="viewer"
				data-kiosk={String(props.kiosk)}
				data-signal={String(props.initialSignalDbm)}
				data-firmware={String(props.initialFirmwareVersion)}
			/>
		);
	},
}));

import LargeScreenPage from "@/app/[locale]/(kiosk)/large-screen/[id]/page";

const DETAIL = {
	id: "dev-1",
	label: "CICT Feeder",
	mac: "68:09:47:25:E1:80",
	lastSeenAt: new Date("2026-11-03T07:59:00.000Z"),
	rtcOk: true,
	waterTempOk: true,
	waterTempC: 27.1,
	waterTempUpdatedAt: new Date("2026-11-03T07:58:00.000Z"),
	staleAfterMs: 300_000,
	diag: { version: "1.6.0" },
	firmwareVersion: "1.6.0",
	signalDbm: -62,
	isPaused: false,
	feedLevelPercent: 62,
	feedLevelUpdatedAt: new Date("2026-11-03T07:57:00.000Z"),
	sensorOffline: true,
	hopperCapacityG: 25_000,
	gramsPerFeeding: 330,
	pond: { id: "pond-1", name: "Pond 1" },
	lastFedAt: new Date("2026-11-03T06:00:00.000Z"),
	lastFedGrams: 120,
	status: "idle" as const,
};

async function renderPage() {
	return renderToStaticMarkup(
		await LargeScreenPage({ params: Promise.resolve({ locale: "en", id: "dev-1" }) }),
	);
}

beforeEach(() => {
	viewerProps.current = null;
	getDeviceDetail.mockResolvedValue(DETAIL);
});

describe("large-screen overview (#616)", () => {
	it("renders the pond and device without a duplicate server-rendered status", async () => {
		const html = await renderPage();

		expect(html).toContain("Pond 1");
		expect(html).toContain("CICT Feeder");
		// The live badge lives in the viewer (#666); the page must not print a
		// second, frozen copy of the status.
		expect(html).not.toMatch(/>Idle</);
		expect(html).toContain('data-testid="viewer"');
		// No shell: the page itself is the only <main>, and there is no sidebar.
		expect(html.match(/<main/g)).toHaveLength(1);
		expect(html).not.toContain("superadmin-sidebar");
	});

	it("gives the viewer every live reading and the kiosk treatment", async () => {
		await renderPage();

		const props = viewerProps.current;
		expect(props).not.toBeNull();
		expect(props?.kiosk).toBe(true);
		expect(props?.initialStatus).toBe("idle");
		expect(props?.initialSignalDbm).toBe(-62);
		expect(props?.initialFirmwareVersion).toBe("1.6.0");
		expect(props?.initialWaterTempC).toBe(27.1);
		expect(props?.initialFeedLevelUpdatedAt).toBe("2026-11-03T07:57:00.000Z");
		expect(props?.initialSensorOffline).toBe(true);
		expect(props?.staleAfterMs).toBe(300_000);
	});

	it("links back to the device page", async () => {
		const html = await renderPage();

		expect(html).toContain('href="/dashboard/devices/dev-1"');
	});

	it("returns not found for a device outside the caller's scope", async () => {
		getDeviceDetail.mockResolvedValue(null);

		await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
	});
});
