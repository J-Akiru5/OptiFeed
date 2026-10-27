/**
 * Minimal, structurally valid image headers for avatar tests.
 *
 * They are not decodable pictures: the server only inspects magic bytes and
 * dimensions, so a header is enough to exercise every acceptance branch.
 */

function ascii(bytes: Uint8Array, offset: number, text: string): void {
	for (let i = 0; i < text.length; i += 1) bytes[offset + i] = text.charCodeAt(i);
}

/** RIFF/WEBP container with an extended (`VP8X`) canvas size. */
export function webpVp8x(width: number, height: number): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(12 + 8 + 10);
	ascii(bytes, 0, "RIFF");
	ascii(bytes, 8, "WEBP");
	ascii(bytes, 12, "VP8X");
	// Payload starts at 20: flags (1), reserved (3), width-1 (3), height-1 (3).
	const w = width - 1;
	const h = height - 1;
	bytes[24] = w & 0xff;
	bytes[25] = (w >> 8) & 0xff;
	bytes[26] = (w >> 16) & 0xff;
	bytes[27] = h & 0xff;
	bytes[28] = (h >> 8) & 0xff;
	bytes[29] = (h >> 16) & 0xff;
	return bytes;
}

/** JPEG SOI + a start-of-frame segment carrying width/height. */
export function jpeg(width: number, height: number): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(21);
	bytes.set([0xff, 0xd8, 0xff, 0xc0], 0);
	// Segment length (17) covers the length bytes, precision, height, width and
	// the remaining component bytes the parser skips.
	bytes[4] = 0x00;
	bytes[5] = 0x11;
	bytes[6] = 0x08;
	const write16 = (offset: number, value: number) => {
		bytes[offset] = (value >> 8) & 0xff;
		bytes[offset + 1] = value & 0xff;
	};
	write16(7, height);
	write16(9, width);
	return bytes;
}

/** PNG signature + IHDR width/height. */
export function png(width: number, height: number): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(24);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	ascii(bytes, 12, "IHDR");
	const write32 = (offset: number, value: number) => {
		bytes[offset] = (value >> 24) & 0xff;
		bytes[offset + 1] = (value >> 16) & 0xff;
		bytes[offset + 2] = (value >> 8) & 0xff;
		bytes[offset + 3] = value & 0xff;
	};
	write32(16, width);
	write32(20, height);
	return bytes;
}
