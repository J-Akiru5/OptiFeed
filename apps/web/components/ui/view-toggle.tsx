"use client";

import { cn } from "@/lib/utils";
import { LayoutGrid, List } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

/**
 * List/card switch for every item list (decision E2).
 *
 * The default is the responsive one every list already had: cards below 768 px
 * and the table from 768 px up. A reader can override that per page, and the
 * choice is remembered in `localStorage`. The first render is always the
 * responsive default (no hydration mismatch); the stored choice is applied
 * after mount.
 *
 * Visibility is driven by `data-list-view` on the wrapper and the
 * `.data-list-table` / `.data-list-cards` markers in `globals.css`, so both
 * views stay in the markup, keep search and numbered pagination working, and
 * an explicit choice can override the responsive default.
 */

export type ListViewMode = "list" | "cards";

const STORAGE_PREFIX = "ofd:list-view:";
export const MOBILE_VIEW_QUERY = "(max-width: 767px)";

export function listViewStorageKey(pageKey: string): string {
	return `${STORAGE_PREFIX}${pageKey}`;
}

/** Read the remembered choice. Storage can be missing or throw in private mode. */
export function readStoredListView(pageKey: string): ListViewMode | null {
	if (typeof window === "undefined") return null;
	try {
		const stored = window.localStorage.getItem(listViewStorageKey(pageKey));
		return stored === "list" || stored === "cards" ? stored : null;
	} catch {
		return null;
	}
}

/** Remember the choice. A failed write must never break the page. */
export function storeListView(pageKey: string, mode: ListViewMode): void {
	try {
		window.localStorage.setItem(listViewStorageKey(pageKey), mode);
	} catch {
		// Storage is unavailable (private mode, quota, embedded webview): the
		// choice still applies for this visit through React state.
	}
}

export interface ListViewPreference {
	mode: ListViewMode;
	/** Apply and remember a choice. */
	choose: (mode: ListViewMode) => void;
	/** False until the client has resolved the stored choice or the viewport. */
	resolved: boolean;
}

/**
 * Resolve the list/card choice for one page key.
 *
 * Renders the list on the server and during hydration, then applies the stored
 * choice, else the viewport default. Until the reader chooses, it follows
 * viewport changes so a rotated tablet matches its width.
 */
export function useListViewPreference(pageKey: string): ListViewPreference {
	const [mode, setMode] = useState<ListViewMode>("list");
	const [resolved, setResolved] = useState(false);
	const chosen = useRef(false);

	useEffect(() => {
		const stored = readStoredListView(pageKey);
		if (stored) chosen.current = true;

		const query =
			typeof window.matchMedia === "function" ? window.matchMedia(MOBILE_VIEW_QUERY) : null;
		setMode(stored ?? (query?.matches ? "cards" : "list"));
		setResolved(true);

		if (!query) return;
		const onChange = (event: MediaQueryListEvent) => {
			if (!chosen.current) setMode(event.matches ? "cards" : "list");
		};
		query.addEventListener("change", onChange);
		return () => query.removeEventListener("change", onChange);
	}, [pageKey]);

	const choose = useCallback(
		(next: ListViewMode) => {
			chosen.current = true;
			setMode(next);
			storeListView(pageKey, next);
		},
		[pageKey],
	);

	return { mode, choose, resolved };
}

export interface ViewToggleProps {
	mode: ListViewMode;
	onChange: (mode: ListViewMode) => void;
	listLabel: string;
	cardsLabel: string;
	/** Accessible name for the segmented control group. */
	label: string;
	className?: string;
}

const optionClass =
	"inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-black transition-colors focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea]";
const activeClass = "bg-[#0A3D62] text-white shadow-sm";
const idleClass =
	"text-[#3D5568] hover:bg-[#F4F7F6] dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100";

/** Segmented List/Card control with 44 px targets and `aria-pressed`. */
export function ViewToggle({
	mode,
	onChange,
	listLabel,
	cardsLabel,
	label,
	className,
}: ViewToggleProps) {
	const options = [
		{ value: "list" as const, label: listLabel, Icon: List },
		{ value: "cards" as const, label: cardsLabel, Icon: LayoutGrid },
	];

	return (
		<fieldset
			aria-label={label}
			className={cn(
				"m-0 inline-flex border-0 p-0",
				"rounded-xl border border-gray-200 bg-white p-0.5 shadow-sm dark:border-gray-700 dark:bg-gray-900",
				className,
			)}
		>
			{options.map(({ value, label: optionLabel, Icon }) => {
				const active = mode === value;
				return (
					<button
						key={value}
						type="button"
						aria-pressed={active}
						onClick={() => onChange(value)}
						className={cn(optionClass, active ? activeClass : idleClass)}
					>
						<Icon aria-hidden="true" className="h-4 w-4" />
						{optionLabel}
					</button>
				);
			})}
		</fieldset>
	);
}

export interface ListViewProps {
	/** Stable page key, e.g. `admin-users`. The stored choice is per key. */
	pageKey: string;
	listLabel: string;
	cardsLabel: string;
	/** Accessible name of the control, e.g. "Layout". */
	toggleLabel: string;
	/** The table (mark it `.data-list-table`) and the card list (`.data-list-cards`). */
	children: ReactNode;
	className?: string;
}

/**
 * Wraps one list with its List/Card control.
 *
 * The children must contain exactly the table view and the card view, marked
 * with `data-list-table` / `data-list-cards` so the CSS can switch between them
 * without unmounting either.
 */
export function ListView({
	pageKey,
	listLabel,
	cardsLabel,
	toggleLabel,
	children,
	className,
}: ListViewProps) {
	const { mode, choose, resolved } = useListViewPreference(pageKey);

	return (
		<div data-list-view={resolved ? mode : undefined} className={cn("space-y-3", className)}>
			<div className="flex justify-end">
				<ViewToggle
					mode={mode}
					onChange={choose}
					listLabel={listLabel}
					cardsLabel={cardsLabel}
					label={toggleLabel}
				/>
			</div>
			{children}
		</div>
	);
}
