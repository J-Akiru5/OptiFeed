import { cn } from "@/lib/utils";

const START_Y = { a: 48, b: 40 } as const;

/** One continuous path of four 720-wide tiles, closed along the bottom, so there are no seams. */
function pathFor(variant: "a" | "b") {
	const tile = (x: number) =>
		variant === "a"
			? `C${x + 120} 8 ${x + 240} 8 ${x + 360} 48 S${x + 600} 88 ${x + 720} 48`
			: `C${x + 90} 80 ${x + 270} 80 ${x + 360} 40 S${x + 630} 0 ${x + 720} 40`;
	return `M0 ${START_Y[variant]} ${[0, 720, 1440, 2160].map(tile).join(" ")} L2880 120 L0 120 Z`;
}

const PATHS = { a: pathFor("a"), b: pathFor("b") } as const;

type WaveProps = {
	/** Shape of the crest. */
	variant?: "a" | "b";
	/** Mirror vertically, so the fill sits above the curve (use on a section's bottom edge). */
	flip?: boolean;
	/** Add a slower, fainter second crest behind the first. */
	layered?: boolean;
	/** Placement and colour; the fill follows `currentColor`, e.g. `top-0 -translate-y-full text-white`. */
	className?: string;
};

function Crest({
	variant,
	opacity,
	seconds,
}: { variant: "a" | "b"; opacity: number; seconds: number }) {
	return (
		<svg
			viewBox="0 0 2880 120"
			preserveAspectRatio="none"
			className="wave-drift absolute left-0 top-0 h-full w-[200%]"
			style={{ animationDuration: `${seconds}s`, opacity }}
			aria-hidden="true"
			focusable="false"
		>
			<path d={PATHS[variant]} fill="currentColor" />
		</svg>
	);
}

/**
 * Drifting wave edge for a section. Place it just outside the section edge, so the section colour
 * flows into its neighbour through a curve instead of a straight line. The fill is `currentColor`
 * and may carry alpha, matching a translucent section background.
 */
export function Wave({ variant = "a", flip = false, layered = false, className }: WaveProps) {
	const other = variant === "a" ? "b" : "a";
	return (
		<div
			aria-hidden="true"
			className={cn(
				"pointer-events-none absolute inset-x-0 h-10 overflow-hidden md:h-14 lg:h-16",
				flip && "-scale-y-100",
				className,
			)}
		>
			{layered && <Crest variant={other} opacity={0.4} seconds={46} />}
			<Crest variant={variant} opacity={1} seconds={30} />
		</div>
	);
}
