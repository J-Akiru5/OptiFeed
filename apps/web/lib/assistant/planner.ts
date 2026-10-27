import { completeAi, stableSessionId } from "@/lib/ai";
import { formatZodError } from "@/lib/limits";
import type { AssistantCaller } from "./caller";
import { ASSISTANT_ACTION_DEFINITIONS } from "./catalog";
import {
	type AssistantNavigationEntry,
	matchNavigation,
	navigationEntries,
	resolveNavigation,
} from "./navigation";
import { availableToolIds, describeToolsForPrompt } from "./tools";
import type { AssistantToolId } from "./types";

/**
 * The assistant planner (issue #194, E10/E11).
 *
 * One model call decides between four outcomes: propose an action tool (which
 * the server validates and stores as a PENDING `AssistantAction`), navigate to
 * a help destination, ask a clarifying question, or fall back to the normal
 * streaming chat. The model never executes anything and never supplies a route
 * or a pond/device id: ids come from the server catalogues below.
 */

export interface AssistantHistoryTurn {
	role: "user" | "assistant";
	content: string;
}

export interface AssistantTurnContext {
	pondName: string | null;
	currentGrams: number | null;
	currentFeedsPerDay: number | null;
	currentRatePct: number | null;
	deviceLabel: string | null;
	deviceOnline: boolean | null;
	devicePaused: boolean | null;
	hopperLevelPct: number | null;
	orgName: string | null;
	locale: string;
	/** Open tasks on the active pond, so "mark the net cleaning done" has ids. */
	openTasks: Array<{ id: string; title: string; startsAt: string }>;
	/** Members of the caller's organization, for role/permission proposals. */
	members: Array<{ userId: string; name: string; role: string }>;
	/** Organizations, for platform admin proposals. */
	organizations: Array<{ id: string; name: string; status: string }>;
}

export type AssistantDecision =
	| {
			kind: "propose";
			toolId: AssistantToolId;
			payload: Record<string, unknown>;
	  }
	| { kind: "navigate"; entry: AssistantNavigationEntry }
	| { kind: "clarify"; text: string }
	| { kind: "fallback" };

interface PlannerReply {
	kind?: unknown;
	tool?: unknown;
	args?: unknown;
	id?: unknown;
	reply?: unknown;
}

function extractJson(text: string): unknown {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) return null;
	try {
		return JSON.parse(text.slice(start, end + 1));
	} catch {
		return null;
	}
}

function buildPrompt(params: {
	context: AssistantTurnContext;
	caller: AssistantCaller;
	today: string;
	history: AssistantHistoryTurn[];
}): string {
	const { context, caller } = params;
	const language = context.locale === "hil" ? "Hiligaynon (Ilonggo)" : "English";
	const navigation = navigationEntries(caller.role, context.locale)
		.map((entry) => `- ${entry.id} — ${entry.label} (${entry.route})`)
		.join("\n");

	const pondData = context.pondName
		? `
CURRENT POND:
- Pond: ${context.pondName}
- Current grams per meal: ${context.currentGrams ?? "unknown"}
- Meals per day: ${context.currentFeedsPerDay ?? "unknown"}
- Feeding rate: ${context.currentRatePct ?? "unknown"}% of body weight/day
- Feeder: ${context.deviceLabel ?? "not linked"}
- Feeder online: ${context.deviceOnline === null ? "unknown" : context.deviceOnline ? "yes" : "no"}
- Feeder paused: ${context.devicePaused === null ? "unknown" : context.devicePaused ? "yes" : "no"}
- Hopper level: ${context.hopperLevelPct === null ? "no reading" : `${context.hopperLevelPct}%`}
`
		: "\nNo active pond for this caller.";

	const history = params.history
		.slice(-6)
		.map((turn) => `${turn.role}: ${turn.content.slice(0, 400)}`)
		.join("\n");

	const tasks =
		context.openTasks.length > 0
			? `\nOPEN TASKS (use the id for records.complete_task):\n${context.openTasks
					.map((task) => `- ${task.id} — ${task.title} (${task.startsAt})`)
					.join("\n")}\n`
			: "";
	const members =
		context.members.length > 0
			? `\nORGANIZATION MEMBERS (use the userId for admin.change_role / admin.set_permission):\n${context.members
					.map((member) => `- ${member.userId} — ${member.name} (${member.role})`)
					.join("\n")}\n`
			: "";
	const organizations =
		context.organizations.length > 0
			? `\nORGANIZATIONS (use the id for superadmin.suspend_org / restore_org / start_view_as):\n${context.organizations
					.map((org) => `- ${org.id} — ${org.name} (${org.status})`)
					.join("\n")}\n`
			: "";

	return `You are the PakaonAI Assistant planner for an African catfish farm in the Philippines. You decide whether the user wants to change something, go somewhere, or just ask a question.

Today (farm time): ${params.today}
Caller role: ${caller.role}${caller.orgName ? ` (organization: ${caller.orgName})` : ""}
${pondData}${tasks}${members}${organizations}
${history ? `\nRECENT CONVERSATION:\n${history}\n` : ""}
ACTION TOOLS AVAILABLE TO THIS CALLER:
${describeToolsForPrompt(caller)}

NAVIGATION DESTINATIONS AVAILABLE TO THIS CALLER:
${navigation || "(none)"}

Return ONLY one JSON object, no markdown, no prose outside it:
1. {"kind":"tool","tool":"<tool id>","args":{...}} — propose an action. Fill args from the user's message. Never invent a value they did not give: if a required value is missing, use clarify instead.
2. {"kind":"navigate","id":"<destination id>"} — the user wants to be taken to a page/control ("take me to calibration", "open the members list", "where do I change the schedule").
3. {"kind":"clarify","reply":"..."} — the request is an action but required information is missing or ambiguous. Ask for the smallest missing set. Reply in ${language}.
4. {"kind":"answer"} — this is an ordinary question; the normal chat will answer it.

Rules:
- Use only the tool ids and destination ids listed above. Never invent one.
- One action at a time. If the user asks for several, propose the first and ask them to do the next one after.
- Never include pondId, deviceId, organization ids or user ids that the user did not give; the server fills the current pond and device.
- Do not invent a feed amount or a number. "Feed them" with no amount means the standard dose (omit grams).
- Resolve relative dates ("tomorrow", "next Monday") from today and write YYYY-MM-DD.
- If the user only asks a question ("what is my FCR", "are we on track"), return answer.
- Destructive or administrative actions still need the user's Accept; never say they are done.`;
}

function parseReply(value: unknown): PlannerReply | null {
	if (!value || typeof value !== "object") return null;
	return value as PlannerReply;
}

function clarify(text: string): AssistantDecision {
	const trimmed = text.trim().slice(0, 500);
	return {
		kind: "clarify",
		text: trimmed || "I need a little more information to do that.",
	};
}

/**
 * Validate a proposed tool call against the server catalogue. Exported so the
 * acceptance path can reuse the exact same schemas.
 */
export function validateToolCall(
	toolId: string,
	args: unknown,
	caller: AssistantCaller,
):
	| { ok: true; toolId: AssistantToolId; payload: Record<string, unknown> }
	| { ok: false; text: string } {
	if (!availableToolIds(caller).includes(toolId as AssistantToolId)) {
		return {
			ok: false,
			text: "I can't do that with your current role and permissions. Ask an administrator if you need access.",
		};
	}
	const definition = ASSISTANT_ACTION_DEFINITIONS[toolId as AssistantToolId];
	const parsed = definition.schema.safeParse(args ?? {});
	if (!parsed.success) return { ok: false, text: formatZodError(parsed.error) };
	return {
		ok: true,
		toolId: definition.id,
		payload: parsed.data as Record<string, unknown>,
	};
}

export async function decideAssistantTurn(params: {
	message: string;
	history: AssistantHistoryTurn[];
	caller: AssistantCaller;
	context: AssistantTurnContext;
	userId: string;
	today: string;
	/** Injected in tests; defaults to the real provider chain. */
	complete?: typeof completeAi;
}): Promise<AssistantDecision> {
	const { message, history, caller, context, userId, today } = params;
	const complete = params.complete ?? completeAi;
	const systemPrompt = buildPrompt({ context, caller, today, history });
	const turns = [
		...history.slice(-6).map((turn) => ({
			role: turn.role,
			text: turn.content,
		})),
		{ role: "user" as const, text: message },
	];

	let reply: PlannerReply | null = null;
	try {
		const result = await complete(
			turns,
			systemPrompt,
			stableSessionId("assistant", userId, history[0]?.content ?? message),
		);
		reply = result?.content ? parseReply(extractJson(result.content)) : null;
	} catch (error) {
		console.error("[assistant] planner failed:", error);
	}

	if (reply) {
		if (reply.kind === "tool" && typeof reply.tool === "string") {
			const validation = validateToolCall(reply.tool, reply.args, caller);
			if (!validation.ok) return clarify(validation.text);
			return {
				kind: "propose",
				toolId: validation.toolId,
				payload: validation.payload,
			};
		}

		if (reply.kind === "navigate" && typeof reply.id === "string") {
			const entry = resolveNavigation(reply.id, caller.role, context.locale);
			if (entry) return { kind: "navigate", entry };
			return clarify("I can't find that screen for your role.");
		}

		if (reply.kind === "clarify" && typeof reply.reply === "string") {
			return clarify(reply.reply);
		}

		if (reply.kind === "answer") return { kind: "fallback" };
	}

	// No usable model answer: a navigation phrase can still be honoured from the
	// same server catalogue. Anything else stays on the normal chat path.
	const fallbackEntry = matchNavigation(message, caller.role, context.locale);
	if (fallbackEntry) return { kind: "navigate", entry: fallbackEntry };

	return { kind: "fallback" };
}
