/**
 * Initials fallback for profile pictures (#198, E20).
 *
 * Pure and client-safe: the shared `<UserAvatar>` uses it on the server and in
 * the browser, and the tests cover the name shapes the app actually renders
 * (display name, farm id, e-mail local part).
 */
export function avatarInitials(name: string | null | undefined): string {
	const trimmed = (name ?? "").trim();
	if (!trimmed) return "?";

	const parts = trimmed.split(/\s+/).filter(Boolean);
	if (parts.length === 0) return "?";
	if (parts.length === 1) {
		return Array.from(parts[0]).slice(0, 2).join("").toUpperCase();
	}
	const first = Array.from(parts[0])[0] ?? "";
	const last = Array.from(parts[parts.length - 1])[0] ?? "";
	return `${first}${last}`.toUpperCase();
}
