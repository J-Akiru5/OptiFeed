"use client";

import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { QuickMenu } from "./quick-menu";
import { type MobileShell, useMobilePageTitle } from "./use-page-title";

/**
 * The coloured header band every shell shows below `lg` (E26).
 *
 * One band, three shells: the PakaonAI navy gradient from the design tokens,
 * the current page's title (duplicated from the page's own `<h1>`, so it is
 * `aria-hidden` for assistive tech), a search button and the "+" quick menu.
 * The second row carries whatever the shell needs next to the page identity —
 * the pond name for a farmer, help and the profile menu for the consoles.
 *
 * Desktop keeps its own header row: nothing here renders at `lg` and up.
 */
export function MobileHeader({
	shell,
	isTenantAdmin,
	subtitle,
	children,
	className,
}: {
	shell: MobileShell;
	isTenantAdmin: boolean;
	/** Pond name / farm line shown under the title. */
	subtitle?: ReactNode;
	/** Right-hand controls for the second row (bell, help, profile). */
	children?: ReactNode;
	className?: string;
}) {
	const title = useMobilePageTitle(shell);
	const tShell = useTranslations("superadmin.shell");
	const tAdmin = useTranslations("dashboard.adminShell");
	const eyebrow =
		shell === "admin" ? tAdmin("badge") : shell === "platform" ? tShell("platform") : "PakaonAI";

	return (
		<div className={cn("ofd-band lg:hidden", className)}>
			<div className="flex items-start gap-2 px-4 pt-3">
				<div className="min-w-0 flex-1">
					<p
						aria-hidden="true"
						className="text-[10px] font-black tracking-[0.18em] text-[var(--ofd-band-ink-muted)] uppercase"
					>
						{eyebrow}
					</p>
					<p
						aria-hidden="true"
						className="truncate text-xl leading-tight font-black text-[var(--ofd-band-ink)]"
					>
						{title}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					<QuickMenu shell={shell} isTenantAdmin={isTenantAdmin} trigger="search" />
					<QuickMenu shell={shell} isTenantAdmin={isTenantAdmin} trigger="plus" />
				</div>
			</div>

			<div className="mt-1.5 flex items-center justify-between gap-2 px-4 pt-1 pb-2.5">
				<div className="min-w-0 flex-1 text-[11px] font-bold text-[var(--ofd-band-ink-muted)]">
					{subtitle}
				</div>
				{children ? <div className="flex shrink-0 items-center gap-1.5">{children}</div> : null}
			</div>
		</div>
	);
}
