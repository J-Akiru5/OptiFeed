import Image from "next/image";

interface LogoProps {
	className?: string;
	size?: number;
	/**
	 * "ondark"       → white mark — for dark navy/blue headers (default)
	 * "color"        → full-color mark — for light/white backgrounds
	 * "color-light"  → lighter gradient mark — for light backgrounds (smaller file)
	 * "white"        → flat white mark — for dark photo backgrounds
	 * "navy"         → flat navy mark — for print / light backgrounds
	 */
	variant?: "ondark" | "color" | "color-light" | "white" | "navy";
}

const VARIANT_SRC: Record<NonNullable<LogoProps["variant"]>, string> = {
	ondark: "/pakaonai-logo-kit/png/pakaonai-mark-ondark.png",
	color: "/pakaonai-logo-kit/png/pakaonai-mark-color.png",
	"color-light": "/pakaonai-logo-kit/png/pakaonai-mark-color-light.png",
	white: "/pakaonai-logo-kit/png/pakaonai-mark-white.png",
	navy: "/pakaonai-logo-kit/png/pakaonai-mark-navy.png",
};

/**
 * PakaonAI mark logo.
 *
 * The fish-and-target-ring mark ships in several colour treatments from the
 * logo kit. Use `variant` to pick the right one for the background context.
 */
export function OptiFeedLogo({ className = "", size = 32, variant = "ondark" }: LogoProps) {
	const src = VARIANT_SRC[variant];

	return (
		<Image
			src={src}
			alt="PakaonAI"
			width={size}
			height={size}
			className={className}
			style={{ width: size, height: size, objectFit: "contain" }}
			priority
		/>
	);
}
