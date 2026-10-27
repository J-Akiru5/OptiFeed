/**
 * Shared class strings for the farmer dashboard.
 *
 * These are not a new design system: they gather the colour, radius and focus
 * treatments the dashboard already used in slightly different spellings, so
 * every page keeps one look and every interactive element keeps a visible focus
 * ring (WCAG 2.4.7).
 *
 * Text-bearing orange uses #C2410C rather than the brand #E85A2A: white on
 * #E85A2A is 3.54:1, which fails WCAG AA for the 12–14 px labels used on these
 * controls, while white on #C2410C is 5.18:1. Decorative orange fills (icon
 * tiles, progress bars) keep the brand colour. This mirrors the tenant admin
 * console (`components/admin/admin-classes.ts`); the two consoles keep their
 * own copies so a change in one does not silently restyle the other.
 */

/** Card/panel surface used by the dashboard. */
export const dashboardSurface =
	"rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700/60 dark:bg-gray-900";

/** Primary action: one per screen. */
export const dashboardButtonPrimary =
	"inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#C2410C] px-4 py-2.5 text-sm font-black text-white transition-colors hover:bg-[#9A3412] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:outline-[#8fc0ea]";

/** Secondary action: filters, print, per-row controls. */
export const dashboardButtonSecondary =
	"inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#0A3D62]/20 bg-white px-3 py-2 text-xs font-black text-[#0A3D62] transition-colors hover:bg-[#F4F7F6] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-900 dark:text-[#8fc0ea] dark:hover:bg-gray-800 dark:focus-visible:outline-[#8fc0ea]";

/** Text input/select treatment shared by the dashboard forms and filters. */
export const dashboardField =
	"min-h-11 w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-[#0A3D62] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A] focus-visible:ring-offset-1 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:focus-visible:ring-offset-gray-900";

/** Form label. */
export const dashboardLabel =
	"mb-1.5 block text-xs font-bold uppercase tracking-wider text-[#3D5568] dark:text-gray-300";

/** Helper text under a field. */
export const dashboardHint = "mt-1 block text-[11px] text-[#3D5568] dark:text-gray-400";

/** Filter pill (tier/category tabs). Meets the 44 px touch target. */
export const dashboardPill =
	"inline-flex min-h-11 items-center rounded-full px-4 py-2 text-xs font-bold uppercase transition-colors focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea]";

/** Filter pill, selected. */
export const dashboardPillActive = "bg-[#0A3D62] text-white";

/** Filter pill, idle. */
export const dashboardPillIdle =
	"bg-[#F4F7F6] text-[#3D5568] hover:bg-[#E8EDED] dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700";

/** Keyboard focus ring for links and icon buttons. */
export const dashboardFocus =
	"focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea]";
