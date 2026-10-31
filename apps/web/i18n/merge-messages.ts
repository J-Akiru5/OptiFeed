export type Messages = { [key: string]: string | Messages };

/**
 * Deep-merge a locale overlay on top of the base catalogue.
 *
 * Tagalog is an overlay on English: keys that exist in `tl.json` win, and every
 * key that does not is served from `en.json`. That fallback is what keeps the
 * locale usable while a translation is being reviewed — a missing key must
 * never render a raw dotted path or throw inside `next-intl`.
 */
export function mergeMessages(base: Messages, overlay: Messages): Messages {
	const merged: Messages = { ...base };
	for (const [key, value] of Object.entries(overlay)) {
		const current = merged[key];
		if (typeof value === "object" && typeof current === "object") {
			merged[key] = mergeMessages(current, value);
		} else {
			merged[key] = value;
		}
	}
	return merged;
}
