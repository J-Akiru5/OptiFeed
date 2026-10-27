/**
 * Colour system for manual calendar items (#195).
 *
 * Every default and palette colour is checked for at least 4.5:1 contrast
 * against white text (WCAG AA for normal text) in the unit tests.
 */

export type ManualEventType = "MAINTENANCE" | "SAMPLING" | "HARVEST_PLANNED" | "STOCKING" | "OTHER";

export const EVENT_TYPE_COLORS: Record<ManualEventType, string> = {
	MAINTENANCE: "#B45309",
	SAMPLING: "#0F766E",
	HARVEST_PLANNED: "#C2410C",
	STOCKING: "#1E7B34",
	OTHER: "#7C3AED",
};

export const EVENT_COLOR_PALETTE = [
	"#0A3D62",
	"#1E7B34",
	"#0F766E",
	"#B45309",
	"#C2410C",
	"#B91C1C",
	"#7C3AED",
	"#3F3F46",
] as const;

export function isEventColor(value: unknown): value is string {
	return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function eventTypeColor(type: string): string {
	return EVENT_TYPE_COLORS[type as ManualEventType] ?? EVENT_TYPE_COLORS.OTHER;
}

/** The stored colour when set, otherwise the type's accessible default. */
export function resolveEventColor(color: string | null | undefined, type: string): string {
	return isEventColor(color) ? color : eventTypeColor(type);
}

function channelLuminance(channel: number): number {
	const value = channel / 255;
	return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
	const normalized = hex.replace("#", "");
	const r = Number.parseInt(normalized.slice(0, 2), 16);
	const g = Number.parseInt(normalized.slice(2, 4), 16);
	const b = Number.parseInt(normalized.slice(4, 6), 16);
	return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

export function contrastRatio(a: string, b: string): number {
	const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
	return (lighter + 0.05) / (darker + 0.05);
}
