import {
	ListView,
	ViewToggle,
	listViewStorageKey,
	readStoredListView,
	storeListView,
} from "@/components/ui/view-toggle";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
	window.localStorage.clear();
});

afterEach(() => {
	vi.restoreAllMocks();
});

function renderList(pageKey = "test-page") {
	return render(
		<ListView pageKey={pageKey} listLabel="List" cardsLabel="Cards" toggleLabel="Layout">
			<table className="data-list-table">
				<tbody>
					<tr>
						<td>Table view</td>
					</tr>
				</tbody>
			</table>
			<ul className="data-list-cards">
				<li>Card view</li>
			</ul>
		</ListView>,
	);
}

describe("ViewToggle (E2)", () => {
	it("offers List and Cards with aria-pressed on the active one", () => {
		const onChange = vi.fn();
		render(
			<ViewToggle
				mode="cards"
				onChange={onChange}
				listLabel="List"
				cardsLabel="Cards"
				label="Layout"
			/>,
		);

		const list = screen.getByRole("button", { name: "List" });
		const cards = screen.getByRole("button", { name: "Cards" });
		expect(list).toHaveAttribute("aria-pressed", "false");
		expect(cards).toHaveAttribute("aria-pressed", "true");

		fireEvent.click(list);
		expect(onChange).toHaveBeenCalledWith("list");
	});

	it("names the segmented control for assistive tech", () => {
		render(
			<ViewToggle
				mode="list"
				onChange={vi.fn()}
				listLabel="List"
				cardsLabel="Cards"
				label="Layout"
			/>,
		);
		expect(screen.getByRole("group", { name: "Layout" })).toBeInTheDocument();
	});
});

describe("list view preference storage", () => {
	it("reads only the two valid values", () => {
		expect(readStoredListView("missing")).toBeNull();

		storeListView("valid", "cards");
		expect(readStoredListView("valid")).toBe("cards");
		expect(window.localStorage.getItem(listViewStorageKey("valid"))).toBe("cards");

		window.localStorage.setItem(listViewStorageKey("bogus"), "grid");
		expect(readStoredListView("bogus")).toBeNull();
	});

	it("never throws when storage is unavailable", () => {
		const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("blocked");
		});

		expect(readStoredListView("blocked")).toBeNull();
		expect(() => storeListView("blocked", "cards")).not.toThrow();

		getItem.mockRestore();
		setItem.mockRestore();
	});
});

describe("ListView (E2)", () => {
	it("renders both views so the choice switches without a reload", async () => {
		renderList();
		expect(screen.getByText("Table view")).toBeInTheDocument();
		expect(screen.getByText("Card view")).toBeInTheDocument();

		// Server render keeps the responsive default: no explicit choice yet.
		await waitFor(() => expect(screen.getByRole("group", { name: "Layout" })).toBeInTheDocument());
	});

	it("applies the stored choice after mount and remembers a new one", async () => {
		storeListView("remembered", "cards");
		const { container } = renderList("remembered");

		await waitFor(() =>
			expect(container.firstElementChild).toHaveAttribute("data-list-view", "cards"),
		);

		fireEvent.click(screen.getByRole("button", { name: "List" }));
		expect(container.firstElementChild).toHaveAttribute("data-list-view", "list");
		expect(readStoredListView("remembered")).toBe("list");
	});

	it("keeps each page's choice separate", async () => {
		storeListView("page-a", "cards");
		storeListView("page-b", "list");

		const first = renderList("page-a");
		await waitFor(() =>
			expect(first.container.firstElementChild).toHaveAttribute("data-list-view", "cards"),
		);
		first.unmount();

		const second = renderList("page-b");
		await waitFor(() =>
			expect(second.container.firstElementChild).toHaveAttribute("data-list-view", "list"),
		);
	});
});
