import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * The server action behind the assistant's Accept/Reject buttons is the only
 * path that can execute a proposal. It must refuse a temporary-password
 * session, a read-only view-as session and an unauthenticated caller before it
 * reads the row, and it must never trust the kind or payload stored on it.
 */

const { prisma, getDefinition, assertPasswordChanged, assertNotViewingAs } = vi.hoisted(() => ({
	prisma: {
		assistantAction: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
	},
	getDefinition: vi.fn(),
	assertPasswordChanged: vi.fn(),
	assertNotViewingAs: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prisma }));
vi.mock("@/lib/assistant/catalog", () => ({ getAssistantActionDefinition: getDefinition }));
vi.mock("@/lib/auth/session", () => ({
	assertPasswordChanged,
	canWrite: vi.fn(),
	getCurrentUser: vi.fn(),
}));
vi.mock("@/lib/auth/view-as", () => ({ assertNotViewingAs }));
vi.mock("@/lib/auth/permissions", () => ({ getCurrentPermissions: vi.fn() }));
vi.mock("@/lib/auth/require-platform-admin", () => ({ isCurrentPlatformAdmin: vi.fn() }));
vi.mock("@/lib/auth/tenant-admin", () => ({ isCurrentTenantAdmin: vi.fn() }));
vi.mock("@/lib/auth/step-up", () => ({ requireStepUp: vi.fn() }));

import { acceptAssistantAction, rejectAssistantAction } from "@/lib/actions/assistant";
import { getCurrentPermissions } from "@/lib/auth/permissions";
import { isCurrentPlatformAdmin } from "@/lib/auth/require-platform-admin";
import { canWrite, getCurrentUser } from "@/lib/auth/session";
import { requireStepUp } from "@/lib/auth/step-up";
import { isCurrentTenantAdmin } from "@/lib/auth/tenant-admin";

const mockUser = vi.mocked(getCurrentUser);
const mockPermissions = vi.mocked(getCurrentPermissions);
const mockCanWrite = vi.mocked(canWrite);
const mockPlatformAdmin = vi.mocked(isCurrentPlatformAdmin);
const mockTenantAdmin = vi.mocked(isCurrentTenantAdmin);
const mockStepUp = vi.mocked(requireStepUp);

const NOW = new Date("2026-10-29T08:00:00.000Z");
const ROW = {
	id: "action-1",
	userId: "user-1",
	kind: "log_sample",
	payload: { weightGrams: 120 },
	status: "PENDING" as const,
	expiresAt: new Date("2026-10-29T09:00:00.000Z"),
};

function definition(overrides: Record<string, unknown> = {}) {
	return {
		id: "log_sample",
		schema: z.object({ weightGrams: z.number().positive() }),
		execute: vi.fn(async () => ({ success: true, message: "Sample logged." })),
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
	assertPasswordChanged.mockResolvedValue(undefined);
	assertNotViewingAs.mockResolvedValue(undefined);
	mockUser.mockResolvedValue({ id: "user-1" } as Awaited<ReturnType<typeof getCurrentUser>>);
	mockPermissions.mockResolvedValue(new Set(["view_dashboard"]));
	mockCanWrite.mockResolvedValue(true);
	mockPlatformAdmin.mockResolvedValue(false);
	mockTenantAdmin.mockResolvedValue(false);
	mockStepUp.mockResolvedValue(new Date());
	prisma.assistantAction.findUnique.mockResolvedValue(ROW);
	prisma.assistantAction.update.mockResolvedValue({});
	prisma.assistantAction.updateMany.mockResolvedValue({ count: 1 });
	getDefinition.mockReturnValue(definition());
});

afterEach(() => {
	vi.useRealTimers();
});

describe("acceptAssistantAction authorization", () => {
	it("refuses a temporary-password session before reading the proposal", async () => {
		assertPasswordChanged.mockRejectedValue(new Error("must change password"));

		await expect(acceptAssistantAction("action-1")).resolves.toEqual({
			success: false,
			error: "Change your temporary password first.",
		});
		expect(prisma.assistantAction.findUnique).not.toHaveBeenCalled();
	});

	it("refuses a read-only view-as session before reading the proposal", async () => {
		assertNotViewingAs.mockRejectedValue(new Error("read only"));

		await expect(acceptAssistantAction("action-1")).resolves.toEqual({
			success: false,
			error: "This is a read-only view-as session.",
		});
		expect(prisma.assistantAction.findUnique).not.toHaveBeenCalled();
	});

	it("refuses an unauthenticated caller", async () => {
		mockUser.mockResolvedValue(null);

		await expect(acceptAssistantAction("action-1")).resolves.toEqual({
			success: false,
			error: "Not authenticated.",
		});
		expect(prisma.assistantAction.findUnique).not.toHaveBeenCalled();
	});
});

describe("acceptAssistantAction execution", () => {
	it("runs the stored definition and records the accepted result", async () => {
		const tool = definition();
		getDefinition.mockReturnValue(tool);

		await expect(acceptAssistantAction("action-1")).resolves.toEqual({
			success: true,
			message: "Sample logged.",
		});

		expect(tool.execute).toHaveBeenCalledWith({ weightGrams: 120 }, { userId: "user-1" });
		expect(prisma.assistantAction.updateMany).toHaveBeenCalledWith({
			where: { id: "action-1", status: "PENDING", decidedAt: null },
			data: { decidedAt: expect.any(Date) },
		});
		expect(prisma.assistantAction.update).toHaveBeenCalledWith({
			where: { id: "action-1" },
			data: {
				status: "ACCEPTED",
				decidedAt: expect.any(Date),
				result: { message: "Sample logged." },
			},
		});
	});

	it("expires a proposal whose deadline has passed", async () => {
		prisma.assistantAction.findUnique.mockResolvedValue({
			...ROW,
			expiresAt: new Date("2026-10-29T07:59:59.000Z"),
		});

		await expect(acceptAssistantAction("action-1")).resolves.toEqual({
			success: false,
			error: "That action expired. Ask me again.",
		});
		expect(prisma.assistantAction.update).toHaveBeenCalledWith({
			where: { id: "action-1" },
			data: { status: "EXPIRED", decidedAt: expect.any(Date) },
		});
	});

	it("fails a proposal whose kind is no longer registered", async () => {
		getDefinition.mockReturnValue(undefined);

		await expect(acceptAssistantAction("action-1")).resolves.toEqual({
			success: false,
			error: "That action is no longer supported.",
		});
		expect(prisma.assistantAction.update).toHaveBeenCalledWith({
			where: { id: "action-1" },
			data: { status: "FAILED", decidedAt: expect.any(Date), error: "Unknown action." },
		});
	});

	it("fails a proposal whose stored payload no longer validates", async () => {
		getDefinition.mockReturnValue(definition());
		prisma.assistantAction.findUnique.mockResolvedValue({
			...ROW,
			payload: { weightGrams: -5 },
		});

		await expect(acceptAssistantAction("action-1")).resolves.toEqual({
			success: false,
			error: "The stored action is no longer valid. Ask me again.",
		});
		expect(prisma.assistantAction.update.mock.calls[0][0].data.status).toBe("FAILED");
	});

	it("asks for a fresh step-up without deciding the row", async () => {
		getDefinition.mockReturnValue(definition({ requiresStepUp: true }));
		mockStepUp.mockRejectedValue(new Error("step up required"));

		const result = await acceptAssistantAction("action-1");

		expect(result).toMatchObject({ success: false, code: "step_up_required" });
		expect(prisma.assistantAction.updateMany).not.toHaveBeenCalled();
		expect(prisma.assistantAction.update).not.toHaveBeenCalled();
	});

	it("refuses when another tab already claimed the row", async () => {
		prisma.assistantAction.updateMany.mockResolvedValue({ count: 0 });

		await expect(acceptAssistantAction("action-1")).resolves.toEqual({
			success: false,
			error: "That action was already decided.",
		});
		expect(prisma.assistantAction.update).not.toHaveBeenCalled();
	});

	it("records a failed execution with the tool's message", async () => {
		getDefinition.mockReturnValue(
			definition({ execute: vi.fn(async () => ({ success: false, message: "Hopper empty." })) }),
		);

		await expect(acceptAssistantAction("action-1")).resolves.toEqual({
			success: false,
			error: "Hopper empty.",
		});
		expect(prisma.assistantAction.update).toHaveBeenCalledWith({
			where: { id: "action-1" },
			data: {
				status: "FAILED",
				decidedAt: expect.any(Date),
				error: "Hopper empty.",
			},
		});
	});

	it("records a thrown execution error", async () => {
		getDefinition.mockReturnValue(
			definition({
				execute: vi.fn(async () => {
					throw new Error("Pond is fallow.");
				}),
			}),
		);

		await expect(acceptAssistantAction("action-1")).resolves.toEqual({
			success: false,
			error: "Pond is fallow.",
		});
		expect(prisma.assistantAction.update.mock.calls[0][0].data).toMatchObject({
			status: "FAILED",
			error: "Pond is fallow.",
		});
	});

	it("truncates a long failure message before storing it", async () => {
		getDefinition.mockReturnValue(
			definition({ execute: vi.fn(async () => ({ success: false, message: "x".repeat(1500) })) }),
		);

		await acceptAssistantAction("action-1");

		expect(prisma.assistantAction.update.mock.calls[0][0].data.error).toHaveLength(1000);
	});

	it("refuses a proposal for a platform-only tool", async () => {
		getDefinition.mockReturnValue(definition({ platformAdminOnly: true }));

		await expect(acceptAssistantAction("action-1")).resolves.toEqual({
			success: false,
			error: "Only a platform admin can do that.",
		});
		expect(prisma.assistantAction.updateMany).not.toHaveBeenCalled();
	});

	it("refuses a proposal for a tenant-admin-only tool", async () => {
		getDefinition.mockReturnValue(definition({ tenantAdminOnly: true }));

		await expect(acceptAssistantAction("action-1")).resolves.toEqual({
			success: false,
			error: "Only an organization owner or admin can do that.",
		});
	});

	it("refuses a tool whose permission the caller has lost", async () => {
		getDefinition.mockReturnValue(definition({ permission: "control_feeder" }));

		await expect(acceptAssistantAction("action-1")).resolves.toEqual({
			success: false,
			error: "You no longer have permission to do that.",
		});
	});

	it("refuses a permissionless write for a read-only caller", async () => {
		mockCanWrite.mockResolvedValue(false);

		await expect(acceptAssistantAction("action-1")).resolves.toEqual({
			success: false,
			error: "You have read-only access, so that cannot run.",
		});
		expect(prisma.assistantAction.updateMany).not.toHaveBeenCalled();
	});
});

describe("rejectAssistantAction", () => {
	it("refuses a read-only view-as session", async () => {
		assertNotViewingAs.mockRejectedValue(new Error("read only"));

		await expect(rejectAssistantAction("action-1")).resolves.toEqual({
			success: false,
			error: "This is a read-only view-as session.",
		});
		expect(prisma.assistantAction.findUnique).not.toHaveBeenCalled();
	});

	it("refuses an unauthenticated caller", async () => {
		mockUser.mockResolvedValue(null);

		await expect(rejectAssistantAction("action-1")).resolves.toEqual({
			success: false,
			error: "Not authenticated.",
		});
	});

	it("hides another user's proposal", async () => {
		prisma.assistantAction.findUnique.mockResolvedValue({ ...ROW, userId: "user-2" });

		await expect(rejectAssistantAction("action-1")).resolves.toEqual({
			success: false,
			error: "That action was not found.",
		});
		expect(prisma.assistantAction.update).not.toHaveBeenCalled();
	});

	it("refuses a row that was already decided", async () => {
		prisma.assistantAction.findUnique.mockResolvedValue({ ...ROW, status: "ACCEPTED" });

		await expect(rejectAssistantAction("action-1")).resolves.toEqual({
			success: false,
			error: "That action was already decided.",
		});
		expect(prisma.assistantAction.update).not.toHaveBeenCalled();
	});

	it("marks a live proposal rejected", async () => {
		await expect(rejectAssistantAction("action-1")).resolves.toEqual({ success: true });

		expect(prisma.assistantAction.update).toHaveBeenCalledWith({
			where: { id: "action-1" },
			data: { status: "REJECTED", decidedAt: expect.any(Date) },
		});
	});

	it("marks an expired proposal expired rather than rejected", async () => {
		prisma.assistantAction.findUnique.mockResolvedValue({
			...ROW,
			expiresAt: new Date("2026-10-29T07:00:00.000Z"),
		});

		await expect(rejectAssistantAction("action-1")).resolves.toEqual({ success: true });

		expect(prisma.assistantAction.update.mock.calls[0][0].data.status).toBe("EXPIRED");
	});
});
