import { OptiFeedLogo } from "@/components/OptiFeedLogo";
import { cn } from "@/lib/utils";
import Image from "next/image";

/**
 * Compact horizontal lockup for dark surfaces.
 *
 * The kit's full `*-logo-*` lockups are stacked (2000x1583), which leaves the
 * wordmark unreadably small in a 4.5rem header. Pairing the mark with the
 * separate wordmark keeps both legible.
 */
export function LandingLogo({
	size = 30,
	wordmarkClassName = "h-[18px]",
	className,
}: {
	size?: number;
	wordmarkClassName?: string;
	className?: string;
}) {
	return (
		<span className={cn("flex items-center gap-2.5", className)}>
			<OptiFeedLogo size={size} variant="ondark" />
			<Image
				src="/pakaonai-logo-kit/png/pakaonai-wordmark-color.png"
				alt=""
				width={200}
				height={40}
				priority
				className={cn("w-auto object-contain brightness-0 invert", wordmarkClassName)}
			/>
		</span>
	);
}
