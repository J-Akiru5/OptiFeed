"use client";

import { usePathname, useRouter } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { useLocale } from "next-intl";
import { useTransition } from "react";

export function LocaleSwitcher() {
	const router = useRouter();
	const pathname = usePathname();
	const locale = useLocale();
	const [isPending, startTransition] = useTransition();

	const handleLocaleChange = (newLocale: "en" | "hil") => {
		if (newLocale === locale) return;
		startTransition(() => {
			router.replace({ pathname }, { locale: newLocale });
		});
	};

	return (
		<div
			className={cn(
				"flex items-center gap-1 rounded-full bg-gray-100 p-1",
				isPending && "opacity-50 pointer-events-none",
			)}
		>
			<button
				type="button"
				onClick={() => handleLocaleChange("en")}
				className={cn(
					"min-h-[var(--ofd-touch-min)] px-4 rounded-full text-sm font-medium transition-colors",
					locale === "en"
						? "bg-white text-gray-900 shadow-sm"
						: "text-gray-500 hover:text-gray-700",
				)}
			>
				EN
			</button>
			<button
				type="button"
				onClick={() => handleLocaleChange("hil")}
				className={cn(
					"min-h-[var(--ofd-touch-min)] px-4 rounded-full text-sm font-medium transition-colors",
					locale === "hil"
						? "bg-white text-gray-900 shadow-sm"
						: "text-gray-500 hover:text-gray-700",
				)}
			>
				HIL
			</button>
		</div>
	);
}
