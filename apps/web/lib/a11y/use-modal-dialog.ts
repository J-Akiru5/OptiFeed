"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE =
	'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard and focus behaviour for a conditionally rendered modal panel (#757).
 *
 * Both the Feed Now confirmation and the biomass edit overlay were plain fixed
 * divs: no dialog role, no focus trap, no Escape, and focus was left wherever it
 * happened to be. This hook is the shared piece they can use without adopting a
 * particular visual shell, so each surface keeps its own layout.
 *
 * The caller renders the panel with `role="dialog"`, `aria-modal="true"`,
 * `aria-labelledby` pointing at its heading, `tabIndex={-1}` and this ref.
 * Mount the hook with `open`; it locks background scrolling, moves focus into
 * the panel, traps Tab, closes on Escape and restores the previously focused
 * element when the panel closes or unmounts.
 */
export function useModalDialog<T extends HTMLElement = HTMLDivElement>(
	open: boolean,
	onClose: () => void,
) {
	const panelRef = useRef<T>(null);
	// The listener is installed once per open; a fresh `onClose` identity must
	// not tear down and re-run the focus move, which would steal focus back from
	// a field the user just reached.
	const onCloseRef = useRef(onClose);

	useEffect(() => {
		onCloseRef.current = onClose;
	}, [onClose]);

	useEffect(() => {
		if (!open) return;
		const panel = panelRef.current;
		const previousOverflow = document.body.style.overflow;
		const previouslyFocused =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		document.body.style.overflow = "hidden";

		const getFocusable = () =>
			panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];

		const initial = getFocusable()[0] ?? panel;
		initial?.focus();

		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				event.preventDefault();
				onCloseRef.current();
				return;
			}
			if (event.key !== "Tab") return;

			const focusable = getFocusable();
			if (focusable.length === 0) {
				event.preventDefault();
				panel?.focus();
				return;
			}

			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			const active = document.activeElement;
			if (event.shiftKey && (active === first || active === panel)) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && active === last) {
				event.preventDefault();
				first.focus();
			}
		}

		window.addEventListener("keydown", onKeyDown);
		return () => {
			document.body.style.overflow = previousOverflow;
			window.removeEventListener("keydown", onKeyDown);
			previouslyFocused?.focus();
		};
	}, [open]);

	return panelRef;
}
