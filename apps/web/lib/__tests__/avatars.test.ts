import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	createSignedUrls: vi.fn(),
	from: vi.fn(),
	createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: mocks.createAdminClient,
}));

import {
	AVATAR_SIGNED_URL_TTL_SECONDS,
	getSignedAvatarUrls,
	isAvatarPathForUser,
} from "@/lib/avatars";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.from.mockReturnValue({ createSignedUrls: mocks.createSignedUrls });
	mocks.createAdminClient.mockReturnValue({ storage: { from: mocks.from } });
});

describe("getSignedAvatarUrls", () => {
	it("signs a whole page of users in one Storage call with a 1 h expiry", async () => {
		mocks.createSignedUrls.mockResolvedValue({
			data: [
				{ path: "u1/a.webp", signedUrl: "https://signed/u1", error: null },
				{ path: "u2/b.png", signedUrl: "https://signed/u2", error: null },
			],
			error: null,
		});

		const urls = await getSignedAvatarUrls([
			{ id: "u1", avatarPath: "u1/a.webp" },
			{ id: "u2", avatarPath: "u2/b.png" },
		]);

		expect(AVATAR_SIGNED_URL_TTL_SECONDS).toBe(3600);
		expect(mocks.from).toHaveBeenCalledWith("avatars");
		expect(mocks.createSignedUrls).toHaveBeenCalledTimes(1);
		expect(mocks.createSignedUrls).toHaveBeenCalledWith(
			["u1/a.webp", "u2/b.png"],
			AVATAR_SIGNED_URL_TTL_SECONDS,
		);
		expect(urls).toEqual({ u1: "https://signed/u1", u2: "https://signed/u2" });
	});

	it("skips users without a picture, foreign paths and duplicate objects", async () => {
		mocks.createSignedUrls.mockResolvedValue({
			data: [{ path: "u1/a.webp", signedUrl: "https://signed/u1", error: null }],
			error: null,
		});

		const urls = await getSignedAvatarUrls([
			{ id: "u1", avatarPath: "u1/a.webp" },
			{ id: "u2", avatarPath: null },
			// A path outside the user's own folder is never signed or returned.
			{ id: "u3", avatarPath: "u1/a.webp" },
			{ id: "u4", avatarPath: "../../etc/passwd" },
		]);

		expect(mocks.createSignedUrls).toHaveBeenCalledWith(
			["u1/a.webp"],
			AVATAR_SIGNED_URL_TTL_SECONDS,
		);
		expect(urls).toEqual({ u1: "https://signed/u1" });
	});

	it("returns an empty map when Storage reports an error", async () => {
		mocks.createSignedUrls.mockResolvedValue({
			data: null,
			error: { message: "storage down" },
		});

		await expect(getSignedAvatarUrls([{ id: "u1", avatarPath: "u1/a.webp" }])).resolves.toEqual({});
	});

	it("falls back to initials when the service client is unavailable", async () => {
		mocks.createAdminClient.mockImplementation(() => {
			throw new Error("Missing environment variable: SUPABASE_SERVICE_ROLE_KEY");
		});

		await expect(getSignedAvatarUrls([{ id: "u1", avatarPath: "u1/a.webp" }])).resolves.toEqual({});
	});

	it("does not call Storage when nobody on the page has a picture", async () => {
		await expect(getSignedAvatarUrls([{ id: "u1", avatarPath: null }])).resolves.toEqual({});
		expect(mocks.createSignedUrls).not.toHaveBeenCalled();
	});
});

describe("isAvatarPathForUser", () => {
	it("accepts only an object inside the user's own folder", () => {
		expect(isAvatarPathForUser("u1/abc.webp", "u1")).toBe(true);
		expect(isAvatarPathForUser("u2/abc.webp", "u1")).toBe(false);
		expect(isAvatarPathForUser("u1/../u2/abc.webp", "u1")).toBe(false);
		expect(isAvatarPathForUser("u1/", "u1")).toBe(false);
	});
});
