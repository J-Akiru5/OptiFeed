"use client";

import { Link, usePathname } from "@/i18n/routing";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";

export function BackToDashboard() {
	const pathname = usePathname();
	const t = useTranslations("nav");

	if (!pathname || pathname === "/dashboard") return null;

	return (
		<Link
			href="/dashboard"
			className="mb-4 inline-flex items-center gap-1.5 text-sm font-bold text-[#0A3D62] transition-colors hover:text-[#E85A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A3D62] rounded-lg"
		>
			<ArrowLeft className="h-4 w-4" />
			{t("dashboard")}
		</Link>
	);
}
