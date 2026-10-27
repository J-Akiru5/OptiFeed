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
		canWrite: vi.fn(async () => true),
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

// Every kind goes through the same gate. These two loops are the allow/deny
// matrix: a fully authorized caller can accept each one, and a caller with no
// permission, no write access, no tenant role and no platform grant can accept
// none of them. The per-action test lives in assistant-catalog.test.ts.
const ALL_KINDS: Array<[string, Record<string, unknown>]> = [
	["feeding.set_grams", { grams: 95 }],
	["feeding.set_meals", { mealsPerDay: 4 }],
	["feeding.set_rate", { feedingRatePct: 2.5 }],
	["feeding.pause", {}],
	["feeding.resume", {}],
	["feed.now", { grams: 120 }],
	["records.log_biomass", { avgWeightG: 150, sampleCount: 10 }],
	[
		"records.add_calendar_item",
		{ kind: "TASK", title: "Clean the net", startsAt: "2026-10-30", allDay: true },
	],
	[
		"records.start_cycle",
		{ stockingDate: "2026-05-01", stockingCount: 1000, targetHarvestDate: "2026-08-29" },
	],
	["records.complete_task", { eventId: "event-1" }],
	["admin.invite_member", { email: "new@example.com", role: "OPERATOR" }],
	["admin.change_role", { userId: "member-1", role: "OPERATOR" }],
	["admin.set_permission", { userId: "member-1", permission: "manage_schedule", granted: true }],
	["superadmin.suspend_org", { orgId: "org-1", reason: "a".repeat(10) }],
	["superadmin.restore_org", { orgId: "org-1", reason: "a".repeat(10) }],
	["superadmin.start_view_as", { orgId: "org-1", reason: "a".repeat(10) }],
];

describe("assistant kind allow/deny matrix", () => {
	it.each(ALL_KINDS)("accepts %s for an authorized caller", async (kind, payload) => {
		const deps = dependencies({
			load: vi.fn(async () => row({ kind, payload })),
			hasPermission: vi.fn(async () => true),
			canWrite: vi.fn(async () => true),
			isPlatformAdmin: vi.fn(async () => true),
			isTenantAdmin: vi.fn(async () => true),
			requireStepUp: vi.fn(async () => undefined),
		});

		const result = await acceptAssistantActionWith("user-1", "action-1", deps);

		expect(result.success).toBe(true);
		expect(deps.execute).toHaveBeenCalledWith(kind, payload, "user-1");
	});

	it.each(ALL_KINDS)(
		"denies %s without permission, write access or role",
		async (kind, payload) => {
			const deps = dependencies({
				load: vi.fn(async () => row({ kind, payload })),
				hasPermission: vi.fn(async () => false),
				canWrite: vi.fn(async () => false),
				isPlatformAdmin: vi.fn(async () => false),
				isTenantAdmin: vi.fn(async () => false),
			});

			const result = await acceptAssistantActionWith("user-1", "action-1", deps);

			expect(result.success).toBe(false);
			expect(deps.execute).not.toHaveBeenCalled();
			expect(deps.markAccepted).not.toHaveBeenCalled();
		},
	);
});
