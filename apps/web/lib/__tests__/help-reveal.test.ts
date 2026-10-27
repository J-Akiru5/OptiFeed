import {
	HELP_PENDING_TTL_MS,
	claimHelpTarget,
	clearHelpTarget,
	peekHelpTarget,
	requestHelpTarget,
	revealHelpTarget,
} from "@/lib/help/reveal";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	clearHelpTarget();
	document.body.innerHTML = "";
});

describe("the cross-page request", () => {
	it("waits for its own route, and only once", () => {
		const request = requestHelpTarget("calibration-form", "/dashboard/settings/hardware", 1000);

		expect(peekHelpTarget("/dashboard/schedule", 1000)).toBeNull();
		expect(peekHelpTarget("/dashboard/settings/hardware", 1000)?.id).toBe(request.id);

		expect(claimHelpTarget(request)).toBe(true);
		expect(claimHelpTarget(request)).toBe(false);
		expect(peekHelpTarget("/dashboard/settings/hardware", 1000)).toBeNull();
	});

	it("drops a request the reader abandoned", () => {
		requestHelpTarget("calibration-form", "/dashboard/settings/hardware", 1000);
		expect(
			peekHelpTarget("/dashboard/settings/hardware", 1000 + HELP_PENDING_TTL_MS + 1),
		).toBeNull();
	});
});

describe("revealHelpTarget", () => {
	it("waits for the control's box to settle, then highlights it", () => {
		document.body.innerHTML = '<button data-help="calibration-form">Calibrate</button>';
		const timers: (() => void)[] = [];
		const highlight = vi.fn(() => true);

		const stop = revealHelpTarget("calibration-form", {
			intervalMs: 10,
			requestTimer: (callback) => {
				timers.push(callback);
				return timers.length;
			},
			cancelTimer: () => undefined,
			highlight,
		});

		// First look is synchronous: the box is recorded but not yet stable.
		expect(highlight).not.toHaveBeenCalled();
		timers.shift()?.();
		timers.shift()?.();
		expect(highlight).toHaveBeenCalledWith("calibration-form", document);
		stop();
	});

	it("reports a missing control after the timeout instead of ringing nothing", () => {
		const onMissing = vi.fn();
		let clock = 0;
		const timers: (() => void)[] = [];

		revealHelpTarget("never-there", {
			timeoutMs: 100,
			intervalMs: 10,
			now: () => clock,
			requestTimer: (callback) => {
				timers.push(callback);
				return timers.length;
			},
			cancelTimer: () => undefined,
			onMissing,
		});

		clock = 101;
		timers.shift()?.();
		expect(onMissing).toHaveBeenCalledOnce();
	});
});
