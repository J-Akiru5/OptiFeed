"use client";

import type { CalendarCapability } from "@/lib/calendar/capability";
import type { CalendarEventType } from "@/lib/crop-cycle/calendar";
import { cn } from "@/lib/utils";
import { Filter, Home, Lock, Pencil } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Shared calendar controls.
 *
 * The farmer, tenant-admin and platform calendars render the same chip set and
 * capability badge so a control never changes shape between consoles. Only the
 * data and the permission behind a control change.
 */

const CHIP_BASE =
	"inline-flex min-h-11 items-center rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea]";

const CHIP_ON = "bg-[#0A3D62] text-white dark:bg-[#1f66a0]";
const CHIP_OFF =
	"bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700";

/** One chip style for every surface, so filters keep their size and contrast. */
export function calendarChipClass(active: boolean, extra?: string): string {
	return cn(CHIP_BASE, active ? CHIP_ON : CHIP_OFF, extra);
}

interface CalendarTypeFiltersProps {
	/** Types rendered as chips, in display order. */
	types: readonly CalendarEventType[];
	isSelected: (type: CalendarEventType) => boolean;
	onToggle: (type: CalendarEventType) => void;
	/** Visible group label, e.g. "Filter" or "Event types". */
	label: string;
	labelFor: (type: CalendarEventType) => string;
	/** Hide the leading icon on surfaces that already render one. */
	hideIcon?: boolean;
	className?: string;
}

export function CalendarTypeFilters({
	types,
	isSelected,
	onToggle,
	label,
	labelFor,
	hideIcon = false,
	className,
}: CalendarTypeFiltersProps) {
	return (
		<fieldset
			aria-label={label}
			className={cn("m-0 flex min-w-0 flex-wrap items-center gap-1.5 border-0 p-0", className)}
		>
			<span className="mr-1 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500">
				{!hideIcon && <Filter aria-hidden="true" className="h-3 w-3" />}
				{label}
			</span>
			{types.map((type) => (
				<button
					key={type}
					type="button"
					onClick={() => onToggle(type)}
					aria-pressed={isSelected(type)}
					className={calendarChipClass(isSelected(type))}
				>
					{labelFor(type)}
				</button>
			))}
		</fieldset>
	);
}

const CAPABILITY: Record<
	CalendarCapability,
	{ icon: LucideIcon; className: string; key: "edit" | "ownFarm" | "read" }
> = {
	edit: {
		icon: Pencil,
		key: "edit",
		className:
			"border-green-200 bg-green-50 text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300",
	},
	"own-farm": {
		icon: Home,
		key: "ownFarm",
		className:
			"border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300",
	},
	read: {
		icon: Lock,
		key: "read",
		className:
			"border-gray-200 bg-gray-100 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300",
	},
};

interface CalendarCapabilityBadgeProps {
	capability: CalendarCapability;
	labels: Record<"edit" | "ownFarm" | "read", string>;
	className?: string;
}

/** "Editing enabled" / "Own farm only" / "View only", identical in every console. */
export function CalendarCapabilityBadge({
	capability,
	labels,
	className,
}: CalendarCapabilityBadgeProps) {
	const { icon: Icon, key, className: tone } = CAPABILITY[capability];
	return (
		<span
			className={cn(
				"inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wider",
				tone,
				className,
			)}
		>
			<Icon aria-hidden="true" className="h-3 w-3" />
			{labels[key]}
		</span>
	);
}
