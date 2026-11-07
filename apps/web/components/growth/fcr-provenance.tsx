import { cn } from "@/lib/utils";
import { CircleAlert, Info } from "lucide-react";

/**
 * Visible provenance label for a stored FCR value (issue #875).
 *
 * Presentation only: the strings are resolved by the server page so every
 * locale uses the same catalogue, and the reasons are the same codes the
 * analytics layer produces. This is deliberately not a tooltip — a stored
 * number that no log reproduces must say so in the reading flow.
 */

export type FcrProvenanceTone = "info" | "warning" | "danger";

export interface FcrProvenanceText {
	/** Short label, e.g. "Stored report". */
	title: string;
	/** One sentence per reason, already translated. */
	messages: readonly string[];
	tone: FcrProvenanceTone;
}

/**
 * Build the label from a display decision. Pure and exported so a test can
 * prove every reason reaches the visible text without booting the page.
 */
export function fcrProvenanceText(
	display: { source: "computed" | "stored"; unverifiedReasons: readonly string[] } | null,
	translate: (key: string) => string,
): FcrProvenanceText | null {
	if (display?.source !== "stored") return null;
	return {
		title: translate("badge"),
		messages:
			display.unverifiedReasons.length > 0
				? display.unverifiedReasons.map((reason) => translate(`reasons.${reason}`))
				: [translate("verified")],
		tone: display.unverifiedReasons.includes("stored-contradicts-totals") ? "danger" : "warning",
	};
}

const LIGHT_TONE: Record<FcrProvenanceTone, string> = {
	info: "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100",
	warning:
		"border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100",
	danger:
		"border-red-300 bg-red-50 text-red-950 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100",
};

const DARK_TONE: Record<FcrProvenanceTone, string> = {
	info: "border-sky-300/40 bg-sky-300/15 text-sky-50",
	warning: "border-amber-300/50 bg-amber-300/15 text-amber-50",
	danger: "border-red-300/60 bg-red-400/20 text-red-50",
};

export function FcrProvenanceNote({
	text,
	surface = "light",
	className,
}: {
	text: FcrProvenanceText;
	surface?: "light" | "dark";
	className?: string;
}) {
	const Icon = text.tone === "danger" ? CircleAlert : Info;
	const tone = surface === "dark" ? DARK_TONE[text.tone] : LIGHT_TONE[text.tone];

	return (
		<div
			role="note"
			data-fcr-provenance={text.tone}
			className={cn("mt-3 max-w-md rounded-xl border px-3 py-2", tone, className)}
		>
			<p className="flex items-center gap-1.5 text-[10px] font-black tracking-wider uppercase">
				<Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
				{text.title}
			</p>
			<ul className="mt-1 space-y-0.5 text-[11px] leading-snug">
				{text.messages.map((message) => (
					<li key={message}>{message}</li>
				))}
			</ul>
		</div>
	);
}
