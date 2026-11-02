import { createIssueReport } from "@/lib/reports/store";
import { z } from "zod";
import type { AssistantActionDefinition, AssistantToolId } from "../types";
import { fail, str } from "./shared";

/**
 * Support tools (issue #487): the escape hatch that lets Pakoy "pass the bill".
 *
 * When a request is outside the tool catalogue — a broken screen, a missing
 * feature, an accessibility problem, or something only a platform
 * administrator may change — the assistant files an issue report for the
 * platform team instead of dead-ending with "I can't do that".
 *
 * This is the one write a read-only account may accept: the row records the
 * caller as the reporter and touches no tenant data, so `requiresWrite` is
 * false and no step-up is required.
 */

const CATEGORIES = ["BUG", "ACCESSIBILITY", "CONTENT", "OTHER"] as const;

const SUMMARY_LIMIT = 160;

function truncate(value: string): string {
	return value.length > SUMMARY_LIMIT ? `${value.slice(0, SUMMARY_LIMIT - 1)}…` : value;
}

type AssistantActionTable = Partial<Record<AssistantToolId, AssistantActionDefinition>>;

export const supportActions = {
	"support.file_report": {
		id: "support.file_report",
		label: "Report a problem to the platform team",
		description:
			"File an issue report when the request is outside what Pakoy can do here: a bug, a broken layout, a missing feature, an accessibility problem, or a change only a platform administrator can make. The platform team reviews reports in the order they arrive.",
		params:
			"category: BUG|ACCESSIBILITY|CONTENT|OTHER; message: string (10-2000 chars, the user's own words)",
		schema: z.object({
			category: z.enum(CATEGORIES).default("OTHER"),
			message: z
				.string()
				.trim()
				.min(10, "Describe the issue in at least 10 characters")
				.max(2_000, "Keep the report under 2000 characters"),
		}),
		requiresWrite: false,
		requiresStepUp: false,
		describe(payload) {
			const message = str(payload.message);
			const category = str(payload.category) || "OTHER";
			return {
				summary: `Send this report to the platform team: “${truncate(message)}”. They review reports in the order they arrive.`,
				fields: [
					{ label: "Category", value: category },
					{ label: "Report", value: message },
				],
			};
		},
		async execute(payload, context) {
			const result = await createIssueReport({
				category: str(payload.category) as (typeof CATEGORIES)[number],
				message: str(payload.message),
				source: "ASSISTANT",
				reporterUserId: context.userId,
			});
			if (!result.ok) {
				return fail(
					result.error === "invalid"
						? "That report needs a little more detail before I can send it."
						: "I could not send the report. Please try again in a moment.",
				);
			}
			return {
				success: true,
				message: "Report sent to the platform team. You can keep chatting while they look into it.",
			};
		},
	},
} satisfies AssistantActionTable;
