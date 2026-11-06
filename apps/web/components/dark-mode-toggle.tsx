"use client";

import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Light/dark switch.
 *
 * The default 36 px square is the desktop row's size, where it sits between the
 * language switcher and the help button. The mobile band cannot use that size:
 * every other control there is a 44 px pill, so it passes `className` and gets
 * the same pill (E26 follow-up — a theme control that only exists at `lg` and
 * up is a control a phone cannot find).
 *
 * The label states the action, not the current mode, and is announced with the
 * rest of the band's controls.
 */
export function DarkModeToggle({ className }: { className?: string }) {
	const { resolvedTheme, setTheme } = useTheme();
	const t = useTranslations("dashboard.common");
	const isDark = resolvedTheme === "dark";
	const label = isDark ? t("themeToLight") : t("themeToDark");

	return (
		<button
			type="button"
			onClick={() => setTheme(isDark ? "light" : "dark")}
			className={cn(
				"flex h-9 w-9 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none",
				className,
			)}
			aria-label={label}
			title={label}
		>
			{isDark ? (
				<Sun aria-hidden="true" className="h-4 w-4" />
			) : (
				<Moon aria-hidden="true" className="h-4 w-4" />
			)}
		</button>
	);
}
