import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	HELP_RING_CLASS,
	clearHelpHighlight,
	drawHelpRing,
	findHelpTarget,
	highlightHelpTarget,
} from "@/lib/help/highlight";
import { afterEach, describe, expect, it, vi } from "vitest";

/** The smallest thing that behaves like the DOM for this purpose. */
function fakeRoot(anchors: string[]): ParentNode {
	return {
		querySelector: (selector: string) => {
			const match = /^\[data-help="([a-z0-9-]+)"\]$/.exec(selector);
			return match?.[1] && anchors.includes(match[1]) ? { selector } : null;
		},
	} as unknown as ParentNode;
}

afterEach(() => {
	clearHelpHighlight();
	document.body.innerHTML = "";
});

describe("findHelpTarget", () => {
	it("finds the control by its data-help attribute", () => {
		document.body.innerHTML = '<button data-help="dashboard-feed-now">Feed Now</button>';
		expect(findHelpTarget(document, "dashboard-feed-now")).not.toBeNull();
		expect(findHelpTarget(document, "dashboard-export")).toBeNull();
	});

	it("refuses anything that is not an anchor, so a guide cannot inject a selector", () => {
		const root = fakeRoot(["dashboard-feed-now"]);
		for (const bad of [
			"",
			"Dashboard",
			"dashboard feed",
			'dashboard"][data-help="x',
			"dashboard-feed-now]",
			"-starts-with-a-dash",
		]) {
			expect(findHelpTarget(root, bad), bad).toBeNull();
		}
	});

	it("accepts the anchor shape the guides actually use", () => {
		const anchor = "superadmin-devices-2";
		expect(findHelpTarget(fakeRoot([anchor]), anchor)).not.toBeNull();
	});

	it("skips a hidden copy and finds the one rendered on this screen", () => {
		const hidden = { getClientRects: () => [] };
		const shown = { getClientRects: () => [{}] };
		const root = {
			querySelectorAll: () => [hidden, shown],
		} as unknown as ParentNode;
		expect(findHelpTarget(root, "dashboard-feed-now")).toBe(shown as unknown as HTMLElement);
	});

	it("falls back to the first copy when no layout engine reports a box", () => {
		const only = { getClientRects: () => [] };
		const root = {
			querySelectorAll: () => [only],
		} as unknown as ParentNode;
		expect(findHelpTarget(root, "dashboard-feed-now")).toBe(only as unknown as HTMLElement);
	});
});

describe("the ring", () => {
	/** Enough of a DOM element for drawHelpRing: styles, one attribute, removal. */
	class FakeRing {
		className = "";
		style: Record<string, string> = {};
		attrs: Record<string, string> = {};
		removed = false;
		setAttribute(name: string, value: string) {
			this.attrs[name] = value;
		}
		remove() {
			this.removed = true;
		}
	}

	const box = { top: 10, left: 20, width: 200, height: 40 };

	it("is sized to the control's box, lives outside React's tree, and takes itself away", () => {
		const ring = new FakeRing();
		const doc = {
			createElement: () => ring,
			body: { appendChild: () => undefined },
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
		} as unknown as Document;
		const target = { getBoundingClientRect: () => box } as unknown as HTMLElement;

		const calls: (() => void)[] = [];
		const returned = drawHelpRing(doc, target, 1500, (fn) => {
			calls.push(fn);
		});

		expect(returned).toBe(ring as unknown as HTMLElement);
		expect(ring.className).toBe(HELP_RING_CLASS);
		expect(ring.attrs["aria-hidden"]).toBe("true");
		expect(ring.style).toEqual({ top: "10px", left: "20px", width: "200px", height: "40px" });

		expect(calls).toHaveLength(1);
		calls[0]?.();
		expect(ring.removed).toBe(true);
	});

	it("scrolls and focuses the control, then draws the ring", () => {
		document.body.innerHTML = '<button data-help="dashboard-feed-now">Feed Now</button>';
		const button = document.querySelector("button");
		if (!button) throw new Error("no button");
		const scrollIntoView = vi.fn();
		(button as unknown as { scrollIntoView: () => void }).scrollIntoView = scrollIntoView;

		expect(highlightHelpTarget("dashboard-feed-now")).toBe(true);
		expect(scrollIntoView).toHaveBeenCalledOnce();
		expect(document.activeElement).toBe(button);
		expect(document.querySelector(`.${HELP_RING_CLASS}`)).not.toBeNull();
	});

	it("returns false when the control is not on this screen", () => {
		expect(highlightHelpTarget("dashboard-feed-now")).toBe(false);
	});

	it("clears on Escape and on a click elsewhere", () => {
		document.body.innerHTML = '<button data-help="dashboard-feed-now">Feed Now</button>';
		highlightHelpTarget("dashboard-feed-now");
		expect(document.querySelector(`.${HELP_RING_CLASS}`)).not.toBeNull();

		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		expect(document.querySelector(`.${HELP_RING_CLASS}`)).toBeNull();

		highlightHelpTarget("dashboard-feed-now");
		expect(document.querySelector(`.${HELP_RING_CLASS}`)).not.toBeNull();

		document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(document.querySelector(`.${HELP_RING_CLASS}`)).toBeNull();
	});

	it("is a class the stylesheet knows, with a reduced-motion escape hatch", () => {
		// Renaming the class without renaming the CSS is the failure this guards.
		const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
		expect(css).toContain(`.${HELP_RING_CLASS} {`);
		expect(css).toContain("pointer-events: none");
		expect(css).toContain("prefers-reduced-motion: reduce");
	});
});
