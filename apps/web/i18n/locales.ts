/**
 * The locale set, in one place.
 *
 * `i18n/routing.ts` feeds these to next-intl; `lib/auth/recovery-link.ts` uses
 * the same list to validate a redirect target without importing the
 * navigation hooks into a server action or route handler.
 */
export const locales = ["en", "hil", "tl"] as const;

export const defaultLocale = "en";
