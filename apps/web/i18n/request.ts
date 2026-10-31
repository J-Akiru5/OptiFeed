import { getRequestConfig } from "next-intl/server";
import { type Messages, mergeMessages } from "./merge-messages";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
	let locale = await requestLocale;
	if (!locale || !routing.locales.includes(locale as (typeof routing.locales)[number])) {
		locale = routing.defaultLocale;
	}

	if (locale === "tl") {
		// Tagalog is an overlay: a key missing from tl.json falls back to English.
		const [english, tagalog] = await Promise.all([
			import("../messages/en.json"),
			import("../messages/tl.json"),
		]);
		return {
			locale,
			messages: mergeMessages(
				english.default as unknown as Messages,
				tagalog.default as unknown as Messages,
			),
		};
	}

	return {
		locale,
		messages: (await import(`../messages/${locale}.json`)).default,
	};
});
