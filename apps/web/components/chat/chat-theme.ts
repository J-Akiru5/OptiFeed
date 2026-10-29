/**
 * Shared colours for every chat surface (#309).
 *
 * The chat shell pre-dates the dashboard's dark-mode pass: it hard-coded
 * light-only surfaces (`bg-white`, `bg-gray-50`, `bg-gray-100`) and text
 * colours chosen for them. When the app turns on `.dark`, the page's inherited
 * foreground becomes near-white, so the composer rendered near-white text on
 * `bg-gray-100` — effectively invisible — while the panel stayed a bright
 * island in an otherwise dark dashboard.
 *
 * These tokens move the whole widget onto the palette the dashboard already
 * uses, instead of inventing a chat-only theme:
 *
 *   light: white / gray-50 surfaces, #0A3D62 ink, gray-800 message text
 *   dark:  gray-900 / gray-950 surfaces, gray-100 ink, #8fc0ea links
 *
 * `CHAT_CONTRAST` records the rendered sRGB values behind those classes. The
 * regression test checks every pair against WCAG AA for normal text (4.5:1) in
 * both themes, so a future repaint cannot quietly drop below it. Tailwind v4
 * ships its palette as OKLCH, so the hex values are the 8-bit sRGB equivalents
 * of the tokens named in each comment.
 */

/** Panel/sheet shell: the desktop side panel and the mobile bottom sheet. */
export const chatSurface = "bg-white dark:bg-gray-900";

/** Desktop panel's left edge against the dashboard page. */
export const chatPanelBorder = "border-l border-gray-200 dark:border-gray-700";

/** The scrolling message list behind the bubbles. */
export const chatMessageList = "bg-gray-50 dark:bg-gray-950";

/** Assistant turn: `text-gray-800` on white, `text-gray-100` on gray-800. */
export const chatAssistantBubble =
	"border border-gray-100 bg-white text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100";

/** User turn: white on blue-600 is 5.25:1 in both themes, so it stays. */
export const chatUserBubble = "bg-blue-600 text-white";

/** User turn avatar. */
export const chatUserAvatar = "bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300";

/** Assistant/typing avatar. */
export const chatAssistantAvatar = "bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-300";

/** Streaming placeholder bubble, matching the assistant turn. */
export const chatTypingBubble =
	"border border-gray-100 bg-white dark:border-gray-700 dark:bg-gray-800";

/** Suggestion-chip and composer strip below the messages. */
export const chatFooter = "border-t border-gray-100 bg-white dark:border-gray-800 dark:bg-gray-900";

/** Suggestion chip: navy on #F4F7F6, light blue on gray-800. */
export const chatChip =
	"border border-[#0A3D62]/15 bg-[#F4F7F6] text-[#0A3D62] transition hover:bg-[#E85A2A]/10 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-[#8fc0ea] dark:hover:bg-gray-700";

/**
 * Composer input. The explicit text colour is the point of #309: this field
 * used to inherit `text-foreground`, which is near-white in dark mode.
 */
export const chatComposer =
	"flex-1 rounded-full bg-gray-100 px-4 py-2 text-sm text-[#0A3D62] outline-none transition-all placeholder:text-[#3D5568] focus:ring-2 focus:ring-[#0A3D62]/25 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-400 dark:focus:ring-[#8fc0ea]/40";

/** Send control: the dashboard's dark navy primary (#1f66a0) in dark mode. */
export const chatSendButton =
	"flex h-10 w-10 items-center justify-center rounded-full bg-[#0A3D62] text-white transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-[#1f66a0]";

/** Action-card Accept: #C2410C, not the brand orange, so white text clears AA. */
export const chatActionAccept =
	"inline-flex items-center gap-1.5 rounded-lg bg-[#C2410C] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#9A3412] disabled:opacity-50";

/** Floating toggle: brand orange stays for the decorative icon (3.54:1 ≥ 3:1). */
export const chatToggleButton =
	"flex h-[var(--ofd-fab-size)] w-[var(--ofd-fab-size)] items-center justify-center rounded-full bg-[#E85A2A] text-white shadow-lg transition-transform hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A] focus-visible:ring-offset-2 dark:focus-visible:ring-[#ff8a5c] dark:focus-visible:ring-offset-gray-950";

export interface ChatContrastPair {
	/** What the pair paints, e.g. "assistant message text". */
	label: string;
	light: { background: string; foreground: string };
	dark: { background: string; foreground: string };
}

/**
 * The rendered pairs the chat states depend on. Values mirror the Tailwind
 * classes named in `chat-theme.ts`; `chat-theme-contrast.test.tsx` asserts each
 * one is at least 4.5:1 (WCAG AA normal text) in both themes.
 */
export const CHAT_CONTRAST: readonly ChatContrastPair[] = [
	{
		label: "assistant message text",
		// bg-white / text-gray-800  ·  dark:bg-gray-800 / dark:text-gray-100
		light: { background: "#FFFFFF", foreground: "#1E2939" },
		dark: { background: "#1E2939", foreground: "#F3F4F6" },
	},
	{
		label: "composer text",
		// bg-gray-100 / text-[#0A3D62]  ·  dark:bg-gray-800 / dark:text-white
		light: { background: "#F3F4F6", foreground: "#0A3D62" },
		dark: { background: "#1E2939", foreground: "#FFFFFF" },
	},
	{
		label: "composer placeholder",
		// placeholder:text-[#3D5568]  ·  dark:placeholder:text-gray-400
		light: { background: "#F3F4F6", foreground: "#3D5568" },
		dark: { background: "#1E2939", foreground: "#99A1AF" },
	},
	{
		label: "suggestion chip",
		// bg-[#F4F7F6] / text-[#0A3D62]  ·  dark:bg-gray-800 / dark:text-[#8fc0ea]
		light: { background: "#F4F7F6", foreground: "#0A3D62" },
		dark: { background: "#1E2939", foreground: "#8FC0EA" },
	},
	{
		label: "user message text",
		// bg-blue-600 / text-white, unchanged in dark
		light: { background: "#155DFC", foreground: "#FFFFFF" },
		dark: { background: "#155DFC", foreground: "#FFFFFF" },
	},
	{
		label: "greeting label",
		// text-[#C2410C]  ·  dark:text-[#ff8a5c]
		light: { background: "#FFFFFF", foreground: "#C2410C" },
		dark: { background: "#101828", foreground: "#FF8A5C" },
	},
	{
		label: "action accept button",
		// bg-[#C2410C] / text-white, unchanged in dark
		light: { background: "#C2410C", foreground: "#FFFFFF" },
		dark: { background: "#C2410C", foreground: "#FFFFFF" },
	},
	{
		label: "action confirmed status",
		// text-green-700  ·  dark:text-green-400
		light: { background: "#FFFFFF", foreground: "#008236" },
		dark: { background: "#101828", foreground: "#05DF72" },
	},
	{
		label: "action cancelled status",
		// text-gray-500  ·  dark:text-gray-400
		light: { background: "#FFFFFF", foreground: "#6A7282" },
		dark: { background: "#101828", foreground: "#99A1AF" },
	},
	{
		label: "action expired status",
		// text-amber-700  ·  dark:text-amber-400
		light: { background: "#FFFFFF", foreground: "#A65F00" },
		dark: { background: "#101828", foreground: "#FFB900" },
	},
	{
		label: "action failed status",
		// text-red-600  ·  dark:text-red-400
		light: { background: "#FFFFFF", foreground: "#E7000B" },
		dark: { background: "#101828", foreground: "#FF6467" },
	},
] as const;
