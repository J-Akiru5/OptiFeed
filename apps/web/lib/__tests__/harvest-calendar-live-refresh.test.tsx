import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * #830: `DashboardLiveRefresh` calls `router.refresh()` every 30 s (and on
 * `visibilitychange`), so the harvest calendar is re-rendered from a fresh RSC
 * payload while the operator's pond/type selection lives only in state.
 *
 * The hydration effect used to depend on the `ponds` array, which is a new
 * array on every payload, so it re-read the URL and overwrote whatever had been
 * selected since. These checks hydrate from the URL on mount, then prove the
 * selection survives a refresh — including when the URL write was throttled and
 * the two have diverged.
 */

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	// Memoise per namespace. The component's fetch effects depend on `t`, and the
	// real next-intl translator is stable; a fresh function per render would make
	// those effects re-run forever inside `act`.
	const translators = new Map<string, ReturnType<typeof createTranslator>>();
	return {
		useTranslations: (namespace: string) => {
			const cached = translators.get(namespace);
			if (cached) return cached;
			const translator = createTranslator(namespace);
			translators.set(namespace, translator);
			return translator;
		},
		useLocale: () => "en",
	};
});

vi.mock("next/dynamic", () => ({
	// The month grid is client-only; the surrounding chrome is what we assert on.
	default: () => () => null,
}));

vi.mock("@/i18n/routing", () => ({
	Link: ({ href, children }: { href: string; children?: ReactNode }) => (
		<a href={href}>{children}</a>
	),
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/api-client", () => ({
	apiGet: vi.fn(async () => ({ events: [], truncated: false })),
	ApiClientError: class extends Error {},
}));

vi.mock("@/lib/actions/crop-cycle", () => ({
	cancelCropCycle: vi.fn(),
	updateCropCycle: vi.fn(),
	createCropCycle: vi.fn(),
	markCycleHarvested: vi.fn(),
}));

vi.mock("@/lib/actions/pond-event", () => ({
	completePondEvent: vi.fn(),
	uncompletePondEvent: vi.fn(),
	updatePondEvent: vi.fn(),
	createPondEvent: vi.fn(),
	deletePondEvent: vi.fn(),
}));

import { HarvestCalendar } from "@/components/harvest/harvest-calendar";
import type { PondOption } from "@/lib/crop-cycle/types";

function pond(id: string, name: string): PondOption {
	return {
		id,
		name,
		isFallow: false,
		population: 1000,
		areaM2: 500,
		averageDepthM: 1.5,
		savedTargetWeightG: null,
	};
}

const ponds: PondOption[] = [pond("pond-1", "Pond 1"), pond("pond-2", "Pond 2")];

function calendar(list: PondOption[] = ponds) {
	return (
		<HarvestCalendar
			initialPondId="pond-1"
			initialPondName="Pond 1"
			initialPondIsFallow={false}
			ponds={list}
			activeCycle={null}
			activeCycles={[]}
			recentCycles={[]}
			canManage
			today="2026-11-04"
			hopperLevelPct={50}
		/>
	);
}

/** Let the calendar's event fetches settle so no state update lands later. */
async function flush() {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

const pondSelect = () => screen.getByLabelText("All ponds") as HTMLSelectElement;
const chip = (name: string) => screen.getByRole("button", { name });

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.clearAllMocks();
	window.history.replaceState(null, "", "/");
});

describe("HarvestCalendar keeps the URL filters (#830)", () => {
	it("hydrates the pond and event-type selection from the URL on mount", async () => {
		window.history.replaceState(null, "", "/dashboard/calendar?pond=pond-2&types=sampling");
		render(calendar());
		await flush();

		expect(pondSelect().value).toBe("pond-2");
		expect(chip("Sampling")).toHaveAttribute("aria-pressed", "true");
		expect(chip("Harvest")).toHaveAttribute("aria-pressed", "false");
	});

	it("restores 'all ponds' from the URL", async () => {
		window.history.replaceState(null, "", "/dashboard/calendar?pond=all");
		render(calendar());
		await flush();

		expect(pondSelect().value).toBe("all");
	});

	it("keeps the operator's selection when a new pond array arrives", async () => {
		window.history.replaceState(null, "", "/dashboard/calendar?pond=pond-1&types=harvest");
		// The browser throttled (or refused) the URL write, so the URL keeps the
		// value it had at mount while the operator moves on.
		const write = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
		const view = render(calendar());
		await flush();

		fireEvent.change(pondSelect(), { target: { value: "pond-2" } });
		fireEvent.click(chip("Sampling"));

		expect(pondSelect().value).toBe("pond-2");
		expect(chip("Sampling")).toHaveAttribute("aria-pressed", "true");
		expect(window.location.search).toBe("?pond=pond-1&types=harvest");

		// 30 s later: `router.refresh()` re-deserialises the payload, so `ponds`
		// is a deep-equal but brand-new array.
		write.mockClear();
		view.rerender(calendar(ponds.map((item) => ({ ...item }))));
		await flush();

		expect(pondSelect().value).toBe("pond-2");
		expect(chip("Sampling")).toHaveAttribute("aria-pressed", "true");
		expect(chip("Harvest")).toHaveAttribute("aria-pressed", "true");
	});

	it("still writes the URL when the operator changes the selection", async () => {
		window.history.replaceState(null, "", "/dashboard/calendar?pond=pond-1&types=harvest");
		render(calendar());
		await flush();

		fireEvent.change(pondSelect(), { target: { value: "pond-2" } });

		expect(window.location.search).toBe("?pond=pond-2&types=harvest");
	});
});
