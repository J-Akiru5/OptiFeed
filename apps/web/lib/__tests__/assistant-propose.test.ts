import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	create: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: { assistantAction: { create: mocks.create } },
}));
vi.mock("@/i18n/routing", () => ({ redirect: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "en") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { ASSISTANT_PROPOSAL_TTL_MS, createAssistantProposal } from "../assistant/propose";

const context = {
	pondName: "Pond A",
	orgName: "Org A",
	deviceLabel: "Feeder A",
	currentGrams: 80,
	currentFeedsPerDay: 3,
	currentRatePct: 3,
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.create.mockImplementation(async ({ data }: { data: { expiresAt: Date } }) => ({
		id: "action-1",
		expiresAt: data.expiresAt,
	}));
});

describe("createAssistantProposal", () => {
	it("stores a validated PENDING proposal with a ten-minute expiry", async () => {
		const before = Date.now();

		const proposal = await createAssistantProposal({
			userId: "user-1",
			orgId: "org-1",
			pondId: "pond-1",
			toolId: "feeding.set_grams",
			payload: { grams: "95" },
			context,
		});

		expect(proposal.actionId).toBe("action-1");
		expect(proposal.toolId).toBe("feeding.set_grams");
		expect(proposal.summary).toContain("95");
		const data = mocks.create.mock.calls[0][0].data;
		expect(data.payload).toEqual({ grams: 95 });
		expect(data.status).toBeUndefined(); // schema default PENDING
		const ttl = data.expiresAt.getTime() - before;
		expect(ttl).toBeGreaterThan(ASSISTANT_PROPOSAL_TTL_MS - 5_000);
		expect(ttl).toBeLessThanOrEqual(ASSISTANT_PROPOSAL_TTL_MS + 5_000);
	});

	it("refuses an invalid payload instead of storing it", async () => {
		await expect(
			createAssistantProposal({
				userId: "user-1",
				orgId: "org-1",
				pondId: "pond-1",
				toolId: "feeding.set_grams",
				payload: { grams: -1 },
				context,
			}),
		).rejects.toBeTruthy();
		expect(mocks.create).not.toHaveBeenCalled();
	});

	it("refuses an unknown tool", async () => {
		await expect(
			createAssistantProposal({
				userId: "user-1",
				orgId: null,
				pondId: null,
				toolId: "not.a.tool",
				payload: {},
				context,
			}),
		).rejects.toThrow("Unknown assistant tool.");
	});
});
