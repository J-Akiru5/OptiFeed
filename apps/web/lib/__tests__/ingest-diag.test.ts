import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: {
			findUnique: vi.fn(),
			update: vi.fn(),
		},
		feedEvent: {
			findFirst: vi.fn(),
			create: vi.fn(),
		},
		feedLevelLog: {
			findFirst: vi.fn(),
			create: vi.fn(),
		},
		pond: {
			findUnique: vi.fn(),
		},
		feedRequest: {
			findMany: vi.fn(),
			update: vi.fn(),
			updateMany: vi.fn(),
		},
		deviceStateEvent: {
			findFirst: vi.fn(),
			create: vi.fn(),
		},
		notification: {
			create: vi.fn(),
			findFirst: vi.fn(),
			updateMany: vi.fn(),
		},
		$transaction: vi.fn(async (input: unknown) => {
			if (Array.isArray(input)) return Promise.all(input);
			return (input as () => Promise<unknown>)();
		}),
	},
}));

import { POST } from "@/app/api/ingest/route";
import { hashToken } from "@/lib/device-auth";
import prisma from "@/lib/prisma";

const mockEnergyDevice = vi.mocked(prisma.energyDevice);

const DEVICE = {
	id: "dev-1",
	mac: "A4:CF:12:7E:3B:09",
	lastSeenAt: null as Date | null,
	pondId: null as string | null,
	label: "Feeder A",
	tokenHash: hashToken("test-token"),
	approvalStatus: "APPROVED",
};

function ingestRequest(body: Record<string, unknown>): Request {
	return new Request("http://test.local/api/ingest", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-device-token": "test-token",
		},
		body: JSON.stringify(body),
	});
}

function heartbeatBody(overrides: Record<string, unknown> = {}) {
	return {
		device_id: DEVICE.mac,
		event_type: "heartbeat",
		event_id: "evt-heartbeat-diag-1",
		timestamp: "2026-11-01T12:00:00+00:00",
		rtc_ok: true,
		feeder_active: false,
		...overrides,
	};
}

/** The `diag` value written to EnergyDevice, when any was written. */
function storedDiag(): unknown {
	const call = mockEnergyDevice.update.mock.calls[0]?.[0] as
		| { data: { diag?: unknown } }
		| undefined;
	return call?.data?.diag === undefined ? undefined : call.data.diag;
}

describe("POST /api/ingest — firmware diagnostics (issue #454)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnergyDevice.findUnique.mockResolvedValue({ ...DEVICE } as never);
		mockEnergyDevice.update.mockResolvedValue({} as never);
	});

	it("stores a sanitised diag object with the heartbeat", async () => {
		const res = await POST(
			ingestRequest(
				heartbeatBody({
					diag: { sd_ok: true, heap: 45632, button_glitches: 4, reset_reason: "poweron" },
				}),
			),
		);
		expect(res.status).toBe(204);
		expect(storedDiag()).toEqual({
			sd_ok: true,
			heap: 45632,
			button_glitches: 4,
			reset_reason: "poweron",
		});
	});

	it("still accepts heartbeats without a diag field (old firmware)", async () => {
		const res = await POST(ingestRequest(heartbeatBody()));
		expect(res.status).toBe(204);
		expect(storedDiag()).toBeUndefined();
	});

	it("drops a malformed diag (array) and keeps the response clean", async () => {
		const res = await POST(ingestRequest(heartbeatBody({ diag: [1, 2, 3] })));
		expect(res.status).toBe(204);
		expect(storedDiag()).toBeUndefined();
	});

	it("truncates an oversized string inside diag instead of failing the beat", async () => {
		const res = await POST(ingestRequest(heartbeatBody({ diag: { note: "x".repeat(400) } })));
		expect(res.status).toBe(204);
		const result = storedDiag() as { note?: string } | undefined;
		expect(result?.note).toHaveLength(120);
	});
});
