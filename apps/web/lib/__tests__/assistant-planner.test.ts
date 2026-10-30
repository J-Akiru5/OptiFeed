import { PERMISSIONS } from "@/lib/auth/permissions";
import { describe, expect, it, vi } from "vitest";
import type { AssistantCaller } from "../assistant/caller";
import {
	type AssistantTurnContext,
	decideAssistantTurn,
	validateToolCall,
} from "../assistant/planner";
import { availableToolIds } from "../assistant/tools";

vi.mock("@/lib/ai", () => ({
	completeAi: vi.fn(),
	stableSessionId: () => "assistant-session",
}));

vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/i18n/routing", () => ({ redirect: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "en") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const context: AssistantTurnContext = {
	pondName: "Pond A",
	currentGrams: 80,
	currentFeedsPerDay: 3,
	currentRatePct: 3,
	deviceLabel: "Feeder A",
	deviceOnline: true,
	devicePaused: false,
	hopperLevelPct: 72,
	orgName: "Org A",
	locale: "en",
	openTasks: [],
	ponds: [{ id: "pond-1", name: "Pond A", status: "ACTIVE" }],
	calendarEvents: [],
	samples: [],
	members: [],
	organizations: [],
	devices: [],
	platformUsers: [],
};

function caller(overrides: Partial<AssistantCaller> = {}): AssistantCaller {
	return {
		userId: "u1",
		role: "owner",
		permissions: new Set(PERMISSIONS),
		canWrite: true,
		isPlatformAdmin: false,
		isTenantAdmin: true,
		orgName: "Org A",
		...overrides,
	};
}

function reply(content: string) {
	return { content, reasoning: null };
}

describe("availableToolIds", () => {
	it("offers an owner the feeding, record and admin kinds", () => {
		const ids = availableToolIds(caller());
		expect(ids).toContain("feeding.set_grams");
		expect(ids).toContain("records.log_biomass");
		expect(ids).toContain("admin.invite_member");
		expect(ids).not.toContain("superadmin.suspend_org");
	});

	it("offers a farmer no admin or platform kinds", () => {
		const ids = availableToolIds(
			caller({
				role: "farmer",
				isTenantAdmin: false,
				permissions: new Set([
					"view_dashboard",
					"manage_schedule",
					"manage_crop_cycle",
					"control_feeder",
				]),
			}),
		);
		expect(ids).toContain("feeding.set_grams");
		expect(ids).toContain("records.log_biomass");
		expect(ids).not.toContain("admin.invite_member");
		expect(ids).not.toContain("superadmin.start_view_as");
	});

	it("offers a read-only viewer nothing", () => {
		expect(
			availableToolIds(
				caller({
					role: "farmer",
					isTenantAdmin: false,
					canWrite: false,
					permissions: new Set(["view_dashboard", "view_reports"]),
				}),
			),
		).toEqual([]);
	});

	it("offers a platform admin the platform kinds only", () => {
		const ids = availableToolIds(
			caller({
				role: "superadmin",
				isPlatformAdmin: true,
				isTenantAdmin: false,
				canWrite: false,
				permissions: new Set(),
			}),
		);
		expect(ids).toEqual([
			"superadmin.suspend_org",
			"superadmin.restore_org",
			"superadmin.start_view_as",
			"superadmin.stop_view_as",
			"superadmin.rotate_device_token",
			"superadmin.remote_feed",
			"superadmin.pause_device",
			"superadmin.disable_user",
			"superadmin.enable_user",
			"superadmin.grant_platform_admin",
			"superadmin.revoke_platform_admin",
			"superadmin.create_org",
		]);
	});
});

describe("validateToolCall", () => {
	it("coerces a numeric string and returns the validated payload", () => {
		const result = validateToolCall("feeding.set_grams", { grams: "120" }, caller());
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.payload).toEqual({ grams: 120 });
	});

	it("refuses a kind the caller may not use", () => {
		const result = validateToolCall(
			"superadmin.suspend_org",
			{ orgId: "o1", reason: "x".repeat(10) },
			caller(),
		);
		expect(result.ok).toBe(false);
	});

	it("names the missing platform role, permission or write access", () => {
		const platform = validateToolCall(
			"superadmin.suspend_org",
			{ orgId: "o1", reason: "x".repeat(10) },
			caller(),
		);
		expect(platform).toEqual({
			ok: false,
			text: "Only a platform admin can suspend an organization.",
		});

		const permission = validateToolCall(
			"admin.invite_member",
			{ email: "new@example.com", role: "OPERATOR" },
			caller({ isTenantAdmin: true, permissions: new Set() }),
		);
		expect(permission).toEqual({
			ok: false,
			text: 'You need the "manage_members" permission to invite a member. Ask an organization admin to grant it.',
		});

		const readOnly = validateToolCall(
			"records.delete_biomass",
			{ logId: "log-1" },
			caller({ canWrite: false }),
		);
		expect(readOnly).toEqual({
			ok: false,
			text: "You have read-only access, so you cannot delete a biomass sample.",
		});

		expect(validateToolCall("not.a.tool", {}, caller())).toEqual({
			ok: false,
			text: "I don't have an action for that.",
		});
	});

	it("refuses an out-of-range payload", () => {
		const result = validateToolCall("feeding.set_grams", { grams: -5 }, caller());
		expect(result.ok).toBe(false);
	});
});

describe("decideAssistantTurn", () => {
	it("turns a tool answer into a validated proposal", async () => {
		const complete = vi.fn(async () =>
			reply(JSON.stringify({ kind: "tool", tool: "feeding.set_grams", args: { grams: 95 } })),
		);

		const decision = await decideAssistantTurn({
			message: "Set the feed to 95 grams",
			history: [],
			caller: caller(),
			context,
			userId: "u1",
			today: "2026-10-27",
			complete,
		});

		expect(decision).toMatchObject({
			kind: "propose",
			toolId: "feeding.set_grams",
			payload: { grams: 95 },
		});
	});

	it("asks for information instead of running a tool the caller may not use", async () => {
		const complete = vi.fn(async () =>
			reply(JSON.stringify({ kind: "tool", tool: "admin.invite_member", args: {} })),
		);

		const decision = await decideAssistantTurn({
			message: "Invite someone",
			history: [],
			caller: caller({ role: "farmer", isTenantAdmin: false }),
			context,
			userId: "u1",
			today: "2026-10-27",
			complete,
		});

		expect(decision.kind).toBe("clarify");
	});

	it("asks a clarifying question when a required field is missing", async () => {
		const complete = vi.fn(async () =>
			reply(
				JSON.stringify({ kind: "tool", tool: "records.log_biomass", args: { sampleCount: 10 } }),
			),
		);

		const decision = await decideAssistantTurn({
			message: "Log a sample",
			history: [],
			caller: caller(),
			context,
			userId: "u1",
			today: "2026-10-27",
			complete,
		});

		expect(decision.kind).toBe("clarify");
	});

	it("resolves a navigation id against the caller's own catalogue", async () => {
		const complete = vi.fn(async () =>
			reply(JSON.stringify({ kind: "navigate", id: "item:dashboard:0" })),
		);

		const decision = await decideAssistantTurn({
			message: "Take me to Feed Now",
			history: [],
			caller: caller(),
			context,
			userId: "u1",
			today: "2026-10-27",
			complete,
		});

		expect(decision).toMatchObject({
			kind: "navigate",
			entry: { route: "/dashboard", target: "feed-now" },
		});
	});

	it("refuses a navigation id that belongs to another role", async () => {
		const complete = vi.fn(async () =>
			reply(JSON.stringify({ kind: "navigate", id: "section:superadmin.devices" })),
		);

		const decision = await decideAssistantTurn({
			message: "Open the device fleet",
			history: [],
			caller: caller(),
			context,
			userId: "u1",
			today: "2026-10-27",
			complete,
		});

		expect(decision.kind).toBe("clarify");
	});

	it("falls back to the normal chat for ordinary questions", async () => {
		const complete = vi.fn(async () => reply(JSON.stringify({ kind: "answer" })));

		const decision = await decideAssistantTurn({
			message: "What is my FCR?",
			history: [],
			caller: caller(),
			context,
			userId: "u1",
			today: "2026-10-27",
			complete,
		});

		expect(decision.kind).toBe("fallback");
	});

	it("uses the navigation catalogue when the model is unavailable", async () => {
		const complete = vi.fn(async () => {
			throw new Error("provider down");
		});

		const decision = await decideAssistantTurn({
			message: "Take me to calibration",
			history: [],
			caller: caller(),
			context,
			userId: "u1",
			today: "2026-10-27",
			complete,
		});

		expect(decision.kind).toBe("navigate");
		if (decision.kind !== "navigate") return;
		expect(decision.entry.route).toBe("/dashboard/settings/hardware");
		expect(decision.entry.target).toBe("calibration-form");
	});
});
