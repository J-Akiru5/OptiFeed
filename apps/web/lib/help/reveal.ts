/**
 * Navigating to a control a help item points at, then ringing it.
 *
 * An item can be about a control on another screen. The sheet closes, remembers
 * which anchor to ring, and pushes the route. The shell that arrives asks for
 * that request by its own path, and only then starts looking for the control:
 * the order is navigate first, ring later.
 *
 * A new page renders before its data and fonts have settled, so the ring waits
 * for the control to exist, then for its box to stay in the same place for two
 * polls. Ringing on the first poll is what puts the ring where a control used
 * to be.
 */

import { findHelpTarget, highlightHelpTarget } from "./highlight";

/** How long to keep looking for a control after a route change. */
export const HELP_REVEAL_TIMEOUT_MS = 6000;

/** How often the reveal looks for the control. */
export const HELP_REVEAL_POLL_MS = 100;

/** Polls the control's box must stay put before the ring is drawn. */
const HELP_SETTLE_POLLS = 2;

/** A request older than this was abandoned (slow page, or the reader navigated away). */
export const HELP_PENDING_TTL_MS = 15000;

export interface PendingHelpTarget {
	id: number;
	/** The `data-help` anchor to ring. */
	target: string;
	/** The locale-less route that holds it. */
	route: string;
	requestedAt: number;
}

let nextRequestId = 1;
let pending: PendingHelpTarget | null = null;

/** Remembers the control to ring once the route that holds it is on screen. */
export function requestHelpTarget(
	target: string,
	route: string,
	now: number = Date.now(),
): PendingHelpTarget {
	pending = { id: nextRequestId++, target, route, requestedAt: now };
	return pending;
}

/**
 * The request waiting for this path, if any. Not consumed: the component that
 * reached the page may be unmounted by the navigation that brought the reader
 * here, so a replacement must be able to find the same request.
 * `claimHelpTarget` decides which one rings it.
 */
export function peekHelpTarget(path: string, now: number = Date.now()): PendingHelpTarget | null {
	if (!pending) return null;
	if (now - pending.requestedAt > HELP_PENDING_TTL_MS) {
		pending = null;
		return null;
	}
	return pending.route === path ? pending : null;
}

/** Takes the request exactly once, so two mounted shells cannot draw two rings. */
export function claimHelpTarget(request: PendingHelpTarget): boolean {
	if (pending?.id !== request.id) return false;
	pending = null;
	return true;
}

/** Drops a request without ringing anything. */
export function clearHelpTarget(): void {
	pending = null;
}

export interface RevealOptions {
	doc?: Document;
	timeoutMs?: number;
	intervalMs?: number;
	/** Returns false when the control vanished between the lookup and the draw. */
	highlight?: (target: string, doc: Document) => boolean;
	onMissing?: () => void;
	now?: () => number;
	requestTimer?: (callback: () => void, ms: number) => number;
	cancelTimer?: (handle: number) => void;
}

function sameBox(a: DOMRect | null, b: DOMRect): boolean {
	if (!a) return false;
	return (
		Math.abs(a.top - b.top) < 1 &&
		Math.abs(a.left - b.left) < 1 &&
		Math.abs(a.width - b.width) < 1 &&
		Math.abs(a.height - b.height) < 1
	);
}

/**
 * Waits for the control to exist, waits for its box to settle, then highlights
 * it. Returns a cancel function for the caller's effect cleanup.
 */
export function revealHelpTarget(target: string, options: RevealOptions = {}): () => void {
	const doc = options.doc ?? document;
	const now = options.now ?? (() => Date.now());
	const intervalMs = options.intervalMs ?? HELP_REVEAL_POLL_MS;
	const requestTimer = options.requestTimer ?? ((callback, ms) => window.setTimeout(callback, ms));
	const cancelTimer = options.cancelTimer ?? ((handle) => window.clearTimeout(handle));
	const highlight = options.highlight ?? ((name, root) => highlightHelpTarget(name, root));
	const timeoutMs = options.timeoutMs ?? HELP_REVEAL_TIMEOUT_MS;
	const started = now();

	let cancelled = false;
	let timer: number | null = null;
	let lastBox: DOMRect | null = null;
	let steadyPolls = 0;

	const stop = () => {
		cancelled = true;
		if (timer !== null) cancelTimer(timer);
		timer = null;
	};

	const tick = () => {
		timer = null;
		if (cancelled) return;

		if (now() - started > timeoutMs) {
			stop();
			options.onMissing?.();
			return;
		}

		const element = findHelpTarget(doc, target);
		if (!element) {
			lastBox = null;
			steadyPolls = 0;
			timer = requestTimer(tick, intervalMs);
			return;
		}

		const box = element.getBoundingClientRect();
		if (sameBox(lastBox, box)) {
			steadyPolls += 1;
		} else {
			lastBox = box;
			steadyPolls = 0;
		}

		if (steadyPolls >= HELP_SETTLE_POLLS) {
			stop();
			if (!highlight(target, doc)) options.onMissing?.();
			return;
		}

		timer = requestTimer(tick, intervalMs);
	};

	// The first look is synchronous, so a control that is already on screen is
	// rung without a visible delay.
	tick();
	return stop;
}
