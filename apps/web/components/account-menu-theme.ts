/**
 * Shared colours for the account menu (#345).
 *
 * The dropdown was built for the dark dashboard header but most of its items
 * only had light-mode ink. In dark mode the device status kept `#1E7B34` /
 * `#C42B3A` on gray-800 (2.75:1 and 2.62:1), the "missing" state was 3.03:1,
 * and the Admin Panel label used the brand orange on a 5% orange tint (3.34:1
 * in light mode). The close control also stayed a light `bg-gray-100` island in
 * the dark panel.
 *
 * These tokens move the menu onto the palette the dashboard already uses, and
 * `ACCOUNT_MENU_CONTRAST` records the rendered sRGB pairs so the regression
 * test can check every item against WCAG AA for normal text (4.5:1) in both
 * themes. The tinted action surfaces are the blended colours the browser
 * actually paints (orange/navy at 5-20% over the panel), not the raw accent.
 */

/** The dropdown card itself. */
export const accountMenuPanel =
	"border border-gray-200 bg-white text-[#0A3D62] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100";

/** Language/Device stat tiles inside the panel. */
export const accountMenuTile = "bg-[#F4F7F6] dark:bg-gray-800";

/** Secondary copy: role line, pond label and the tile captions. */
export const accountMenuMutedText = "text-[#3D5568] dark:text-gray-400";

/** Dismiss control: a light chip in light mode, a panel-toned chip in dark. */
export const accountMenuCloseButton =
	"bg-gray-100 text-[#3D5568] hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700";

export type AccountMenuDeviceStatus = "online" | "offline" | "missing";

/**
 * Device health on the gray-800 tile. The light values already cleared AA on
 * #F4F7F6 except `missing`, which was 4.49:1 and is now gray-600. The dark
 * values use the 400 ramp so the status never sinks into the tile.
 */
export const ACCOUNT_MENU_DEVICE_STATUS: Record<AccountMenuDeviceStatus, string> = {
	online: "text-[#1E7B34] dark:text-green-400",
	offline: "text-[#C42B3A] dark:text-red-400",
	missing: "text-gray-600 dark:text-gray-300",
};

/**
 * Admin Panel action. The brand orange is decorative elsewhere, but it cannot
 * carry text on its own tint: #E85A2A is 3.34:1 on the 5% light surface. The
 * darker #C2410C (the same AA-safe orange as the chat Accept button) clears it,
 * and #ff8a5c stays bright on the 10% dark surface.
 */
export const accountMenuAdminAction =
	"border border-[#E85A2A]/30 bg-[#E85A2A]/5 text-[#C2410C] hover:bg-[#E85A2A]/10 dark:bg-[#E85A2A]/10 dark:text-[#ff8a5c]";

/** Platform Console action: navy on its 5% tint, light blue on the dark tint. */
export const accountMenuPlatformAction =
	"border border-[#0A3D62]/20 bg-[#0A3D62]/5 text-[#0A3D62] hover:bg-[#0A3D62]/10 dark:bg-[#0A3D62]/20 dark:text-[#8ec5ef]";

/** Account settings and Switch language rows. */
export const accountMenuNavigationItem =
	"border border-[#0A3D62]/10 bg-white text-[#0A3D62] hover:bg-[#F4F7F6] dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700";

/** Locale badge inside the Switch language row. */
export const accountMenuBadge = "bg-[#0A3D62]/10 dark:bg-gray-700";

/** Sign out action. */
export const accountMenuSignOut =
	"border border-red-100 bg-red-50 text-[#C42B3A] hover:bg-red-100 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30";

export interface AccountMenuContrastPair {
	/** What the pair paints, e.g. "device offline status". */
	label: string;
	light: { background: string; foreground: string };
	dark: { background: string; foreground: string };
}

/**
 * The rendered pairs the account menu depends on. Values mirror the Tailwind
 * classes above; `account-menu-contrast.test.tsx` asserts each one is at least
 * 4.5:1 (WCAG AA normal text) in both themes.
 */
export const ACCOUNT_MENU_CONTRAST: readonly AccountMenuContrastPair[] = [
	{
		label: "account name",
		// inherited text-[#0A3D62] on white  ·  dark:text-gray-100 on dark:bg-gray-900
		light: { background: "#FFFFFF", foreground: "#0A3D62" },
		dark: { background: "#101828", foreground: "#F3F4F6" },
	},
	{
		label: "account role",
		// text-[#3D5568] on white  ·  dark:text-gray-400 on dark:bg-gray-900
		light: { background: "#FFFFFF", foreground: "#3D5568" },
		dark: { background: "#101828", foreground: "#99A1AF" },
	},
	{
		label: "language value",
		// text-[#0A3D62] on bg-[#F4F7F6]  ·  dark:text-[#5b9bd5] on dark:bg-gray-800
		light: { background: "#F4F7F6", foreground: "#0A3D62" },
		dark: { background: "#1E2939", foreground: "#5B9BD5" },
	},
	{
		label: "account menu label",
		// text-[#3D5568] on bg-[#F4F7F6]  ·  dark:text-gray-400 on dark:bg-gray-800
		light: { background: "#F4F7F6", foreground: "#3D5568" },
		dark: { background: "#1E2939", foreground: "#99A1AF" },
	},
	{
		label: "account menu close control",
		// bg-gray-100 / text-[#3D5568]  ·  dark:bg-gray-800 / dark:text-gray-300
		light: { background: "#F3F4F6", foreground: "#3D5568" },
		dark: { background: "#1E2939", foreground: "#D1D5DC" },
	},
	{
		label: "device online status",
		// text-[#1E7B34]  ·  dark:text-green-400
		light: { background: "#F4F7F6", foreground: "#1E7B34" },
		dark: { background: "#1E2939", foreground: "#05DF72" },
	},
	{
		label: "device offline status",
		// text-[#C42B3A]  ·  dark:text-red-400
		light: { background: "#F4F7F6", foreground: "#C42B3A" },
		dark: { background: "#1E2939", foreground: "#FF6467" },
	},
	{
		label: "device missing status",
		// text-gray-600  ·  dark:text-gray-300
		light: { background: "#F4F7F6", foreground: "#4A5565" },
		dark: { background: "#1E2939", foreground: "#D1D5DC" },
	},
	{
		label: "admin panel action",
		// text-[#C2410C] on the 5% orange tint  ·  dark:text-[#ff8a5c] on the 10% tint
		light: { background: "#FEF7F4", foreground: "#C2410C" },
		dark: { background: "#261F28", foreground: "#FF8A5C" },
	},
	{
		label: "platform console action",
		// text-[#0A3D62] on the 5% navy tint  ·  dark:text-[#8ec5ef] on the 20% tint
		light: { background: "#F3F5F7", foreground: "#0A3D62" },
		dark: { background: "#0F1F34", foreground: "#8EC5EF" },
	},
	{
		label: "account settings action",
		// text-[#0A3D62] on white  ·  dark:text-gray-100 on dark:bg-gray-800
		light: { background: "#FFFFFF", foreground: "#0A3D62" },
		dark: { background: "#1E2939", foreground: "#F3F4F6" },
	},
	{
		label: "switch language action",
		// text-[#0A3D62] on white  ·  dark:text-gray-100 on dark:bg-gray-800
		light: { background: "#FFFFFF", foreground: "#0A3D62" },
		dark: { background: "#1E2939", foreground: "#F3F4F6" },
	},
	{
		label: "locale badge",
		// text-[#0A3D62] on the 10% navy badge  ·  dark:text-gray-100 on dark:bg-gray-700
		light: { background: "#E7ECEF", foreground: "#0A3D62" },
		dark: { background: "#364153", foreground: "#F3F4F6" },
	},
	{
		label: "sign out action",
		// text-[#C42B3A] on bg-red-50  ·  dark:text-red-400 on the 20% red tint
		light: { background: "#FEF2F2", foreground: "#C42B3A" },
		dark: { background: "#271825", foreground: "#FF6467" },
	},
] as const;
