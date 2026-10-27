/**
 * Shared class strings for the tenant admin console.
 *
 * These are not a new design system: they gather the colour, radius and focus
 * treatments the console already used in slightly different spellings, so the
 * pages keep one look and every interactive element keeps a visible focus ring
 * (WCAG 2.4.7).
 *
 * Text-bearing orange uses #C2410C rather than the brand #E85A2A: white on
 * #E85A2A is 3.54:1, which fails WCAG AA for the 12–14 px labels used on these
 * controls, while white on #C2410C is 5.18:1. Decorative orange fills (icon
 * tiles, progress bars) keep the brand colour.
 */

/** Card/panel surface used by the console. */
export const adminSurface =
	"rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700/60 dark:bg-gray-900";

/** Primary action: one per screen. */
export const adminButtonPrimary =
	"inline-flex items-center justify-center gap-2 rounded-xl bg-[#C2410C] px-4 py-2.5 text-sm font-black text-white transition-colors hover:bg-[#9A3412] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:outline-[#8fc0ea]";

/** Secondary action: filters, print, per-row controls. */
export const adminButtonSecondary =
	"inline-flex items-center justify-center gap-2 rounded-xl border border-[#0A3D62]/20 bg-white px-3 py-2 text-xs font-black text-[#0A3D62] transition-colors hover:bg-[#F4F7F6] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-900 dark:text-[#8fc0ea] dark:hover:bg-gray-800 dark:focus-visible:outline-[#8fc0ea]";

/** Text input/select treatment shared by the console forms. */
export const adminField =
	"w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-[#0A3D62] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A] focus-visible:ring-offset-1 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:focus-visible:ring-offset-gray-900";

/** Form label. */
export const adminLabel =
	"mb-1.5 block text-xs font-bold uppercase tracking-wider text-[#3D5568] dark:text-gray-300";

/** Helper text under a field. */
export const adminHint = "mt-1 block text-[11px] text-[#3D5568] dark:text-gray-400";
