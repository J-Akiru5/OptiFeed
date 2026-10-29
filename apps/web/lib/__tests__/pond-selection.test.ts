import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenancyDb } from "./helpers/tenancy";

/**
 * Active-pond selection (issue #303): the cookie is only a hint, and every
 * read or write re-intersects it with the caller's own ACTIVE ponds.
 *
 * The action runs against the two-org fixture, so a missing owner filter would
 * actually return org B's pond and fail these tests.
 */

const holder = vi.hoisted(() => ({
	db: undefined as TenancyDb | undefined,
	farm: null as string | null,
	cookie: null as { name: string; value: string } | null,
	sets: [] as { name: string; value: string; options?: Record<string, unknown> }[],
}));

vi.mock("@/lib/prisma", async () => {
	const { createTenancyDb } = await import("./helpers/tenancy");
	holder.db = createTenancyDb();
	return { default: holder.db.client };
});

vi.mock("@/lib/auth/session", () => ({
	getCurrentUser: vi.fn(async () =>
		holder.farm ? { id: "user-session", farmId: holder.farm } : null,
	),
	getCurrentPondOwnerIdSafe: vi.fn(async () => holder.farm),
	getCurrentPondOwnerId: vi.fn(async () => holder.farm),
}));

vi.mock("next/headers", () => ({
	cookies: vi.fn(async () => ({
		get: (name: string) =>
			holder.cookie?.name === name ? { name, value: holder.cookie.value } : undefined,
		set: (name: string, value: string, options?: Record<string, unknown>) => {
			holder.sets.push({ name, value, options });
			holder.cookie = { name, value };
		},
	})),
}));

import { switchPond } from "@/lib/actions/pond-selection";
import { getActivePond, getActivePondId, listSelectablePonds } from "@/lib/pond-selection";
import {
	FARM_A,
	FARM_B,
	POND_A_1,
	POND_A_1_NAME,
	POND_A_2,
	POND_A_2_NAME,
	POND_B_1,
	POND_B_1_NAME,
} from "./helpers/tenancy";

function tenancy(): TenancyDb {
	if (!holder.db) throw new Error("tenancy database was not initialised");
	return holder.db;
}

beforeEach(() => {
	vi.clearAllMocks();
	tenancy().reset();
	holder.farm = FARM_A;
	holder.cookie = null;
	holder.sets = [];
});

describe("listSelectablePonds", () => {
	it("allows the caller's own ACTIVE ponds only", async () => {
		const ponds = await listSelectablePonds();

		expect(ponds.map((pond) => ({ id: pond.id, name: pond.name }))).toEqual([
			{ id: POND_A_1, name: POND_A_1_NAME },
			{ id: POND_A_2, name: POND_A_2_NAME },
		]);
		expect(ponds.map((pond) => pond.id)).not.toContain(POND_B_1);
	});

	it("keeps the query scoped to owner + ACTIVE", async () => {
		const findMany = vi.spyOn(tenancy().client.pond, "findMany");

		await listSelectablePonds();

		expect(findMany).toHaveBeenCalledWith({
			where: { ownerId: FARM_A, status: "ACTIVE" },
			orderBy: { createdAt: "asc" },
		});
	});

	it("denies a caller with no session or farm an empty list", async () => {
		holder.farm = null;

		expect(await listSelectablePonds()).toEqual([]);
	});
});

describe("the active pond cookie", () => {
	it("reads the persisted pond id", async () => {
		holder.cookie = { name: "optifeed:pondId", value: POND_A_2 };

		expect(await getActivePondId()).toBe(POND_A_2);
	});

	it("returns null when nothing has been selected", async () => {
		expect(await getActivePondId()).toBeNull();
	});

	it("falls back to the first own pond when the cookie names a foreign pond", async () => {
		holder.cookie = { name: "optifeed:pondId", value: POND_B_1 };

		const pond = await getActivePond();

		expect(pond?.id).toBe(POND_A_1);
		expect(pond?.name).toBe(POND_A_1_NAME);
		expect(pond?.name).not.toBe(POND_B_1_NAME);
	});

	it("resolves the selected own pond", async () => {
		holder.cookie = { name: "optifeed:pondId", value: POND_A_2 };

		expect((await getActivePond())?.id).toBe(POND_A_2);
	});
});

describe("switchPond", () => {
	it("allows a switch to the caller's own ACTIVE pond and persists it", async () => {
		await switchPond(POND_A_2);

		expect(holder.sets).toEqual([
			{
				name: "optifeed:pondId",
				value: POND_A_2,
				options: {
					httpOnly: true,
					secure: false,
					sameSite: "lax",
					path: "/",
					maxAge: 60 * 60 * 24 * 365,
				},
			},
		]);
		expect(await getActivePondId()).toBe(POND_A_2);
	});

	it("denies a pond from another farm and writes no cookie", async () => {
		await expect(switchPond(POND_B_1)).rejects.toThrow("Pond not found or access denied");

		expect(holder.sets).toEqual([]);
		expect(holder.cookie).toBeNull();
	});

	it("denies an archived pond even when the caller owns it", async () => {
		const archived = tenancy().tables.ponds.find((pond) => pond.id === POND_A_2);
		if (!archived) throw new Error("fixture pond missing");
		archived.status = "ARCHIVED";

		await expect(switchPond(POND_A_2)).rejects.toThrow("Pond not found or access denied");
		expect(holder.sets).toEqual([]);
	});

	it("denies an unknown or malformed id", async () => {
		await expect(switchPond("pond-does-not-exist")).rejects.toThrow(
			"Pond not found or access denied",
		);
		await expect(switchPond("")).rejects.toThrow("Pond not found or access denied");
		await expect(switchPond("x".repeat(65))).rejects.toThrow("Pond not found or access denied");
		expect(holder.sets).toEqual([]);
	});

	it("denies an unauthenticated caller", async () => {
		holder.farm = null;

		await expect(switchPond(POND_A_1)).rejects.toThrow("Not authenticated");
		expect(holder.sets).toEqual([]);
	});

	it("never accepts a pond from the other farm even when that farm is the caller's", async () => {
		holder.farm = FARM_B;

		await switchPond(POND_B_1);
		expect(holder.sets[0]?.value).toBe(POND_B_1);

		await expect(switchPond(POND_A_1)).rejects.toThrow("Pond not found or access denied");
		expect(holder.sets).toHaveLength(1);
	});
});
