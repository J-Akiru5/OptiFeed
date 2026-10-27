import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	auditCount: vi.fn(),
	auditFindMany: vi.fn(),
	auditFindUnique: vi.fn(),
	auditGroupBy: vi.fn(),
	userFindMany: vi.fn(),
	userFindUnique: vi.fn(),
	orgFindMany: vi.fn(),
	orgFindUnique: vi.fn(),
	gate: vi.fn(),
	isPlatformAdmin: vi.fn(),
	getSession: vi.fn(),
	pageSize: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		platformAuditLog: {
			count: mocks.auditCount,
			findMany: mocks.auditFindMany,
			findUnique: mocks.auditFindUnique,
			groupBy: mocks.auditGroupBy,
		},
		user: { findMany: mocks.userFindMany, findUnique: mocks.userFindUnique },
		organization: { findMany: mocks.orgFindMany, findUnique: mocks.orgFindUnique },
	},
}));

vi.mock("@/lib/auth/require-platform-admin", () => ({
	requirePlatformAdmin: mocks.gate,
	isCurrentPlatformAdmin: mocks.isPlatformAdmin,
}));

vi.mock("@/lib/auth/session", () => ({
	getVerifiedSession: mocks.getSession,
}));

vi.mock("@/lib/settings/platform", () => ({
	getListPageSize: mocks.pageSize,
}));

import { GET as exportAuditCsv } from "@/app/api/platform/audit/export/route";
import {
	AUDIT_CSV_HEADER,
	AUDIT_EXPORT_LIMIT,
	type AuditCsvRow,
	buildPlatformAuditWhere,
	fetchAuditExportRows,
	getAuditEntry,
	listPlatformAuditEntries,
	parseAuditFilters,
	streamAuditCsv,
	toAuditCsvRow,
} from "@/lib/platform/audit-log";

const ROW: AuditCsvRow = {
	id: "row-1",
	createdAt: new Date("2026-10-27T10:00:00.000Z"),
	actorUserId: "admin-1",
	action: "platform.settings.feeding_caps",
	targetType: "platform_setting",
	targetId: "feeding.caps",
	orgId: "org-a",
	reason: 'Lowered the cap, "safely"',
	ip: "203.0.113.7",
	userAgent: "vitest",
	before: { maxDispenseMs: 20_000 },
	after: { maxDispenseMs: 15_000 },
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.gate.mockResolvedValue(undefined);
	mocks.isPlatformAdmin.mockResolvedValue(true);
	mocks.getSession.mockResolvedValue({ sub: "admin-1", email: "admin@example.test" });
	mocks.pageSize.mockResolvedValue(20);
	mocks.auditCount.mockResolvedValue(1);
	mocks.auditFindMany.mockResolvedValue([]);
	mocks.userFindMany.mockResolvedValue([]);
	mocks.orgFindMany.mockResolvedValue([]);
	mocks.auditGroupBy.mockResolvedValue([]);
});

describe("parseAuditFilters", () => {
	it("trims values and defaults to page 1", () => {
		expect(parseAuditFilters({ action: "  platform. ", page: "0" })).toEqual({
			action: "platform.",
			actor: undefined,
			orgId: undefined,
			targetType: undefined,
			target: undefined,
			from: undefined,
			to: undefined,
			page: 1,
		});
	});

	it("reads the url keys and clamps long values", () => {
		const filters = parseAuditFilters({
			actor: "a".repeat(200),
			org: "org-a",
			targetType: "platform_setting",
			target: "dev-1",
			from: "2026-10-01",
			to: "2026-10-05",
			page: "3",
		});

		expect(filters.actor).toHaveLength(120);
		expect(filters.orgId).toBe("org-a");
		expect(filters.targetType).toBe("platform_setting");
		expect(filters.target).toBe("dev-1");
		expect(filters.page).toBe(3);
	});
});

describe("buildPlatformAuditWhere", () => {
	it("is empty when nothing is filtered", () => {
		expect(buildPlatformAuditWhere(parseAuditFilters({}))).toEqual({});
	});

	it("builds every supported filter", () => {
		const filters = parseAuditFilters({
			action: "platform.device",
			org: "org-a",
			targetType: "energy_device",
			target: "dev-",
			from: "2026-10-01",
			to: "2026-10-05",
		});

		const where = buildPlatformAuditWhere(filters, ["user-a", "user-b"]);

		expect(where).toEqual({
			AND: [
				{ action: { contains: "platform.device", mode: "insensitive" } },
				{ actorUserId: { in: ["user-a", "user-b"] } },
				{ orgId: "org-a" },
				{ targetType: "energy_device" },
				{ targetId: { contains: "dev-", mode: "insensitive" } },
				{
					createdAt: {
						gte: new Date("2026-10-01T00:00:00.000Z"),
						lt: new Date("2026-10-06T00:00:00.000Z"),
					},
				},
			],
		});
	});

	it("returns nothing when a typed actor matched no user", () => {
		const where = buildPlatformAuditWhere(parseAuditFilters({ actor: "nobody" }), []);

		expect(where).toEqual({ AND: [{ actorUserId: { in: ["__no_match__"] } }] });
	});

	it("ignores an invalid date range", () => {
		const where = buildPlatformAuditWhere(
			parseAuditFilters({ from: "not-a-date", to: "2026-02-31" }),
		);
		expect(where).toEqual({});
	});
});

describe("listPlatformAuditEntries", () => {
	it("requires a platform admin before any query", async () => {
		mocks.gate.mockRejectedValue(new Error("NEXT_REDIRECT"));

		await expect(listPlatformAuditEntries(parseAuditFilters({}))).rejects.toThrow("NEXT_REDIRECT");

		expect(mocks.auditCount).not.toHaveBeenCalled();
		expect(mocks.auditFindMany).not.toHaveBeenCalled();
	});

	it("joins actor and organization names onto the page", async () => {
		mocks.auditCount.mockResolvedValue(1);
		mocks.auditFindMany.mockResolvedValue([
			{
				id: "row-1",
				createdAt: ROW.createdAt,
				actorUserId: "admin-1",
				action: ROW.action,
				targetType: ROW.targetType,
				targetId: ROW.targetId,
				orgId: ROW.orgId,
				reason: ROW.reason,
				stepUpAt: null,
				temporaryGrant: false,
				impersonationId: null,
			},
		]);
		mocks.userFindMany.mockResolvedValue([
			{ id: "admin-1", farmId: "superadmin", email: "admin@example.test", displayName: "Jeff" },
		]);
		mocks.orgFindMany.mockResolvedValue([{ id: "org-a", name: "Org A" }]);

		const result = await listPlatformAuditEntries(parseAuditFilters({ page: "1" }));

		expect(result.total).toBe(1);
		expect(result.rows[0]).toMatchObject({
			id: "row-1",
			actorLabel: "Jeff",
			actorFarmId: "superadmin",
			orgName: "Org A",
		});
		expect(mocks.auditFindMany).toHaveBeenCalledWith(
			expect.objectContaining({ take: 20, skip: 0, orderBy: { createdAt: "desc" } }),
		);
	});
});

describe("getAuditEntry", () => {
	it("requires a platform admin", async () => {
		mocks.gate.mockRejectedValue(new Error("NEXT_REDIRECT"));
		await expect(getAuditEntry("row-1")).rejects.toThrow("NEXT_REDIRECT");
		expect(mocks.auditFindUnique).not.toHaveBeenCalled();
	});

	it("returns null for an unknown id", async () => {
		mocks.auditFindUnique.mockResolvedValue(null);
		await expect(getAuditEntry("missing")).resolves.toBeNull();
	});

	it("returns the recorded state either side", async () => {
		mocks.auditFindUnique.mockResolvedValue({
			...ROW,
			stepUpAt: null,
			temporaryGrant: false,
			impersonationId: null,
			before: ROW.before,
			after: ROW.after,
		});
		mocks.userFindUnique.mockResolvedValue({
			id: "admin-1",
			farmId: "superadmin",
			email: "admin@example.test",
			displayName: null,
		});
		mocks.orgFindUnique.mockResolvedValue({ id: "org-a", name: "Org A" });

		const entry = await getAuditEntry("row-1");

		expect(entry).toMatchObject({
			id: "row-1",
			actorLabel: "admin@example.test",
			orgName: "Org A",
			before: ROW.before,
			after: ROW.after,
		});
	});
});

describe("CSV export", () => {
	it("quotes fields with commas, quotes and newlines", () => {
		const line = toAuditCsvRow(ROW);

		expect(line.endsWith("\r\n")).toBe(true);
		expect(line).toContain('"Lowered the cap, ""safely"""');
		expect(line).toContain('"{""maxDispenseMs"":20000}"');
	});

	it("neutralises spreadsheet formulas", () => {
		const line = toAuditCsvRow({ ...ROW, reason: '=HYPERLINK("http://x")' });
		expect(line).toContain(`"'=HYPERLINK(""http://x"")"`);
	});

	it("streams rows in batches and stops at the requested limit", async () => {
		const calls: [number, number][] = [];
		const fetchBatch = vi.fn(async (offset: number, take: number) => {
			calls.push([offset, take]);
			return Array.from({ length: take }, (_, index) => ({
				...ROW,
				id: `row-${offset + index}`,
			}));
		});

		const chunks: string[] = [];
		for await (const chunk of streamAuditCsv(fetchBatch, 250)) chunks.push(chunk);

		expect(calls).toEqual([
			[0, 200],
			[200, 50],
		]);
		const body = chunks.slice(1).join("");
		expect(body.split("\r\n").filter(Boolean)).toHaveLength(250);
		expect(chunks[0]).toBe(AUDIT_CSV_HEADER);
	});

	it("never exceeds the hard export limit", async () => {
		const fetchBatch = vi.fn(async (_offset: number, take: number) =>
			Array.from({ length: take }, (_, index) => ({ ...ROW, id: `row-${index}` })),
		);

		let rows = 0;
		for await (const chunk of streamAuditCsv(fetchBatch, AUDIT_EXPORT_LIMIT * 2)) {
			rows += chunk.split("\r\n").filter(Boolean).length;
		}
		// The header counts as one line; the remaining rows stop at the cap.
		expect(rows).toBe(AUDIT_EXPORT_LIMIT + 1);
	});

	it("caps a requested batch size at the export batch", async () => {
		await fetchAuditExportRows({}, 0, 10_000);
		expect(mocks.auditFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }));
	});
});

describe("GET /api/platform/audit/export", () => {
	function request() {
		return new Request("http://localhost/api/platform/audit/export?action=platform.settings");
	}

	it("returns 401 without a session", async () => {
		mocks.getSession.mockResolvedValue(null);

		const response = await exportAuditCsv(request());

		expect(response.status).toBe(401);
		expect(mocks.auditFindMany).not.toHaveBeenCalled();
	});

	it("returns 403 for a signed-in non-platform-admin", async () => {
		mocks.isPlatformAdmin.mockResolvedValue(false);

		const response = await exportAuditCsv(request());

		expect(response.status).toBe(403);
		expect(mocks.auditFindMany).not.toHaveBeenCalled();
	});

	it("streams the filtered CSV for a platform admin", async () => {
		mocks.auditFindMany.mockResolvedValue([]);

		const response = await exportAuditCsv(request());
		const body = await response.text();

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toContain("text/csv");
		expect(response.headers.get("X-Export-Limit")).toBe(String(AUDIT_EXPORT_LIMIT));
		expect(body).toBe(AUDIT_CSV_HEADER);
		expect(mocks.auditFindMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { AND: [{ action: { contains: "platform.settings", mode: "insensitive" } }] },
			}),
		);
	});
});
