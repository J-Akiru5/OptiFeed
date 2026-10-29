"use client";

import { cn } from "@/lib/utils";
import { Info } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Tooltip box width; also used to clamp it inside the viewport. */
const TOOLTIP_WIDTH = 256;
const VIEWPORT_MARGIN = 8;
/** Rough height used only to decide whether the box opens above or below. */
const TOOLTIP_ESTIMATED_HEIGHT = 88;

/**
 * A term that keeps its abbreviation visible but explains it on demand.
 *
 * The explanation is always in the document, referenced by `aria-describedby`,
 * so screen readers announce it when the trigger gets focus. Sighted readers
 * get the same text in a tooltip on hover (the whole label is the hover target)
 * or keyboard focus. The tooltip is portalled and `fixed`, so it never pushes
 * card content or gets clipped by a card's `overflow-hidden`.
 */
export function TermInfo({
	label,
	hint,
	description,
	className,
}: {
	/** The visible label, abbreviation included. */
	label: ReactNode;
	/** Accessible name for the info trigger, e.g. "What does FCR mean?". */
	hint: string;
	/** What the abbreviation expands to and what the number means. */
	description: string;
	className?: string;
}) {
	const descriptionId = useId();
	const triggerRef = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	const [position, setPosition] = useState({ top: 0, left: 0 });

	const place = useCallback(() => {
		const trigger = triggerRef.current;
		if (!trigger) return;
		const rect = trigger.getBoundingClientRect();
		const width = Math.min(TOOLTIP_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
		const maxLeft = window.innerWidth - VIEWPORT_MARGIN - width;
		const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft));
		const below = rect.bottom + VIEWPORT_MARGIN;
		const above = rect.top - VIEWPORT_MARGIN - TOOLTIP_ESTIMATED_HEIGHT;
		const fitsBelow = below + TOOLTIP_ESTIMATED_HEIGHT <= window.innerHeight;
		setPosition({ top: fitsBelow || above < VIEWPORT_MARGIN ? below : above, left });
	}, []);

	const show = useCallback(() => {
		place();
		setOpen(true);
	}, [place]);

	const close = useCallback(() => setOpen(false), []);

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			close();
		};
		// The box is positioned once; a scroll or resize would leave it behind.
		const onViewportChange = () => close();
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("scroll", onViewportChange, true);
		window.addEventListener("resize", onViewportChange);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("scroll", onViewportChange, true);
			window.removeEventListener("resize", onViewportChange);
		};
	}, [close, open]);

	return (
		<span
			data-term-info=""
			className={cn("inline-flex max-w-full items-center gap-1 align-middle", className)}
			onPointerEnter={show}
			onPointerLeave={() => {
				if (document.activeElement !== triggerRef.current) close();
			}}
		>
			<span>{label}</span>
			<button
				ref={triggerRef}
				type="button"
				aria-label={hint}
				aria-describedby={descriptionId}
				className="-my-1 inline-flex h-5 w-5 shrink-0 cursor-help items-center justify-center rounded-full text-current opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-1 focus-visible:ring-offset-transparent"
				onFocus={show}
				onBlur={close}
				onClick={show}
			>
				<Info aria-hidden="true" className="h-3.5 w-3.5" />
			</button>
			<span id={descriptionId} className="sr-only">
				{description}
			</span>
			{open
				? createPortal(
						<span
							data-term-tooltip=""
							aria-hidden="true"
							style={{ top: position.top, left: position.left, width: TOOLTIP_WIDTH }}
							className="pointer-events-none fixed z-[70] max-w-[calc(100vw-1rem)] rounded-xl border border-white/10 bg-[#0A3D62] px-3 py-2 text-left text-[11px] font-semibold normal-case leading-snug tracking-normal text-white shadow-xl dark:bg-gray-800"
						>
							{description}
						</span>,
						document.body,
					)
				: null}
		</span>
	);
}
