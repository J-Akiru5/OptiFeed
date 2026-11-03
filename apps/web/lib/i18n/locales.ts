/**
 * Locale metadata shared by the language switcher and the coverage tests.
 *
 * Names are exonyms: they stay in their own language in every locale, so they
 * are not catalogue keys.
 */
export type AppLocale = "en" | "hil" | "tl";

export const LOCALE_LABELS: Record<AppLocale, string> = {
	en: "English",
	hil: "Hiligaynon",
	tl: "Tagalog",
};

/**
 * Locales that are not ready to be presented as complete (#762).
 *
 * - `tl` ships key-complete but most values are machine drafts awaiting human
 *   review (`messages/tl.draft-keys.json`, #457).
 * - `hil` is key-complete but largely untranslated: 141 of the 220 `landing.*`
 *   values are still byte-identical to English, including whole sections and
 *   `/hil/privacy` headings. The Beta badge is the honest label until the
 *   translation pass lands; `hiligaynon-coverage.test.ts` stops it growing.
 */
export const BETA_LOCALES: ReadonlySet<AppLocale> = new Set<AppLocale>(["hil", "tl"]);

export function isBetaLocale(locale: string): boolean {
	return BETA_LOCALES.has(locale as AppLocale);
}
