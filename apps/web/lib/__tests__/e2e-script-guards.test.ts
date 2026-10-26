import type { PrismaClient } from "@prisma/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { runCleanup } from "../../scripts/e2e/cleanup-e2e";
import {
	assertE2eEnvironment,
	assertE2eIdentifier,
	isE2eEmail,
	isE2eIdentifier,
	isE2eMac,
	requireE2ePassword,
} from "../../scripts/e2e/guards";

/**
 * The e2e scripts run against the production project, so their guards are
 * themselves tested: wrong host, missing acknowledgement, a non-prefixed
 * target and a dry run that must not write anything.
 */

const VALID_ENV: Record<string, string | undefined> = {
	DATABASE_URL: "postgresql://user:secret@db.e2e.example:5432/postgres",
	E2E_ALLOWED_DB_HOST: "db.e2e.example",
	E2E_CONFIRM_PRODUCTION: "yes",
};

const PRISMA_MODELS = [
	"organization",
	"user",
	"farm",
	"pond",
	"energyDevice",
	"feedLevelLog",
	"feedRequest",
	"feedEvent",
	"deviceStateEvent",
	"scheduleCommand",
	"biomassLog",
	"fishSample",
	"fcrReport",
	"notification",
	"reminderLog",
	"pondEvent",
	"cropCycle",
	"pondOwnershipHistory",
	"device",
	"feedingEvent",
	"membership",
	"membershipPermission",
	"platformAdmin",
	"impersonationSession",
	"platformAuditLog",
	"userLockout",
	"loginLockout",
] as const;

type MockDelegate = {
	findMany: ReturnType<typeof vi.fn>;
	deleteMany: ReturnType<typeof vi.fn>;
	count: ReturnType<typeof vi.fn>;
};

type MockPrisma = Record<(typeof PRISMA_MODELS)[number], MockDelegate>;

function createPrismaMock(
	overrides: Partial<Record<(typeof PRISMA_MODELS)[number], Partial<MockDelegate>>> = {},
): MockPrisma {
	const prisma = {} as MockPrisma;
	for (const model of PRISMA_MODELS) {
		prisma[model] = {
			findMany: vi.fn().mockResolvedValue([]),
			deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
			count: vi.fn().mockResolvedValue(0),
			...overrides[model],
		};
	}
	return prisma;
}

function createSupabaseMock(users: { id: string; email: string }[] = []) {
	return {
		auth: {
			admin: {
				listUsers: vi.fn().mockResolvedValue({ data: { users }, error: null }),
				deleteUser: vi.fn().mockResolvedValue({ error: null }),
			},
		},
	};
}

function fixturePrisma(
	overrides: Partial<Record<(typeof PRISMA_MODELS)[number], Partial<MockDelegate>>>,
): MockPrisma {
	return createPrismaMock(overrides);
}

describe("e2e environment guards", () => {
	it("refuses a DATABASE_URL host that is not allow-listed", () => {
		expect(() =>
			assertE2eEnvironment({ ...VALID_ENV, E2E_ALLOWED_DB_HOST: "elsewhere.example" }),
		).toThrow(/not the allow-listed host/);
	});

	it("refuses to run without the production acknowledgement", () => {
		const withoutConfirm: Record<string, string | undefined> = { ...VALID_ENV };
		withoutConfirm.E2E_CONFIRM_PRODUCTION = undefined;
		expect(() => assertE2eEnvironment(withoutConfirm)).toThrow(/E2E_CONFIRM_PRODUCTION/);
		expect(() => assertE2eEnvironment({ ...VALID_ENV, E2E_CONFIRM_PRODUCTION: "no" })).toThrow(
			/E2E_CONFIRM_PRODUCTION/,
		);
	});

	it("refuses a missing e2e password", () => {
		expect(() => requireE2ePassword({})).toThrow(/E2E_PASSWORD/);
		expect(requireE2ePassword({ E2E_PASSWORD: "e2e-only" })).toBe("e2e-only");
	});
});

describe("e2e identifier guards", () => {
	it("recognises only reserved e2e identifiers and MACs", () => {
		expect(isE2eIdentifier("e2e-farmer")).toBe(true);
		expect(isE2eIdentifier("demo-farmer-1")).toBe(false);
		expect(isE2eMac("E2:E0:00:00:00:01")).toBe(true);
		expect(isE2eMac("AA:BB:CC:DD:EE:FF")).toBe(false);
		expect(isE2eEmail("e2e-farmer@pond.optifeed.local")).toBe(true);
		expect(isE2eEmail("e2e-farmer@example.com")).toBe(false);
		expect(() => assertE2eIdentifier("demo-farmer-1")).toThrow(/only deletes identifiers/);
	});
});

describe("cleanup guards", () => {
	it("refuses a target that is not e2e-prefixed and deletes nothing", async () => {
		const prisma = fixturePrisma({
			organization: { findMany: vi.fn().mockResolvedValue([{ id: "e2e-org", name: "e2e-org" }]) },
			user: {
				findMany: vi.fn().mockResolvedValue([
					{
						id: "user-demo",
						farmId: "demo-farmer-1",
						email: "demo-farmer-1@pond.optifeed.local",
						supabaseId: "sb-demo",
					},
				]),
			},
		});
		const supabase = createSupabaseMock();

		await expect(
			runCleanup({
				prisma: prisma as unknown as PrismaClient,
				supabase: supabase as unknown as SupabaseClient,
				env: VALID_ENV,
			}),
		).rejects.toThrow(/Refusing e2e cleanup/);

		for (const model of PRISMA_MODELS) {
			expect(prisma[model].deleteMany, `${model}.deleteMany`).not.toHaveBeenCalled();
		}
		expect(supabase.auth.admin.deleteUser).not.toHaveBeenCalled();
	});

	it("a dry run reports the fixture and performs no writes", async () => {
		const prisma = fixturePrisma({
			organization: { findMany: vi.fn().mockResolvedValue([{ id: "e2e-org", name: "e2e-org" }]) },
			user: {
				findMany: vi.fn().mockResolvedValue([
					{
						id: "user-e2e-farmer",
						farmId: "e2e-farmer",
						email: "e2e-farmer@pond.optifeed.local",
						supabaseId: "sb-e2e-farmer",
					},
				]),
			},
			farm: { findMany: vi.fn().mockResolvedValue([{ id: "farm-e2e", ownerId: "e2e-farmer" }]) },
			pond: {
				findMany: vi
					.fn()
					.mockResolvedValue([
						{ id: "e2e-pond", name: "e2e-pond", ownerId: "e2e-farmer", farmId: "farm-e2e" },
					]),
			},
			energyDevice: {
				findMany: vi.fn().mockResolvedValue([
					{
						id: "device-e2e",
						label: "e2e-feeder",
						mac: "E2:E0:00:00:00:01",
						pondId: "e2e-pond",
					},
				]),
			},
		});
		const supabase = createSupabaseMock([
			{ id: "sb-e2e-farmer", email: "e2e-farmer@pond.optifeed.local" },
		]);

		const summary = await runCleanup({
			prisma: prisma as unknown as PrismaClient,
			supabase: supabase as unknown as SupabaseClient,
			env: VALID_ENV,
			dryRun: true,
		});

		expect(summary.dryRun).toBe(true);
		expect(summary.counts).toMatchObject({
			organizations: 1,
			users: 1,
			farms: 1,
			ponds: 1,
			devices: 1,
			authUsers: 1,
		});
		expect(summary.users).toEqual(["e2e-farmer"]);

		for (const model of PRISMA_MODELS) {
			expect(prisma[model].deleteMany, `${model}.deleteMany`).not.toHaveBeenCalled();
		}
		expect(supabase.auth.admin.deleteUser).not.toHaveBeenCalled();
	});

	it("never deletes platform audit rows (append-only table) and reports them as kept", async () => {
		const prisma = fixturePrisma({
			organization: { findMany: vi.fn().mockResolvedValue([{ id: "e2e-org", name: "e2e-org" }]) },
			user: {
				findMany: vi
					.fn()
					.mockResolvedValue([
						{ id: "user-e2e", farmId: "e2e-farmer", email: "e2e-farmer@pond.optifeed.local" },
					]),
			},
			platformAuditLog: {
				findMany: vi.fn().mockResolvedValue([]),
				deleteMany: vi.fn().mockRejectedValue(new Error("PlatformAuditLog is append-only")),
				count: vi.fn().mockResolvedValue(3),
			},
		});
		const supabase = createSupabaseMock([]);

		const summary = await runCleanup({
			prisma: prisma as unknown as PrismaClient,
			supabase: supabase as unknown as SupabaseClient,
			env: VALID_ENV,
			dryRun: false,
		});

		expect(prisma.platformAuditLog.deleteMany).not.toHaveBeenCalled();
		expect(summary.counts.keptAuditRows).toBe(3);
	});
});
