import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	count: vi.fn(),
	findMany: vi.fn(),
	findUnique: vi.fn(),
	update: vi.fn(),
	transaction: vi.fn(),
	gate: vi.fn(),
	pageSize: vi.fn(),
	actorContext: vi.fn(),
	writePlatformAudit: vi.fn(),
	revalidatePath: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		errorEvent: {
			count: mocks.count,
			findMany: mocks.findMany,
			findUnique: mocks.findUnique,
			update: mocks.update,
		},
		$transaction: mocks.transaction,
	},
}));

vi.mock("@/lib/auth/require-platform-admin", () => ({
	requirePlatformAdmin: mocks.gate,
}));

vi.mock("@/lib/settings/platform", () => ({
	getListPageSize: mocks.pageSize,
}));

vi.mock("@/lib/actions/platform/audit", () => ({
	actorContext: mocks.actorContext,
	writePlatformAudit: mocks.writePlatformAudit,
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { resolveErrorEvent } from "@/lib/actions/platform/error-events";
import {
	buildErrorEventWhere,
	listErrorEvents,
	parseErrorEventFilters,
} from "@/lib/platform/error-events";

const ROW = {
	id: "err-1",
	message: "hopper sensor missing",
	stack: "Error: hopper sensor missing\n    at feed (lib/feed.ts:42:7)",
	route: "ingest",
	severity: "ERROR" as const,
	count: 3,
	firstSeenAt: new Date("2026-10-29T08:00:00.000Z"),
	lastSeenAt: new Date("2026-10-29T09:00:00.000Z"),
	resolved: false,
	resolvedAt: null,
	resolvedBy: null,
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.gate.mockResolvedValue(undefined);
	mocks.pageSize.mockResolvedValue(20);
	mocks.count.mockResolvedValue(0);
	mocks.findMany.mockResolvedValue([]);
	mocks.actorContext.mockResolvedValue({ id: "admin-1", temporaryGrant: false });
	mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
		callback({
			errorEvent: {
				findUnique: mocks.findUnique,
				update: mocks.update,
			},
		}),
	);
});

describe("parseErrorEventFilters", () => {
	it("defaults to unresolved on page 1", () => {
		expect(parseErrorEventFilters({})).toEqual({ status: "unresolved", page: 1 });
	});

	it("accepts the three status values and clamps the page", () => {
		expect(parseErrorEventFilters({ status: "resolved" })).toEqual({
			status: "resolved",
			page: 1,
		});
		expect(parseErrorEventFilters({ status: "all", page: "3" })).toEqual({
			status: "all",
			page: 3,
		});
		expect(parseErrorEventFilters({ status: "nonsense", page: "0" })).toEqual({
			status: "unresolved",
			page: 1,
		});
	});
});

describe("buildErrorEventWhere", () => {
	it("maps the status filter onto `resolved`", () => {
		expect(buildErrorEventWhere({ status: "unresolved", page: 1 })).toEqual({ resolved: false });
		expect(buildErrorEventWhere({ status: "resolved", page: 1 })).toEqual({ resolved: true });
		expect(buildErrorEventWhere({ status: "all", page: 1 })).toEqual({});
	});
});

describe("listErrorEvents", () => {
	it("denies a caller without an active PlatformAdmin row before querying", async () => {
		mocks.gate.mockRejectedValue(new Error("NEXT_REDIRECT"));

		await expect(listErrorEvents(parseErrorEventFilters({}))).rejects.toThrow("NEXT_REDIRECT");

		expect(mocks.count).not.toHaveBeenCalled();
		expect(mocks.findMany).not.toHaveBeenCalled();
	});

	it("allows a platform admin and lists newest activity first", async () => {
		mocks.count.mockResolvedValue(1);
		mocks.findMany.mockResolvedValue([ROW]);

		const result = await listErrorEvents(parseErrorEventFilters({}));

		expect(mocks.gate).toHaveBeenCalledTimes(1);
		expect(result.total).toBe(1);
		expect(result.rows).toEqual([ROW]);
		expect(mocks.count).toHaveBeenCalledWith({ where: { resolved: false } });
		expect(mocks.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { resolved: false },
				orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
				skip: 0,
				take: 20,
			}),
		);
	});

	it("uses the resolved filter when asked", async () => {
		await listErrorEvents(parseErrorEventFilters({ status: "resolved" }));

		expect(mocks.count).toHaveBeenCalledWith({ where: { resolved: true } });
	});

	it("re-reads a clamped page so an out-of-range ?page never renders empty", async () => {
		mocks.count.mockResolvedValue(3);
		mocks.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([ROW]);

		const result = await listErrorEvents(parseErrorEventFilters({ page: "99" }));

		expect(result.page).toBe(1);
		expect(mocks.findMany).toHaveBeenCalledTimes(2);
	});
});

describe("resolveErrorEvent", () => {
	it("denies a caller without an active PlatformAdmin row", async () => {
		mocks.gate.mockRejectedValue(new Error("NEXT_REDIRECT"));

		await expect(resolveErrorEvent("err-1")).rejects.toThrow("NEXT_REDIRECT");

		expect(mocks.transaction).not.toHaveBeenCalled();
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it("allows a platform admin and records the resolve in the audit log", async () => {
		mocks.findUnique.mockResolvedValue({ id: "err-1", resolved: false });

		const result = await resolveErrorEvent("err-1");

		expect(result).toEqual({ success: true });
		expect(mocks.update).toHaveBeenCalledWith({
			where: { id: "err-1" },
			data: {
				resolved: true,
				resolvedAt: expect.any(Date),
				resolvedBy: "admin-1",
			},
		});
		expect(mocks.writePlatformAudit).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				actorUserId: "admin-1",
				action: "platform.error_event.resolve",
				targetType: "error_event",
				targetId: "err-1",
			}),
		);
		expect(mocks.revalidatePath).toHaveBeenCalledWith(
			"/[locale]/(superadmin)/superadmin/operations/errors",
			"page",
		);
	});

	it("is idempotent and does not write a second audit row", async () => {
		mocks.findUnique.mockResolvedValue({ id: "err-1", resolved: true });

		await expect(resolveErrorEvent("err-1")).resolves.toEqual({ success: true });

		expect(mocks.update).not.toHaveBeenCalled();
		expect(mocks.writePlatformAudit).not.toHaveBeenCalled();
	});

	it("rejects an unknown event without mutating", async () => {
		mocks.findUnique.mockResolvedValue(null);

		await expect(resolveErrorEvent("missing")).resolves.toEqual({
			error: "Unknown error event.",
		});
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it("rejects a malformed id before opening a transaction", async () => {
		await expect(resolveErrorEvent(" ")).resolves.toEqual({ error: "Unknown error event." });
		expect(mocks.transaction).not.toHaveBeenCalled();
	});
});
