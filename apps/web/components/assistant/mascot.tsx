import { cn } from "@/lib/utils";
import { Bot } from "lucide-react";

/**
 * The assistant's face (issue #193, E9).
 *
 * One component, one art slot. Jeff is curating the mascot art with GPT; when
 * it lands it replaces the placeholder below and nothing else changes: the
 * header, the intro message and every assistant bubble already render this.
 */
export const ASSISTANT_NAME = "PakaonAI Assistant";

// TODO(#193): swap the Bot glyph for Jeff's mascot art. Keep the same props so
// every call site (chat header, intro, message avatar) updates at once.
export function Mascot({
	size = 20,
	className,
	decorative = true,
}: {
	size?: number;
	className?: string;
	/** The intro carries the name in text, so the glyph is decorative there. */
	decorative?: boolean;
}) {
	return (
		<span
			className={cn(
				"inline-flex items-center justify-center rounded-full bg-[#0A3D62] text-white",
				className,
			)}
			aria-hidden={decorative ? "true" : undefined}
			role={decorative ? undefined : "img"}
			aria-label={decorative ? undefined : ASSISTANT_NAME}
		>
			<Bot size={size} aria-hidden="true" />
		</span>
	);
}
