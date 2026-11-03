import { cn } from "@/lib/utils";
import { FIELD_INPUT, FIELD_LABEL, PRIMARY_BUTTON, SECONDARY_BUTTON } from "./ui";

/**
 * Theme for the shared platform-console dialog (#321, tokens #628).
 *
 * The console was built light-only, and the app-wide theme provider toggles
 * `.dark` on `<html>` for every shell. With the system in dark mode the modal
 * therefore stayed a bright island — readable, but the one surface that ignored
 * the theme. Since #628 the dialog paints from the same `console-*` tokens as
 * every other console surface, so its panel is the card surface, its fields are
 * the sunken surface and its dividers are the border token. There is no
 * dialog-only palette left to drift.
 *
 * `DIALOG_CONTRAST` names the token pairs the dialog depends on;
 * `superadmin-dialog-contrast.test.tsx` reads the values from
 * `app/globals.css` and checks every pair against WCAG AA for normal text
 * (4.5:1) in both themes, the same contract `console-palette.ts` enforces for
 * the rest of the console.
 */

/** Dimmed backdrop behind the panel. */
export const DIALOG_BACKDROP = "bg-console-scrim/70";

/** The dialog panel itself: the surface every child inherits from. */
export const DIALOG_PANEL = "border-console-border bg-console-surface text-console-content";

/** Header icon tile. */
export const DIALOG_ICON_TILE = "bg-console-surface-sunken text-console-content";

/** Dialog title. */
export const DIALOG_TITLE = "text-console-content";

/** One-line explanation under the title. */
export const DIALOG_DESCRIPTION = "text-console-content-muted";

/** Close control in the header, and the header's hover wash. */
export const DIALOG_CLOSE =
	"text-console-content-muted hover:bg-console-surface-sunken hover:text-console-content";

/** Field label. */
export const DIALOG_LABEL = FIELD_LABEL;

/** Text field, themed and with a focus ring that clears the field surface. */
export const DIALOG_FIELD = cn(FIELD_INPUT, "focus:ring-console-focus");

/** Inline validation message. */
export const DIALOG_ERROR =
	"border-console-critical-content/40 bg-console-critical-surface text-console-critical-content";

/**
 * Confirm control. `--console-accent` is the AA-safe console orange (5.2:1
 * against white in light, 8.1:1 against the dark page); the brighter brand
 * orange stays the focus ring and decoration only.
 */
export const DIALOG_PRIMARY = PRIMARY_BUTTON;

/** Cancel control. */
export const DIALOG_SECONDARY = cn(SECONDARY_BUTTON, "text-console-content");

export interface DialogContrastPair {
	/** What the pair paints, e.g. "dialog title". */
	label: string;
	/** Token name without the leading `--`, resolved from `app/globals.css`. */
	background: string;
	foreground: string;
}

/**
 * The pairs the dialog depends on. Values are not repeated here: the test reads
 * them from the single `--console-*` palette, so a dialog colour and a card
 * colour can never disagree.
 */
export const DIALOG_CONTRAST: readonly DialogContrastPair[] = [
	{
		label: "dialog title",
		background: "console-surface",
		foreground: "console-content",
	},
	{
		label: "dialog explanation",
		background: "console-surface",
		foreground: "console-content-muted",
	},
	{
		label: "password field text",
		background: "console-surface-sunken",
		foreground: "console-content",
	},
	{
		label: "confirm button",
		background: "console-accent",
		foreground: "console-accent-foreground",
	},
	{
		label: "cancel button",
		background: "console-surface-raised",
		foreground: "console-content",
	},
	{
		label: "validation message",
		background: "console-critical-surface",
		foreground: "console-critical-content",
	},
] as const;
