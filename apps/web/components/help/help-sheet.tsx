"use client";

import { useOnboarding } from "@/components/onboarding-provider";
import { usePathname, useRouter } from "@/i18n/routing";
import { currentSectionIds, sectionsFor } from "@/lib/help/guides";
import { clearHelpHighlight, findHelpTarget, highlightHelpTarget } from "@/lib/help/highlight";
import {
	claimHelpTarget,
	peekHelpTarget,
	requestHelpTarget,
	revealHelpTarget,
} from "@/lib/help/reveal";
import { type HelpRole, type HelpSection, itemRoute } from "@/lib/help/types";
import { DPO_EMAIL } from "@/lib/legal/config";
import { cn } from "@/lib/utils";
import { ChevronDown, Crosshair, LifeBuoy, Mail, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The help sheet: a short step list for the screen the reader is on, then every
 * other screen that role can open.
 *
 * Items that name a control get a "Show me" button. It closes the sheet and
 * rings the real control, so nobody has to guess which button a sentence means.
 * When the control lives on another page, the sheet remembers it, navigates,
 * and the shell that arrives draws the ring once the page has settled (see
 * `lib/help/reveal.ts`).
 *
 * Desktop: a right-hand sheet, full height. Mobile (<768px): a bottom sheet, so
 * it never covers the whole screen the reader is trying to learn.
 */
export function HelpSheet({
	open,
	onOpenChange,
	audience,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	audience: HelpRole;
}) {
	const t = useTranslations("help");
	const pathname = usePathname();
	const router = useRouter();
	const { startTour, hasTour } = useOnboarding();
	const panelRef = useRef<HTMLDialogElement>(null);
	const [expanded, setExpanded] = useState<string[]>([]);
	const [missing, setMissing] = useState(false);

	const sections = sectionsFor(audience, pathname);
	const currentIds = currentSectionIds(audience, pathname);
	const currentKey = currentIds.join(",");
	// A page with no section of its own (the two console overviews) opens the
	// first section for that role instead of showing everything collapsed.
	const fallbackId = sections[0]?.id ?? "";

	// The screen the reader is on opens first; the rest are one tap away.
	useEffect(() => {
		if (!open) return;
		setExpanded(currentKey ? currentKey.split(",") : fallbackId ? [fallbackId] : []);
	}, [open, currentKey, fallbackId]);

	// Escape closes, Tab stays inside, and focus returns to the "?" button.
	useEffect(() => {
		if (!open) return;
		const previous = document.activeElement as HTMLElement | null;
		const timer = window.setTimeout(() => {
			panelRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
		}, 0);

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

	// A ring belongs to the screen it was drawn on: a route change clears it.
	// A "Show me" from another page left a request behind; this page claims it
	// exactly once, however many shells are mounted.
	useEffect(() => {
		clearHelpHighlight();
		const request = peekHelpTarget(pathname);
		if (!request) return;
		return revealHelpTarget(request.target, {
			highlight: (target, doc) => {
				if (!claimHelpTarget(request)) return true;
				return highlightHelpTarget(target, doc);
			},
			onMissing: () => {
				if (!claimHelpTarget(request)) return;
				setMissing(true);
				onOpenChange(true);
			},
		});
	}, [pathname, onOpenChange]);

	// The note belongs to the attempt that missed, not to every later visit.
	useEffect(() => {
		if (!open) setMissing(false);
	}, [open]);

	if (!open) return null;

	const toggle = (id: string) => {
		setExpanded((current) =>
			current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
		);
	};

	const show = (section: HelpSection, item: HelpSection["items"][number]) => {
		const target = item.target;
		if (!target) return;
		const route = itemRoute(section, item);
		setMissing(false);

		// Same screen: close first so the sheet is not in the way, then ring.
		if (!route || route === pathname) {
			if (!findHelpTarget(document, target)) {
				setMissing(true);
				return;
			}
			onOpenChange(false);
			window.setTimeout(() => {
				revealHelpTarget(target, {
					onMissing: () => {
						setMissing(true);
						onOpenChange(true);
					},
				});
			}, 140);
			return;
		}

		// Another screen: close, remember the anchor, navigate. The destination
		// shell draws the ring (see the pathname effect above).
		onOpenChange(false);
		requestHelpTarget(target, route);
		router.push(route);
	};

	// The sheet is rendered into `body`, not inside the header: the header is a
	// sticky, z-indexed stacking context, so a fixed overlay inside it would sit
	// under the chat panel and the FAB cluster.
	if (typeof document === "undefined") return null;
	return createPortal(
		<div className="fixed inset-0 z-[70]">
			<button
				type="button"
				tabIndex={-1}
				aria-hidden="true"
				onClick={() => onOpenChange(false)}
				className="absolute inset-0 h-full w-full cursor-default bg-[#0A3D62]/40 backdrop-blur-[1px]"
			/>
			<dialog
				ref={panelRef}
				open
				tabIndex={-1}
				aria-modal="true"
				aria-labelledby="help-sheet-title"
				data-help="help-sheet"
				className={cn(
					"m-0 max-h-none max-w-none border-0 p-0",
					// Mobile: a bottom sheet that leaves the page visible above it.
					"absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-3xl bg-white text-[#0A3D62] shadow-2xl",
					// Desktop: a full-height right-hand sheet.
					"md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-[min(420px,100vw)] md:rounded-none md:rounded-l-3xl",
					"dark:bg-gray-900 dark:text-gray-100",
				)}
			>
				<div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-gray-700">
					<div className="flex items-center gap-3">
						<span
							aria-hidden="true"
							className="grid h-10 w-10 place-items-center rounded-2xl bg-[#0A3D62]/5 text-[#0A3D62] dark:bg-white/5 dark:text-[#5b9bd5]"
						>
							<LifeBuoy className="h-5 w-5" />
						</span>
						<div>
							<h2 id="help-sheet-title" className="text-lg font-black tracking-tight">
								{t("title")}
							</h2>
							<p className="text-xs font-bold text-[#3D5568] dark:text-gray-400">{t("subtitle")}</p>
						</div>
					</div>
					<button
						type="button"
						data-autofocus
						onClick={() => onOpenChange(false)}
						aria-label={t("close")}
						className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[#3D5568] transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] dark:text-gray-300 dark:hover:bg-gray-800"
					>
						<X className="h-4 w-4" aria-hidden="true" />
					</button>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
					{missing && (
						<output className="mb-3 block rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] font-bold text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
							{t("missing")}
						</output>
					)}

					<div className="grid gap-2.5">
						{sections.map((section) => {
							const isOpen = expanded.includes(section.id);
							const isCurrent = currentIds.includes(section.id);
							const panelId = `help-section-${section.id}`;
							return (
								<section
									key={section.id}
									className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700"
								>
									<h3>
										<button
											type="button"
											onClick={() => toggle(section.id)}
											aria-expanded={isOpen}
											aria-controls={panelId}
											className="flex min-h-12 w-full items-center justify-between gap-3 bg-[#F4F7F6] px-4 py-3 text-left text-sm font-black text-[#0A3D62] transition-colors hover:bg-[#0A3D62]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0A3D62] dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
										>
											<span className="flex min-w-0 items-center gap-2">
												<span className="truncate">{t(section.title)}</span>
												{isCurrent && (
													<span className="shrink-0 rounded-full bg-[#E85A2A] px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">
														{t("onThisPage")}
													</span>
												)}
											</span>
											<ChevronDown
												aria-hidden="true"
												className={cn(
													"h-4 w-4 shrink-0 transition-transform",
													isOpen && "rotate-180",
												)}
											/>
										</button>
									</h3>
									{isOpen && (
										<div id={panelId} className="px-4 py-3">
											<p className="text-[13px] leading-5 text-[#3D5568] dark:text-gray-300">
												{t(section.intro)}
											</p>
											<ol className="mt-3 grid list-decimal gap-2.5 pl-5 text-[13px] leading-5">
												{section.items.map((item, index) => (
													<li key={`${section.id}-${index}`} className="grid gap-1.5">
														<span>{t(item.text)}</span>
														{item.target && (
															<button
																type="button"
																onClick={() => show(section, item)}
																className="inline-flex min-h-8 w-fit items-center gap-1.5 rounded-lg border border-[#0A3D62]/20 px-2.5 py-1 text-xs font-black text-[#0A3D62] transition-colors hover:bg-[#0A3D62] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] dark:border-white/20 dark:text-[#8ec5ef] dark:hover:bg-[#5b9bd5] dark:hover:text-gray-900"
															>
																<Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
																{t("showMe")}
															</button>
														)}
													</li>
												))}
											</ol>
										</div>
									)}
								</section>
							);
						})}
					</div>
				</div>

				<div className="flex shrink-0 flex-col gap-2 border-t border-gray-200 px-5 py-4 dark:border-gray-700">
					{hasTour && (
						<button
							type="button"
							onClick={() => {
								onOpenChange(false);
								startTour();
							}}
							className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#0A3D62]/20 text-sm font-black text-[#0A3D62] transition-colors hover:bg-[#0A3D62]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] dark:border-white/20 dark:text-[#8ec5ef] dark:hover:bg-gray-800"
						>
							{t("takeTour")}
						</button>
					)}
					<p className="text-center text-xs text-[#3D5568] dark:text-gray-400">
						{t("more")}{" "}
						<a
							href={`mailto:${DPO_EMAIL}?subject=${encodeURIComponent("PakaonAI help")}`}
							className="inline-flex items-center gap-1 font-bold text-[#0A3D62] underline underline-offset-2 dark:text-[#8ec5ef]"
						>
							<Mail className="h-3 w-3" aria-hidden="true" />
							{DPO_EMAIL}
						</a>
					</p>
				</div>
			</dialog>
		</div>,
		document.body,
	);
}
