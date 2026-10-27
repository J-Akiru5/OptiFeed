/**
 * Avatar image inspection (issue #198, decision E20).
 *
 * The browser crops the picture to a square and re-encodes it to WebP before
 * upload, but the server never trusts that: the bytes are re-checked here.
 *
 * `sharp` ships only as a transitive dependency of Next and is not resolvable
 * from the app under pnpm, so the object stored in the private bucket is the
 * client-encoded image (512 px WebP in the normal path). This module is
 * therefore the type and dimension gate instead of a server-side re-encode.
 *
 * Everything here is pure and dependency-free so the browser, the server action
 * and the tests share one definition of "acceptable avatar".
 */

/** Square edge produced by the browser crop. */
export const AVATAR_TARGET_PX = 512;
/** The bucket's own object limit (2 MB). */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
/** Defence in depth against a decompression bomb that slips past the 2 MB cap. */
export const AVATAR_MAX_DIMENSION = 4096;

export type AvatarImageMime = "image/webp" | "image/png" | "image/jpeg";
export type AvatarImageExtension = "webp" | "png" | "jpg";

export type AvatarImageInfo = {
	mime: AvatarImageMime;
	extension: AvatarImageExtension;
	/** Null when the header is valid but the size could not be parsed. */
	width: number | null;
	height: number | null;
};

function hasBytes(bytes: Uint8Array, minimum: number): boolean {
	return bytes.byteLength >= minimum;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	if (!hasBytes(bytes, offset + length)) return "";
	let out = "";
	for (let i = offset; i < offset + length; i += 1) {
		out += String.fromCharCode(bytes[i]);
	}
	return out;
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
	return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
	return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
	return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
	return (
		bytes[offset] |
		(bytes[offset + 1] << 8) |
		(bytes[offset + 2] << 16) |
		((bytes[offset + 3] << 24) >>> 0)
	);
}

/**
 * WebP has three payload variants; each stores the canvas size differently.
 * Any bounds or signature failure returns null instead of throwing.
 */
function readWebpSize(bytes: Uint8Array): { width: number; height: number } | null {
	if (!hasBytes(bytes, 30)) return null;

	const chunk = ascii(bytes, 12, 4);
	if (chunk === "VP8X") {
		return {
			width: readUint24LE(bytes, 24) + 1,
			height: readUint24LE(bytes, 27) + 1,
		};
	}

	if (chunk === "VP8 ") {
		// Frame tag (3) + start code 0x9D 0x01 0x2A, then 14-bit dimensions.
		if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
		return {
			width: readUint16LE(bytes, 26) & 0x3fff,
			height: readUint16LE(bytes, 28) & 0x3fff,
		};
	}

	if (chunk === "VP8L") {
		if (bytes[20] !== 0x2f) return null;
		const bits = readUint32LE(bytes, 21);
		return {
			width: (bits & 0x3fff) + 1,
			height: ((bits >> 14) & 0x3fff) + 1,
		};
	}

	return null;
}

function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
	if (!hasBytes(bytes, 24)) return null;
	return {
		width: readUint32BE(bytes, 16),
		height: readUint32BE(bytes, 20),
	};
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
	return (
		((bytes[offset] << 24) >>> 0) +
		(bytes[offset + 1] << 16) +
		(bytes[offset + 2] << 8) +
		bytes[offset + 3]
	);
}

const JPEG_SOF_MARKERS = new Set([
	0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/** Walk the JPEG marker segments until a start-of-frame carries the size. */
function readJpegSize(bytes: Uint8Array): { width: number; height: number } | null {
	let offset = 2;
	while (offset + 9 < bytes.byteLength) {
		if (bytes[offset] !== 0xff) {
			offset += 1;
			continue;
		}
		// Any number of 0xFF fill bytes may precede a marker.
		let markerOffset = offset + 1;
		while (markerOffset < bytes.byteLength && bytes[markerOffset] === 0xff) markerOffset += 1;
		if (markerOffset >= bytes.byteLength) return null;

		const marker = bytes[markerOffset];
		const segmentStart = markerOffset + 1;
		// Standalone markers carry no length.
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
			offset = segmentStart;
			continue;
		}
		if (segmentStart + 1 >= bytes.byteLength) return null;

		const segmentLength = readUint16BE(bytes, segmentStart);
		if (segmentLength < 2 || segmentStart + segmentLength > bytes.byteLength) return null;

		if (JPEG_SOF_MARKERS.has(marker)) {
			if (segmentStart + 7 >= bytes.byteLength) return null;
			return {
				height: readUint16BE(bytes, segmentStart + 3),
				width: readUint16BE(bytes, segmentStart + 5),
			};
		}
		offset = segmentStart + segmentLength;
	}
	return null;
}

/**
 * Identify an avatar from its magic bytes and, when possible, its pixel size.
 * Returns null for anything that is not a WebP, PNG or JPEG image.
 */
export function inspectAvatarImage(bytes: Uint8Array): AvatarImageInfo | null {
	if (!hasBytes(bytes, 4)) return null;

	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && hasBytes(bytes, 3)) {
		const size = readJpegSize(bytes);
		return {
			mime: "image/jpeg",
			extension: "jpg",
			width: size?.width ?? null,
			height: size?.height ?? null,
		};
	}

	if (
		hasBytes(bytes, 8) &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	) {
		const size = readPngSize(bytes);
		return {
			mime: "image/png",
			extension: "png",
			width: size?.width ?? null,
			height: size?.height ?? null,
		};
	}

	if (hasBytes(bytes, 12) && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
		const size = readWebpSize(bytes);
		return {
			mime: "image/webp",
			extension: "webp",
			width: size?.width ?? null,
			height: size?.height ?? null,
		};
	}

	return null;
}

/** True when a parsed image fits the bucket's byte limit and the dimension cap. */
export function isAvatarWithinLimits(info: AvatarImageInfo, byteLength: number): boolean {
	if (byteLength <= 0 || byteLength > AVATAR_MAX_BYTES) return false;
	if (info.width === null || info.height === null) return true;
	return info.width <= AVATAR_MAX_DIMENSION && info.height <= AVATAR_MAX_DIMENSION;
}
