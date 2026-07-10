"use server";

import { formatDateTimeLocal } from "@/lib/date-local";
import { askGemini, isGeminiEnabled } from "@/lib/gemini";
import prisma from "@/lib/prisma";
import { getTranslations } from "next-intl/server";

async function buildPondContext() {
	const pond = await prisma.pond.findFirst({
		where: { ownerId: "demo-farmer-1" },
		include: {
			devices: {
				include: {
					feedingEvents: { orderBy: { scheduledTime: "desc" }, take: 10 },
				},
			},
			fcrReports: { orderBy: { periodEnd: "desc" }, take: 1 },
			biomassLogs: { orderBy: { recordedAt: "desc" }, take: 1 },
		},
	});

	if (!pond) return null;

	const device = pond.devices[0] ?? null;
	const latestFcr = pond.fcrReports[0] ?? null;
	const latestBiomass = pond.biomassLogs[0] ?? null;
	const events = device?.feedingEvents ?? [];
	const missedToday = events.filter((e) => e.status === "missed").length;
	const completedToday = events.filter((e) => e.status === "completed").length;

	return {
		pondName: pond.name,
		feedsPerDay: pond.feedsPerDay,
		feedingRatePct: pond.feedingRatePct,
		scheduleStart: pond.scheduleStart,
		scheduleEnd: pond.scheduleEnd,
		deviceOnline: device?.connectivity === "online",
		devicePaused: device?.isPaused ?? false,
		hopperLevelPct: device?.hopperLevelPct ?? 0,
		latestFcr: latestFcr?.fcrValue ?? null,
		latestAbw: latestBiomass ? latestBiomass.avgWeightKg * 1000 : null,
		sampleCount: latestBiomass?.sampleCount ?? null,
		missedToday,
		completedToday,
	};
}

function buildSystemPrompt(ctx: Awaited<ReturnType<typeof buildPondContext>>, locale: string) {
	const lang = locale === "hil" ? "Hiligaynon (Ilonggo)" : "English";
	const t = locale === "hil" ? "Hiligaynon" : "English";

	const scheduleTime = (d: Date) =>
		d.toLocaleTimeString(locale === "hil" ? "fil-PH" : "en-US", {
			hour: "numeric",
			minute: "2-digit",
		});

	const dataSection = ctx
		? `
CURRENT POND DATA:
- Pond name: ${ctx.pondName}
- Feeds per day: ${ctx.feedsPerDay}
- Feeding rate: ${ctx.feedingRatePct}% BW/day
- Schedule window: ${scheduleTime(ctx.scheduleStart)} to ${scheduleTime(ctx.scheduleEnd)}
- Device online: ${ctx.deviceOnline ? "Yes" : "No"}
- Device paused: ${ctx.devicePaused ? "Yes" : "No"}
- Hopper level: ${ctx.hopperLevelPct}%
- Latest FCR: ${ctx.latestFcr?.toFixed(2) ?? "No data"}
- Latest average body weight: ${ctx.latestAbw ? `${ctx.latestAbw}g` : "No data"}
- Last sample size: ${ctx.sampleCount ? `${ctx.sampleCount} fish` : "No data"}
- Feedings completed today: ${ctx.completedToday}
- Feedings missed today: ${ctx.missedToday}
`
		: "\n(No pond data available yet.)";

	return `You are OptiFeed Assistant, an expert aquaculture AI for catfish farming in the Philippines. You help pond owners and operators manage their fish farm remotely.

Your responsibilities:
- Answer questions about feeding schedules, FCR, biomass, device status, and pond health
- Provide practical aquaculture advice for African Catfish (Clarias gariepinus)
- Help users understand their data and take action
- Be concise, friendly, and professional
- You may use **bold** for emphasis in your responses

LANGUAGE RULE:
- You MUST respond in ${lang}. The user is communicating in ${lang}.
- If the user writes in ${lang}, respond in ${lang}.
${locale === "hil" ? '- For Hiligaynon, use natural Ilonggo phrasing. Mix English technical terms (like "FCR", "biomass", "schedule") naturally as locals do.' : ""}
${dataSection}

IMPORTANT: Do not fabricate data. Only use the data provided above. If information is not available, say so honestly.`;
}

export async function submitChatMessage(message: string, locale: string): Promise<string> {
	const lower = message.toLowerCase();
	const t = await getTranslations({ locale, namespace: "chat" });
	const tDates = await getTranslations({ locale, namespace: "dates" });

	try {
		// If Gemini is enabled, use LLM with pond context
		const geminiEnabled = isGeminiEnabled();
		console.log(`[Chat] Gemini enabled: ${geminiEnabled}`);

		if (geminiEnabled) {
			const ctx = await buildPondContext();
			const systemPrompt = buildSystemPrompt(ctx, locale);
			const geminiReply = await askGemini(message, systemPrompt);
			if (geminiReply) {
				console.log("[Chat] Gemini responded successfully");
				return geminiReply;
			}
			console.warn("[Chat] Gemini returned null, falling back to keyword assistant");
		}

		// Fallback: keyword-based intent detection (no API key or quota exceeded)
		// INTENT 1: Next feeding time
		const isScheduleIntent =
			locale === "hil"
				? lower.includes("masunod") ||
					lower.includes("iskedyul") ||
					lower.includes("pakaon") ||
					lower.includes("san-o")
				: lower.includes("next feed") ||
					lower.includes("when is the") ||
					lower.includes("feeding time") ||
					lower.includes("schedule");

		if (isScheduleIntent) {
			const pond = await prisma.pond.findFirst({
				where: { ownerId: "demo-farmer-1" },
				include: { devices: true },
			});
			if (!pond || pond.devices.length === 0) {
				return t("intentScheduleNoPond");
			}
			const device = pond.devices[0];
			if (device.isPaused) {
				return t("intentSchedulePaused");
			}

			const formatTime = (d: Date) => formatDateTimeLocal(d, tDates).time;
			return t("intentScheduleActive", {
				feedsPerDay: pond.feedsPerDay,
				startTime: formatTime(pond.scheduleStart),
				endTime: formatTime(pond.scheduleEnd),
			});
		}

		// INTENT 2: How to log a sample
		const isLogSampleIntent =
			locale === "hil"
				? lower.includes("lista") ||
					lower.includes("sampol") ||
					lower.includes("biomass") ||
					lower.includes("timbang")
				: lower.includes("log a sample") ||
					lower.includes("how to log") ||
					lower.includes("biomass") ||
					lower.includes("weigh");

		if (isLogSampleIntent) {
			return t("intentLogSample");
		}

		// INTENT 3: Current FCR
		const isFcrIntent =
			locale === "hil"
				? lower.includes("fcr") || lower.includes("feed conversion")
				: lower.includes("fcr") || lower.includes("feed conversion");

		if (isFcrIntent) {
			const pond = await prisma.pond.findFirst({
				where: { ownerId: "demo-farmer-1" },
				include: { fcrReports: { orderBy: { periodEnd: "desc" }, take: 1 } },
			});
			if (!pond || pond.fcrReports.length === 0) {
				return t("intentFcrNoData");
			}
			const latestFcr = pond.fcrReports[0].fcrValue.toFixed(2);
			return t("intentFcrActive", { fcr: latestFcr });
		}

		// INTENT 4: Missed feeding
		const isMissedIntent =
			locale === "hil"
				? lower.includes("miss") ||
					lower.includes("palpak") ||
					lower.includes("guba") ||
					lower.includes("wala") ||
					lower.includes("ngaa")
				: lower.includes("missed") || lower.includes("failed") || lower.includes("error");

		if (isMissedIntent) {
			const missedEvent = await prisma.feedingEvent.findFirst({
				where: { status: "missed" },
				orderBy: { scheduledTime: "desc" },
			});
			if (!missedEvent) {
				return t("intentMissedNoData");
			}
			const formatFull = (d: Date) => formatDateTimeLocal(d, tDates).full;
			return t("intentMissedActive", { time: formatFull(missedEvent.scheduledTime) });
		}

		// FALLBACK
		return t("fallback");
	} catch (error) {
		console.error("Chat Action Error:", error);
		return t("serverError");
	}
}
