"use client";

import { usePathname, useRouter } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { Globe } from "lucide-react";
import { useLocale } from "next-intl";
import { useTransition } from "react";

export function LocaleSwitcher() {
	const router = useRouter();
	const pathname = usePathname();
	const locale = useLocale();
	const [isPending, startTransition] = useTransition();

	const handleLocaleChange = () => {
		const newLocale = locale === "en" ? "hil" : "en";
		startTransition(() => {
			router.replace({ pathname }, { locale: newLocale });
		});
	};

	return (
		<button
			type="button"
			onClick={handleLocaleChange}
			disabled={isPending}
			className={cn(
				"bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-full text-xs flex items-center gap-1 transition-all border border-white/10 font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
				isPending && "opacity-50 cursor-not-allowed",
			)}
			title="Change language / Bag-uhon ang pulong"
		>
			<Globe className="w-3.5 h-3.5" />
			<span className="uppercase">{locale}</span>
		</button>
	);
}
