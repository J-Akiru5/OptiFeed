import { completeAi, stableSessionId } from "@/lib/ai";
import { hasPermission } from "@/lib/auth/permissions";
import { daysBetween, isValidDateOnly, todayDateOnly } from "@/lib/crop-cycle/dates";
import { cropCycleInputSchema } from "@/lib/crop-cycle/schema";
import type { GrowthPlan } from "@/lib/growth-plan";
import { formatZodError } from "@/lib/limits";
import prisma from "@/lib/prisma";
import type { ChatContext } from "./context";

export type AgentActionType = "create_crop_cycle" | "update_crop_cycle" | "apply_growth_plan";

export interface AgentActionField {
	label: string;
	value: string;
}

export interface AgentActionPreview {
	type: AgentActionType;
	summary: string;
	fields: AgentActionField[];
	args: Record<string, unknown>;
}

export type AgentPlannerResult =
	| { kind: "fallback" }
	| { kind: "clarify"; text: string }
	| { kind: "action"; text: string; action: AgentActionPreview };

interface PlannerDecision {
	kind: "answer" | "clarify" | AgentActionType;
	reply?: string;
	args?: Record<string, unknown>;
}

interface HistoryTurn {
	role: "user" | "assistant";
	content: string;
}

interface ActiveCycle {
	id: string;
	label: string | null;
	stockingDate: string;
	stockingCount: number;
	stockingAvgWeightG: number | null;
	targetHarvestDate: string;
	targetHarvestWeightG: number | null;
	expectedSurvivalPct: number | null;
	notes: string | null;
}

function dateOnly(value: Date): string {
	return value.toISOString().slice(0, 10);
}

function textArg(value: unknown): string | null {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function numberArg(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function intArg(value: unknown): number | null {
	const parsed = numberArg(value);
	return parsed === null ? null : Math.round(parsed);
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

function isPlannerDecision(value: unknown): value is PlannerDecision {
	if (!value || typeof value !== "object") return false;
	const kind = (value as { kind?: unknown }).kind;
	return (
		kind === "answer" ||
		kind === "clarify" ||
		kind === "create_crop_cycle" ||
		kind === "update_crop_cycle" ||
		kind === "apply_growth_plan"
	);
}

function planLine(plan: GrowthPlan | null): string {
	if (!plan) return "No active target-weight cycle.";
	if (plan.status === "noCycle") return "No active grow-out cycle.";
	if (plan.status === "noTarget") return "Active cycle has no target harvest weight.";
	if (plan.status === "noWeight") return "Active cycle has no current body weight yet.";
	return [
		`target ${plan.targetWeightG ?? "?"}g by ${plan.targetDate ?? "?"}`,
		`current ${plan.currentWeightG?.toFixed(1) ?? "?"}g vs expected ${plan.expectedWeightG?.toFixed(1) ?? "?"}g`,
		`track ${plan.track}`,
		`recommended ${plan.recommendedGramsPerFeeding?.toFixed(1) ?? "?"}g/meal`,
		`adjustment ${plan.adjustmentAllowed ? "available" : `blocked (${plan.adjustmentBlock}${plan.nextAdjustmentDate ? `, next ${plan.nextAdjustmentDate}` : ""})`}`,
		plan.density.fishPerM2 !== null
			? `density ${plan.density.fishPerM2} fish/m2`
			: "density unknown",
	].join("; ");
}

function buildPrompt(params: {
	today: string;
	locale: string;
	context: ChatContext | null;
	plan: GrowthPlan | null;
	activeCycle: ActiveCycle | null;
	activeCycleId: string | null;
	densityAreaM2: number | null;
	averageDepthM: number | null;
}): string {
	const lang = params.locale === "hil" ? "Hiligaynon (Ilonggo)" : "English";
	const cycle = params.activeCycle
		? JSON.stringify({
				id: params.activeCycle.id,
				label: params.activeCycle.label,
				stockingDate: params.activeCycle.stockingDate,
				stockingCount: params.activeCycle.stockingCount,
				stockingAvgWeightG: params.activeCycle.stockingAvgWeightG,
				targetHarvestDate: params.activeCycle.targetHarvestDate,
				targetHarvestWeightG: params.activeCycle.targetHarvestWeightG,
				expectedSurvivalPct: params.activeCycle.expectedSurvivalPct,
			})
		: "none";

	return `You are the OptiFeed action planner for an African catfish farm in the Philippines.

Today (farm timezone): ${params.today}
Active pond: ${params.context?.pondName ?? "unknown"} (${params.activeCycleId ? "cycle linked" : "no active cycle"})
Population: ${params.context?.population ?? "unknown"}
Pond area: ${params.densityAreaM2 ?? "unknown"} m2; average depth: ${params.averageDepthM ?? "unknown"} m
Target plan: ${planLine(params.plan)}
Active cycle: ${cycle}

Return ONLY a JSON object, no markdown, no prose outside it.

Allowed shapes:
1. {"kind":"answer"} — the user is asking a question or just chatting. Do not answer it; the normal chat will handle it.
2. {"kind":"clarify","reply":"..."} — the request is an action but required information is missing or ambiguous. Ask for the smallest missing set. Reply in ${lang}.
3. {"kind":"create_crop_cycle","args":{"label":"...","stockingDate":"YYYY-MM-DD","stockingCount":5000,"stockingAvgWeightG":10,"targetHarvestDate":"YYYY-MM-DD","targetHarvestWeightG":330,"expectedSurvivalPct":85}} — start a full grow-out cycle. Omit label if the user did not give one.
4. {"kind":"update_crop_cycle","args":{"cycleId":"...","label":"...","stockingDate":"YYYY-MM-DD","stockingCount":5000,"stockingAvgWeightG":10,"targetHarvestDate":"YYYY-MM-DD","targetHarvestWeightG":330,"expectedSurvivalPct":85}} — edit the active cycle. Include only fields the user wants to change plus cycleId.
5. {"kind":"apply_growth_plan","args":{}} — apply the next safe feeding adjustment. Include grams only when the user explicitly asks for a specific amount.

Rules:
- Use YYYY-MM-DD dates. Resolve relative dates ("next month", "May 15") from today.
- Never invent a stocking count, target weight, stocking weight or date. If one is required and the user did not provide it, use clarify.
- For "set our grow-out cycle on these dates", the required fields are stockingDate, targetHarvestDate, stockingCount and targetHarvestWeightG. Stocking weight and survival are optional; survival defaults to 85.
- If a cycle is already active, use update_crop_cycle, not create_crop_cycle.
- If the user asks to change the target or dates, use update_crop_cycle.
- If the user asks whether they are on track, use answer (the normal chat has the plan data).
- Never return a feeding amount calculated by you. The server computes it from the plan.
- Respond in ${lang} for clarify text.`;
}

async function askPlanner(
	params: Parameters<typeof buildPrompt>[0] & {
		message: string;
		history: HistoryTurn[];
		ownerId: string;
	},
): Promise<PlannerDecision | null> {
	const systemPrompt = buildPrompt(params);
	const turns = [
		...params.history.slice(-8).map((turn) => ({
			role: turn.role,
			text: turn.content,
		})),
		{ role: "user" as const, text: params.message },
	];
	const result = await completeAi(
		turns,
		systemPrompt,
		stableSessionId("chat-agent", params.ownerId, params.message),
	);
	if (!result?.content) return null;
	const parsed = extractJson(result.content);
	return isPlannerDecision(parsed) ? parsed : null;
}

function previewFields(input: {
	pondName: string;
	stockingDate: string;
	targetHarvestDate: string;
	stockingCount: number;
	stockingAvgWeightG: number | null;
	targetHarvestWeightG: number;
	expectedSurvivalPct: number;
	areaM2: number | null;
}): AgentActionField[] {
	const days = daysBetween(input.stockingDate, input.targetHarvestDate);
	const density = input.areaM2 ? input.stockingCount / input.areaM2 : null;
	return [
		{ label: "Pond", value: input.pondName },
		{ label: "Stocking", value: `${input.stockingDate} (${input.stockingCount} fish)` },
		{ label: "Harvest", value: `${input.targetHarvestDate} (${days} days)` },
		{
			label: "Stocking weight",
			value:
				input.stockingAvgWeightG !== null
					? `${input.stockingAvgWeightG} g`
					: "not provided — tracking starts with the first sample",
		},
		{ label: "Target weight", value: `${input.targetHarvestWeightG} g/fish` },
		{ label: "Survival", value: `${input.expectedSurvivalPct}%` },
		{
			label: "Density",
			value: density ? `${density.toFixed(1)} fish/m²` : "unknown — add pond area in Settings",
		},
	];
}

async function buildCreatePreview(
	args: Record<string, unknown>,
	params: {
		pondId: string;
		pondName: string;
		areaM2: number | null;
		activeCycleId: string | null;
	},
): Promise<AgentPlannerResult> {
	const stockingDate = textArg(args.stockingDate);
	const targetHarvestDate = textArg(args.targetHarvestDate);
	const stockingCount = intArg(args.stockingCount);
	const targetHarvestWeightG = numberArg(args.targetHarvestWeightG);
	const stockingAvgWeightG = numberArg(args.stockingAvgWeightG);
	const expectedSurvivalPct = numberArg(args.expectedSurvivalPct) ?? 85;

	const missing: string[] = [];
	if (!stockingDate || !isValidDateOnly(stockingDate)) missing.push("stocking date (YYYY-MM-DD)");
	if (!targetHarvestDate || !isValidDateOnly(targetHarvestDate))
		missing.push("target harvest date (YYYY-MM-DD)");
	if (stockingCount === null || stockingCount < 1) missing.push("stocking count");
	if (targetHarvestWeightG === null || targetHarvestWeightG <= 0)
		missing.push("target weight per fish in grams");
	if (missing.length > 0) {
		return {
			kind: "clarify",
			text: `I need ${missing.join(", ")} to create the cycle.`,
		};
	}
	if (params.activeCycleId) {
		return {
			kind: "clarify",
			text: "This pond already has an active grow-out cycle. Ask me to update its dates or target instead.",
		};
	}
	if (!(await hasPermission("manage_crop_cycle"))) {
		return {
			kind: "clarify",
			text: "You do not have permission to manage grow-out cycles.",
		};
	}

	const growOutDays = daysBetween(stockingDate as string, targetHarvestDate as string);
	const input = {
		pondId: params.pondId,
		label: textArg(args.label),
		stockingDate,
		stockingCount,
		stockingAvgWeightG,
		growOutDays,
		targetHarvestDate,
		targetHarvestWeightG,
		expectedSurvivalPct,
		notes: textArg(args.notes),
	};
	const parsed = cropCycleInputSchema.safeParse(input);
	if (!parsed.success) {
		return { kind: "clarify", text: formatZodError(parsed.error) };
	}

	return {
		kind: "action",
		text: "Here is the cycle I will create. Review and confirm.",
		action: {
			type: "create_crop_cycle",
			summary: `Create ${parsed.data.label ?? "a grow-out cycle"} for ${params.pondName}: ${parsed.data.stockingDate} → ${parsed.data.targetHarvestDate} (${growOutDays} days), ${parsed.data.stockingCount} fish, target ${parsed.data.targetHarvestWeightG}g. This also creates the stocking and harvest calendar events.`,
			fields: previewFields({
				pondName: params.pondName,
				stockingDate: parsed.data.stockingDate,
				targetHarvestDate: parsed.data.targetHarvestDate,
				stockingCount: parsed.data.stockingCount,
				stockingAvgWeightG: parsed.data.stockingAvgWeightG ?? null,
				targetHarvestWeightG: parsed.data.targetHarvestWeightG ?? 0,
				expectedSurvivalPct: parsed.data.expectedSurvivalPct ?? 85,
				areaM2: params.areaM2,
			}),
			args: parsed.data as unknown as Record<string, unknown>,
		},
	};
}

async function buildUpdatePreview(
	args: Record<string, unknown>,
	params: {
		pondId: string;
		pondName: string;
		areaM2: number | null;
		activeCycle: ActiveCycle | null;
	},
): Promise<AgentPlannerResult> {
	if (!params.activeCycle) {
		return { kind: "clarify", text: "There is no active grow-out cycle to update." };
	}
	if (!(await hasPermission("manage_crop_cycle"))) {
		return {
			kind: "clarify",
			text: "You do not have permission to manage grow-out cycles.",
		};
	}

	const merged = {
		pondId: params.pondId,
		label: args.label !== undefined ? textArg(args.label) : params.activeCycle.label,
		stockingDate: textArg(args.stockingDate) ?? params.activeCycle.stockingDate,
		stockingCount: intArg(args.stockingCount) ?? params.activeCycle.stockingCount,
		stockingAvgWeightG:
			args.stockingAvgWeightG !== undefined
				? numberArg(args.stockingAvgWeightG)
				: params.activeCycle.stockingAvgWeightG,
		growOutDays: 0,
		targetHarvestDate: textArg(args.targetHarvestDate) ?? params.activeCycle.targetHarvestDate,
		targetHarvestWeightG:
			args.targetHarvestWeightG !== undefined
				? numberArg(args.targetHarvestWeightG)
				: params.activeCycle.targetHarvestWeightG,
		expectedSurvivalPct:
			args.expectedSurvivalPct !== undefined
				? numberArg(args.expectedSurvivalPct)
				: params.activeCycle.expectedSurvivalPct,
		notes: args.notes !== undefined ? textArg(args.notes) : params.activeCycle.notes,
	};
	if (!isValidDateOnly(merged.stockingDate) || !isValidDateOnly(merged.targetHarvestDate)) {
		return { kind: "clarify", text: "Use YYYY-MM-DD for the stocking and harvest dates." };
	}
	merged.growOutDays = daysBetween(merged.stockingDate, merged.targetHarvestDate);
	const parsed = cropCycleInputSchema.safeParse(merged);
	if (!parsed.success) {
		return { kind: "clarify", text: formatZodError(parsed.error) };
	}

	return {
		kind: "action",
		text: "Here is the updated cycle. Review and confirm.",
		action: {
			type: "update_crop_cycle",
			summary: `Update ${parsed.data.label ?? "the active cycle"} for ${params.pondName}: ${parsed.data.stockingDate} → ${parsed.data.targetHarvestDate}, ${parsed.data.stockingCount} fish, target ${parsed.data.targetHarvestWeightG ?? "not set"}g.`,
			fields: previewFields({
				pondName: params.pondName,
				stockingDate: parsed.data.stockingDate,
				targetHarvestDate: parsed.data.targetHarvestDate,
				stockingCount: parsed.data.stockingCount,
				stockingAvgWeightG: parsed.data.stockingAvgWeightG ?? null,
				targetHarvestWeightG: parsed.data.targetHarvestWeightG ?? 0,
				expectedSurvivalPct: parsed.data.expectedSurvivalPct ?? 100,
				areaM2: params.areaM2,
			}),
			args: { cycleId: params.activeCycle.id, ...parsed.data } as unknown as Record<
				string,
				unknown
			>,
		},
	};
}

function buildApplyPreview(
	args: Record<string, unknown>,
	plan: GrowthPlan | null,
	pondId: string,
): AgentPlannerResult {
	if (
		!plan ||
		plan.status === "noCycle" ||
		plan.status === "noTarget" ||
		plan.status === "noWeight"
	) {
		return {
			kind: "clarify",
			text: "There is no target plan ready to apply yet. Start a cycle with a target weight and log a biomass sample first.",
		};
	}
	if (!plan.adjustmentAllowed || plan.applicableGramsPerFeeding === null) {
		if (plan.adjustmentBlock === "adjustmentWindow" && plan.nextAdjustmentDate) {
			return {
				kind: "clarify",
				text: `The last adjustment was too recent. The next one is available on ${plan.nextAdjustmentDate}.`,
			};
		}
		if (plan.adjustmentBlock === "deviceCap") {
			return {
				kind: "clarify",
				text: "The target needs more feed per meal than the feeder supports. Add meals or a second feeder.",
			};
		}
		return { kind: "clarify", text: "The plan is not ready for an adjustment yet." };
	}

	const safeApplicable = plan.applicableGramsPerFeeding;
	const requested = numberArg(args.grams) ?? safeApplicable;
	if (!Number.isFinite(requested) || requested < 1) {
		return { kind: "clarify", text: "The feeding amount must be at least 1g per meal." };
	}
	const current = plan.currentGramsPerFeeding;
	if (current !== null && current > 0) {
		const deviation = Math.abs(requested - current) / current;
		if (deviation > plan.maxChangePct + 1e-9) {
			return {
				kind: "clarify",
				text: `A single adjustment is limited to ${plan.maxChangePct * 100}%. The safe amount is ${safeApplicable.toFixed(1)}g.`,
			};
		}
	}
	if (requested > plan.device.maxGramsPerFeeding) {
		return {
			kind: "clarify",
			text: `The feeder limit is ${plan.device.maxGramsPerFeeding}g per meal.`,
		};
	}

	return {
		kind: "action",
		text: "Here is the feeding adjustment. Review and confirm.",
		action: {
			type: "apply_growth_plan",
			summary: `Change the feeder from ${current?.toFixed(1) ?? "—"}g to ${requested.toFixed(1)}g per meal (${plan.adjustmentPct !== null ? `${plan.adjustmentPct > 0 ? "+" : ""}${plan.adjustmentPct.toFixed(1)}%` : "safe step"}). The next adjustment is available after 15 days.`,
			fields: [
				{ label: "Current", value: `${current?.toFixed(1) ?? "—"} g/meal` },
				{ label: "New", value: `${requested.toFixed(1)} g/meal` },
				{
					label: "Target plan",
					value: `${plan.targetWeightG ?? "—"}g by ${plan.targetDate ?? "—"}`,
				},
				{ label: "Confidence", value: plan.confidence },
				{ label: "FCR assumption", value: String(plan.feed.fcrAssumption) },
			],
			args: { grams: requested, pondId },
		},
	};
}

/**
 * Turn a natural-language action request into a validated preview. The model
 * only extracts intent and arguments; every number and date is revalidated
 * here and again when the user confirms.
 */
export async function planAgentAction(params: {
	message: string;
	history: HistoryTurn[];
	locale: string;
	ownerId: string;
	context: ChatContext | null;
	plan: GrowthPlan | null;
	pondId: string;
	pondName: string;
	areaM2: number | null;
	averageDepthM: number | null;
}): Promise<AgentPlannerResult> {
	const active = await prisma.cropCycle.findFirst({
		where: { pondId: params.pondId, status: "ACTIVE" },
		select: {
			id: true,
			label: true,
			stockingDate: true,
			stockingCount: true,
			stockingAvgWeightG: true,
			targetHarvestDate: true,
			targetHarvestWeightG: true,
			expectedSurvivalPct: true,
			notes: true,
		},
	});
	const activeCycle: ActiveCycle | null = active
		? {
				id: active.id,
				label: active.label,
				stockingDate: dateOnly(active.stockingDate),
				stockingCount: active.stockingCount,
				stockingAvgWeightG: active.stockingAvgWeightG,
				targetHarvestDate: dateOnly(active.targetHarvestDate),
				targetHarvestWeightG: active.targetHarvestWeightG,
				expectedSurvivalPct: active.expectedSurvivalPct,
				notes: active.notes,
			}
		: null;

	const decision = await askPlanner({
		message: params.message,
		history: params.history,
		ownerId: params.ownerId,
		locale: params.locale,
		today: todayDateOnly(),
		context: params.context,
		plan: params.plan,
		activeCycle,
		activeCycleId: activeCycle?.id ?? null,
		densityAreaM2: params.areaM2,
		averageDepthM: params.averageDepthM,
	});
	if (!decision || decision.kind === "answer") return { kind: "fallback" };
	if (decision.kind === "clarify") {
		return {
			kind: "clarify",
			text: decision.reply?.trim() || "I need a little more information to do that.",
		};
	}
	const args = decision.args ?? {};
	if (decision.kind === "create_crop_cycle") {
		return buildCreatePreview(args, {
			pondId: params.pondId,
			pondName: params.pondName,
			areaM2: params.areaM2,
			activeCycleId: activeCycle?.id ?? null,
		});
	}
	if (decision.kind === "update_crop_cycle") {
		return buildUpdatePreview(args, {
			pondId: params.pondId,
			pondName: params.pondName,
			areaM2: params.areaM2,
			activeCycle,
		});
	}
	return buildApplyPreview(args, params.plan, params.pondId);
}
