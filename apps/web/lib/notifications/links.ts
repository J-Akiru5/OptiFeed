/**
 * Allowlist for `Notification.linkTo` (#746).
 *
 * Producers store an in-app destination on every notification, but the inbox
 * never read it. Rendering it blindly would let a stored value become an
 * off-site or `javascript:` navigation, so only a plain absolute path on this
 * origin is accepted. The caller renders the result with the locale-aware
 * `Link`, which prefixes the active locale.
 */
export function safeNotificationLink(linkTo: string | null | undefined): string | null {
	if (typeof linkTo !== "string") return null;

	const path = linkTo.trim();
	if (!path.startsWith("/")) return null;
	// `//host` is protocol-relative, `/\host` is normalised to it by browsers.
	if (path.startsWith("//") || path.startsWith("/\\")) return null;
	if (path.includes("\\")) return null;
	// Control characters can split the scheme in lenient parsers.
	for (const char of path) {
		const code = char.charCodeAt(0);
		if (code < 0x20 || code === 0x7f) return null;
	}

	return path;
}
