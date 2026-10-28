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

/** Calendar surfaces a chip is painted on. Keep in sync with the CSS tokens. */
export const CALENDAR_THEME_SURFACE = {
	light: "#FFFFFF",
	dark: "#111827",
} as const;

export type CalendarTheme = keyof typeof CALENDAR_THEME_SURFACE;

export interface EventChipColors {
	background: string;
	foreground: string;
}

/**
 * The "+N more" link: navy on white, light blue on the dark calendar surface.
 * The CSS mirrors these values in `--ofc-more-fg`.
 */
export const CALENDAR_MORE_COLORS: Record<CalendarTheme, EventChipColors> = {
	light: { background: CALENDAR_THEME_SURFACE.light, foreground: "#0A3D62" },
	dark: { background: CALENDAR_THEME_SURFACE.dark, foreground: "#9EC5EA" },
};

/** WCAG AA for normal text; chip labels are bold but below the "large text" size. */
const CHIP_MIN_CONTRAST = 4.5;
/** Aim just above the floor so integer channel rounding cannot dip below it. */
const CHIP_TARGET_CONTRAST = 4.6;
/** How much of the stored hue survives in the dark-mode tinted surface. */
const DARK_CHIP_TINT = 0.5;

type Rgb = [number, number, number];
type Hsl = [number, number, number];

function parseHex(hex: string): Rgb {
	const normalized = hex.replace("#", "");
	return [
		Number.parseInt(normalized.slice(0, 2), 16),
		Number.parseInt(normalized.slice(2, 4), 16),
		Number.parseInt(normalized.slice(4, 6), 16),
	];
}

function rgbToHex([r, g, b]: Rgb): string {
	return `#${[r, g, b]
		.map((channel) => Math.round(channel).toString(16).padStart(2, "0").toUpperCase())
		.join("")}`;
}

function rgbToHsl([r, g, b]: Rgb): Hsl {
	const red = r / 255;
	const green = g / 255;
	const blue = b / 255;
	const max = Math.max(red, green, blue);
	const min = Math.min(red, green, blue);
	const lightness = (max + min) / 2;
	if (max === min) return [0, 0, lightness];

	const delta = max - min;
	const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
	let hue: number;
	if (max === red) hue = ((green - blue) / delta + (green < blue ? 6 : 0)) / 6;
	else if (max === green) hue = ((blue - red) / delta + 2) / 6;
	else hue = ((red - green) / delta + 4) / 6;
	return [hue, saturation, lightness];
}

function hueToRgb(p: number, q: number, t: number): number {
	let value = t;
	if (value < 0) value += 1;
	if (value > 1) value -= 1;
	if (value < 1 / 6) return p + (q - p) * 6 * value;
	if (value < 1 / 2) return q;
	if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
	return p;
}

function hslToRgb([h, s, l]: Hsl): Rgb {
	if (s === 0) {
		const channel = l * 255;
		return [channel, channel, channel];
	}
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	return [
		hueToRgb(p, q, h + 1 / 3) * 255,
		hueToRgb(p, q, h) * 255,
		hueToRgb(p, q, h - 1 / 3) * 255,
	];
}

/** Blend `color` into `base`; `weight` is how much of `color` remains. */
function mixHex(color: string, base: string, weight: number): string {
	const source = parseHex(color);
	const target = parseHex(base);
	return rgbToHex(
		source.map((channel, index) => channel * weight + target[index] * (1 - weight)) as Rgb,
	);
}

/**
 * Move lightness in one direction until the colour clears `minimum` against
 * `background`, keeping the hue and saturation so the event stays recognisable.
 */
function adjustLightness(
	color: string,
	direction: -1 | 1,
	minimum: number,
	background: string,
): string {
	const [hue, saturation, lightness] = rgbToHsl(parseHex(color));
	for (let step = 1; step <= 100; step += 1) {
		const next = Math.min(1, Math.max(0, lightness + direction * (step / 100)));
		const candidate = rgbToHex(hslToRgb([hue, saturation, next]));
		if (contrastRatio(candidate, background) >= minimum) return candidate;
		if (next === 0 || next === 1) return candidate;
	}
	return direction < 0 ? "#000000" : "#FFFFFF";
}

/**
 * Accessible chip/row colours for a stored event colour (#272).
 *
 * Light mode keeps the solid fill and picks white text, darkening only the
 * swatches that cannot carry white text (harvest orange, the cancelled grey).
 * Dark mode paints a tinted surface and a lightened version of the same hue,
 * so a red chip no longer sits as saturated red-on-navy with white text.
 */
export function eventChipColors(color: string, theme: CalendarTheme): EventChipColors {
	const base = isEventColor(color) ? color : EVENT_TYPE_COLORS.OTHER;
	if (theme === "light") {
		const background =
			contrastRatio(base, CALENDAR_THEME_SURFACE.light) >= CHIP_TARGET_CONTRAST
				? base
				: adjustLightness(base, -1, CHIP_TARGET_CONTRAST, CALENDAR_THEME_SURFACE.light);
		return { background, foreground: "#FFFFFF" };
	}

	const background = mixHex(base, CALENDAR_THEME_SURFACE.dark, DARK_CHIP_TINT);
	const foreground =
		contrastRatio(base, background) >= CHIP_TARGET_CONTRAST
			? base
			: adjustLightness(base, 1, CHIP_TARGET_CONTRAST, background);
	return { background, foreground };
}

/** Guard for the shared 4.5:1 threshold, exported for the colour tests. */
export function meetsChipContrast(colors: EventChipColors): boolean {
	return contrastRatio(colors.background, colors.foreground) >= CHIP_MIN_CONTRAST;
}
