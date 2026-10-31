import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	count: vi.fn(),
	findMany: vi.fn(),
	create: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: new Proxy(
		{},
		{
			get: () => ({ count: mocks.count, findMany: mocks.findMany, create: mocks.create }),
		},
	),
}));

import { BACKUP_TRAILER_MARKER } from "@/lib/backup/constants";
import {
	BackupExportByteCapError,
	BackupExportTimeoutError,
	BackupExportTooLargeError,
	backupFilename,
	createBackupExportResponse,
	prepareBackupExport,
} from "@/lib/backup/export";
import { fetchTablePage, scopeWhere } from "@/lib/backup/query";
import type { TenantExportScope } from "@/lib/backup/scope";
import { findBackupTable } from "@/lib/backup/tables";

/**
 * The export pipeline: the pre-flight row cap, the streamed body, the checksum
 * contract and the one audit row per attempt.
 */

const SCOPE: TenantExportScope = {
	kind: "tenant",
	orgIds: ["org-1"],
	orgNames: ["CICT Farm"],
	memberUserIds: ["user-1"],
	farmIds: ["farm-1"],
	pondIds: ["pond-1"],
	membershipIds: ["membership-1"],
};

const USER_ROW = {
	id: "user-1",
	supabaseId: "11111111-1111-1111-1111-111111111111",
	farmId: "cict-farm",
	email: "owner@example.com",
	displayName: null,
	role: "OWNER",
};

const MEMBERSHIP_ROW = {
	id: "membership-1",
	orgId: "org-1",
	userId: "user-1",
	role: "OWNER",
	invitedBy: null,
	revokedAt: null,
};

function request(overrides: Partial<Parameters<typeof createBackupExportResponse>[0]> = {}) {
	return {
		scope: SCOPE,
		actorUserId: "user-1",
		actorLabel: "Owner One",
		reason: "Monthly backup",
		stepUpAt: null,
		temporaryGrant: false,
		origin: { ip: "203.0.113.9", userAgent: "vitest" },
		now: new Date("2026-10-31T07:30:00.000Z"),
		...overrides,
	};
}

/** The exact range the server hashes: everything before the trailer marker. */
function payloadOf(text: string): string {
	const boundary = text.indexOf(`\n${BACKUP_TRAILER_MARKER}`);
	expect(boundary, "the trailer marker is missing").toBeGreaterThan(-1);
	return text.slice(0, boundary);
}

beforeEach(() => {
	mocks.count.mockReset().mockResolvedValue(0);
	mocks.findMany.mockReset().mockResolvedValue([]);
	mocks.create.mockReset().mockResolvedValue({});
});

describe("prepareBackupExport", () => {
	it("counts every tenant table in scope and names the file", async () => {
		mocks.count.mockResolvedValue(2);
		const prepared = await prepareBackupExport(SCOPE, new Date("2026-10-31T07:30:00.000Z"));

		expect(prepared.tables.length).toBeGreaterThan(20);
		expect(prepared.totalRows).toBe(prepared.tables.length * 2);
		expect(prepared.counts.Pond).toBe(2);
		expect(prepared.filename).toBe("pakaonai-backup-tenant-20261031-0730.sql");
		expect(mocks.count).toHaveBeenCalledTimes(prepared.tables.length);
	});

	it("refuses a scope above the row cap before any streaming", async () => {
		mocks.count.mockResolvedValue(300_000);
		await expect(prepareBackupExport(SCOPE)).rejects.toBeInstanceOf(BackupExportTooLargeError);
	});

	it("builds a platform filename", () => {
		expect(backupFilename("platform", new Date("2026-01-02T03:04:00.000Z"))).toBe(
			"pakaonai-backup-platform-20260102-0304.sql",
		);
	});

	it("explains the row cap in the error message", () => {
		const error = new BackupExportTooLargeError(300_000);
		expect(error.message).toContain("300,000");
		expect(error.message).toContain("250,000");
	});
});

describe("streamed body", () => {
	it("writes header, rows, summary, identity manifest and a verifiable trailer", async () => {
		mocks.findMany.mockImplementation(async (args: { select?: Record<string, boolean> }) => {
			const select = args.select ?? {};
			if (select.supabaseId) return [USER_ROW];
			if (select.invitedBy) return [MEMBERSHIP_ROW];
			return [];
		});

		const prepared = await prepareBackupExport(SCOPE, new Date("2026-10-31T07:30:00.000Z"));
		const response = createBackupExportResponse(request(), prepared);
		const body = await response.text();

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("application/sql");
		expect(response.headers.get("content-disposition")).toContain(
			"pakaonai-backup-tenant-20261031-0730.sql",
		);
		expect(response.headers.get("cache-control")).toBe("no-store");

		expect(body).toContain("-- PakaonAI SQL export, format v1");
		expect(body).toContain("Scope: tenant export for CICT Farm");
		expect(body).toContain('INSERT INTO "User"');
		expect(body).toContain("'owner@example.com'");
		expect(body).toContain('INSERT INTO "Membership"');
		expect(body).toContain("-- Summary: User=1, Membership=1");
		expect(body).toContain("-- === AUTH IDENTITY MANIFEST (issue #322) ===");
		expect(body).toContain('"supabaseId":"11111111-1111-1111-1111-111111111111"');

		const payload = payloadOf(body);
		const expected = createHash("sha256").update(payload).digest("hex");
		expect(body).toContain(`SHA-256 (of every byte before this marker): ${expected}`);
		expect(body).toContain(`Payload bytes: ${Buffer.byteLength(payload)}`);

		const audit = mocks.create.mock.calls[0][0].data;
		expect(audit.action).toBe("backup.export");
		expect(audit.actorUserId).toBe("user-1");
		expect(audit.orgId).toBe("org-1");
		expect(audit.reason).toBe("Monthly backup");
		expect(audit.ip).toBe("203.0.113.9");
		expect(audit.after).toMatchObject({
			scope: "tenant",
			format: "sql",
			outcome: "succeeded",
			filename: "pakaonai-backup-tenant-20261031-0730.sql",
			sha256: expected,
			totalRows: 2,
			tables: { User: 1, Membership: 1 },
			orgIds: ["org-1"],
			orgNames: ["CICT Farm"],
			error: null,
		});
		expect(audit.after.bytes).toBe(Buffer.byteLength(payload));
	});

	it("never writes exported values into the audit row", async () => {
		mocks.findMany.mockImplementation(async (args: { select?: Record<string, boolean> }) => {
			const select = args.select ?? {};
			if (select.supabaseId) return [USER_ROW];
			return [];
		});
		const prepared = await prepareBackupExport(SCOPE);
		await createBackupExportResponse(request(), prepared).text();

		const serialized = JSON.stringify(mocks.create.mock.calls[0][0].data);
		expect(serialized).not.toContain("owner@example.com");
		expect(serialized).not.toContain("11111111-1111");
	});

	it("records a failed attempt when a query fails mid-stream", async () => {
		mocks.findMany.mockRejectedValueOnce(new Error("database went away"));
		const prepared = await prepareBackupExport(SCOPE);
		const response = createBackupExportResponse(request(), prepared);

		await expect(response.text()).rejects.toThrow();

		const audit = mocks.create.mock.calls[0][0].data;
		expect(audit.after).toMatchObject({
			outcome: "failed",
			error: "database went away",
			sha256: null,
		});
	});

	it("records a cancelled attempt when the client disconnects", async () => {
		const prepared = await prepareBackupExport(SCOPE);
		const response = createBackupExportResponse(request(), prepared);
		const reader = response.body?.getReader();
		if (!reader) throw new Error("no body");

		await reader.read();
		await reader.cancel();

		const audit = mocks.create.mock.calls[0][0].data;
		expect(audit.after).toMatchObject({
			outcome: "cancelled",
			error: "The download was cancelled before it finished.",
		});
	});

	it("survives an audit write failure without breaking the download", async () => {
		mocks.create.mockRejectedValueOnce(new Error("audit down"));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const prepared = await prepareBackupExport(SCOPE);
		const body = await createBackupExportResponse(request(), prepared).text();

		expect(body).toContain(BACKUP_TRAILER_MARKER);
		errorSpy.mockRestore();
	});

	it("files a platform export without a single organization", async () => {
		const prepared = await prepareBackupExport({ kind: "platform" });
		await createBackupExportResponse(
			request({ scope: { kind: "platform" }, actorLabel: "Platform Admin" }),
			prepared,
		).text();

		const audit = mocks.create.mock.calls[0][0].data;
		expect(audit.orgId).toBeNull();
		expect(audit.after.scope).toBe("platform");
		expect(audit.after.orgIds).toEqual([]);
	});

	it("names the byte cap and the timeout in their errors", () => {
		expect(new BackupExportByteCapError().message).toContain("64 MB");
		expect(new BackupExportTimeoutError().message).toContain("120 s");
	});
});

describe("table queries", () => {
	it("applies the tenant predicate and no predicate for the platform", () => {
		const pond = findBackupTable("Pond");
		if (!pond) throw new Error("Pond is missing");
		expect(scopeWhere(pond, SCOPE)).toEqual({ id: { in: ["pond-1"] } });
		expect(scopeWhere(pond, { kind: "platform" })).toBeUndefined();
	});

	it("pages with a cursor and selects only allow-listed columns", async () => {
		mocks.findMany.mockResolvedValueOnce([]);
		const pond = findBackupTable("Pond");
		if (!pond) throw new Error("Pond is missing");

		await fetchTablePage(pond, SCOPE, null, 25);
		const first = mocks.findMany.mock.calls[0][0];
		expect(first).toMatchObject({ take: 25, orderBy: { id: "asc" } });
		expect(first).not.toHaveProperty("skip");
		expect(Object.keys(first.select).sort()).toEqual([...pond.columns].sort());

		await fetchTablePage(pond, SCOPE, "pond-9", 50);
		const second = mocks.findMany.mock.calls[1][0];
		expect(second).toMatchObject({ cursor: { id: "pond-9" }, skip: 1, take: 50 });
	});

	it("clamps a page size of zero or a fraction to one row", async () => {
		mocks.findMany.mockResolvedValue([]);
		const pond = findBackupTable("Pond");
		if (!pond) throw new Error("Pond is missing");
		await fetchTablePage(pond, SCOPE, null, 0);
		expect(mocks.findMany.mock.calls[0][0].take).toBe(1);
		await fetchTablePage(pond, SCOPE, null, 12.7);
		expect(mocks.findMany.mock.calls[1][0].take).toBe(12);
	});
});
