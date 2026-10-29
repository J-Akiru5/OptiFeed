import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

type Messages = Record<string, unknown>;

/**
 * Tagalog starts as an overlay on top of English. Every key that is not in
 * `tl.json` falls back to English, so the locale is usable immediately and
 * translations can be filled in incrementally without a missing-message crash.
 */
function mergeMessages(base: Messages, overlay: Messages): Messages {
	const merged: Messages = { ...base };
	for (const [key, value] of Object.entries(overlay)) {
		const current = merged[key];
		if (
			value &&
			typeof value === "object" &&
			!Array.isArray(value) &&
			current &&
			typeof current === "object" &&
			!Array.isArray(current)
		) {
			merged[key] = mergeMessages(current as Messages, value as Messages);
		} else {
			merged[key] = value;
		}
	}
	return merged;
}

export default getRequestConfig(async ({ requestLocale }) => {
	let locale = await requestLocale;
	if (!locale || !routing.locales.includes(locale as (typeof routing.locales)[number])) {
		locale = routing.defaultLocale;
	}

	if (locale === "tl") {
		const [english, tagalog] = await Promise.all([
			import("../messages/en.json"),
			import("../messages/tl.json"),
		]);
		return {
			locale,
			messages: mergeMessages(english.default as Messages, tagalog.default as Messages),
		};
	}

	return {
		locale,
		messages: (await import(`../messages/${locale}.json`)).default,
	};
});
