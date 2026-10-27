"use client";

import { HelpSheet } from "@/components/help/help-sheet";
import type { HelpRole } from "@/lib/help/types";
import { cn } from "@/lib/utils";
import { CircleHelp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

/**
 * The "?" every shell carries, next to the other header actions.
 *
 * It opens the help sheet for whatever screen the reader is on. The button and
 * the sheet are one component so the sheet can hand focus back to the control
 * that opened it.
 */
export function HelpButton({
	audience,
	className,
}: {
	audience: HelpRole;
	className?: string;
}) {
	const t = useTranslations("help");
	const [open, setOpen] = useState(false);

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				aria-label={t("button")}
				title={t("button")}
				aria-haspopup="dialog"
				data-help="help-button"
				className={cn(
					"flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white transition-all hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
					className,
				)}
			>
				<CircleHelp className="h-4 w-4" aria-hidden="true" />
			</button>
			<HelpSheet open={open} onOpenChange={setOpen} audience={audience} />
		</>
	);
}
