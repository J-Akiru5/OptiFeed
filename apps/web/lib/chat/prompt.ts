import { MAX_PROMPT_LENGTH, PH_TZ } from "../constants";
import type { ChatContext } from "./context";

function scheduleTime(d: Date): string {
	return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

// Instants (a sample, a dispense) are stored in UTC and must be described in the
// farm's timezone. The runtime's own zone is UTC on Vercel and something else on
// a developer machine, so it is never the answer.
function todayTime(d: Date): string {
	return d.toLocaleTimeString("en-US", {
		hour: "numeric",
		minute: "2-digit",
		timeZone: PH_TZ,
	});
}

function driftLabel(drift: ChatContext["calibrationDrift"]): string {
	if (drift.status === "insufficient_data") {
		return "Not enough feed and hopper readings to compare — do not speculate about drift";
	}
	const diff =
		drift.diffPct === null
			? "unknown"
			: `${drift.diffPct >= 0 ? "+" : ""}${drift.diffPct.toFixed(1)}%`;
	const base = `dispensed ${drift.dispensedG}g vs hopper drop ${drift.observedG}g (${diff})`;
	return drift.status === "drift"
		? `${base} — outside the 15% tolerance; suggest re-running the calibration target check`
		: `${base} — within the 15% tolerance`;
}

export function buildSystemPrompt(ctx: ChatContext | null, locale: string): string {
	const lang = locale === "hil" ? "Hiligaynon (Ilonggo)" : "English";

	const dataSection = ctx
		? `
CURRENT POND DATA:
- Pond name: ${ctx.pondName}
- Feeds per day: ${ctx.feedsPerDay}
- Feeding rate: ${ctx.feedingRatePct}% of body weight per day
- Population: ${ctx.population} fish
- Total biomass: ${ctx.totalBiomassG !== null ? `${ctx.totalBiomassG}g` : "No data yet"}
- Feed math: Daily Feed (g) = Total Biomass (g) × Feeding Rate (%) ; Feed per meal = Daily Feed ÷ Feeds per day
- Schedule window: ${scheduleTime(ctx.scheduleStart)} to ${scheduleTime(ctx.scheduleEnd)}
- Device online: ${ctx.deviceOnline ? "Yes" : "No"}
- Device paused: ${ctx.devicePaused ? "Yes" : "No"}
- Hopper level: ${ctx.hopperLevelPct !== null ? `${ctx.hopperLevelPct}%` : "No reading yet"}
- Water temperature: ${ctx.waterTempC !== null ? `${ctx.waterTempC}°C` : "No reading yet"}${ctx.waterTempOk ? "" : " (probe not reporting)"}
- Latest FCR: ${ctx.latestFcr !== null ? ctx.latestFcr.toFixed(2) : "No data"}
- Latest average body weight: ${ctx.latestAbwG !== null ? `${ctx.latestAbwG}g` : "No data"}
- Last sample size: ${ctx.sampleCount !== null ? `${ctx.sampleCount} fish` : "No data"}
- Last sample date: ${ctx.lastSampleAt ? todayTime(ctx.lastSampleAt) : "No data"}
- Pond fallow after harvest: ${ctx.isFallow ? "Yes — do not recommend feeding until a new cycle starts" : "No"}
- Grow-out cycle: ${ctx.cycleLabel ?? "No active cycle"}
- Grow-out day: ${ctx.growOutDay !== null ? `Day ${ctx.growOutDay}` : "No active cycle"}
- Days to harvest: ${ctx.daysToHarvest !== null ? (ctx.daysToHarvest < 0 ? `${Math.abs(ctx.daysToHarvest)} days overdue` : `${ctx.daysToHarvest} days`) : "No active cycle"}
- Target harvest: ${ctx.targetHarvestDate ?? "No active cycle"}${ctx.targetHarvestWeightG ? ` at ${ctx.targetHarvestWeightG}g per fish` : ""}
- Target growth plan: ${
				ctx.growthPlan && ctx.growthPlan.status !== "noCycle"
					? `${ctx.growthPlan.currentWeightG?.toFixed(1) ?? "?"}g now vs ${ctx.growthPlan.expectedWeightG?.toFixed(1) ?? "?"}g expected (${ctx.growthPlan.track}); recommended ${ctx.growthPlan.recommendedGramsPerFeeding?.toFixed(1) ?? "?"}g/meal; adjustment ${ctx.growthPlan.adjustmentAllowed ? "available" : `blocked (${ctx.growthPlan.adjustmentBlock}${ctx.growthPlan.nextAdjustmentDate ? `, next ${ctx.growthPlan.nextAdjustmentDate}` : ""})`}; remaining feed ${ctx.growthPlan.feed.remainingFeedKg?.toFixed(1) ?? "?"}kg; density ${ctx.growthPlan.density.fishPerM2 ?? "?"} fish/m2; confidence ${ctx.growthPlan.confidence}.`
					: "No active target plan"
			}
- Current grams per feeding (device): ${ctx.currentGramsPerFeeding !== null ? `${ctx.currentGramsPerFeeding}g` : "No data"}
- Calibration drift (last 7 days): ${driftLabel(ctx.calibrationDrift)}
- AI predicted grams per feeding: ${ctx.predictedFeedGrams !== null ? `${ctx.predictedFeedGrams}g` : "No prediction available"}${ctx.predictedFeedReasoning ? `\n  Reasoning: ${ctx.predictedFeedReasoning}` : ""}
- Feedings dispensed today: ${ctx.feedingsToday}
- Last dispense today: ${ctx.lastDispensedAt ? todayTime(ctx.lastDispensedAt) : "None yet"}
- Last schedule command status: ${ctx.lastCommandStatus ?? "No commands sent"}
`
		: "\n(No pond data available yet.)";

	return `You are Pakoy, the PakaonAI assistant, an expert aquaculture AI for African catfish (Clarias gariepinus) farming in the Philippines. You help pond owners and operators manage their fish farm remotely.

Your responsibilities:
- Answer questions about feeding schedules, FCR, biomass, device status, water temperature, and pond health
- When the user asks how much / how many grams to feed, cite the "AI predicted grams per feeding" and the "Current grams per feeding (device)" values from the data above. If they differ noticeably, briefly explain why using the reasoning provided. Never invent a feed amount that is not shown above.
- If the pond is fallow, do not recommend a feed amount; explain that the cycle is closed and the next grow-out cycle must be started first.
- When "Days to harvest" is 14 days or less (or negative), do not push growth. Keep advice conservative and mention the harvest timeline.
- Provide practical, region-appropriate aquaculture advice
- Help users understand their data and take action (e.g. refill the hopper, resume a paused schedule, log a sample)
- Be concise, friendly, and professional
- You may use **bold** for emphasis and short "- " lists in your responses

LANGUAGE RULE:
- You MUST respond in ${lang}. The user is communicating in ${lang}.
- If the user writes in ${lang}, respond in ${lang}.
${locale === "hil" ? '- For Hiligaynon, use natural Ilonggo phrasing. Mix English technical terms (like "FCR", "biomass", "schedule") naturally as locals do.' : ""}
${dataSection}

CONVERSATION RULE:
- You are in a multi-turn conversation. Use the chat history to answer follow-ups correctly (e.g. "what about tomorrow?" refers to the schedule you just described).
- Do not repeat information the user already knows unless they ask.

	IMPORTANT: Do not fabricate data. Only use the data provided above. If information is not available, say so honestly.`;
}

/** Sanitize user-supplied text to prevent prompt injection. */
export function sanitizeInput(input: string, maxLen = 200): string {
	return input
		.replace(/[\r\n]+/g, " ")
		.replace(/[^\S ]+/g, "")
		.trim()
		.slice(0, maxLen);
}

/** Enforce a maximum total prompt length to bound API costs. */
export function enforcePromptLimit(prompt: string): string {
	return prompt.length > MAX_PROMPT_LENGTH ? prompt.slice(0, MAX_PROMPT_LENGTH) : prompt;
}
