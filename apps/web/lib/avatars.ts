import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Profile pictures (issue #198, decision E20).
 *
 * The `avatars` bucket is private, so pictures are only ever served through
 * short-lived signed URLs. One call signs a whole page of users, which keeps
 * list pages to a single Storage request and means no component ever receives
 * another user's object key.
 *
 * Object key layout: `<userId>/<random>.<ext>` — no name, e-mail or farm slug.
 */

export const AVATAR_BUCKET = "avatars";
export const AVATAR_SIGNED_URL_TTL_SECONDS = 60 * 60;

/** Supabase's Storage API caps a signed-URL batch; stay well below it. */
const SIGN_BATCH_SIZE = 100;

export type AvatarSubject = {
	id: string;
	avatarPath: string | null;
};

/** An object key is only ever deletable by the user whose folder it sits in. */
export function isAvatarPathForUser(path: string, userId: string): boolean {
	if (!path || !userId) return false;
	const prefix = `${userId}/`;
	return path.startsWith(prefix) && path.length > prefix.length && !path.includes("..");
}

/**
 * Sign the pictures of a page of users in one Storage round trip.
 *
 * Never throws: a storage hiccup, a missing service key or a deleted object
 * degrades to initials, which is the same fallback a user without a picture
 * gets. The returned map is keyed by user id so callers never handle paths.
 */
export async function getSignedAvatarUrls(
	subjects: readonly AvatarSubject[],
): Promise<Record<string, string>> {
	const pathByUser = new Map<string, string>();
	for (const subject of subjects) {
		if (!subject?.id || !subject.avatarPath) continue;
		if (!isAvatarPathForUser(subject.avatarPath, subject.id)) continue;
		pathByUser.set(subject.id, subject.avatarPath);
	}
	if (pathByUser.size === 0) return {};

	const userIdsByPath = new Map<string, string[]>();
	for (const [userId, path] of pathByUser) {
		const owners = userIdsByPath.get(path) ?? [];
		owners.push(userId);
		userIdsByPath.set(path, owners);
	}
	const paths = [...userIdsByPath.keys()];

	const urlByPath = new Map<string, string>();
	try {
		const storage = createAdminClient().storage.from(AVATAR_BUCKET);
		for (let start = 0; start < paths.length; start += SIGN_BATCH_SIZE) {
			const batch = paths.slice(start, start + SIGN_BATCH_SIZE);
			const { data, error } = await storage.createSignedUrls(batch, AVATAR_SIGNED_URL_TTL_SECONDS);
			if (error || !data) continue;
			for (const entry of data) {
				if (!entry.path || entry.error || !entry.signedUrl) continue;
				urlByPath.set(entry.path, entry.signedUrl);
			}
		}
	} catch {
		// Initials fallback; an avatar must never break a page.
		return {};
	}

	const urls: Record<string, string> = {};
	for (const [path, userIds] of userIdsByPath) {
		const signed = urlByPath.get(path);
		if (!signed) continue;
		for (const userId of userIds) urls[userId] = signed;
	}
	return urls;
}
