"use client";

import { useRouter } from "@/i18n/routing";
import { switchPond } from "@/lib/actions/pond-selection";
import { globalSearch } from "@/lib/actions/search";
import type { GlobalSearchResult, SearchGroup, SearchRow, SearchShell } from "@/lib/search/types";
import { cn } from "@/lib/utils";
import {
	AlertCircle,
	CalendarClock,
	CornerDownLeft,
	Cpu,
	Droplets,
	FileText,
	Loader2,
	Search,
	SearchX,
	Users,
	X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Global search (#270): one command palette per shell, opened by ⌘K / Ctrl+K
 * or by the search field in the header.
 *
 * Each shell mounts exactly one `<GlobalSearch shell="…" />`. The visible
 * triggers call `openGlobalSearch()`, a module-level signal, so the desktop
 * field and the mobile icon open the same dialog rather than two stacked
 * copies. The dialog portals to `document.body`: the header is a sticky,
 * z-indexed stacking context, so a fixed overlay rendered inside it would sit
 * under the chat panel and the FABs.
 *
 * Page results are filtered in the browser because their labels come from the
 * current locale; data results arrive already scoped from the server action.
 * Nothing here decides authorization: the action filters both the page
 * catalogue and every entity before it returns.
 */

const openListeners = new Set<() => void>();

/** Open the mounted palette. A no-op when no shell has mounted one. */
export function openGlobalSearch() {
	for (const listener of openListeners) listener();
}

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const GROUP_ICON = {
	pages: FileText,
	ponds: Droplets,
	devices: Cpu,
	members: Users,
	records: CalendarClock,
} as const;

const GROUP_ORDER: SearchGroup[] = ["pages", "ponds", "devices", "members", "records"];

/**
 * Mount one palette for the current shell. Nothing renders until it is opened
 * (the dialog portals itself), so this adds no markup to the header.
 */
export function GlobalSearch({ shell }: { shell: SearchShell }) {
	const [open, setOpen] = useState(false);

	useEffect(() => {
		const listener = () => setOpen(true);
		openListeners.add(listener);
		return () => {
			openListeners.delete(listener);
		};
	}, []);

	return <GlobalSearchDialog shell={shell} open={open} onOpenChange={setOpen} />;
}

/** True on macOS/iOS, where the shortcut is ⌘K rather than Ctrl+K. */
function useIsApple() {
	const [isApple, setIsApple] = useState(false);
	useEffect(() => {
		const platform = navigator.platform || navigator.userAgent;
		setIsApple(/Mac|iPhone|iPad|iPod/i.test(platform));
	}, []);
	return isApple;
}

/**
 * The visible search control: a field with the shortcut hint on desktop, a
 * 44 px icon button on mobile. Both open the provider's single dialog.
 */
export function SearchTrigger({
	variant = "field",
	className,
}: {
	variant?: "field" | "icon";
	className?: string;
}) {
	const t = useTranslations("search");
	const isApple = useIsApple();
	const label = t("triggerLabel");

	if (variant === "icon") {
		return (
			<button
				type="button"
				onClick={openGlobalSearch}
				aria-label={label}
				aria-haspopup="dialog"
				data-global-search-trigger
				className={cn(
					"inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
					className,
				)}
			>
				<Search aria-hidden="true" className="h-5 w-5" />
			</button>
		);
	}

	return (
		<button
			type="button"
			onClick={openGlobalSearch}
			aria-label={label}
			aria-haspopup="dialog"
			data-global-search-trigger
			className={cn(
				"flex h-9 w-[168px] shrink-0 items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 text-left text-white/80 transition-colors hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
				className,
			)}
		>
			<Search aria-hidden="true" className="h-4 w-4 shrink-0" />
			<span className="min-w-0 flex-1 truncate text-xs font-bold">{t("trigger")}</span>
			<kbd className="shrink-0 rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-mono text-[10px] leading-none">
				{isApple ? "⌘K" : "Ctrl K"}
			</kbd>
		</button>
	);
}

export function GlobalSearchDialog({
	shell,
	open,
	onOpenChange,
}: {
	shell: SearchShell;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useTranslations("search");
	// Catalogue labels live in the navigation namespaces (`nav.*`,
	// `superadmin.shell.nav.*`), so page titles resolve through the root
	// translator while the dialog's own copy stays under `search`.
	const tRoot = useTranslations();
	const locale = useLocale();
	const router = useRouter();
	const panelRef = useRef<HTMLDialogElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const requestId = useRef(0);
	const pagesLoaded = useRef(false);
	const queryRef = useRef("");

	const [query, setQuery] = useState("");
	const [pages, setPages] = useState<SearchRow[]>([]);
	const [rows, setRows] = useState<SearchRow[]>([]);
	const [status, setStatus] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");
	const [activeIndex, setActiveIndex] = useState(0);
	const [mounted, setMounted] = useState(false);

	queryRef.current = query;

	useEffect(() => setMounted(true), []);

	// ⌘K / Ctrl+K works from anywhere in the shell, including while a form field
	// has focus. Alt/Shift combinations and the browser's own Ctrl+Shift+K stay
	// untouched.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
			if (event.key.toLowerCase() !== "k") return;
			event.preventDefault();
			onOpenChange(true);
			window.setTimeout(() => inputRef.current?.focus(), 0);
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [onOpenChange]);

	// Opening always starts from the suggestions; Escape and Tab are trapped,
	// and focus goes back to whatever opened the dialog.
	useEffect(() => {
		if (!open) return;
		setQuery("");
		setRows([]);
		setStatus("idle");
		setActiveIndex(0);
		const previous = document.activeElement as HTMLElement | null;
		const timer = window.setTimeout(() => inputRef.current?.focus(), 0);

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onOpenChange(false);
				return;
			}
			if (event.key !== "Tab") return;
			const panel = panelRef.current;
			if (!panel) return;
			const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
			if (nodes.length === 0) return;
			const first = nodes[0];
			const last = nodes[nodes.length - 1];
			const active = document.activeElement;
			if (event.shiftKey && (active === first || active === panel)) {
				event.preventDefault();
				last?.focus();
			} else if (!event.shiftKey && active === last) {
				event.preventDefault();
				first?.focus();
			}
		};

		document.addEventListener("keydown", onKeyDown);
		return () => {
			window.clearTimeout(timer);
			document.removeEventListener("keydown", onKeyDown);
			previous?.focus?.();
		};
	}, [open, onOpenChange]);

	// The empty state is the caller's suggested destinations, fetched once per
	// mount. A later query response carries the same catalogue, and the request
	// id ensures an older response can never overwrite a newer one.
	useEffect(() => {
		if (!open) return;
		const trimmed = query.trim();
		const id = ++requestId.current;

		if (trimmed.length === 0) {
			setRows([]);
			setStatus("idle");
			setActiveIndex(0);
			if (pagesLoaded.current) return;
			void globalSearch({ query: "", shell }).then((result: GlobalSearchResult) => {
				if (id !== requestId.current) return;
				pagesLoaded.current = result.status === "ok";
				setPages(result.pages);
				setStatus(result.status === "unavailable" ? "unavailable" : "idle");
			});
			return;
		}

		setStatus("loading");
		const timer = window.setTimeout(async () => {
			const result = await globalSearch({ query: trimmed, shell });
			if (id !== requestId.current) return;
			pagesLoaded.current = pagesLoaded.current || result.status === "ok";
			setPages(result.pages);
			setRows(result.rows);
			setStatus(result.status === "unavailable" ? "unavailable" : "ready");
			setActiveIndex(0);
		}, 160);

		return () => window.clearTimeout(timer);
	}, [query, open, shell]);

	const pageMatches = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return pages.slice(0, 6);
		return pages.filter((page) => {
			const title = page.titleKey ? tRoot(page.titleKey) : page.title;
			const haystack = [title, ...(page.keywords ?? [])].join(" ").toLowerCase();
			return haystack.includes(needle);
		});
	}, [pages, query, tRoot]);

	const groups = useMemo(
		() =>
			GROUP_ORDER.map((group) => ({
				group,
				rows: group === "pages" ? pageMatches : rows.filter((row) => row.group === group),
			})).filter((entry) => entry.rows.length > 0),
		[pageMatches, rows],
	);

	const visibleRows = useMemo(() => groups.flatMap((entry) => entry.rows), [groups]);

	useEffect(() => {
		setActiveIndex((current) => Math.min(current, Math.max(0, visibleRows.length - 1)));
	}, [visibleRows.length]);

	useEffect(() => {
		if (!open) return;
		const node = document.getElementById(`global-search-option-${activeIndex}`);
		if (node && typeof node.scrollIntoView === "function") {
			node.scrollIntoView({ block: "nearest" });
		}
	}, [activeIndex, open]);

	const title = useCallback(
		(row: SearchRow) => (row.titleKey ? tRoot(row.titleKey) : row.title),
		[tRoot],
	);

	const subtitle = useCallback(
		(row: SearchRow): string | null => {
			const meta = row.meta;
			if (!meta) return null;
			const statusLabel = meta.status ? t(`status.${meta.status}`) : null;
			const date = meta.date
				? new Intl.DateTimeFormat(locale, {
						day: "numeric",
						month: "short",
						year: "numeric",
					}).format(new Date(meta.date))
				: null;

			if (row.group === "devices") {
				return [meta.mac, meta.pondName ?? t("status.unassigned"), statusLabel]
					.filter(Boolean)
					.join(" · ");
			}
			if (row.group === "members") return meta.email ?? statusLabel;
			if (row.group === "ponds") return statusLabel;

			const grams = meta.grams === undefined ? null : `${Math.round(meta.grams)} g`;
			return [meta.pondName, date, grams, statusLabel].filter(Boolean).join(" · ") || null;
		},
		[locale, t],
	);

	const select = (row: SearchRow | undefined) => {
		if (!row) return;
		onOpenChange(false);
		if (row.switchPondId) {
			// Reuse the app's existing pond switch (it validates ownership) rather
			// than inventing a second navigation path for a pond row.
			void switchPond(row.switchPondId).catch(() => router.push(row.href));
			return;
		}
		router.push(row.href);
	};

	const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setActiveIndex((current) => Math.min(current + 1, Math.max(0, visibleRows.length - 1)));
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			setActiveIndex((current) => Math.max(0, current - 1));
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			select(visibleRows[activeIndex]);
		}
	};

	if (!mounted || !open) return null;

	const empty =
		query.trim().length > 0 &&
		status !== "loading" &&
		status !== "unavailable" &&
		visibleRows.length === 0;

	return createPortal(
		<div className="fixed inset-0 z-[80]">
			<button
				type="button"
				tabIndex={-1}
				aria-hidden="true"
				onClick={() => onOpenChange(false)}
				className="absolute inset-0 h-full w-full cursor-default bg-[#0A3D62]/45 backdrop-blur-[2px]"
			/>
			<dialog
				ref={panelRef}
				open
				tabIndex={-1}
				aria-modal="true"
				aria-labelledby="global-search-title"
				data-global-search-dialog
				className="fixed top-[10vh] left-1/2 m-0 flex max-h-[80dvh] w-[calc(100vw-1rem)] max-w-2xl -translate-x-1/2 flex-col overflow-hidden rounded-3xl border-0 bg-white p-0 text-[#0A3D62] shadow-2xl dark:bg-gray-900 dark:text-gray-100 sm:w-[calc(100vw-2rem)]"
			>
				<h2 id="global-search-title" className="sr-only">
					{t("dialogTitle")}
				</h2>

				<div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
					<Search
						aria-hidden="true"
						className="h-5 w-5 shrink-0 text-[#3D5568] dark:text-gray-400"
					/>
					<input
						ref={inputRef}
						type="search"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={onInputKeyDown}
						placeholder={t("placeholder")}
						aria-label={t("placeholder")}
						aria-controls="global-search-results"
						autoComplete="off"
						enterKeyHint="search"
						className="min-h-10 min-w-0 flex-1 bg-transparent text-base font-bold text-[#0A3D62] placeholder:font-medium placeholder:text-[#3D5568]/70 focus:outline-none dark:text-gray-100 dark:placeholder:text-gray-500"
					/>
					{status === "loading" && (
						<Loader2
							aria-hidden="true"
							className="h-4 w-4 shrink-0 animate-spin text-[#3D5568] dark:text-gray-400"
						/>
					)}
					<button
						type="button"
						onClick={() => onOpenChange(false)}
						aria-label={t("close")}
						className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[#3D5568] transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] dark:text-gray-300 dark:hover:bg-gray-800 dark:focus-visible:ring-[#8fc0ea]"
					>
						<X aria-hidden="true" className="h-4 w-4" />
					</button>
				</div>

				{/* Focus stays in the search input; the rows are click targets and are
				    announced through the live region plus their own titles. */}
				<section
					id="global-search-results"
					aria-label={t("resultsLabel")}
					className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain p-2"
				>
					<div aria-live="polite" className="sr-only">
						{status === "loading" ? (
							t("loading")
						) : (
							<span>{t("resultsCount", { count: visibleRows.length })}</span>
						)}
					</div>

					{status === "unavailable" && (
						<output className="m-2 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-bold text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
							<AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
							<span>{t("unavailable")}</span>
						</output>
					)}

					{query.trim().length === 0 && groups.length > 0 && (
						<p className="px-3 pt-2 pb-1 text-[10px] font-black tracking-widest text-[#3D5568] uppercase dark:text-gray-400">
							{t("suggested")}
						</p>
					)}

					{groups.map(({ group, rows: groupRows }) => (
						<section key={group} aria-label={t(`groups.${group}`)} className="pb-1">
							{query.trim().length > 0 && (
								<p
									aria-hidden="true"
									className="px-3 pt-2 pb-1 text-[10px] font-black tracking-widest text-[#3D5568] uppercase dark:text-gray-400"
								>
									{t(`groups.${group}`)}
								</p>
							)}
							<ul>
								{groupRows.map((row) => {
									const index = visibleRows.indexOf(row);
									const isActive = index === activeIndex;
									const Icon = GROUP_ICON[row.group];
									const rowSubtitle = subtitle(row);
									return (
										<li key={row.id}>
											<button
												type="button"
												id={`global-search-option-${index}`}
												aria-current={isActive ? "true" : undefined}
												tabIndex={-1}
												onMouseEnter={() => setActiveIndex(index)}
												onMouseDown={(event) => event.preventDefault()}
												onClick={() => select(row)}
												className={cn(
													"flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors",
													isActive
														? "bg-[#0A3D62] text-white dark:bg-[#5b9bd5] dark:text-gray-950"
														: "text-[#0A3D62] hover:bg-[#F4F7F6] dark:text-gray-100 dark:hover:bg-gray-800",
												)}
											>
												<span
													className={cn(
														"flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
														isActive
															? "bg-white/15 text-white dark:bg-gray-950/10 dark:text-gray-950"
															: "bg-[#0A3D62]/8 text-[#0A3D62] dark:bg-white/10 dark:text-[#8fc0ea]",
													)}
												>
													<Icon aria-hidden="true" className="h-4 w-4" />
												</span>
												<span className="min-w-0 flex-1">
													<span className="block truncate text-sm font-black">{title(row)}</span>
													{rowSubtitle && (
														<span
															className={cn(
																"block truncate text-xs font-semibold",
																isActive
																	? "text-white/80 dark:text-gray-950/75"
																	: "text-[#3D5568] dark:text-gray-400",
															)}
														>
															{rowSubtitle}
														</span>
													)}
												</span>
												{isActive && (
													<CornerDownLeft
														aria-hidden="true"
														className="h-4 w-4 shrink-0 opacity-70"
													/>
												)}
											</button>
										</li>
									);
								})}
							</ul>
						</section>
					))}

					{empty && (
						<div className="flex flex-col items-center justify-center px-4 py-10 text-center">
							<SearchX aria-hidden="true" className="h-8 w-8 text-[#3D5568] dark:text-gray-400" />
							<p className="mt-3 text-sm font-bold text-[#3D5568] dark:text-gray-300">
								{t("noResults", { query: query.trim() })}
							</p>
						</div>
					)}
				</section>

				<div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-200 px-4 py-2.5 text-[11px] font-semibold text-[#3D5568] dark:border-gray-700 dark:text-gray-400">
					<span className="inline-flex items-center gap-1">
						<kbd className="rounded border border-gray-300 px-1 dark:border-gray-600">↑</kbd>
						<kbd className="rounded border border-gray-300 px-1 dark:border-gray-600">↓</kbd>
						{t("hintMove")}
					</span>
					<span className="inline-flex items-center gap-1">
						<kbd className="rounded border border-gray-300 px-1 dark:border-gray-600">Enter</kbd>
						{t("hintOpen")}
					</span>
					<span className="inline-flex items-center gap-1">
						<kbd className="rounded border border-gray-300 px-1 dark:border-gray-600">Esc</kbd>
						{t("hintClose")}
					</span>
				</div>
			</dialog>
		</div>,
		document.body,
	);
}
