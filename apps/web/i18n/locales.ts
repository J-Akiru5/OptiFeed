/**
 * Locale identifiers shared by the routing config and server helpers.
 *
 * This module is intentionally free of `next-intl/navigation`: server actions
 * and tests can validate a locale without pulling the client navigation module
 * (and `next/navigation`) into a Node-only test graph.
 */
export const locales = ["en", "hil", "tl"] as const;
export const defaultLocale = "en";

export type AppLocale = (typeof locales)[number];

export function isAppLocale(value: string | null | undefined): value is AppLocale {
	return typeof value === "string" && (locales as readonly string[]).includes(value);
}
