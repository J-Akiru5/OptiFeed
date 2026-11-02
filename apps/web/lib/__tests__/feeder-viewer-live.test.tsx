import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The live viewer (#620). Before this, the 15 s poll refreshed status, hopper
 * level and last-fed only, so the water probe and RTC health froze at the values
 * they had when the page loaded. These tests drive the poll and assert the
 * rendered health actually moves.
 */

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace),
		useLocale: () => "en",
	};
});

import { FeederViewerLazy } from "@/components/feeder/feeder-viewer-lazy";

const NOW = Date.now();
const RECENT = new Date(NOW - 60_000).toISOString();
const OLD = new Date(NOW - 2 * 60 * 60_000).toISOString();
const STALE_AFTER_MS = 5 * 60_000;

const BASE_PAYLOAD = {
	deviceId: "dev-1",
	status: "idle",
	lastSeenAt: RECENT,
	lastFedAt: null,
	lastFedGrams: null,
	feedLevelPercent: 40,
	hopperCapacityG: 25_000,
	gramsPerFeeding: 330,
	rtcOk: true,
	waterTempOk: true,
	waterTempC: 27.1,
	waterTempUpdatedAt: RECENT,
	staleAfterMs: STALE_AFTER_MS,
	isPaused: false,
};

class ImmediateIntersectionObserver {
	root = null;
	rootMargin = "";
	thresholds: number[] = [];
	private readonly callback: IntersectionObserverCallback;
	constructor(callback: IntersectionObserverCallback) {
		this.callback = callback;
	}
	observe(target: Element) {
		this.callback(
			[{ isIntersecting: true, target } as IntersectionObserverEntry],
			this as unknown as IntersectionObserver,
		);
	}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

function pollReturns(data: Record<string, unknown>) {
	const fetchMock = vi.fn(
		async () =>
			({
				ok: true,
				json: async () => ({ data }),
			}) as unknown as Response,
	);
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

function renderViewer(overrides: Partial<Parameters<typeof FeederViewerLazy>[0]> = {}) {
	return render(
		<FeederViewerLazy
			deviceId="dev-1"
			label="CICT Feeder"
			initialStatus="idle"
			initialLevel={40}
			initialLastFedAt={null}
			initialWaterTempOk={true}
			initialWaterTempC={27.1}
			initialWaterTempUpdatedAt={RECENT}
			initialRtcOk={true}
			initialLastSeenAt={RECENT}
			staleAfterMs={STALE_AFTER_MS}
			{...overrides}
		/>,
	);
}

beforeEach(() => {
	vi.stubGlobal("IntersectionObserver", ImmediateIntersectionObserver);
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		get: () => "visible",
	});
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
		null as unknown as RenderingContext,
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("FeederViewerLazy live health", () => {
	it("replaces the water probe health and temperature from the poll", async () => {
		pollReturns({ ...BASE_PAYLOAD, waterTempOk: false, waterTempC: 26.4 });

		renderViewer();

		expect(await screen.findByText("26.4 °C · Fault")).toBeInTheDocument();
		// The RTC was healthy before and in the payload, so it stays healthy.
		expect(screen.getAllByText("Healthy")).toHaveLength(1);
	});

	it("replaces the RTC health from the poll", async () => {
		pollReturns({ ...BASE_PAYLOAD, rtcOk: false });

		renderViewer();

		expect(await screen.findByText("Fault")).toBeInTheDocument();
		expect(screen.getByText("27.1 °C · Healthy")).toBeInTheDocument();
	});

	it("marks an old probe reading stale with its age", async () => {
		pollReturns({ ...BASE_PAYLOAD, waterTempUpdatedAt: OLD });

		renderViewer();

		const stale = await screen.findByText(/Stale · 2h ago/);
		expect(stale.textContent).toContain("27.1 °C");
	});

	it("marks an old heartbeat as a stale RTC reading", async () => {
		pollReturns({ ...BASE_PAYLOAD, lastSeenAt: OLD });

		renderViewer();

		expect(await screen.findByText(/Stale · 2h ago/)).toBeInTheDocument();
	});

	it("polls the device state endpoint", async () => {
		const fetchMock = pollReturns({ ...BASE_PAYLOAD });

		renderViewer();

		expect(await screen.findByText("27.1 °C · Healthy")).toBeInTheDocument();
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/devices/dev-1/state",
			expect.objectContaining({ cache: "no-store" }),
		);
	});
});
