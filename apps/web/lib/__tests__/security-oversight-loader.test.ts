import { beforeEach, describe, expect, it, vi } from "vitest";

const { auditFindMany, userFindMany, orgFindMany, gateMock } = vi.hoisted(() => ({
	auditFindMany: vi.fn(),
	userFindMany: vi.fn(),
	orgFindMany: vi.fn(),
	gateMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		platformAuditLog: { findMany: auditFindMany },
		user: { findMany: userFindMany },
		organization: { findMany: orgFindMany },
	},
}));
vi.mock("@/lib/auth/require-platform-admin", () => ({ requirePlatformAdmin: gateMock }));

import { OVERSIGHT_ROW_LIMIT, getSecurityOversight } from "../platform/security-oversight";
import { sensitiveAuditActions } from "../platform/sensitive-actions-rules";

/**
 * Security and oversight loader (issue #479, M3C.7).
 *
 * These cover the read model only: which audit rows are asked for, how the
 * catalog annotates them, and the failure path — a throwing read must arrive as
 * an explicit error, never as an empty history that looks calm.
 */

const NOW = new Date("2026-11-01T12:00:00.000Z");

function auditRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "audit-1",
		createdAt: NOW,
		actorUserId: "user-1",
		action: "platform.device.feed",
		targetType: "device",
		targetId: "device-1",
		orgId: "org-1",
		reason: "Operator asked for a manual feed.",
		stepUpAt: NOW,
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	gateMock.mockResolvedValue(undefined);
	userFindMany.mockResolvedValue([
		{ id: "user-1", email: "ops@example.com", displayName: "Ops Lead" },
	]);
	orgFindMany.mockResolvedValue([{ id: "org-1", name: "Alpha" }]);
});

describe("getSecurityOversight", () => {
	it("asks only for catalogued audit actions, bounded and newest first", async () => {
		auditFindMany.mockResolvedValue([]);

		await getSecurityOversight();

		const args = auditFindMany.mock.calls[0][0];
		expect(args.where.action.in).toEqual(sensitiveAuditActions());
		expect(args.orderBy).toEqual({ createdAt: "desc" });
		expect(args.take).toBe(OVERSIGHT_ROW_LIMIT);
	});

	it("annotates rows with the catalog requirement and the people involved", async () => {
		auditFindMany.mockResolvedValue([auditRow()]);

		const result = await getSecurityOversight();

		expect(result.sourceError).toBe(false);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]).toMatchObject({
			auditAction: "platform.device.feed",
			actionId: "remoteFeed",
			requirement: "step-up",
			actorLabel: "Ops Lead",
			orgName: "Alpha",
			stepUpAt: NOW,
		});
		expect(result.missingStepUp).toBe(0);
	});

	it("falls back to the email when a user has no display name", async () => {
		auditFindMany.mockResolvedValue([auditRow()]);
		userFindMany.mockResolvedValue([{ id: "user-1", email: "ops@example.com", displayName: null }]);

		const result = await getSecurityOversight();

		expect(result.rows[0].actorLabel).toBe("ops@example.com");
	});

	it("counts step-up actions recorded without a step-up timestamp", async () => {
		auditFindMany.mockResolvedValue([
			auditRow({ id: "a", stepUpAt: null }),
			auditRow({ id: "b", action: "platform.settings.feature_flag", stepUpAt: null }),
			auditRow({ id: "c" }),
		]);

		const result = await getSecurityOversight();

		expect(result.missingStepUp).toBe(1);
		const featureFlag = result.rows.find((row) => row.id === "b");
		expect(featureFlag?.requirement).toBe("reason-and-audit");
	});

	it("keeps a row whose audit code is not in the catalog", async () => {
		auditFindMany.mockResolvedValue([auditRow({ action: "platform.something.new" })]);

		const result = await getSecurityOversight();

		expect(result.rows[0]).toMatchObject({
			auditAction: "platform.something.new",
			actionId: null,
			requirement: null,
		});
		expect(result.missingStepUp).toBe(0);
	});

	it("reports an explicit error when the audit read throws", async () => {
		auditFindMany.mockRejectedValue(new Error("db down"));

		const result = await getSecurityOversight();

		expect(result).toEqual({ rows: [], sourceError: true, missingStepUp: 0 });
	});

	it("reports an explicit error when the actor or tenant lookup throws", async () => {
		auditFindMany.mockResolvedValue([auditRow()]);
		orgFindMany.mockRejectedValue(new Error("db down"));

		const result = await getSecurityOversight();

		expect(result.sourceError).toBe(true);
		expect(result.rows).toEqual([]);
	});

	it("skips the actor and tenant lookups when there are no rows", async () => {
		auditFindMany.mockResolvedValue([]);

		const result = await getSecurityOversight();

		expect(userFindMany).not.toHaveBeenCalled();
		expect(orgFindMany).not.toHaveBeenCalled();
		expect(result.missingStepUp).toBe(0);
	});
});
