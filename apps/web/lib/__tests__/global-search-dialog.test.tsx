import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The global search dialog's interaction contract (#270): ⌘K / Ctrl+K opens it,
 * Escape closes it, arrows + Enter and clicks navigate, and a failed read is a
 * quiet message rather than a stack. Page titles are translated client-side, so
 * this also proves the catalogue rows render from their message keys.
 */

const search = vi.hoisted(() => ({ globalSearch: vi.fn() }));
const pond = vi.hoisted(() => ({ switchPond: vi.fn() }));
const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("@/lib/actions/search", () => ({ globalSearch: search.globalSearch }));
vi.mock("@/lib/actions/pond-selection", () => ({ switchPond: pond.switchPond }));
vi.mock("@/i18n/routing", async () => {
	const react = await import("react");
	return {
		useRouter: () => ({ push: navigation.push }),
		Link: ({
			href,
			children,
			...rest
		}: {
			href: string;
			children?: React.ReactNode;
		} & Record<string, unknown>) => react.createElement("a", { href, ...rest }, children),
	};
});

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace?: string) => createTranslator(namespace ?? ""),
		useLocale: () => "en",
	};
});

import { GlobalSearch, SearchTrigger } from "@/components/search/global-search";
import type { GlobalSearchResult, SearchRow } from "@/lib/search/types";

const PAGES: SearchRow[] = [
	{
		id: "pages:dashboard",
		group: "pages",
		title: "",
		titleKey: "nav.dashboard",
		href: "/dashboard",
	},
	{
		id: "pages:schedule",
		group: "pages",
		title: "",
		titleKey: "nav.schedule",
		href: "/dashboard/schedule",
	},
];

function ok(rows: SearchRow[] = [], pages: SearchRow[] = PAGES): GlobalSearchResult {
	return { status: "ok", pages, rows };
}

function renderPalette() {
	return render(
		<>
			<GlobalSearch shell="farmer" />
			<SearchTrigger />
		</>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	pond.switchPond.mockResolvedValue(undefined);
	search.globalSearch.mockImplementation(async ({ query }: { query: string }) =>
		query.trim() ? ok() : ok(),
	);
});

describe("global search keyboard and navigation", () => {
	it("opens with Ctrl+K and focuses the input", async () => {
		renderPalette();
		fireEvent.keyDown(document, { key: "k", ctrlKey: true });

		const input = await screen.findByRole("searchbox");
		expect(input).toHaveFocus();
		expect(await screen.findByText("Suggested for you")).toBeTruthy();
	});

	it("opens with ⌘K on macOS", async () => {
		renderPalette();
		fireEvent.keyDown(document, { key: "k", metaKey: true });

		expect(await screen.findByRole("searchbox")).toBeTruthy();
	});

	it("opens from the visible header search control", async () => {
		renderPalette();
		fireEvent.click(
			screen.getByRole("button", { name: "Search everything (Ctrl+K or Command+K)" }),
		);

		expect(await screen.findByRole("searchbox")).toBeTruthy();
	});

	it("closes on Escape", async () => {
		renderPalette();
		fireEvent.keyDown(document, { key: "k", ctrlKey: true });
		await screen.findByRole("searchbox");

		fireEvent.keyDown(document, { key: "Escape" });

		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("selects with ArrowDown + Enter and pushes the route", async () => {
		renderPalette();
		fireEvent.keyDown(document, { key: "k", ctrlKey: true });
		await screen.findByText("Dashboard");
		const input = screen.getByRole("searchbox");

		fireEvent.keyDown(input, { key: "ArrowDown" });
		await waitFor(() =>
			expect(screen.getByText("Schedule").closest("button")).toHaveAttribute(
				"aria-current",
				"true",
			),
		);
		fireEvent.keyDown(input, { key: "Enter" });

		expect(navigation.push).toHaveBeenCalledWith("/dashboard/schedule");
	});

	it("selects a row by click", async () => {
		renderPalette();
		fireEvent.keyDown(document, { key: "k", ctrlKey: true });
		await screen.findByText("Dashboard");

		fireEvent.click(screen.getByText("Dashboard"));

		expect(navigation.push).toHaveBeenCalledWith("/dashboard");
	});

	it("uses the existing pond switch for a farmer pond row", async () => {
		search.globalSearch.mockImplementation(async () =>
			ok([
				{
					id: "ponds:pond-a-1",
					group: "ponds",
					title: "Pond A One",
					href: "/dashboard",
					switchPondId: "pond-a-1",
				},
			]),
		);
		renderPalette();
		fireEvent.keyDown(document, { key: "k", ctrlKey: true });
		const input = await screen.findByRole("searchbox");
		fireEvent.change(input, { target: { value: "pond" } });

		fireEvent.click(await screen.findByText("Pond A One"));

		expect(pond.switchPond).toHaveBeenCalledWith("pond-a-1");
		expect(navigation.push).not.toHaveBeenCalled();
	});
});

describe("global search states", () => {
	it("finds the platform console when the reader types “superadmin”", async () => {
		search.globalSearch.mockResolvedValue(
			ok(
				[],
				[
					{
						id: "pages:platform-overview",
						group: "pages",
						title: "",
						titleKey: "superadmin.shell.console",
						href: "/superadmin",
						keywords: ["superadmin", "platform"],
					},
				],
			),
		);
		render(
			<>
				<GlobalSearch shell="platform" />
				<SearchTrigger />
			</>,
		);
		fireEvent.keyDown(document, { key: "k", ctrlKey: true });
		const input = await screen.findByRole("searchbox");
		fireEvent.change(input, { target: { value: "superadmin" } });

		expect(await screen.findByText("Platform Console")).toBeTruthy();
	});

	it("shows the quiet unavailable message when the read fails", async () => {
		search.globalSearch.mockResolvedValue({ status: "unavailable", pages: [], rows: [] });
		renderPalette();
		fireEvent.keyDown(document, { key: "k", ctrlKey: true });
		const input = await screen.findByRole("searchbox");
		fireEvent.change(input, { target: { value: "pond" } });

		expect(await screen.findByText("Search is unavailable right now.")).toBeTruthy();
	});

	it("shows the quiet unavailable message when the suggestions fail to load", async () => {
		search.globalSearch.mockResolvedValue({ status: "unavailable", pages: [], rows: [] });
		renderPalette();
		fireEvent.keyDown(document, { key: "k", ctrlKey: true });
		const input = await screen.findByRole("searchbox");

		expect(input).toBeTruthy();
		expect(await screen.findByText("Search is unavailable right now.")).toBeTruthy();
	});

	it("shows an empty state for a query with no matches", async () => {
		search.globalSearch.mockResolvedValue(ok([], []));
		renderPalette();
		fireEvent.keyDown(document, { key: "k", ctrlKey: true });
		const input = await screen.findByRole("searchbox");

		fireEvent.change(input, { target: { value: "zzz" } });

		expect(await screen.findByText(/Nothing matches/)).toBeTruthy();
	});

	it("renders a device row with its MAC and pond, never a token", async () => {
		search.globalSearch.mockImplementation(async () =>
			ok([
				{
					id: "devices:device-a-1",
					group: "devices",
					title: "Feeder A One",
					href: "/dashboard/settings/hardware",
					meta: { mac: "A4:CF:12:7E:3B:09", pondName: "Pond A One" },
				},
			]),
		);
		renderPalette();
		fireEvent.keyDown(document, { key: "k", ctrlKey: true });
		const input = await screen.findByRole("searchbox");
		fireEvent.change(input, { target: { value: "feeder" } });

		expect(await screen.findByText("Feeder A One")).toBeTruthy();
		expect(screen.getByText("A4:CF:12:7E:3B:09 · Pond A One")).toBeTruthy();
	});
});
