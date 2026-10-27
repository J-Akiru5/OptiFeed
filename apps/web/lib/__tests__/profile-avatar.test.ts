import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	upload: vi.fn(),
	remove: vi.fn(),
	from: vi.fn(),
	update: vi.fn(),
	getCurrentUser: vi.fn(),
	assertPasswordChanged: vi.fn(),
	assertNotViewingAs: vi.fn(),
	revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: () => ({ storage: { from: mocks.from } }),
}));
vi.mock("@/lib/prisma", () => ({ default: { user: { update: mocks.update } } }));
vi.mock("@/lib/auth/session", () => ({
	getCurrentUser: mocks.getCurrentUser,
	assertPasswordChanged: mocks.assertPasswordChanged,
}));
vi.mock("@/lib/auth/view-as", () => ({ assertNotViewingAs: mocks.assertNotViewingAs }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { removeAvatar, uploadAvatar } from "@/lib/actions/profile-avatar";
import { AVATAR_MAX_BYTES } from "@/lib/avatar-image";
import { png, webpVp8x } from "./helpers/avatar-images";

const USER = { id: "u1", avatarPath: null as string | null };

function avatarForm(
	bytes: Uint8Array<ArrayBuffer>,
	name = "avatar.webp",
	type = "image/webp",
): FormData {
	const form = new FormData();
	form.set("avatar", new File([bytes], name, { type }));
	return form;
}

beforeEach(() => {
	vi.clearAllMocks();
	USER.avatarPath = null;
	mocks.getCurrentUser.mockResolvedValue(USER);
	mocks.assertPasswordChanged.mockResolvedValue(undefined);
	mocks.assertNotViewingAs.mockResolvedValue(undefined);
	mocks.from.mockReturnValue({ upload: mocks.upload, remove: mocks.remove });
	mocks.upload.mockResolvedValue({ error: null });
	mocks.remove.mockResolvedValue({ error: null });
	mocks.update.mockResolvedValue({ ...USER });
});

describe("uploadAvatar", () => {
	it("lets a signed-in user upload their own picture under their own folder", async () => {
		const result = await uploadAvatar(avatarForm(webpVp8x(512, 512)));

		expect(result).toEqual({ success: true });
		expect(mocks.from).toHaveBeenCalledWith("avatars");
		const [key, , options] = mocks.upload.mock.calls[0];
		expect(key).toMatch(/^u1\/[0-9a-f-]{36}\.webp$/);
		expect(options).toMatchObject({ contentType: "image/webp", upsert: false });
		expect(mocks.update).toHaveBeenCalledWith({
			where: { id: "u1" },
			data: { avatarPath: key },
		});
		expect(mocks.revalidatePath).toHaveBeenCalled();
	});

	it("keeps a PNG upload honest about its type", async () => {
		const result = await uploadAvatar(avatarForm(png(512, 512), "avatar.png", "image/png"));

		expect(result).toEqual({ success: true });
		const [key, , options] = mocks.upload.mock.calls[0];
		expect(key).toMatch(/^u1\/[0-9a-f-]{36}\.png$/);
		expect(options).toMatchObject({ contentType: "image/png" });
	});

	it("denies an anonymous caller and never touches Storage", async () => {
		mocks.getCurrentUser.mockResolvedValue(null);

		await expect(uploadAvatar(avatarForm(webpVp8x(512, 512)))).resolves.toEqual({
			error: "not_authenticated",
		});
		expect(mocks.upload).not.toHaveBeenCalled();
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it("denies a read-only view-as session", async () => {
		mocks.assertNotViewingAs.mockRejectedValueOnce(new Error("view_as_read_only"));

		await expect(uploadAvatar(avatarForm(webpVp8x(512, 512)))).resolves.toEqual({
			error: "not_allowed",
		});
		expect(mocks.upload).not.toHaveBeenCalled();
	});

	it("denies a caller whose password change is still pending", async () => {
		mocks.assertPasswordChanged.mockRejectedValueOnce(new Error("Password change required"));

		await expect(uploadAvatar(avatarForm(webpVp8x(512, 512)))).resolves.toEqual({
			error: "not_allowed",
		});
	});

	it("ignores a userId in the payload: the session owns the target", async () => {
		const form = avatarForm(webpVp8x(512, 512));
		form.set("userId", "u2");

		await expect(uploadAvatar(form)).resolves.toEqual({ success: true });
		const [key] = mocks.upload.mock.calls[0];
		expect(key.startsWith("u1/")).toBe(true);
		expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "u1" } }));
	});

	it("rejects a non-image by magic bytes, not by name or MIME type", async () => {
		const result = await uploadAvatar(
			avatarForm(new TextEncoder().encode("<svg onload=alert(1)>"), "avatar.webp", "image/webp"),
		);

		expect(result).toEqual({ error: "invalid_type" });
		expect(mocks.upload).not.toHaveBeenCalled();
	});

	it("rejects a file over 2 MB before uploading", async () => {
		const result = await uploadAvatar(
			avatarForm(new Uint8Array(AVATAR_MAX_BYTES + 1), "big.webp", "image/webp"),
		);

		expect(result).toEqual({ error: "too_large" });
		expect(mocks.upload).not.toHaveBeenCalled();
	});

	it("rejects an oversized canvas", async () => {
		const result = await uploadAvatar(avatarForm(png(6000, 6000), "bomb.png", "image/png"));

		expect(result).toEqual({ error: "invalid_dimensions" });
		expect(mocks.upload).not.toHaveBeenCalled();
	});

	it("replaces the previous picture and deletes only that object", async () => {
		USER.avatarPath = "u1/old.webp";

		await expect(uploadAvatar(avatarForm(webpVp8x(512, 512)))).resolves.toEqual({
			success: true,
		});
		expect(mocks.remove).toHaveBeenCalledTimes(1);
		expect(mocks.remove).toHaveBeenCalledWith(["u1/old.webp"]);
	});

	it("never deletes an object outside the user's folder, even if the row is tampered", async () => {
		USER.avatarPath = "u2/secret.webp";

		await expect(uploadAvatar(avatarForm(webpVp8x(512, 512)))).resolves.toEqual({
			success: true,
		});
		expect(mocks.remove).not.toHaveBeenCalled();
	});

	it("removes the new object and keeps the old picture when the database write fails", async () => {
		USER.avatarPath = "u1/old.webp";
		mocks.update.mockRejectedValueOnce(new Error("db down"));

		const result = await uploadAvatar(avatarForm(webpVp8x(512, 512)));

		expect(result).toEqual({ error: "save_failed" });
		const [key] = mocks.upload.mock.calls[0];
		expect(mocks.remove).toHaveBeenCalledWith([key]);
		expect(mocks.remove).not.toHaveBeenCalledWith(["u1/old.webp"]);
	});
});

describe("removeAvatar", () => {
	it("clears the column and deletes the object", async () => {
		USER.avatarPath = "u1/old.webp";

		await expect(removeAvatar()).resolves.toEqual({ success: true });
		expect(mocks.update).toHaveBeenCalledWith({
			where: { id: "u1" },
			data: { avatarPath: null },
		});
		expect(mocks.remove).toHaveBeenCalledWith(["u1/old.webp"]);
	});

	it("is idempotent when there is no picture", async () => {
		await expect(removeAvatar()).resolves.toEqual({ success: true });
		expect(mocks.update).not.toHaveBeenCalled();
		expect(mocks.remove).not.toHaveBeenCalled();
	});

	it("denies an anonymous caller", async () => {
		mocks.getCurrentUser.mockResolvedValue(null);

		await expect(removeAvatar()).resolves.toEqual({ error: "not_authenticated" });
		expect(mocks.update).not.toHaveBeenCalled();
	});
});
