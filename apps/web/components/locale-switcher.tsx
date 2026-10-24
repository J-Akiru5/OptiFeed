"use client";

import { usePathname, useRouter } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { Globe } from "lucide-react";
import { useLocale } from "next-intl";
import { useTransition } from "react";

export function LocaleSwitcher({ variant = "dark" }: { variant?: "light" | "dark" }) {
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
				"px-3 py-1.5 rounded-full text-xs flex items-center gap-1 transition-all border font-bold focus-visible:outline-none focus-visible:ring-2",
				variant === "dark"
					? "bg-white/10 hover:bg-white/20 border-white/10 text-white focus-visible:ring-white"
					: "bg-white hover:bg-[#F4F7F6] border-gray-200 text-[#0A3D62] focus-visible:ring-[#E85A2A]",
				isPending && "opacity-50 cursor-not-allowed",
			)}
			title="Change language / Bag-uhon ang pulong"
		>
			<Globe className="w-3.5 h-3.5" />
			<span className="uppercase">{locale}</span>
		</button>
	);
}
