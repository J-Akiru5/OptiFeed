import { cn } from "@/lib/utils";

/**
 * A tiny inline trend line for a KPI (issue #479, M3C.8).
 *
 * Pure SVG: a 100 x 28 view box, one polyline, no chart library and no client
 * JavaScript. The series is normalised to its own min/max, so a KPI whose
 * values sit between 4,100 and 4,180 still shows its shape; a flat series (or
 * an empty/one-point one) draws a line through the middle instead of dividing
 * by zero.
 *
 * The graphic has no text: its accessible name arrives as `label`, and the
 * caller localises it. Colour is decoration only, so the same chart still
 * reads when the tone classes are not visible.
 */

const WIDTH = 100;
const HEIGHT = 28;
const PADDING = 2;
const MIDDLE = HEIGHT / 2;

const TONES: Record<"accent" | "success" | "danger" | "muted", string> = {
	accent: "text-[#C2410C] dark:text-[#FF8A5C]",
	success: "text-[#1E7B34] dark:text-[#4ADE80]",
	danger: "text-[#C42B3A] dark:text-[#F87171]",
	muted: "text-[#3D5568] dark:text-[#94A3B8]",
};

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

function polylinePoints(points: number[]): string {
	if (points.length < 2) {
		return `${PADDING},${MIDDLE} ${WIDTH - PADDING},${MIDDLE}`;
	}

	const min = Math.min(...points);
	const max = Math.max(...points);
	const span = max - min;
	const step = (WIDTH - PADDING * 2) / (points.length - 1);

	return points
		.map((value, index) => {
			const x = PADDING + index * step;
			const y = span === 0 ? MIDDLE : PADDING + (1 - (value - min) / span) * (HEIGHT - PADDING * 2);
			return `${round(x)},${round(y)}`;
		})
		.join(" ");
}

export function Sparkline({
	points,
	label,
	tone = "accent",
	className,
}: {
	points: number[];
	label: string;
	tone?: "accent" | "success" | "danger" | "muted";
	className?: string;
}) {
	return (
		<svg
			role="img"
			aria-label={label}
			viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
			preserveAspectRatio="none"
			className={cn("h-7 w-full", TONES[tone], className)}
		>
			<polyline
				points={polylinePoints(points)}
				fill="none"
				stroke="currentColor"
				strokeWidth={1.5}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
