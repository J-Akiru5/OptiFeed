import { avatarInitials } from "@/lib/avatar-initials";
import { cn } from "@/lib/utils";

/**
 * One avatar for every place the app used to draw an initials circle (#198, E20).
 *
 * `src` is a short-lived signed URL produced by `lib/avatars.ts`; the picture is
 * decorative because a name is always rendered next to it (or the surrounding
 * button/link carries the accessible label). When there is no picture — or the
 * signed URL could not be produced — the same circle falls back to initials.
 */
export function UserAvatar({
	src,
	name,
	size = "md",
	className,
}: {
	src?: string | null;
	name?: string | null;
	size?: "sm" | "md" | "lg";
	/** Size, shape and surface classes, e.g. `rounded-full bg-[#E85A2A]`. */
	className?: string;
}) {
	const sizeClass =
		size === "sm" ? "h-8 w-8 text-[10px]" : size === "lg" ? "h-14 w-14 text-lg" : "h-9 w-9 text-xs";

	const base = cn(
		"flex shrink-0 items-center justify-center overflow-hidden font-black text-white",
		sizeClass,
		className,
	);

	if (src) {
		return (
			<img
				src={src}
				alt=""
				aria-hidden="true"
				loading="lazy"
				decoding="async"
				referrerPolicy="no-referrer"
				className={cn(base, "object-cover")}
			/>
		);
	}

	return (
		<span aria-hidden="true" className={base}>
			{avatarInitials(name)}
		</span>
	);
}
