import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * #831: `DashboardLiveRefresh` calls `router.refresh()` every 30 s (and on
 * `visibilitychange`), so the hopper calibration panel is re-rendered from a
 * fresh RSC payload while the distance poller keeps running.
 *
 * `feedLevelUpdatedAt` arrives as a new `Date` instance every payload, so the
 * memo that builds `initial` produced a new object every 30 s and the reset
 * effect re-seeded the panel with the older server snapshot. The live reading
 * must survive that, and a server snapshot may only win when it is genuinely
 * newer than what the poller already showed.
 */

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace),
		useLocale: () => "en",
	};
});

vi.mock("@/i18n/routing", () => ({
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/actions/energy", () => ({ saveHopperCalibration: vi.fn() }));

import { HopperCalibrationForm } from "@/components/HopperCalibrationForm";
import {
	HOPPER_DISTANCE_POLL_MS,
	type HopperDistanceSnapshot,
	HopperLiveDistance,
} from "@/components/calibration/hopper-live-distance";

const AT = "2026-11-03T10:05:00.000Z";
const LATER = "2026-11-03T10:05:05.000Z";
const NEWEST = "2026-11-03T10:05:30.000Z";

function reading(cm: number | null, updatedAt: string | null = AT): HopperDistanceSnapshot {
	return { cm, percent: 71, updatedAt };
}

/** Let the mount poll resolve and advance to the next interval. */
async function advance(ms = HOPPER_DISTANCE_POLL_MS) {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("HopperLiveDistance under live refresh (#831)", () => {
	it("keeps the polled reading when a deep-equal payload object arrives", async () => {
		vi.useFakeTimers();
		const readAction = vi.fn(async () => reading(6.1, LATER));
		const view = render(
			<HopperLiveDistance
				deviceId="dev-1"
				initial={reading(12.4)}
				readAction={readAction}
				onCapture={vi.fn()}
			/>,
		);
		await advance(0);
		expect(screen.getByTestId("hopper-raw-cm")).toHaveTextContent("6.1");

		// The 30 s refresh: a new object, same values the server already sent.
		view.rerender(
			<HopperLiveDistance
				deviceId="dev-1"
				initial={reading(12.4)}
				readAction={readAction}
				onCapture={vi.fn()}
			/>,
		);

		expect(screen.getByTestId("hopper-raw-cm")).toHaveTextContent("6.1");
	});

	it("refuses an older server snapshot even when its distance changed", async () => {
		vi.useFakeTimers();
		const readAction = vi.fn(async () => reading(6.1, LATER));
		const view = render(
			<HopperLiveDistance
				deviceId="dev-1"
				initial={reading(12.4)}
				readAction={readAction}
				onCapture={vi.fn()}
			/>,
		);
		await advance(0);

		// A payload built from a render that predates the poll: newer object,
		// older reading, different value.
		view.rerender(
			<HopperLiveDistance
				deviceId="dev-1"
				initial={reading(9.9, AT)}
				readAction={readAction}
				onCapture={vi.fn()}
			/>,
		);

		expect(screen.getByTestId("hopper-raw-cm")).toHaveTextContent("6.1");
	});

	it("adopts a server snapshot that is genuinely newer than the polled one", async () => {
		vi.useFakeTimers();
		const readAction = vi.fn(async () => reading(6.1, LATER));
		const view = render(
			<HopperLiveDistance
				deviceId="dev-1"
				initial={reading(12.4)}
				readAction={readAction}
				onCapture={vi.fn()}
			/>,
		);
		await advance(0);

		view.rerender(
			<HopperLiveDistance
				deviceId="dev-1"
				initial={reading(4.2, NEWEST)}
				readAction={readAction}
				onCapture={vi.fn()}
			/>,
		);

		expect(screen.getByTestId("hopper-raw-cm")).toHaveTextContent("4.2");
	});

	it("does not replace a timestamped reading with an untimed server snapshot", async () => {
		vi.useFakeTimers();
		const readAction = vi.fn(async () => reading(6.1, LATER));
		const view = render(
			<HopperLiveDistance
				deviceId="dev-1"
				initial={reading(12.4)}
				readAction={readAction}
				onCapture={vi.fn()}
			/>,
		);
		await advance(0);

		view.rerender(
			<HopperLiveDistance
				deviceId="dev-1"
				initial={{ cm: 20, percent: 5, updatedAt: null }}
				readAction={readAction}
				onCapture={vi.fn()}
			/>,
		);

		expect(screen.getByTestId("hopper-raw-cm")).toHaveTextContent("6.1");
	});

	it("keeps an untimed polled reading when the payload cannot be ordered", async () => {
		vi.useFakeTimers();
		const readAction = vi.fn(async () => ({ cm: 6.1, percent: 71, updatedAt: null }));
		const view = render(
			<HopperLiveDistance
				deviceId="dev-1"
				initial={{ cm: 12.4, percent: 71, updatedAt: null }}
				readAction={readAction}
				onCapture={vi.fn()}
			/>,
		);
		await advance(0);
		expect(screen.getByTestId("hopper-raw-cm")).toHaveTextContent("6.1");

		// Neither side has a timestamp, so nothing proves the server is newer.
		view.rerender(
			<HopperLiveDistance
				deviceId="dev-1"
				initial={{ cm: 9.9, percent: 71, updatedAt: null }}
				readAction={readAction}
				onCapture={vi.fn()}
			/>,
		);

		expect(screen.getByTestId("hopper-raw-cm")).toHaveTextContent("6.1");
	});
});

describe("HopperCalibrationForm under live refresh (#831)", () => {
	function form(updatedAt: string, cm = 12.4) {
		return (
			<HopperCalibrationForm
				deviceId="dev-1"
				hopperFullCm={5}
				hopperEmptyCm={30}
				hopperCapacityG={7000}
				feedLevelCm={cm}
				feedLevelPercent={71}
				feedLevelUpdatedAt={new Date(updatedAt)}
			/>
		);
	}

	it("keeps the reading and the captured reference values across a payload", async () => {
		vi.useFakeTimers();
		// The poller sees a distance the server render (12.4) has not caught up to.
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							data: { feedLevelCm: 6.1, feedLevelPercent: 42, feedLevelUpdatedAt: LATER },
						}),
						{ status: 200, headers: { "content-type": "application/json" } },
					),
			),
		);
		const view = render(form(AT));
		await advance(0);
		expect(screen.getByTestId("hopper-raw-cm")).toHaveTextContent("6.1");

		// The operator captures the live distance, then edits the other field.
		fireEvent.click(screen.getByRole("button", { name: "Use as full distance" }));
		expect(screen.getByLabelText("Full Distance (cm)")).toHaveValue(6.1);
		fireEvent.change(screen.getByLabelText("Empty Distance (cm)"), {
			target: { value: "28.5" },
		});

		// 30 s later: same reading, new `Date` instance.
		view.rerender(form(AT));

		expect(screen.getByTestId("hopper-raw-cm")).toHaveTextContent("6.1");
		expect(screen.getByLabelText("Full Distance (cm)")).toHaveValue(6.1);
		expect(screen.getByLabelText("Empty Distance (cm)")).toHaveValue(28.5);
	});
});
