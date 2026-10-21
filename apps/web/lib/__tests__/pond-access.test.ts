import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
	default: { pond: { findMany: vi.fn() } },
}));

import { resolveActivePond } from "@/lib/auth/pond-access";
import prisma from "@/lib/prisma";

const findMany = vi.mocked(prisma.pond.findMany);

describe("resolveActivePond", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("queries only ACTIVE ponds ordered by createdAt asc", async () => {
		findMany.mockResolvedValue([{ id: "p1" }] as never);
		await resolveActivePond("farm-1");
		expect(findMany).toHaveBeenCalledWith({
			where: { ownerId: "farm-1", status: "ACTIVE" },
			orderBy: { createdAt: "asc" },
		});
	});

	it("returns the first active pond when no pondId is given", async () => {
		findMany.mockResolvedValue([{ id: "p1" }, { id: "p2" }] as never);
		const pond = await resolveActivePond("farm-1");
		expect(pond?.id).toBe("p1");
	});

	it("returns null when the owner has no active pond", async () => {
		findMany.mockResolvedValue([] as never);
		expect(await resolveActivePond("farm-1")).toBeNull();
	});

	it("returns the matching active pond when pondId is provided", async () => {
		findMany.mockResolvedValue([{ id: "p1" }, { id: "p2" }] as never);
		const pond = await resolveActivePond("farm-1", "p2");
		expect(pond?.id).toBe("p2");
	});

	it("returns null when pondId is not among the owner's ACTIVE ponds", async () => {
		// archived, nonexistent, or another farm's pond — never selected.
		findMany.mockResolvedValue([{ id: "p1" }] as never);
		expect(await resolveActivePond("farm-1", "archived-or-foreign")).toBeNull();
	});
});
