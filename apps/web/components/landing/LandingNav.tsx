"use client";

import { OptiFeedLogo } from "@/components/OptiFeedLogo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { useRouter } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { ArrowRight, Menu, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useEffect, useState } from "react";

const SECTIONS = [
	{ id: "problem", key: "navProblem" },
	{ id: "how", key: "navHow" },
	{ id: "offline", key: "navOffline" },
	{ id: "hardware", key: "navHardware" },
	{ id: "study", key: "navStudy" },
	{ id: "faq", key: "navFaq" },
] as const;

export function LandingNav() {
	const router = useRouter();
	const t = useTranslations("landing");
	const tBtn = useTranslations("button");
	const [active, setActive] = useState<string | null>(null);
	const [scrolled, setScrolled] = useState(false);
	const [open, setOpen] = useState(false);

	useEffect(() => {
		const onScroll = () => setScrolled(window.scrollY > 24);
		onScroll();
		window.addEventListener("scroll", onScroll, { passive: true });
		return () => window.removeEventListener("scroll", onScroll);
	}, []);

	useEffect(() => {
		const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(
			(el): el is HTMLElement => el !== null,
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
			{ rootMargin: "-30% 0px -50% 0px", threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
		);
		for (const el of els) observer.observe(el);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open]);

	return (
		<header
			className={cn(
				"sticky top-0 z-50 border-b border-gray-200 bg-white/95 backdrop-blur-md transition-shadow duration-300",
				scrolled && "shadow-md",
			)}
		>
			<div
				className={cn(
					"mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 transition-all duration-300 md:px-12",
					scrolled ? "py-2.5" : "py-4",
				)}
			>
				<a href="#top" className="flex shrink-0 items-center gap-3" aria-label="PakaonAI">
					<OptiFeedLogo size={32} variant="color-light" className="drop-shadow-md" />
					<Image
						src="/pakaonai-logo-kit/png/pakaonai-wordmark-color.png"
						alt="PakaonAI"
						width={120}
						height={28}
						className="h-6 w-auto object-contain sm:h-7"
						priority
					/>
				</a>

				<nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
					{SECTIONS.map(({ id, key }) => (
						<a
							key={id}
							href={`#${id}`}
							aria-current={active === id ? "true" : undefined}
							className={cn(
								"relative rounded-full px-3.5 py-2 text-sm font-semibold transition-colors",
								active === id ? "text-[#0A3D62]" : "text-[#3D5568] hover:text-[#0A3D62]",
							)}
						>
							{t(key)}
							{active === id && (
								<motion.span
									layoutId="landing-nav-underline"
									className="absolute inset-x-3.5 -bottom-0.5 h-0.5 rounded-full bg-[#E85A2A]"
									transition={{ type: "spring", stiffness: 500, damping: 40 }}
								/>
							)}
						</a>
					))}
				</nav>

				<div className="flex items-center gap-2 md:gap-3">
					<div className="hidden sm:block">
						<LocaleSwitcher variant="light" />
					</div>
					<button
						type="button"
						onClick={() => router.push("/login")}
						className="flex items-center gap-2 whitespace-nowrap rounded-full bg-[#E85A2A] px-4 py-2 text-sm font-bold text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-[#d04a1f] hover:shadow-lg active:scale-95 md:px-5 md:py-2.5 md:text-base"
					>
						{tBtn("login")} <ArrowRight className="h-4 w-4" />
					</button>
					<button
						type="button"
						onClick={() => setOpen((v) => !v)}
						aria-expanded={open}
						aria-controls="landing-mobile-menu"
						aria-label={open ? t("navClose") : t("navMenu")}
						className="rounded-full border border-gray-200 p-2 text-[#0A3D62] hover:bg-[#F4F7F6] lg:hidden"
					>
						{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
					</button>
				</div>
			</div>

			<AnimatePresence>
				{open && (
					<motion.nav
						id="landing-mobile-menu"
						aria-label="Mobile"
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.25, ease: "easeOut" }}
						className="overflow-hidden border-t border-gray-100 bg-white lg:hidden"
					>
						<ul className="mx-auto max-w-7xl px-6 py-3 md:px-12">
							{SECTIONS.map(({ id, key }) => (
								<li key={id}>
									<a
										href={`#${id}`}
										onClick={() => setOpen(false)}
										aria-current={active === id ? "true" : undefined}
										className={cn(
											"block border-l-4 py-3 pl-4 text-base font-bold",
											active === id
												? "border-[#E85A2A] text-[#0A3D62]"
												: "border-transparent text-[#3D5568]",
										)}
									>
										{t(key)}
									</a>
								</li>
							))}
						</ul>
						<div className="mx-auto max-w-7xl px-6 pb-4 sm:hidden md:px-12">
							<LocaleSwitcher variant="light" />
						</div>
					</motion.nav>
				)}
			</AnimatePresence>
		</header>
	);
}
