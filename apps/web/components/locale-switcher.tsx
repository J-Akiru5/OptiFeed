"use client";

import { routing, usePathname, useRouter } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { Check, ChevronDown, Globe } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";

type Locale = (typeof routing.locales)[number];

const LOCALE_LABELS: Record<Locale, string> = {
	en: "English",
	hil: "Hiligaynon",
	tl: "Tagalog",
};

type MenuPosition = {
	top?: number;
	bottom?: number;
	right: number;
};

export function LocaleSwitcher({ variant = "dark" }: { variant?: "light" | "dark" }) {
	const router = useRouter();
	const pathname = usePathname();
	const locale = useLocale() as Locale;
	const t = useTranslations("login");
	const [isPending, startTransition] = useTransition();
	const [open, setOpen] = useState(false);
	const [position, setPosition] = useState<MenuPosition | null>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node;
			if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
				setOpen(false);
			}
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		const close = () => setOpen(false);
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		window.addEventListener("scroll", close, true);
		window.addEventListener("resize", close);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("scroll", close, true);
			window.removeEventListener("resize", close);
		};
	}, [open]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: close the menu when the route or locale changes
	useEffect(() => {
		setOpen(false);
	}, [pathname, locale]);

	const openMenu = () => {
		const rect = triggerRef.current?.getBoundingClientRect();
		if (!rect) return;
		const menuHeight = 176;
		const openUp = rect.bottom + menuHeight > window.innerHeight;
		setPosition({
			top: openUp ? undefined : rect.bottom + 8,
			bottom: openUp ? window.innerHeight - rect.top + 8 : undefined,
			right: window.innerWidth - rect.right,
		});
		setOpen(true);
	};

	const choose = (next: Locale) => {
		setOpen(false);
		if (next === locale) return;
		startTransition(() => {
			router.replace({ pathname }, { locale: next });
		});
	};

	return (
		<div className="relative">
			<button
				ref={triggerRef}
				type="button"
				onClick={() => (open ? setOpen(false) : openMenu())}
				disabled={isPending}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-label={`${t("languageLabel")}: ${LOCALE_LABELS[locale]}`}
				className={cn(
					"flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2",
					variant === "dark"
						? "border-white/10 bg-white/10 text-white hover:bg-white/20 focus-visible:ring-white"
						: "border-gray-200 bg-white text-[#0A3D62] hover:bg-[#F4F7F6] focus-visible:ring-[#E85A2A]",
					isPending && "cursor-not-allowed opacity-50",
				)}
			>
				<Globe className="size-3.5" aria-hidden="true" />
				<span className="uppercase">{locale}</span>
				<ChevronDown
					className={cn("size-3 transition-transform", open && "rotate-180")}
					aria-hidden="true"
				/>
			</button>

			{open &&
				position &&
				createPortal(
					<div
						ref={menuRef}
						role="menu"
						aria-label={t("languageLabel")}
						onPointerDown={(event) => event.stopPropagation()}
						style={{
							position: "fixed",
							top: position.top,
							bottom: position.bottom,
							right: position.right,
							width: 176,
						}}
						className={cn(
							"z-50 overflow-hidden rounded-xl border p-1 shadow-xl",
							variant === "dark"
								? "border-white/15 bg-[#0B2336] text-white"
								: "border-gray-200 bg-white text-[#0A3D62]",
						)}
					>
						{routing.locales.map((code) => {
							const active = code === locale;
							return (
								<button
									key={code}
									type="button"
									role="menuitemradio"
									aria-checked={active}
									onClick={() => choose(code)}
									disabled={isPending}
									className={cn(
										"flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2",
										variant === "dark"
											? "hover:bg-white/10 focus-visible:ring-white/60"
											: "hover:bg-[#F4F7F6] focus-visible:ring-[#E85A2A]/60",
										active && (variant === "dark" ? "bg-white/10" : "bg-[#F4F7F6]"),
									)}
								>
									<span>{LOCALE_LABELS[code]}</span>
									{active && <Check className="size-3.5" aria-hidden="true" />}
								</button>
							);
						})}
					</div>,
					document.body,
				)}
		</div>
	);
}
