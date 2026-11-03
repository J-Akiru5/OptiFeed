import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pakoy's escalation tool (issue #487).
 *
 * When a request is outside the catalogue the assistant files an issue report
 * for the platform team instead of refusing. These tests pin the three things
 * that make that safe and useful: a read-only account is offered the tool, the
 * report is stored with `source: ASSISTANT` and the caller as its reporter, and
 * a failed write surfaces a readable message instead of a raw error code.
 */

const mocks = vi.hoisted(() => ({ createIssueReport: vi.fn() }));

vi.mock("@/lib/reports/store", () => ({ createIssueReport: mocks.createIssueReport }));
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/i18n/routing", () => ({ redirect: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "en") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import type { AssistantCaller } from "../assistant/caller";
import { ASSISTANT_ACTION_DEFINITIONS } from "../assistant/catalog";
import { validateToolCall } from "../assistant/planner";
import { availableToolIds } from "../assistant/tools";

const ctx = { userId: "user-readonly" };

/** A farmer with no write access and no admin role: the escalation case. */
const readOnlyFarmer: AssistantCaller = {
	userId: "user-readonly",
	role: "farmer",
	membershipRole: "VIEWER",
	isOwner: false,
	permissions: new Set(),
	canWrite: false,
	isPlatformAdmin: false,
	isTenantAdmin: false,
	orgName: "Org A",
};

const report = ASSISTANT_ACTION_DEFINITIONS["support.file_report"];

beforeEach(() => {
	vi.clearAllMocks();
	mocks.createIssueReport.mockResolvedValue({ ok: true, id: "report-1" });
});

describe("support.file_report", () => {
	it("is offered to a read-only caller while other writes are not", () => {
		const ids = availableToolIds(readOnlyFarmer);

		expect(ids).toContain("support.file_report");
		expect(ids).not.toContain("feeding.set_grams");
		expect(ids).not.toContain("records.log_biomass");
	});

	it("validates the model's category and message through the planner", () => {
		const accepted = validateToolCall(
			"support.file_report",
			{ category: "BUG", message: "The dashboard clips at 100% zoom on my laptop." },
			readOnlyFarmer,
		);
		expect(accepted.ok).toBe(true);
		if (accepted.ok) {
			expect(accepted.payload).toEqual({
				category: "BUG",
				message: "The dashboard clips at 100% zoom on my laptop.",
			});
		}

		const tooShort = validateToolCall(
			"support.file_report",
			{ category: "OTHER", message: "broken" },
			readOnlyFarmer,
		);
		expect(tooShort.ok).toBe(false);
	});

	it("stores the report as an assistant report from the caller", async () => {
		const result = await report.execute(
			{ category: "ACCESSIBILITY", message: "The colour contrast on the pond card is too low." },
			ctx,
		);

		expect(mocks.createIssueReport).toHaveBeenCalledWith({
			category: "ACCESSIBILITY",
			message: "The colour contrast on the pond card is too low.",
			source: "ASSISTANT",
			reporterUserId: "user-readonly",
		});
		expect(mocks.createIssueReport.mock.calls[0][0]).not.toHaveProperty("email");
		expect(result).toEqual({
			success: true,
			message: "Report sent to the platform team. You can keep chatting while they look into it.",
		});
	});

	it("surfaces a readable failure instead of the coarse store code", async () => {
		mocks.createIssueReport.mockResolvedValueOnce({ ok: false, error: "unavailable" });

		const result = await report.execute(
			{ category: "BUG", message: "The export button does nothing on Safari." },
			ctx,
		);

		expect(result.success).toBe(false);
		expect(result.message).toBe("I could not send the report. Please try again in a moment.");
		expect(result.message).not.toContain("unavailable");
	});

	it("describes the report in the caller's words on the proposal card", () => {
		const card = report.describe(
			{ category: "BUG", message: "The schedule page hides the meal times." },
			{
				pondName: null,
				orgName: "Org A",
				deviceLabel: null,
				currentGrams: null,
				currentFeedsPerDay: null,
				currentRatePct: null,
				currentDailyCapG: null,
				deviceOnline: null,
			},
		);

		expect(card.summary).toContain("The schedule page hides the meal times.");
		expect(card.summary).toContain("platform team");
		expect(card.fields).toEqual([
			{ label: "Category", value: "BUG" },
			{ label: "Report", value: "The schedule page hides the meal times." },
		]);
	});

	it("needs no step-up, because it only records the caller's own report", () => {
		expect(report.requiresStepUp).toBe(false);
		expect(report.requiresWrite).toBe(false);
		expect(report.permission).toBeUndefined();
		expect(report.platformAdminOnly).toBeUndefined();
		expect(report.tenantAdminOnly).toBeUndefined();
	});
});
