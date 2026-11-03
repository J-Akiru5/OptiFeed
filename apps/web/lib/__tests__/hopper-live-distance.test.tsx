import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The raw ultrasonic distance in the hopper form (issue #659).
 *
 * `feedLevelCm` was stored but never rendered, so the operator calibrating the
 * hopper could not see the distance they were calibrating against. These checks
 * pin the behaviour that makes it useful: the value moves while the form is
 * open, a failed poll keeps the last reading, and a capture button fills a
 * reference field with the reading on screen.
 */

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace),
		useLocale: () => "en",
	};
});

import {
	HOPPER_DISTANCE_POLL_MS,
	type HopperDistanceSnapshot,
	HopperLiveDistance,
	fetchHopperDistance,
} from "@/components/calibration/hopper-live-distance";

const AT = "2026-11-03T10:05:00.000Z";

function reading(cm: number | null, updatedAt = AT): HopperDistanceSnapshot {
	return { cm, percent: 71, updatedAt };
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("fetchHopperDistance", () => {
	it("reads the raw distance from the device's live-state endpoint", async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						data: { feedLevelCm: 8.6, feedLevelPercent: 42, feedLevelUpdatedAt: AT },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(fetchHopperDistance("dev-1")).resolves.toEqual({
			cm: 8.6,
			percent: 42,
			updatedAt: AT,
		});
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/devices/dev-1/state",
			expect.objectContaining({ cache: "no-store" }),
		);
	});

	it("returns null instead of throwing when the endpoint refuses", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("{}", { status: 404 })),
		);
		await expect(fetchHopperDistance("dev-9")).resolves.toBeNull();

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("offline");
			}),
		);
		await expect(fetchHopperDistance("dev-1")).resolves.toBeNull();
	});
});

describe("HopperLiveDistance", () => {
	it("renders the raw distance and when it was measured", () => {
		render(
			<HopperLiveDistance
				deviceId="dev-1"
				initial={reading(12.4)}
				isStale={false}
				onCapture={vi.fn()}
			/>,
		);

		expect(screen.getByTestId("hopper-raw-cm")).toHaveTextContent("12.4");
		// The timestamp comes from the shared farm-time helper, not the browser.
		expect(screen.getByTestId("hopper-live-distance")).toHaveTextContent("Reported");
	});

	it("says so when no distance has arrived yet", () => {
		render(
			<HopperLiveDistance
				deviceId="dev-1"
				initial={{ cm: null, percent: null, updatedAt: null }}
				onCapture={vi.fn()}
			/>,
		);

		expect(screen.getByTestId("hopper-raw-cm")).toHaveTextContent("—");
		expect(screen.getByTestId("hopper-live-distance")).toHaveTextContent(
			"No distance has been reported yet.",
		);
		expect(screen.getByRole("button", { name: "Use as full distance" })).toBeDisabled();
	});

	it("polls the guarded reader and moves the value", async () => {
		vi.useFakeTimers();
		const readAction = vi
			.fn<(deviceId: string) => Promise<HopperDistanceSnapshot | null>>()
			.mockResolvedValueOnce(reading(12.4))
			.mockResolvedValueOnce(reading(6.1, "2026-11-03T10:05:05.000Z"));

		render(
			<HopperLiveDistance
				deviceId="dev-1"
				initial={reading(null, AT)}
				readAction={readAction}
				onCapture={vi.fn()}
			/>,
		);

		// One read as soon as the block is on screen, then on the interval.
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(readAction).toHaveBeenCalledWith("dev-1");
		expect(screen.getByTestId("hopper-raw-cm")).toHaveTextContent("12.4");

		await act(async () => {
			await vi.advanceTimersByTimeAsync(HOPPER_DISTANCE_POLL_MS);
		});
		expect(screen.getByTestId("hopper-raw-cm")).toHaveTextContent("6.1");
	});

	it("keeps the last reading when a poll fails", async () => {
		vi.useFakeTimers();
		const readAction = vi.fn(async () => null);

		render(
			<HopperLiveDistance
				deviceId="dev-1"
				initial={reading(9.3)}
				readAction={readAction}
				onCapture={vi.fn()}
			/>,
		);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(HOPPER_DISTANCE_POLL_MS);
		});
		expect(readAction).toHaveBeenCalled();
		expect(screen.getByTestId("hopper-raw-cm")).toHaveTextContent("9.3");
	});

	it("fills a reference field with the displayed distance", () => {
		const onCapture = vi.fn();
		render(<HopperLiveDistance deviceId="dev-1" initial={reading(5)} onCapture={onCapture} />);

		fireEvent.click(screen.getByRole("button", { name: "Use as full distance" }));
		expect(onCapture).toHaveBeenCalledWith("full", 5);

		fireEvent.click(screen.getByRole("button", { name: "Use as empty distance" }));
		expect(onCapture).toHaveBeenCalledWith("empty", 5);
	});

	it("refuses a capture without write access or on a stale reading", () => {
		const onCapture = vi.fn();
		const { rerender } = render(
			<HopperLiveDistance
				deviceId="dev-1"
				initial={reading(5)}
				canWrite={false}
				onCapture={onCapture}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Use as full distance" }));
		expect(onCapture).not.toHaveBeenCalled();

		rerender(
			<HopperLiveDistance deviceId="dev-1" initial={reading(5)} isStale onCapture={onCapture} />,
		);
		expect(screen.getByTestId("hopper-live-distance")).toHaveTextContent("Last known");
		expect(screen.getByRole("button", { name: "Use as empty distance" })).toBeDisabled();
	});
});
