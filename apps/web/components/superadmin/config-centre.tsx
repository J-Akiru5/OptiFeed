"use client";

import { FOCUS_RING } from "@/components/superadmin/ui";
import { cn } from "@/lib/utils";
import {
	Bot,
	Building2,
	ChevronDown,
	Cpu,
	Gauge,
	ListChecks,
	Mail,
	Settings2,
	Tag,
	ToggleLeft,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

/**
 * Sectioned shell for the platform configuration centre (I-14).
 *
 * Desktop shows a persistent left section nav beside a single column of
 * sections; below `lg` the same sections become an accordion so a long page is
 * still usable at 375 px. The content of each section is rendered on the server
 * and passed in, so every write keeps its own server action and permission
 * check.
 */

export type ConfigSectionIcon =
	| "lists"
	| "stickers"
	| "ai"
	| "email"
	| "safety"
	| "defaults"
	| "firmware"
	| "flags";

const ICONS = {
	lists: ListChecks,
	stickers: Tag,
	ai: Bot,
	email: Mail,
	safety: Gauge,
	defaults: Building2,
	firmware: Cpu,
	flags: ToggleLeft,
} as const;

const FALLBACK_ICON = Settings2;

export type ConfigSection = {
	id: string;
	title: string;
	description: string;
	icon: ConfigSectionIcon;
	content: ReactNode;
};

export function ConfigCentre({ sections }: { sections: ConfigSection[] }) {
	const t = useTranslations("superadmin.settings");
	const [openId, setOpenId] = useState<string>(sections[0]?.id ?? "");

	return (
		<div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:gap-8">
			<nav aria-label={t("tocLabel")} className="hidden lg:sticky lg:top-24 lg:block">
				<p className="mb-3 px-3 text-[10px] font-extrabold uppercase tracking-widest text-[#3D5568]">
					{t("tocTitle")}
				</p>
				<ul className="space-y-1">
					{sections.map((section) => {
						const Icon = ICONS[section.icon] ?? FALLBACK_ICON;
						return (
							<li key={section.id}>
								<a
									href={`#${section.id}`}
									className={cn(
										"flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold text-[#3D5568] transition-colors hover:bg-white hover:text-[#0A3D62]",
										FOCUS_RING,
									)}
								>
									<Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
									<span className="min-w-0">{section.title}</span>
								</a>
							</li>
						);
					})}
				</ul>
			</nav>

			<div className="space-y-4 lg:space-y-10">
				{sections.map((section) => {
					const Icon = ICONS[section.icon] ?? FALLBACK_ICON;
					const open = openId === section.id;
					return (
						<section
							key={section.id}
							id={section.id}
							aria-label={section.title}
							className="scroll-mt-24 rounded-2xl border border-gray-200 bg-white shadow-sm lg:rounded-none lg:border-0 lg:bg-transparent lg:shadow-none"
						>
							<button
								type="button"
								onClick={() => setOpenId(open ? "" : section.id)}
								aria-expanded={open}
								aria-controls={`${section.id}-panel`}
								className={cn(
									"flex w-full items-center gap-3 rounded-2xl px-4 py-4 text-left lg:hidden",
									FOCUS_RING,
								)}
							>
								<Icon className="h-5 w-5 shrink-0 text-[#E85A2A]" aria-hidden="true" />
								<span className="min-w-0 flex-1">
									<span className="block text-base font-black text-[#0A3D62]">{section.title}</span>
									<span className="mt-0.5 block text-xs text-[#3D5568]">{section.description}</span>
								</span>
								<ChevronDown
									className={cn(
										"h-5 w-5 shrink-0 text-[#3D5568] transition-transform",
										open && "rotate-180",
									)}
									aria-hidden="true"
								/>
							</button>

							<div className="mb-4 hidden items-start gap-3 border-b border-gray-200 pb-3 lg:flex">
								<Icon className="mt-1 h-5 w-5 shrink-0 text-[#E85A2A]" aria-hidden="true" />
								<div className="min-w-0">
									<h2
										id={`${section.id}-heading-desktop`}
										className="text-lg font-black text-[#0A3D62]"
									>
										{section.title}
									</h2>
									<p className="mt-1 max-w-3xl text-sm text-[#3D5568]">{section.description}</p>
								</div>
							</div>

							<div
								id={`${section.id}-panel`}
								className={cn("px-4 pb-5 lg:px-0 lg:pb-0", open ? "block" : "hidden lg:block")}
							>
								{section.content}
							</div>
						</section>
					);
				})}
			</div>
		</div>
	);
}
