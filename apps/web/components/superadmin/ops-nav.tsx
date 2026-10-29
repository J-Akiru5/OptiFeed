"use client";

import { FOCUS_RING } from "@/components/superadmin/ui";
import { Link, usePathname } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { Activity, Cpu, Megaphone, ScrollText, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Section tabs for the platform Operations area (E16.4, task I-15).
 *
 * The platform sidebar has one "Operations" entry; these tabs switch between
 * the four pages without adding four more top-level items to the console.
 */

const tabs = [
	{ href: "/superadmin/operations", key: "health", icon: Activity },
	{ href: "/superadmin/operations/errors", key: "errors", icon: TriangleAlert },
	{ href: "/superadmin/operations/firmware", key: "firmware", icon: Cpu },
	{ href: "/superadmin/operations/audit", key: "audit", icon: ScrollText },
	{ href: "/superadmin/operations/announcements", key: "announcements", icon: Megaphone },
] as const;

export function OpsNav() {
	const t = useTranslations("superadmin.operations");
	const pathname = usePathname();

	return (
		<nav aria-label={t("tabsLabel")} className="scrollbar-none -mx-1 overflow-x-auto">
			<ul className="flex min-w-max items-center gap-1 px-1">
				{tabs.map((tab) => {
					const isActive =
						tab.href === "/superadmin/operations"
							? pathname === "/superadmin/operations" || pathname === "/superadmin/operations/"
							: pathname.startsWith(tab.href);

					return (
						<li key={tab.href}>
							<Link
								href={tab.href}
								aria-current={isActive ? "page" : undefined}
								className={cn(
									"inline-flex min-h-11 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-bold transition-colors",
									FOCUS_RING,
									isActive
										? "bg-[#0A3D62] text-white shadow-sm"
										: "text-[#3D5568] hover:bg-white hover:text-[#0A3D62]",
								)}
							>
								<tab.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
								{t(`tabs.${tab.key}`)}
							</Link>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
