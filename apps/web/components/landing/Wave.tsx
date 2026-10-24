import { cn } from "@/lib/utils";

const TILES = {
	a: "M0 48 C 120 8, 240 8, 360 48 S 600 88, 720 48",
	b: "M0 40 C 90 80, 270 80, 360 40 S 630 0, 720 40",
} as const;

type WaveProps = {
	/** Shape of the crest. */
	variant?: "a" | "b";
	/** Mirror vertically, so the fill sits above the curve (use on a section's bottom edge). */
	flip?: boolean;
	/** Add a slower, fainter second crest behind the first. */
	layered?: boolean;
	/** Placement and colour; the fill follows `currentColor`, e.g. `top-0 text-white`. */
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
			{[0, 1, 2, 3].map((i) => (
				<path
					key={i}
					transform={`translate(${i * 720} 0)`}
					d={`${TILES[variant]} L720 120 L0 120 Z`}
					fill="currentColor"
					stroke="currentColor"
					strokeWidth="1"
				/>
			))}
		</svg>
	);
}

/**
 * Drifting wave edge for a section. It is positioned just outside the section, so the section
 * colour flows into the neighbouring one through a curve instead of a straight line.
 */
export function Wave({ variant = "a", flip = false, layered = false, className }: WaveProps) {
	const other = variant === "a" ? "b" : "a";
	return (
		<div
			aria-hidden="true"
			className={cn(
				"pointer-events-none absolute inset-x-0 h-[clamp(40px,6vw,88px)] overflow-hidden",
				flip && "-scale-y-100",
				className,
			)}
		>
			{layered && <Crest variant={other} opacity={0.4} seconds={46} />}
			<Crest variant={variant} opacity={1} seconds={30} />
		</div>
	);
}
