"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dialog behaviour shared by the dashboard overlays (#757).
 *
 * The panel gets `role="dialog"`/`aria-modal` from the caller. This hook adds
 * the parts that cannot be declared: initial focus, a Tab loop, Escape to
 * close, a scroll lock, and returning focus to the control that opened it.
 *
 * `data-autofocus` on a descendant overrides the first-focusable choice, which
 * keeps the destructive action from being focused by default.
 */
export function useModalDialog<T extends HTMLElement = HTMLDivElement>(
	open: boolean,
	onClose: () => void,
) {
	const panelRef = useRef<T>(null);
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	useEffect(() => {
		if (!open) return;
		const panel = panelRef.current;
		const previouslyFocused =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		const focusTimer = setTimeout(() => {
			const target =
				panel?.querySelector<HTMLElement>("[data-autofocus]") ??
				panel?.querySelector<HTMLElement>(FOCUSABLE);
			(target ?? panel)?.focus();
		}, 0);

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onCloseRef.current();
				return;
			}
			if (event.key !== "Tab") return;

			const focusable = panel
				? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
						(element) => element.tabIndex >= 0,
					)
				: [];
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
		};

		window.addEventListener("keydown", onKeyDown);
		return () => {
			clearTimeout(focusTimer);
			window.removeEventListener("keydown", onKeyDown);
			document.body.style.overflow = previousOverflow;
			previouslyFocused?.focus();
		};
	}, [open]);

	return panelRef;
}
