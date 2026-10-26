import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
	download: vi.fn(),
	createSignedUrl: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
	createAdminClient: vi.fn(() => ({ storage: { from: vi.fn(() => storage) } })),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: { findUnique: vi.fn() },
	},
}));

vi.mock("@/lib/rate-limit", () => ({
	checkDeviceRateLimit: vi.fn(),
}));

import { GET } from "@/app/api/firmware/check/route";
import { hashToken } from "@/lib/device-auth";
import { OTA_MAX_CHECK_RESPONSE_BYTES, OTA_SIGNED_URL_TTL_SECONDS } from "@/lib/firmware/ota";
import prisma from "@/lib/prisma";
import { checkDeviceRateLimit } from "@/lib/rate-limit";

const mockEnergyDevice = vi.mocked(prisma.energyDevice);
const mockRateLimit = vi.mocked(checkDeviceRateLimit);

const DEVICE = {
	id: "dev-1",
	mac: "A4:CF:12:7E:3B:09",
	label: "Feeder A",
	tokenHash: hashToken("test-token"),
};

const SHA = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const SIGNATURE = Buffer.from("throwaway-test-signature").toString("base64");
const SIGNED_URL =
	"https://xjjnkikgkraixlfhhvoh.supabase.co/storage/v1/object/sign/firmware/releases/1.4.1/firmware.bin?token=abc";

function releaseManifest(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		board: "wroom32u",
		key_id: "primary",
		min_from_version: "1.4.0",
		sha256: SHA,
		size: 1_070_200,
		version: "1.4.1",
		...overrides,
	});
}

function channel(overrides: Record<string, unknown> = {}) {
	return {
		version: "1.4.1",
		storage_path: "releases/1.4.1/firmware.bin",
		size: 1_070_200,
		sha256: SHA,
		manifest: releaseManifest(),
		signature: SIGNATURE,
		key_id: "primary",
		targets: "*",
		...overrides,
	};
}

function serveChannel(value: unknown) {
	storage.download.mockResolvedValue({
		data: { text: async () => JSON.stringify(value) },
		error: null,
	} as never);
}

function noChannel() {
	storage.download.mockResolvedValue({
		data: null,
		error: { message: "Object not found" },
	} as never);
}

type RequestOptions = {
	token?: string | null;
	deviceId?: string | null;
	version?: string | null;
};

function checkRequest(options: RequestOptions = {}): Request {
	const { token = "test-token", deviceId = DEVICE.mac, version = "1.4.0" } = options;
	const params = new URLSearchParams();
	if (deviceId !== null) params.set("device_id", deviceId);
	if (version !== null) params.set("version", version);
	const headers: Record<string, string> = {};
	if (token !== null) headers["x-device-token"] = token;
	return new Request(`http://test.local/api/firmware/check?${params.toString()}`, {
		method: "GET",
		headers,
	});
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
	return (await response.json()) as Record<string, unknown>;
}

function assertDeclaredLength(response: Response, text: string) {
	expect(response.headers.get("content-length")).not.toBeNull();
	expect(Number(response.headers.get("content-length"))).toBe(Buffer.byteLength(text, "utf8"));
}

describe("GET /api/firmware/check — auth and rate limit", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRateLimit.mockResolvedValue({ success: true, remaining: 19 } as never);
		mockEnergyDevice.findUnique.mockResolvedValue({ ...DEVICE } as never);
		storage.download.mockResolvedValue({ data: null, error: { message: "not found" } } as never);
		storage.createSignedUrl.mockResolvedValue({
			data: { signedUrl: SIGNED_URL },
			error: null,
		} as never);
	});

	it("rejects a missing device token", async () => {
		const res = await GET(checkRequest({ token: null }));
		expect(res.status).toBe(401);
	});

	it("rejects an unknown device token", async () => {
		mockEnergyDevice.findUnique.mockResolvedValue(null as never);
		const res = await GET(checkRequest({ token: "wrong-token" }));
		expect(res.status).toBe(401);
	});

	it("rejects a token whose mac differs from device_id", async () => {
		const res = await GET(checkRequest({ deviceId: "11:22:33:44:55:66" }));
		expect(res.status).toBe(401);
	});

	it("requires both device_id and version", async () => {
		expect((await GET(checkRequest({ deviceId: null }))).status).toBe(422);
		expect((await GET(checkRequest({ version: null }))).status).toBe(422);
	});

	it("returns 429 when the firmware check bucket is exhausted", async () => {
		mockRateLimit.mockResolvedValue({ success: false, remaining: 0 } as never);
		const res = await GET(checkRequest());
		expect(res.status).toBe(429);
		expect(storage.download).not.toHaveBeenCalled();
	});
});

describe("GET /api/firmware/check — release decision", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRateLimit.mockResolvedValue({ success: true, remaining: 19 } as never);
		mockEnergyDevice.findUnique.mockResolvedValue({ ...DEVICE } as never);
		storage.createSignedUrl.mockResolvedValue({
			data: { signedUrl: SIGNED_URL },
			error: null,
		} as never);
	});

	it("answers {update:false} with an explicit Content-Length when no channel exists", async () => {
		noChannel();
		const res = await GET(checkRequest());
		const text = await res.clone().text();
		expect(res.status).toBe(200);
		expect(await bodyOf(res)).toEqual({ update: false });
		assertDeclaredLength(res, text);
	});

	it("answers {update:false} for an unparseable channel", async () => {
		storage.download.mockResolvedValue({
			data: { text: async () => "not json" },
			error: null,
		} as never);
		const res = await GET(checkRequest());
		expect(await bodyOf(res)).toEqual({ update: false });
		expect(storage.createSignedUrl).not.toHaveBeenCalled();
	});

	it("answers {update:false} when the device is not targeted", async () => {
		serveChannel(channel({ targets: ["11:22:33:44:55:66"] }));
		const res = await GET(checkRequest());
		expect(await bodyOf(res)).toEqual({ update: false });
		expect(storage.createSignedUrl).not.toHaveBeenCalled();
	});

	it("targets MACs case-insensitively", async () => {
		serveChannel(channel({ targets: [DEVICE.mac.toLowerCase()] }));
		const res = await GET(checkRequest());
		expect((await bodyOf(res)).update).toBe(true);
	});

	it("answers {update:false} when the release is the same semantic version", async () => {
		serveChannel(channel());
		const res = await GET(checkRequest({ version: "1.4.1" }));
		expect(await bodyOf(res)).toEqual({ update: false });
		expect(storage.createSignedUrl).not.toHaveBeenCalled();
	});

	it("answers {update:false} when the device is newer than the release", async () => {
		serveChannel(channel());
		const res = await GET(checkRequest({ version: "1.10.0" }));
		expect(await bodyOf(res)).toEqual({ update: false });
	});

	it("answers {update:false} when the device is below the signed min_from_version", async () => {
		serveChannel(channel());
		const res = await GET(checkRequest({ version: "1.3.9" }));
		expect(await bodyOf(res)).toEqual({ update: false });
	});

	it("answers {update:false} when the envelope disagrees with its signed manifest", async () => {
		serveChannel(
			channel({
				manifest: releaseManifest({ version: "9.9.9" }),
			}),
		);
		const res = await GET(checkRequest());
		expect(await bodyOf(res)).toEqual({ update: false });
	});

	it("answers {update:false} when the signed Storage URL cannot be created", async () => {
		serveChannel(channel());
		storage.createSignedUrl.mockResolvedValue({
			data: null,
			error: { message: "permission denied" },
		} as never);
		const res = await GET(checkRequest());
		expect(await bodyOf(res)).toEqual({ update: false });
	});

	it("answers {update:false} when the signed URL is not HTTPS", async () => {
		serveChannel(channel());
		storage.createSignedUrl.mockResolvedValue({
			data: { signedUrl: "http://insecure.example/firmware.bin" },
			error: null,
		} as never);
		const res = await GET(checkRequest());
		expect(await bodyOf(res)).toEqual({ update: false });
	});

	it("offers a newer release with the exact firmware envelope", async () => {
		const payload = channel();
		serveChannel(payload);
		const res = await GET(checkRequest());

		const text = await res.clone().text();
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("application/json");
		assertDeclaredLength(res, text);
		expect(text.length).toBeLessThanOrEqual(OTA_MAX_CHECK_RESPONSE_BYTES);

		expect(await bodyOf(res)).toEqual({
			update: true,
			version: "1.4.1",
			url: SIGNED_URL,
			size: 1_070_200,
			sha256: SHA,
			manifest: payload.manifest,
			signature: SIGNATURE,
			key_id: "primary",
		});

		expect(storage.createSignedUrl).toHaveBeenCalledWith(
			"releases/1.4.1/firmware.bin",
			OTA_SIGNED_URL_TTL_SECONDS,
		);
	});

	it("offers an update to a device exactly at the signed minimum", async () => {
		serveChannel(channel());
		const res = await GET(checkRequest({ version: "1.4.0" }));
		expect((await bodyOf(res)).update).toBe(true);
	});
});

// Static drift guard: the route must keep answering the contract the firmware
// actually implements, not a copy of it.
describe("GET /api/firmware/check — firmware contract", () => {
	const cwd = process.cwd();
	const repoRoot = existsSync(join(cwd, "firmware")) ? cwd : join(cwd, "..", "..");
	const firmware = readFileSync(
		join(repoRoot, "firmware", "firmware-main", "firmware-main.ino"),
		"utf8",
	);

	it("uses the URL and board the firmware calls and sends", () => {
		expect(firmware).toContain(
			'#define OTA_CHECK_URL "https://pakaonai.syntaxure.dev/api/firmware/check"',
		);
		expect(firmware).toMatch(/#define FW_BOARD\s+"wroom32u"/);
		expect(firmware).toContain('https.addHeader("X-Device-Token", provisionedDeviceToken);');
	});

	it("declares the same 8 KB response bound", () => {
		expect(firmware).toMatch(/#define OTA_MAX_CHECK_RESPONSE_BYTES\s+8192/);
	});

	it("sends exactly the fields the firmware parses", () => {
		for (const field of ["version", "url", "size", "sha256", "manifest", "signature", "key_id"]) {
			expect(firmware).toContain(`doc["${field}"]`);
		}
	});
});
