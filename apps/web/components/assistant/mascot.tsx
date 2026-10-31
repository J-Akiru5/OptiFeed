import { cn } from "@/lib/utils";
import Image from "next/image";

/**
 * Pakoy, the PakaonAI mascot (issues #193, #232).
 *
 * One component, one art slot. The crops live in `public/mascot/` and are
 * described in `public/mascot/README.md`, so Jeff's final art can replace them
 * without touching a call site. The name is Pakoy: the character sheet called
 * him "Paka", issue #232 settled the name.
 */
export const ASSISTANT_NAME = "Pakoy";

/** Placement guide identity line: "Pakoy · Your feeding schedule buddy." */
const ASSISTANT_TAGLINE = "Your feeding schedule buddy.";

/** Hiligaynon tagline from the placement guide. */
const ASSISTANT_TAGLINE_HIL = "Sakto nga pakaon, sakto nga oras.";

export const MASCOT_ALT = "Pakoy, the PakaonAI mascot";

/**
 * Intrinsic sizes match the prepared crops (public/mascot/README.md). `head` is
 * the round avatar used wherever the art is too small for a full pose.
 */
const POSES = {
	head: { src: "/mascot/pakoy-head.webp", width: 254, height: 254 },
	idle: { src: "/mascot/pakoy-idle.webp", width: 132, height: 173 },
	dispensing: { src: "/mascot/pakoy-dispensing.webp", width: 138, height: 169 },
	offline: { src: "/mascot/pakoy-offline.webp", width: 132, height: 164 },
	lowHopper: { src: "/mascot/pakoy-low-hopper.webp", width: 138, height: 168 },
	wrongToken: { src: "/mascot/pakoy-wrong-token.webp", width: 132, height: 167 },
	powerFault: { src: "/mascot/pakoy-power-fault.webp", width: 136, height: 167 },
	firstSetup: { src: "/mascot/pakoy-first-setup.webp", width: 132, height: 167 },
	hero: { src: "/mascot/pakoy-hero.webp", width: 370, height: 411 },
} as const;

export type MascotPose = keyof typeof POSES;

/** Every pose's file, for tests and for the "is the art there?" check. */
export const MASCOT_POSES: Record<MascotPose, string> = {
	head: POSES.head.src,
	idle: POSES.idle.src,
	dispensing: POSES.dispensing.src,
	offline: POSES.offline.src,
	lowHopper: POSES.lowHopper.src,
	wrongToken: POSES.wrongToken.src,
	powerFault: POSES.powerFault.src,
	firstSetup: POSES.firstSetup.src,
	hero: POSES.hero.src,
};

interface MascotProps {
	/** Rendered height in pixels. Head poses render as a circle of this size. */
	size?: number;
	className?: string;
	/** True when the surrounding text already names Pakoy. */
	decorative?: boolean;
	/** Which cut-out to show. Defaults to the head mark, as before #193. */
	pose?: MascotPose;
}

export function Mascot({
	size = 20,
	className,
	decorative = true,
	pose = "head",
	priority = false,
}: MascotProps & { priority?: boolean }) {
	const asset = POSES[pose];
	const isHead = pose === "head";
	const width = isHead ? size : Math.round((asset.width / asset.height) * size);

	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center justify-center",
				isHead && "overflow-hidden rounded-full",
				className,
			)}
			data-pose={pose}
		>
			<Image
				src={asset.src}
				alt={decorative ? "" : MASCOT_ALT}
				aria-hidden={decorative ? true : undefined}
				width={asset.width}
				height={asset.height}
				priority={priority}
				style={{ height: size, width, objectFit: "contain" }}
			/>
		</span>
	);
}
