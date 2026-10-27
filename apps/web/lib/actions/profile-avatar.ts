"use server";

import { randomUUID } from "node:crypto";
import { assertPasswordChanged, getCurrentUser } from "@/lib/auth/session";
import { assertNotViewingAs } from "@/lib/auth/view-as";
import { AVATAR_MAX_BYTES, inspectAvatarImage, isAvatarWithinLimits } from "@/lib/avatar-image";
import { AVATAR_BUCKET, isAvatarPathForUser } from "@/lib/avatars";
import prisma from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

/**
 * Profile picture mutations (issue #198, decision E20).
 *
 * A signed-in user may change only their own picture: the actor comes from the
 * verified session, never from the form payload, so there is no id to spoof.
 * The browser crops the picture to a square and re-encodes a 512 px WebP; the
 * server still re-checks the magic bytes, the byte limit and the pixel size
 * before writing to the private `avatars` bucket.
 *
 * Ordering is chosen so a failure never loses the current picture: upload the
 * new object, commit `avatarPath`, and only then delete the previous object.
 *
 * Both exports repeat the guard calls inline: every export of a "use server"
 * module is browser-callable, and `server-action-guards.test.ts` requires each
 * writing body to carry its own guard call rather than trust a shared helper.
 */

export type AvatarErrorCode =
	| "not_authenticated"
	| "not_allowed"
	| "empty"
	| "too_large"
	| "invalid_type"
	| "invalid_dimensions"
	| "upload_failed"
	| "save_failed";

export type AvatarMutationResult = { success: true } | { error: AvatarErrorCode };

function revalidateAvatarSurfaces(): void {
	revalidatePath("/[locale]/(dashboard)/dashboard/settings/profile", "page");
	revalidatePath("/[locale]/dashboard", "layout");
	revalidatePath("/[locale]/admin", "layout");
	revalidatePath("/[locale]/superadmin", "layout");
}

function avatarStorage() {
	try {
		return createAdminClient().storage.from(AVATAR_BUCKET);
	} catch {
		return null;
	}
}

/**
 * Upload or replace the caller's own picture.
 *
 * The FormData field is `avatar`. A `userId` field, if a caller adds one, is
 * ignored on purpose: the session owns the target.
 */
export async function uploadAvatar(formData: FormData): Promise<AvatarMutationResult> {
	const user = await getCurrentUser();
	if (!user) return { error: "not_authenticated" };
	try {
		await assertPasswordChanged();
		await assertNotViewingAs();
	} catch {
		// A read-only view-as session and a pending forced password change are
		// both "not now", and neither may write a personal picture.
		return { error: "not_allowed" };
	}

	const entry = formData.get("avatar");
	if (!entry || typeof entry === "string" || typeof entry.arrayBuffer !== "function") {
		return { error: "empty" };
	}
	const file = entry as File;
	if (file.size <= 0) return { error: "empty" };
	// Check the declared size before buffering a large body.
	if (file.size > AVATAR_MAX_BYTES) return { error: "too_large" };

	let bytes: Uint8Array;
	try {
		bytes = new Uint8Array(await file.arrayBuffer());
	} catch {
		return { error: "empty" };
	}

	const info = inspectAvatarImage(bytes);
	if (!info) return { error: "invalid_type" };
	if (!isAvatarWithinLimits(info, bytes.byteLength)) {
		return { error: bytes.byteLength > AVATAR_MAX_BYTES ? "too_large" : "invalid_dimensions" };
	}

	const key = `${user.id}/${randomUUID()}.${info.extension}`;
	const previousPath = user.avatarPath;

	const storage = avatarStorage();
	if (!storage) return { error: "upload_failed" };

	try {
		const { error: uploadError } = await storage.upload(key, bytes, {
			contentType: info.mime,
			cacheControl: "3600",
			upsert: false,
		});
		if (uploadError) return { error: "upload_failed" };
	} catch {
		return { error: "upload_failed" };
	}

	try {
		await prisma.user.update({
			where: { id: user.id },
			data: { avatarPath: key },
		});
	} catch {
		// Keep the database and the bucket consistent: the new object was never
		// referenced, so remove it and leave the old picture untouched.
		await storage.remove([key]).catch(() => undefined);
		return { error: "save_failed" };
	}

	if (previousPath && isAvatarPathForUser(previousPath, user.id)) {
		// Best effort: a stale object is harmless, losing the new picture is not.
		await storage.remove([previousPath]).catch(() => undefined);
	}

	revalidateAvatarSurfaces();
	return { success: true };
}

/** Remove the caller's own picture, restoring the initials fallback. */
export async function removeAvatar(): Promise<AvatarMutationResult> {
	const user = await getCurrentUser();
	if (!user) return { error: "not_authenticated" };
	try {
		await assertPasswordChanged();
		await assertNotViewingAs();
	} catch {
		return { error: "not_allowed" };
	}

	const previousPath = user.avatarPath;
	if (!previousPath) {
		// Already on initials: idempotent, not an error.
		revalidateAvatarSurfaces();
		return { success: true };
	}

	try {
		await prisma.user.update({
			where: { id: user.id },
			data: { avatarPath: null },
		});
	} catch {
		return { error: "save_failed" };
	}

	if (isAvatarPathForUser(previousPath, user.id)) {
		const storage = avatarStorage();
		if (storage) {
			try {
				await storage.remove([previousPath]);
			} catch {
				// The row no longer references the object; a leftover key is not user
				// visible and can be cleaned up by a later maintenance job.
			}
		}
	}

	revalidateAvatarSurfaces();
	return { success: true };
}
