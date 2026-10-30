/**
 * Canonical public origin of this deployment.
 *
 * This is the single source for the host that `robots.txt`, `sitemap.xml` and
 * the Open Graph / Twitter metadata advertise. `NEXT_PUBLIC_SITE_URL` is the
 * only knob: it defaults to the production origin, so leaving it unset keeps
 * today's output exactly as it was, while a self-hosted or containerised
 * deployment can advertise its own host without editing source.
 *
 * Resolution happens at build time: Next.js evaluates the static `robots` and
 * `sitemap` routes and the root metadata during `next build`, so the variable
 * must be present when the image is built, not only when it starts.
 */

/** Today's production origin. Every other deployment overrides it. */
export const PRODUCTION_SITE_URL = "https://pakaonai.syntaxure.dev";

/**
 * Return a normalised origin (`scheme://host[:port]`) for the configured site
 * URL.
 *
 * - Unset or blank -> the production origin.
 * - Trailing slashes, paths, queries and fragments are dropped so callers can
 *   append `/sitemap.xml` or `/og.png` safely.
 * - A value that is not an absolute http(s) URL falls back to production and
 *   warns once per value, so a typo degrades to today's behaviour instead of
 *   emitting a broken canonical URL.
 */
export function resolveSiteUrl(raw: string | undefined = process.env.NEXT_PUBLIC_SITE_URL): string {
	const candidate = raw?.trim();
	if (!candidate) return PRODUCTION_SITE_URL;

	let parsed: URL;
	try {
		parsed = new URL(candidate);
	} catch {
		console.warn(`[site-url] NEXT_PUBLIC_SITE_URL is not an absolute URL: "${candidate}"`);
		return PRODUCTION_SITE_URL;
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		console.warn(`[site-url] NEXT_PUBLIC_SITE_URL must use http or https: "${candidate}"`);
		return PRODUCTION_SITE_URL;
	}

	return parsed.origin;
}
