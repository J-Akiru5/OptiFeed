import { beforeEach, describe, expect, it, vi } from "vitest";

// session.ts (and therefore with-auth.ts) pulls in next-intl, which cannot
// load under vitest. Mock only the i18n leaves so the real auth logic runs.
vi.mock("@/i18n/routing", () => ({ redirect: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "en") }));

vi.mock("@/lib/auth/session", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/auth/session")>();
	return { ...actual, requireWriteAccess: vi.fn() };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

vi.mock("@/lib/rate-limit", () => ({
	checkApiRateLimit: vi.fn(() => ({ success: true })),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		user: { findUnique: vi.fn() },
		pond: { findMany: vi.fn() },
		energyDevice: { findFirst: vi.fn() },
		biomassLog: { findMany: vi.fn(), createMany: vi.fn() },
		fishSample: { createMany: vi.fn() },
		deviceStateEvent: { create: vi.fn(), createMany: vi.fn() },
		$transaction: vi.fn(),
	},
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { POST as confirmPost } from "@/app/api/import/confirm/route";
import { requireWriteAccess } from "@/lib/auth/session";
import { IMPORT_ROW_LIMIT } from "@/lib/constants";
import prisma from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

const mockRequireWriteAccess = vi.mocked(requireWriteAccess);
const mockCreateClient = vi.mocked(createClient);
const mockUserFindUnique = vi.mocked(prisma.user.findUnique);
const mockPondFindMany = vi.mocked(prisma.pond.findMany);
const mockEnergyDeviceFindFirst = vi.mocked(prisma.energyDevice.findFirst);
const mockTransaction = vi.mocked(prisma.$transaction);
const rootBiomassLogCreateMany = vi.mocked(prisma.biomassLog.createMany);
const rootDeviceStateEventCreate = vi.mocked(prisma.deviceStateEvent.create);

// Writes must be issued on the client handed to the transaction callback,
// never on the root client — root writes are not rolled back if a later
// write in the same import fails.
const txClient = {
	biomassLog: { createMany: vi.fn() },
	fishSample: { createMany: vi.fn() },
	deviceStateEvent: { create: vi.fn(), createMany: vi.fn() },
};

const BIOMASS_CSV = "sampleWeightKg,sampleCount\n10,5\n12,6";

function confirmReq(type: string, csvData: string) {
	return new Request("http://test.local/api/import/confirm", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ type, csvData }),
	}) as never;
}

describe("import/confirm atomicity (F-003)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		txClient.biomassLog.createMany.mockResolvedValue({ count: 2 } as never);
		txClient.fishSample.createMany.mockResolvedValue({ count: 2 } as never);
		txClient.deviceStateEvent.create.mockResolvedValue({} as never);

		mockCreateClient.mockResolvedValue({
			auth: {
				getUser: vi.fn().mockResolvedValue({
					data: { user: { id: "sb-1", email: "demo-farmer-1@pond.optifeed.local" } },
				}),
			},
		} as never);
		mockUserFindUnique.mockResolvedValue({
			farmId: "demo-farmer-1",
			supabaseId: "sb-1",
			role: "ADMIN",
		} as never);
		mockRequireWriteAccess.mockResolvedValue(undefined as never);
		mockPondFindMany.mockResolvedValue([
			{ id: "pond-1", ownerId: "demo-farmer-1", status: "ACTIVE" },
		] as never);
		mockEnergyDeviceFindFirst.mockResolvedValue({ id: "dev-1" } as never);
		// $transaction is overloaded (array / interactive forms); cast the
		// interactive-form implementation past the overload union.
		mockTransaction.mockImplementation((async (fn: (tx: typeof txClient) => Promise<unknown>) =>
			fn(txClient)) as never);
	});

	it("issues the bulk insert and audit event on the transaction client", async () => {
		const res = await confirmPost(confirmReq("biomass_logs", BIOMASS_CSV));

		expect(res.status).toBe(200);
		expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30_000 });
		expect(txClient.biomassLog.createMany).toHaveBeenCalledTimes(1);
		expect(txClient.deviceStateEvent.create).toHaveBeenCalledTimes(1);
		expect(rootBiomassLogCreateMany).not.toHaveBeenCalled();
		expect(rootDeviceStateEventCreate).not.toHaveBeenCalled();
	});

	it("rejects a CSV over the import row limit before opening a transaction", async () => {
		const bigCsv = [
			"sampleWeightKg,sampleCount",
			...Array.from({ length: IMPORT_ROW_LIMIT + 1 }, (_, i) => `${i + 1},5`),
		].join("\n");

		const res = await confirmPost(confirmReq("biomass_logs", bigCsv));

		expect(res.status).toBe(400);
		expect(mockTransaction).not.toHaveBeenCalled();
		expect(rootBiomassLogCreateMany).not.toHaveBeenCalled();
		expect(txClient.biomassLog.createMany).not.toHaveBeenCalled();
	});

	it("rejects a CSV whose type is not an exportable type", async () => {
		const res = await confirmPost(confirmReq("not_a_type", BIOMASS_CSV));

		expect(res.status).toBe(400);
		expect(mockTransaction).not.toHaveBeenCalled();
		expect(txClient.deviceStateEvent.create).not.toHaveBeenCalled();
		expect(rootDeviceStateEventCreate).not.toHaveBeenCalled();
	});

	it("reports an unparseable optional date as a 400, not a Prisma 500", async () => {
		// `recordedAt` is optional, so a present-but-invalid value used to reach
		// Prisma as `Invalid Date` and fail the request with an opaque 500.
		const res = await confirmPost(
			confirmReq("biomass_logs", "sampleWeightKg,sampleCount,recordedAt\n10,5,not-a-date"),
		);

		expect(res.status).toBe(400);
		expect(txClient.biomassLog.createMany).not.toHaveBeenCalled();
		expect(rootBiomassLogCreateMany).not.toHaveBeenCalled();
	});

	it("rejects a non-string csvData before it reaches the parser", async () => {
		const res = await confirmPost(
			new Request("http://test.local/api/import/confirm", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ type: "biomass_logs", csvData: { rows: 1 } }),
			}) as never,
		);

		expect(res.status).toBe(400);
		expect(mockTransaction).not.toHaveBeenCalled();
	});

	it("skips the audit event when the pond has no device (no empty deviceId)", async () => {
		mockEnergyDeviceFindFirst.mockResolvedValue(null);

		const res = await confirmPost(confirmReq("biomass_logs", BIOMASS_CSV));

		expect(res.status).toBe(200);
		// deviceId is a required FK — "" would violate it after the bulk insert.
		expect(rootDeviceStateEventCreate).not.toHaveBeenCalled();
		expect(txClient.deviceStateEvent.create).not.toHaveBeenCalled();
	});
});
