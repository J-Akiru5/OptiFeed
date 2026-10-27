import { describe, expect, it } from "vitest";

import {
	AVATAR_MAX_BYTES,
	AVATAR_MAX_DIMENSION,
	inspectAvatarImage,
	isAvatarWithinLimits,
} from "@/lib/avatar-image";
import { jpeg, png, webpVp8x } from "./helpers/avatar-images";

function inspected(bytes: Uint8Array) {
	const info = inspectAvatarImage(bytes);
	if (!info) throw new Error("expected a recognised image");
	return info;
}

/** `sharp` is unavailable, so this parser is the only server-side image gate. */
describe("avatar image inspection", () => {
	it("detects a WEBP from its magic bytes and reads the VP8X canvas size", () => {
		expect(inspected(webpVp8x(512, 512))).toEqual({
			mime: "image/webp",
			extension: "webp",
			width: 512,
			height: 512,
		});
	});

	it("detects a PNG and reads IHDR dimensions", () => {
		expect(inspected(png(300, 200))).toEqual({
			mime: "image/png",
			extension: "png",
			width: 300,
			height: 200,
		});
	});

	it("detects a JPEG from its SOI marker", () => {
		const header = new Uint8Array(4);
		header.set([0xff, 0xd8, 0xff, 0xe0], 0);
		const info = inspected(header);
		expect(info.mime).toBe("image/jpeg");
		expect(info.extension).toBe("jpg");
	});

	it("detects a JPEG and reads the start-of-frame size", () => {
		const info = inspected(jpeg(640, 480));
		expect(info).toEqual({ mime: "image/jpeg", extension: "jpg", width: 640, height: 480 });
	});

	it("rejects anything that is not an image, including an HTML polyglot prefix", () => {
		expect(inspectAvatarImage(new TextEncoder().encode("<!doctype html>"))).toBeNull();
		expect(inspectAvatarImage(new TextEncoder().encode("GIF89a"))).toBeNull();
		expect(inspectAvatarImage(new Uint8Array())).toBeNull();
	});

	it("accepts a normal picture inside the byte and pixel limits", () => {
		const info = inspected(webpVp8x(512, 512));
		expect(isAvatarWithinLimits(info, 80_000)).toBe(true);
	});

	it("rejects a file over the 2 MB bucket limit", () => {
		const info = inspected(webpVp8x(512, 512));
		expect(isAvatarWithinLimits(info, AVATAR_MAX_BYTES + 1)).toBe(false);
		expect(isAvatarWithinLimits(info, AVATAR_MAX_BYTES)).toBe(true);
	});

	it("rejects a decompression bomb by pixel size", () => {
		const info = inspected(png(AVATAR_MAX_DIMENSION + 1, 512));
		expect(info.width).toBe(AVATAR_MAX_DIMENSION + 1);
		expect(isAvatarWithinLimits(info, 90_000)).toBe(false);
	});
});
