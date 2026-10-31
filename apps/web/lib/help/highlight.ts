/**
 * The "show me" ring: finds the control a help item is about, scrolls it into
 * view, and rings it for a moment.
 *
 * The ring is a **separate element** positioned over the control rather than a
 * class on the control itself. React never sees it, so no re-render is caused
 * and nothing is left behind on the button when it fades. It never takes a
 * click either: the control stays usable while it is lit.
 *
 * The anchor is validated before it reaches a selector, so a bad guide cannot
 * inject one.
 */

/** The class the ring element carries. Styled in `app/globals.css`. */
export const HELP_RING_CLASS = "help-ring";

/** How long the ring stays. Long enough to find after the sheet closes. */
export const HELP_RING_MS = 2600;

/**
 * Dispatched (bubbling) on the target before it is scrolled to, so a container
 * that hides it, such as an inactive settings tab, can show it first.
 */
export const HELP_REVEAL_EVENT = "optifeed:help-reveal";

const ANCHOR_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** Elements worth moving the keyboard focus to. A ring around a card should not steal focus. */
const FOCUSABLE = "input, select, textarea, button, a[href], [tabindex]:not([tabindex='-1'])";

/**
 * A control is rendered when it has a box. The same anchor can appear twice for
 * responsive layouts (a desktop table and its mobile card list); the copy that
 * is hidden on this screen must not win the lookup. In a test DOM there is no
 * layout engine, so every box is empty: then the first match is all we have.
 */
function isRendered(element: HTMLElement): boolean {
	return typeof element.getClientRects !== "function" || element.getClientRects().length > 0;
}

/** The element an item points at, or null when the screen has no such control. */
export function findHelpTarget(root: ParentNode, target: string): HTMLElement | null {
	if (!ANCHOR_PATTERN.test(target)) return null;
	const selector = `[data-help="${target}"]`;
	if (typeof root.querySelectorAll === "function") {
		const matches = Array.from(root.querySelectorAll<HTMLElement>(selector));
		return matches.find(isRendered) ?? matches[0] ?? null;
	}
	return root.querySelector<HTMLElement>(selector);
}

interface ActiveRing {
	element: HTMLElement;
	detach: () => void;
}

let activeRing: ActiveRing | null = null;

/** Removes the ring and its dismissal listeners. Safe to call when none is drawn. */
export function clearHelpHighlight(doc: Document = document): void {
	if (!activeRing) return;
	const { element, detach } = activeRing;
	activeRing = null;
	detach();
	element.remove();
}

/**
 * Draws the ring element over the control's box. Exported so a test can drive
 * it with a fake document and scheduler.
 */
export function drawHelpRing(
	doc: Document,
	target: HTMLElement,
	ringMs: number,
	schedule: (fn: () => void, ms: number) => unknown,
): HTMLElement {
	clearHelpHighlight(doc);

	const box = target.getBoundingClientRect();
	const ring = doc.createElement("div");
	ring.className = HELP_RING_CLASS;
	// Decorative: the item's text already said what this is.
	ring.setAttribute("aria-hidden", "true");
	ring.style.top = `${Math.round(box.top)}px`;
	ring.style.left = `${Math.round(box.left)}px`;
	ring.style.width = `${Math.round(box.width)}px`;
	ring.style.height = `${Math.round(box.height)}px`;
	(doc.body ?? doc.documentElement).appendChild(ring);

	// Any click means "I found it", and Escape means "stop". A route change is
	// cleared by the sheet (see HelpSheet).
	const dismiss = () => clearHelpHighlight(doc);
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Escape") dismiss();
	};
	doc.addEventListener("click", dismiss, { capture: true, once: true });
	doc.addEventListener("keydown", onKeyDown);

	activeRing = {
		element: ring,
		detach: () => {
			doc.removeEventListener("click", dismiss, { capture: true });
			doc.removeEventListener("keydown", onKeyDown);
		},
	};

	schedule(dismiss, ringMs);
	return ring;
}

/**
 * Scrolls the control into view, focuses it when it takes focus, and rings it.
 * Returns false when the control is not on this screen, so the caller can say
 * so instead of doing nothing.
 *
 * The scroll is instant on purpose: a smooth scroll would still be moving when
 * the ring is placed, and the ring would sit where the control used to be.
 */
export function highlightHelpTarget(
	target: string,
	doc: Document = document,
	ringMs: number = HELP_RING_MS,
): boolean {
	const element = findHelpTarget(doc, target);
	if (!element) return false;

	element.dispatchEvent(new Event(HELP_REVEAL_EVENT, { bubbles: true }));

	// jsdom and very old browsers have no scrollIntoView; the ring still helps.
	if (typeof element.scrollIntoView === "function") {
		element.scrollIntoView({ block: "center", behavior: "auto" });
	}
	if (element.matches(FOCUSABLE) && typeof element.focus === "function") {
		element.focus({ preventScroll: true });
	}
	drawHelpRing(doc, element, ringMs, (fn, ms) => {
		window.setTimeout(fn, ms);
	});
	return true;
}
