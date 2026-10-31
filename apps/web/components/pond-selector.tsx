"use client";

import { switchPond } from "@/lib/actions/pond-selection";
import { cn } from "@/lib/utils";
import { Check, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";

export interface PondSelectorProps {
	/** Only the ponds the signed-in user may switch to, resolved on the server. */
	ponds: { id: string; name: string }[];
	activePondId: string;
	className?: string;
}

/**
 * The dashboard pond switcher (issue #303).
 *
 * The server resolves the list with the same owner + ACTIVE scope every
 * dashboard read uses, so this component never decides authorization: it
 * renders what it was given and the `switchPond` action re-validates the id
 * before writing the cookie.
 *
 * Interaction is a menu of radio items: the trigger is labelled with the
 * active pond, `aria-expanded` reports the popup, and the items expose
 * `aria-checked`. Arrow keys, Home/End, Enter/Space (the native button
 * activation) and Escape all work without a pointer; focus returns to the
 * trigger when the menu closes.
 */
export function PondSelector({ ponds, activePondId, className }: PondSelectorProps) {
	const t = useTranslations("dashboard.pondSwitcher");
	const tCommon = useTranslations("dashboard.common");
	const [isOpen, setIsOpen] = useState(false);
	const [isPending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
	/** Which option to focus the next time the menu opens. */
	const openIndexRef = useRef(0);
	const listId = useId();

	const activePond = ponds.find((pond) => pond.id === activePondId) ?? ponds[0];

	const close = useCallback((restoreFocus = false) => {
		setIsOpen(false);
		setError(null);
		if (restoreFocus) triggerRef.current?.focus();
	}, []);

	const open = useCallback(() => {
		openIndexRef.current = Math.max(
			0,
			ponds.findIndex((pond) => pond.id === activePondId),
		);
		setIsOpen(true);
	}, [ponds, activePondId]);

	// A pointer press anywhere outside the control dismisses the menu, the same
	// way the profile and language menus behave.
	useEffect(() => {
		if (!isOpen) return;
		const onPointerDown = (event: PointerEvent) => {
			if (!containerRef.current?.contains(event.target as Node)) close();
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [isOpen, close]);

	// Focus the current pond when the menu opens, so a keyboard or screen-reader
	// user starts on the selected option rather than at the top of the list.
	// Deliberately only on open: a live dashboard refresh re-renders the props
	// and must not pull focus back while the reader is moving through the list.
	useEffect(() => {
		if (!isOpen) return;
		const timer = window.setTimeout(() => itemRefs.current[openIndexRef.current]?.focus(), 0);
		return () => window.clearTimeout(timer);
	}, [isOpen]);

	const handleSwitch = (pondId: string) => {
		if (pondId === activePondId) {
			close(true);
			return;
		}
		setError(null);
		startTransition(async () => {
			try {
				await switchPond(pondId);
				close(true);
			} catch {
				// The action's own message is for logs, not for the header; the
				// reader gets a short retry hint instead.
				setError(t("switchFailed"));
			}
		});
	};

	const focusItem = (index: number) => {
		const count = itemRefs.current.length;
		if (count === 0) return;
		const next = ((index % count) + count) % count;
		itemRefs.current[next]?.focus();
	};

	const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if (event.key === "Escape") {
			event.preventDefault();
			close(true);
			return;
		}
		if (event.key === "Tab") {
			// Let the browser move focus; closing on blur would unmount the menu
			// before the next control is found, so close now and keep the default
			// Tab behaviour.
			close();
			return;
		}
		const focused = itemRefs.current.indexOf(document.activeElement as HTMLButtonElement);
		if (event.key === "ArrowDown") {
			event.preventDefault();
			focusItem(focused + 1);
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			focusItem(focused - 1);
			return;
		}
		if (event.key === "Home") {
			event.preventDefault();
			focusItem(0);
			return;
		}
		if (event.key === "End") {
			event.preventDefault();
			focusItem(itemRefs.current.length - 1);
		}
	};

	const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		event.preventDefault();
		open();
	};

	if (ponds.length === 0) {
		return (
			<span
				className={cn("inline-block max-w-[13rem] text-xs font-bold text-white/80", className)}
				title={tCommon("noPondDesc")}
			>
				{tCommon("noPondTitle")}
			</span>
		);
	}

	// A single pond still renders the trigger: a static label looked like plain
	// header text, so nobody could tell the switcher existed. The menu simply
	// lists the one pond, already checked.
	return (
		<div className={cn("relative", className)} ref={containerRef}>
			<button
				ref={triggerRef}
				type="button"
				onClick={() => (isOpen ? close(true) : open())}
				onKeyDown={onTriggerKeyDown}
				disabled={isPending}
				aria-haspopup="menu"
				aria-expanded={isOpen}
				aria-controls={isOpen ? listId : undefined}
				aria-label={t("labelNamed", { name: activePond?.name ?? "" })}
				aria-busy={isPending}
				className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-lg text-xs font-bold text-white uppercase tracking-wider transition-colors hover:text-white/80 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A3D62] focus-visible:outline-none disabled:opacity-60"
			>
				<span className="truncate">{isPending ? t("switching") : activePond?.name}</span>
				<ChevronDown
					aria-hidden="true"
					className={cn("h-3 w-3 shrink-0 transition-transform", isOpen && "rotate-180")}
				/>
			</button>

			{isOpen && (
				<div
					id={listId}
					role="menu"
					aria-label={t("listLabel")}
					onKeyDown={onMenuKeyDown}
					className="absolute top-full left-0 z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-gray-200 bg-white py-1 text-left shadow-xl dark:border-gray-700 dark:bg-gray-900"
				>
					{error && (
						<p
							role="alert"
							className="px-4 py-2 text-xs font-bold text-[#C42B3A] dark:text-red-400"
						>
							{error}
						</p>
					)}
					{ponds.map((pond, index) => {
						const isSelected = pond.id === activePondId;
						return (
							<button
								key={pond.id}
								ref={(node) => {
									itemRefs.current[index] = node;
								}}
								type="button"
								role="menuitemradio"
								aria-checked={isSelected}
								aria-disabled={isPending}
								tabIndex={-1}
								onClick={() => {
									if (!isPending) handleSwitch(pond.id);
								}}
								className={cn(
									"flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-bold transition-colors focus-visible:ring-2 focus-visible:ring-[#E85A2A] focus-visible:ring-inset focus-visible:outline-none aria-disabled:opacity-60",
									isSelected
										? "bg-[#0A3D62] text-white dark:bg-[#5b9bd5] dark:text-gray-950"
										: "text-[#0A3D62] hover:bg-[#F4F7F6] dark:text-gray-100 dark:hover:bg-gray-800",
								)}
							>
								<span className="truncate">{pond.name}</span>
								{isSelected && <Check aria-hidden="true" className="h-4 w-4 shrink-0" />}
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}
