/**
 * Sticky primary action bar for long forms on a phone (E26).
 *
 * Applied only below `sm`, so the desktop forms keep their existing action row.
 * The offset clears the fixed bottom bar and the device safe area, and the bar
 * is the last element of the form, so it never covers a field the reader still
 * has to fill in.
 */
export const mobileStickyActions =
	"max-sm:sticky max-sm:bottom-[calc(var(--ofd-bottom-nav-h)+env(safe-area-inset-bottom)+0.5rem)] max-sm:z-10 max-sm:rounded-xl max-sm:border max-sm:bg-white/95 max-sm:p-2 max-sm:shadow-lg max-sm:backdrop-blur dark:max-sm:bg-gray-900/95";
