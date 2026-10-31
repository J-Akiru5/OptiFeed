import { cn } from "@/lib/utils";
import { FIELD_INPUT, FIELD_LABEL, PRIMARY_BUTTON, SECONDARY_BUTTON } from "./ui";

/**
 * Dark palette for the shared platform-console dialog (#321).
 *
 * The console was built light-only, and the app-wide theme provider toggles
 * `.dark` on `<html>` for every shell. With the system in dark mode the modal
 * therefore stayed a bright island — readable, but the one surface that ignored
 * the theme. These tokens move the dialog onto the palette the rest of the app
 * already uses, without inventing a console-only theme:
 *
 *   light: white panel, #0A3D62 ink, #3D5568 secondary text, #F4F7F6 fields
 *   dark:  gray-900 panel, gray-100 ink, gray-400 secondary text, gray-800 fields
 *
 * `DIALOG_CONTRAST` records the rendered sRGB values behind those classes; the
 * regression test checks every pair against WCAG AA for normal text (4.5:1) in
 * both themes, the same pattern #309 introduced for the chat surfaces. Tailwind
 * v4 ships its palette as OKLCH, so the hex values are the 8-bit sRGB
 * equivalents of the tokens named in each comment.
 */

/** Dimmed backdrop behind the panel. */
export const DIALOG_BACKDROP = "bg-[#0A3D62]/40 dark:bg-black/70";

/** The dialog panel itself: the surface every child inherits from. */
export const DIALOG_PANEL =
	"border-gray-200 bg-white text-[#0A3D62] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100";

/** Header icon tile. */
export const DIALOG_ICON_TILE = "bg-[#F4F7F6] text-[#0A3D62] dark:bg-gray-800 dark:text-[#8fc0ea]";

/** Dialog title. */
export const DIALOG_TITLE = "text-[#0A3D62] dark:text-gray-100";

/** One-line explanation under the title. */
export const DIALOG_DESCRIPTION = "text-[#3D5568] dark:text-gray-400";

/** Close control in the header, and the header's hover wash. */
export const DIALOG_CLOSE =
	"text-[#3D5568] hover:bg-[#F4F7F6] dark:text-gray-400 dark:hover:bg-gray-800";

/** Field label. */
export const DIALOG_LABEL = cn(FIELD_LABEL, "dark:text-gray-400");

/** Text field, themed and with a focus ring that clears the dark field. */
export const DIALOG_FIELD = cn(
	FIELD_INPUT,
	"dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:focus:ring-[#ff8a5c]",
);

/** Inline validation message. */
export const DIALOG_ERROR =
	"border-red-200 bg-red-50 text-[#C42B3A] dark:border-red-900 dark:bg-red-950 dark:text-red-300";

/**
 * Confirm control. The brand orange (#E85A2A) only reaches 3.54:1 against
 * white, so the dialog uses the AA-safe dashboard orange (#C2410C), exactly as
 * the chat action card does.
 */
export const DIALOG_PRIMARY = cn(
	PRIMARY_BUTTON,
	"bg-[#C2410C] hover:bg-[#9A3412] dark:focus-visible:ring-offset-gray-900",
);

/** Cancel control. */
export const DIALOG_SECONDARY = cn(
	SECONDARY_BUTTON,
	"text-[#3D5568] hover:bg-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700 dark:focus-visible:ring-offset-gray-900",
);

export interface DialogContrastPair {
	/** What the pair paints, e.g. "dialog title". */
	label: string;
	light: { background: string; foreground: string };
	dark: { background: string; foreground: string };
}

/**
 * The rendered pairs the dialog depends on. Values mirror the Tailwind classes
 * named above; `superadmin-dialog-contrast.test.tsx` asserts each one is at
 * least 4.5:1 (WCAG AA normal text) in both themes.
 */
export const DIALOG_CONTRAST: readonly DialogContrastPair[] = [
	{
		label: "dialog title",
		// bg-white / text-[#0A3D62]  ·  dark:bg-gray-900 / dark:text-gray-100
		light: { background: "#FFFFFF", foreground: "#0A3D62" },
		dark: { background: "#101828", foreground: "#F3F4F6" },
	},
	{
		label: "dialog explanation",
		// bg-white / text-[#3D5568]  ·  dark:bg-gray-900 / dark:text-gray-400
		light: { background: "#FFFFFF", foreground: "#3D5568" },
		dark: { background: "#101828", foreground: "#99A1AF" },
	},
	{
		label: "password field text",
		// bg-[#F4F7F6] / text-[#0A3D62]  ·  dark:bg-gray-800 / dark:text-white
		light: { background: "#F4F7F6", foreground: "#0A3D62" },
		dark: { background: "#1E2939", foreground: "#FFFFFF" },
	},
	{
		label: "confirm button",
		// bg-[#C2410C] / text-white, unchanged in dark
		light: { background: "#C2410C", foreground: "#FFFFFF" },
		dark: { background: "#C2410C", foreground: "#FFFFFF" },
	},
	{
		label: "cancel button",
		// bg-white / text-[#3D5568]  ·  dark:bg-gray-800 / dark:text-gray-100
		light: { background: "#FFFFFF", foreground: "#3D5568" },
		dark: { background: "#1E2939", foreground: "#F3F4F6" },
	},
	{
		label: "validation message",
		// bg-red-50 / text-[#C42B3A]  ·  dark:bg-red-950 / dark:text-red-300
		light: { background: "#FEF2F2", foreground: "#C42B3A" },
		dark: { background: "#460809", foreground: "#FFA2A2" },
	},
] as const;
