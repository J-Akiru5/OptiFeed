import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	create: vi.fn(),
	findMany: vi.fn(),
	userFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		platformAuditLog: { create: mocks.create, findMany: mocks.findMany },
		user: { findMany: mocks.userFindMany },
	},
}));

import {
	BACKUP_EXPORT_ACTION,
	listBackupExports,
	parseBackupSummary,
	recordBackupExport,
	recordBackupExportSafely,
} from "@/lib/backup/audit";

/**
 * The audit row and the Backup page history. The row describes the file; it
 * must never contain any exported value.
 */

const SUMMARY = {
	scope: "tenant" as const,
	format: "sql" as const,
	outcome: "succeeded" as const,
	filename: "pakaonai-backup-tenant-20261031-0730.sql",
	bytes: 2048,
	sha256: "a".repeat(64),
	totalRows: 42,
	tables: { Pond: 3, User: 2 },
	orgIds: ["org-1"],
	orgNames: ["CICT Farm"],
	error: null,
};

beforeEach(() => {
	mocks.create.mockReset().mockResolvedValue({});
	mocks.findMany.mockReset().mockResolvedValue([]);
	mocks.userFindMany.mockReset().mockResolvedValue([]);
});

describe("recordBackupExport", () => {
	it("writes one row describing who, when, scope and size", async () => {
		await recordBackupExport({
			actorUserId: "user-1",
			orgId: "org-1",
			reason: "Monthly backup",
			stepUpAt: new Date("2026-10-31T07:00:00.000Z"),
			temporaryGrant: true,
			ip: "203.0.113.9",
			userAgent: "vitest",
			summary: SUMMARY,
		});

		expect(mocks.create).toHaveBeenCalledTimes(1);
		const data = mocks.create.mock.calls[0][0].data;
		expect(data).toMatchObject({
			actorUserId: "user-1",
			action: BACKUP_EXPORT_ACTION,
			targetType: "backup_export",
			targetId: SUMMARY.filename,
			orgId: "org-1",
			reason: "Monthly backup",
			temporaryGrant: true,
			ip: "203.0.113.9",
			userAgent: "vitest",
		});
		expect(data.after).toEqual(SUMMARY);
	});

	it("swallows an audit failure but reports it", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		mocks.create.mockRejectedValueOnce(new Error("audit down"));

		await expect(
			recordBackupExportSafely({
				actorUserId: "user-1",
				orgId: null,
				reason: "x",
				stepUpAt: null,
				temporaryGrant: false,
				ip: null,
				userAgent: null,
				summary: SUMMARY,
			}),
		).resolves.toBeUndefined();

		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});
});

describe("parseBackupSummary", () => {
	it("reads a stored summary", () => {
		expect(parseBackupSummary(SUMMARY)).toMatchObject({
			scope: "tenant",
			outcome: "succeeded",
			tables: { Pond: 3, User: 2 },
		});
	});

	it("rejects a payload with no filename", () => {
		expect(parseBackupSummary({ outcome: "succeeded" })).toBeNull();
		expect(parseBackupSummary(null)).toBeNull();
		expect(parseBackupSummary("nope")).toBeNull();
		expect(parseBackupSummary([1, 2])).toBeNull();
	});

	it("coerces unexpected types to safe defaults", () => {
		const parsed = parseBackupSummary({
			filename: "x.sql",
			scope: "weird",
			outcome: "weird",
			bytes: "many",
			totalRows: Number.NaN,
			tables: { Pond: "3", User: 2 },
			orgIds: ["org-1", 7],
			orgNames: "CICT",
			sha256: 5,
			error: { deep: true },
		});

		expect(parsed).toMatchObject({
			scope: "tenant",
			outcome: "failed",
			bytes: 0,
			totalRows: 0,
			tables: { User: 2 },
			orgIds: ["org-1"],
			orgNames: [],
			sha256: null,
			error: null,
		});
	});
});

describe("listBackupExports", () => {
	const ROW = {
		id: "row-1",
		createdAt: new Date("2026-10-31T07:30:00.000Z"),
		actorUserId: "user-1",
		orgId: "org-1",
		reason: "Monthly backup",
		stepUpAt: null,
		after: SUMMARY,
	};

	it("lists every export for the platform", async () => {
		mocks.findMany.mockResolvedValue([ROW]);
		mocks.userFindMany.mockResolvedValue([
			{ id: "user-1", farmId: "cict", email: "owner@example.com", displayName: "Owner One" },
		]);

		const records = await listBackupExports({ orgIds: null, actorUserId: "user-1" });

		const where = mocks.findMany.mock.calls[0][0].where;
		expect(where).toEqual({ action: BACKUP_EXPORT_ACTION });
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			id: "row-1",
			actorLabel: "Owner One",
			actorFarmId: "cict",
			scope: "tenant",
			filename: SUMMARY.filename,
		});
	});

	it("limits a tenant to its organizations plus its own attempts", async () => {
		await listBackupExports({ orgIds: ["org-1", "org-2"], actorUserId: "user-1" });

		const where = mocks.findMany.mock.calls[0][0].where;
		expect(where.action).toBe(BACKUP_EXPORT_ACTION);
		expect(where.OR).toEqual([{ orgId: { in: ["org-1", "org-2"] } }, { actorUserId: "user-1" }]);
	});

	it("falls back from display name to email to id", async () => {
		mocks.findMany.mockResolvedValue([
			{ ...ROW, id: "row-1", actorUserId: "u-1" },
			{ ...ROW, id: "row-2", actorUserId: "u-2" },
			{ ...ROW, id: "row-3", actorUserId: "u-3" },
		]);
		mocks.userFindMany.mockResolvedValue([
			{ id: "u-1", farmId: "f1", email: "a@example.com", displayName: null },
			{ id: "u-2", farmId: "f2", email: "b@example.com", displayName: "" },
		]);

		const records = await listBackupExports({ orgIds: null, actorUserId: "u-1" });
		expect(records.map((record) => record.actorLabel)).toEqual([
			"a@example.com",
			"b@example.com",
			"u-3",
		]);
	});

	it("drops rows whose summary cannot be parsed", async () => {
		mocks.findMany.mockResolvedValue([{ ...ROW, after: { nothing: true } }]);
		const records = await listBackupExports({ orgIds: null, actorUserId: "user-1" });
		expect(records).toEqual([]);
	});

	it("bounds the history size", async () => {
		await listBackupExports({ orgIds: null, actorUserId: "user-1", take: 5000 });
		expect(mocks.findMany.mock.calls[0][0].take).toBe(100);
		await listBackupExports({ orgIds: null, actorUserId: "user-1", take: 0 });
		expect(mocks.findMany.mock.calls[1][0].take).toBe(1);
	});
});
