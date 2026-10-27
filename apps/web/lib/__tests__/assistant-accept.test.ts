import { describe, expect, it, vi } from "vitest";
import {
	type AcceptDependencies,
	type AssistantActionRow,
	acceptAssistantActionWith,
} from "../assistant/accept";

vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/i18n/routing", () => ({ redirect: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "en") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const NOW = new Date("2026-10-27T12:00:00Z");

function row(overrides: Partial<AssistantActionRow> = {}): AssistantActionRow {
	return {
		id: "action-1",
		userId: "user-1",
		kind: "feeding.pause",
		payload: {},
		status: "PENDING",
		expiresAt: new Date(NOW.getTime() + 60_000),
		...overrides,
	};
}

function dependencies(overrides: Partial<AcceptDependencies> = {}) {
	const deps = {
		now: vi.fn(() => NOW),
		load: vi.fn(async () => row()),
		markExpired: vi.fn(async () => undefined),
		markAccepted: vi.fn(async () => undefined),
		markFailed: vi.fn(async () => undefined),
		hasPermission: vi.fn(async () => true),
		isPlatformAdmin: vi.fn(async () => false),
		isTenantAdmin: vi.fn(async () => false),
		requireStepUp: vi.fn(async () => undefined),
		execute: vi.fn(async () => ({ success: true, message: "Paused." })),
		...overrides,
	} satisfies AcceptDependencies;
	return deps;
}

describe("acceptAssistantActionWith", () => {
	it("runs the stored action once the caller passes every gate", async () => {
		const deps = dependencies();

		const result = await acceptAssistantActionWith("user-1", "action-1", deps);

		expect(result).toEqual({ success: true, message: "Paused." });
		expect(deps.execute).toHaveBeenCalledWith("feeding.pause", {}, "user-1");
		expect(deps.markAccepted).toHaveBeenCalledWith("action-1", { message: "Paused." });
		expect(deps.markFailed).not.toHaveBeenCalled();
	});

	it("denies another user's proposal without revealing that it exists", async () => {
		const deps = dependencies();

		const result = await acceptAssistantActionWith("someone-else", "action-1", deps);

		expect(result.success).toBe(false);
		expect(deps.execute).not.toHaveBeenCalled();
		expect(deps.markAccepted).not.toHaveBeenCalled();
	});

	it("denies a replayed Accept after the row was decided", async () => {
		const deps = dependencies({ load: vi.fn(async () => row({ status: "ACCEPTED" })) });

		const result = await acceptAssistantActionWith("user-1", "action-1", deps);

		expect(result.success).toBe(false);
		expect(deps.execute).not.toHaveBeenCalled();
	});

	it("expires a stale row and refuses to run it", async () => {
		const deps = dependencies({
			load: vi.fn(async () => row({ expiresAt: new Date(NOW.getTime() - 1_000) })),
		});

		const result = await acceptAssistantActionWith("user-1", "action-1", deps);

		expect(result.success).toBe(false);
		expect(deps.markExpired).toHaveBeenCalledWith("action-1");
		expect(deps.execute).not.toHaveBeenCalled();
	});

	it("refuses when the caller no longer holds the permission", async () => {
		const deps = dependencies({ hasPermission: vi.fn(async () => false) });

		const result = await acceptAssistantActionWith("user-1", "action-1", deps);

		expect(result.success).toBe(false);
		expect(deps.markFailed).toHaveBeenCalled();
		expect(deps.execute).not.toHaveBeenCalled();
	});

	it("leaves the row PENDING when step-up is missing", async () => {
		const deps = dependencies({
			load: vi.fn(async () =>
				row({
					kind: "admin.invite_member",
					payload: { email: "new@example.com", role: "OPERATOR" },
				}),
			),
			isTenantAdmin: vi.fn(async () => true),
			requireStepUp: vi.fn(async () => {
				throw new Error("step up");
			}),
		});

		const result = await acceptAssistantActionWith("user-1", "action-1", deps);

		expect(result).toMatchObject({ success: false, code: "step_up_required" });
		expect(deps.execute).not.toHaveBeenCalled();
		expect(deps.markFailed).not.toHaveBeenCalled();
	});

	it("refuses a tampered or no-longer-valid payload", async () => {
		const deps = dependencies({
			load: vi.fn(async () => row({ kind: "feeding.set_grams", payload: { grams: -5 } })),
		});

		const result = await acceptAssistantActionWith("user-1", "action-1", deps);

		expect(result.success).toBe(false);
		expect(deps.markFailed).toHaveBeenCalled();
		expect(deps.execute).not.toHaveBeenCalled();
	});

	it("refuses an unknown tool", async () => {
		const deps = dependencies({ load: vi.fn(async () => row({ kind: "not.a.tool" })) });

		const result = await acceptAssistantActionWith("user-1", "action-1", deps);

		expect(result.success).toBe(false);
		expect(deps.markFailed).toHaveBeenCalled();
		expect(deps.execute).not.toHaveBeenCalled();
	});

	it("refuses a platform kind without a platform admin", async () => {
		const deps = dependencies({
			load: vi.fn(async () =>
				row({ kind: "superadmin.suspend_org", payload: { orgId: "o1", reason: "a".repeat(10) } }),
			),
		});

		const result = await acceptAssistantActionWith("user-1", "action-1", deps);

		expect(result.success).toBe(false);
		expect(deps.execute).not.toHaveBeenCalled();
	});

	it("refuses a tenant-admin kind without a tenant admin", async () => {
		const deps = dependencies({
			load: vi.fn(async () =>
				row({
					kind: "admin.change_role",
					payload: { userId: "member-1", role: "OPERATOR" },
				}),
			),
			isTenantAdmin: vi.fn(async () => false),
		});

		const result = await acceptAssistantActionWith("user-1", "action-1", deps);

		expect(result.success).toBe(false);
		expect(deps.execute).not.toHaveBeenCalled();
	});

	it("marks the row FAILED when the underlying action reports an error", async () => {
		const deps = dependencies({
			execute: vi.fn(async () => ({ success: false, message: "Feeder offline." })),
		});

		const result = await acceptAssistantActionWith("user-1", "action-1", deps);

		expect(result).toEqual({ success: false, error: "Feeder offline." });
		expect(deps.markFailed).toHaveBeenCalledWith("action-1", "Feeder offline.");
		expect(deps.markAccepted).not.toHaveBeenCalled();
	});
});
