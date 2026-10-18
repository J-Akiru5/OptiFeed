import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Markdown } from "@/components/chat/markdown";

let errorSpy: ReturnType<typeof vi.spyOn>;

/**
 * React renders duplicate-keyed children anyway — it only warns and breaks
 * identity tracking — so counting DOM nodes cannot detect the bug. The
 * console.error warning is the only reliable signal.
 */
function duplicateKeyWarnings(): string[] {
	return errorSpy.mock.calls
		.map((args) => args.map(String).join(" "))
		.filter((msg) => msg.includes("same key") || msg.includes("Keys should be unique"));
}

function renderMarkdown(text: string) {
	return render(<Markdown text={text} />);
}

describe("Markdown key stability", () => {
	beforeEach(() => {
		errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		errorSpy.mockRestore();
	});

	// The regression: flushList was keyed `p-${lineNo}`, the same key the
	// paragraph pushed immediately after it received.
	it("does not warn when a bullet list is followed by a paragraph", () => {
		const { container } = renderMarkdown("- alpha\n- beta\nhello world");

		expect(duplicateKeyWarnings()).toEqual([]);
		expect(container.querySelector("ul")).toHaveTextContent("alpha");
		expect(container.querySelector("ul")).toHaveTextContent("beta");
		expect(container.querySelector("p")).toHaveTextContent("hello world");
	});

	it("does not warn when a numbered list is followed by a paragraph", () => {
		const { container } = renderMarkdown("1. first\n2. second\ntrailing");

		expect(duplicateKeyWarnings()).toEqual([]);
		expect(container.querySelector("ol")).toHaveTextContent("first");
		expect(container.querySelector("p")).toHaveTextContent("trailing");
	});

	it("does not warn when two differently-typed lists abut a paragraph", () => {
		const { container } = renderMarkdown("- bullet\n1. numbered\ntail");

		expect(duplicateKeyWarnings()).toEqual([]);
		expect(container.querySelector("ul")).toHaveTextContent("bullet");
		expect(container.querySelector("ol")).toHaveTextContent("numbered");
		expect(container.querySelector("p")).toHaveTextContent("tail");
	});

	it("does not warn for plain paragraphs", () => {
		const { container } = renderMarkdown("hello\n\nworld");

		expect(duplicateKeyWarnings()).toEqual([]);
		expect(container.querySelectorAll("p")).toHaveLength(2);
	});

	it("does not warn when the input ends with a list", () => {
		const { container } = renderMarkdown("intro\n- alpha\n- beta");

		expect(duplicateKeyWarnings()).toEqual([]);
		expect(container.querySelector("p")).toHaveTextContent("intro");
		// List items are rendered as <span>, not <li> — see the note below.
		expect(container.querySelector("ul")?.querySelectorAll("span")).toHaveLength(2);
	});

	it("renders bold and italic inline without key warnings", () => {
		const { container } = renderMarkdown("- **bold** and *italic*\ntail");

		expect(duplicateKeyWarnings()).toEqual([]);
		expect(container.querySelector("strong")).toHaveTextContent("bold");
		expect(container.querySelector("em")).toHaveTextContent("italic");
		expect(container.querySelector("p")).toHaveTextContent("tail");
	});
});
