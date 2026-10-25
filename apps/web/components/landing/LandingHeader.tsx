"use client";

import { LandingLogo } from "@/components/landing/LandingLogo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { useTheme } from "@/components/theme-provider";
import { Link } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { ArrowRight, Menu, Moon, Sun, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

export const LANDING_SECTIONS = [
	{ id: "problem", key: "navWhy" },
	{ id: "how", key: "navHow" },
	{ id: "offline", key: "navOffline" },
	{ id: "hardware", key: "navHardware" },
	{ id: "research", key: "navStudy" },
	{ id: "faq", key: "navFaq" },
] as const;

const focusRing =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF8A5C] focus-visible:ring-offset-2 focus-visible:ring-offset-[#061B2B]";

export function LandingHeader() {
	const t = useTranslations("landing");
	const tBtn = useTranslations("button");
	const { resolvedTheme, setTheme } = useTheme();
	const [active, setActive] = useState<string | null>(null);
	const [scrolled, setScrolled] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);

	useEffect(() => {
		const onScroll = () => setScrolled(window.scrollY > 12);
		onScroll();
		window.addEventListener("scroll", onScroll, { passive: true });
		return () => window.removeEventListener("scroll", onScroll);
	}, []);

	useEffect(() => {
		const elements = LANDING_SECTIONS.map(({ id }) => document.getElementById(id)).filter(
			(element): element is HTMLElement => element !== null,
		);
		const visible = new Map<string, number>();
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) visible.set(entry.target.id, entry.intersectionRatio);
					else visible.delete(entry.target.id);
				}
				let best: string | null = null;
				let bestRatio = 0;
				for (const [id, ratio] of visible) {
					if (ratio > bestRatio) {
						best = id;
						bestRatio = ratio;
					}
				}
				setActive(best);
			},
			{ rootMargin: "-20% 0px -60% 0px", threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
		);
		for (const element of elements) observer.observe(element);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (!menuOpen) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setMenuOpen(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [menuOpen]);

	return (
		<header
			className={cn(
				"sticky top-0 z-50 border-b bg-[#061B2B] transition-shadow duration-300",
				scrolled
					? "border-white/10 shadow-[0_16px_40px_-24px_rgba(0,0,0,0.9)]"
					: "border-transparent",
			)}
		>
			<div className="mx-auto flex h-[4.5rem] w-full max-w-[80rem] items-center justify-between gap-4 px-5 sm:px-8 lg:px-10">
				<a
					href="#top"
					aria-label={t("homeLabel")}
					className={cn("flex shrink-0 items-center rounded-lg py-1", focusRing)}
				>
					<LandingLogo size={30} wordmarkClassName="h-[17px] sm:h-[19px]" />
				</a>

				<nav aria-label={t("primaryNavLabel")} className="hidden items-center gap-0.5 lg:flex">
					{LANDING_SECTIONS.map(({ id, key }) => (
						<a
							key={id}
							href={`#${id}`}
							aria-current={active === id ? "true" : undefined}
							className={cn(
								"relative rounded-md px-2.5 py-2 text-[12.5px] font-medium transition-colors",
								active === id ? "text-white" : "text-white/60 hover:text-white",
								focusRing,
							)}
						>
							{t(key)}
							{active === id && (
								<motion.span
									layoutId="landing-nav-underline"
									className="absolute inset-x-2.5 -bottom-0.5 h-0.5 rounded-full bg-[#FF8A5C]"
									transition={{ type: "spring", stiffness: 500, damping: 40 }}
								/>
							)}
						</a>
					))}
				</nav>

				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
						aria-label={resolvedTheme === "dark" ? t("themeToLight") : t("themeToDark")}
						className={cn(
							"flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-white/65 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white",
							focusRing,
						)}
					>
						{resolvedTheme === "dark" ? (
							<Sun className="size-4" aria-hidden="true" />
						) : (
							<Moon className="size-4" aria-hidden="true" />
						)}
					</button>

					<div className="hidden sm:block">
						<LocaleSwitcher variant="dark" />
					</div>

					<Link
						href="/login"
						className={cn(
							"hidden h-9 items-center gap-1.5 rounded-lg bg-[#E85A2A] px-3.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#D24E22] sm:inline-flex",
							focusRing,
						)}
					>
						{tBtn("login")}
						<ArrowRight className="size-3.5" aria-hidden="true" />
					</Link>

					<button
						type="button"
						onClick={() => setMenuOpen((open) => !open)}
						aria-expanded={menuOpen}
						aria-controls="landing-mobile-menu"
						aria-label={menuOpen ? t("navClose") : t("navMenu")}
						className={cn(
							"flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-white transition-colors hover:bg-white/10 lg:hidden",
							focusRing,
						)}
					>
						{menuOpen ? (
							<X className="size-4" aria-hidden="true" />
						) : (
							<Menu className="size-4" aria-hidden="true" />
						)}
					</button>
				</div>
			</div>

			<AnimatePresence>
				{menuOpen && (
					<motion.nav
						id="landing-mobile-menu"
						aria-label={t("primaryNavLabel")}
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.22, ease: "easeOut" }}
						className="overflow-hidden border-t border-white/10 bg-[#061B2B] lg:hidden"
					>
						<ul className="mx-auto max-w-[80rem] px-5 py-2 sm:px-8">
							{LANDING_SECTIONS.map(({ id, key }) => (
								<li key={id}>
									<a
										href={`#${id}`}
										onClick={() => setMenuOpen(false)}
										aria-current={active === id ? "true" : undefined}
										className={cn(
											"block border-l-2 py-3 pl-4 text-[14px] font-medium transition-colors",
											active === id
												? "border-[#FF8A5C] text-white"
												: "border-transparent text-white/60 hover:text-white",
										)}
									>
										{t(key)}
									</a>
								</li>
							))}
						</ul>
						<div className="mx-auto flex max-w-[80rem] items-center gap-2.5 px-5 pb-5 sm:px-8">
							<LocaleSwitcher variant="dark" />
							<Link
								href="/login"
								onClick={() => setMenuOpen(false)}
								className={cn(
									"inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-[#E85A2A] px-4 text-[13px] font-semibold text-white",
									focusRing,
								)}
							>
								{tBtn("login")}
								<ArrowRight className="size-4" aria-hidden="true" />
							</Link>
						</div>
					</motion.nav>
				)}
			</AnimatePresence>
		</header>
	);
}
