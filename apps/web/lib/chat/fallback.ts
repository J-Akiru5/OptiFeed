import { formatDateTimeLocal } from "@/lib/date-local";
import prisma from "@/lib/prisma";
import enMessages from "@/messages/en.json";
import hilMessages from "@/messages/hil.json";
import type { ChatContext } from "./context";

export type ChatTranslator = (key: string, values?: Record<string, string | number>) => string;

function getNested(obj: Record<string, unknown>, path: string): unknown {
	return path.split(".").reduce<unknown>((acc, key) => {
		if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
			return (acc as Record<string, unknown>)[key];
		}
		return undefined;
	}, obj);
}

// Loads a message namespace from the bundled JSON so the fallback intents work
// inside a Route Handler (no request config / getTranslations context).
export function createNamespaceTranslator(locale: string, namespace: string): ChatTranslator {
	const messages: Record<string, unknown> = locale === "hil" ? hilMessages : enMessages;

	const ns = (getNested(messages, namespace) ?? {}) as Record<string, unknown>;

	return (key, values) => {
		let template = typeof ns[key] === "string" ? (ns[key] as string) : key;
		if (values) {
			for (const [k, v] of Object.entries(values)) {
				template = template.split(`{${k}}`).join(String(v));
			}
		}
		return template;
	};
}

export async function runFallbackIntent(params: {
	message: string;
	locale: string;
	ownerId: string;
	ctx: ChatContext | null;
}): Promise<string> {
	const { message, locale, ownerId, ctx } = params;
	const lower = message.toLowerCase();
	const t = createNamespaceTranslator(locale, "chat");
	const tDates = createNamespaceTranslator(locale, "dates");

	const formatTime = (d: Date) => formatDateTimeLocal(d, tDates).time;
	const formatFull = (d: Date) => formatDateTimeLocal(d, tDates).full;

	// INTENT 1: How much feed / grams prediction.
	// Checked before the schedule intent because the Hiligaynon schedule
	// triggers include the generic word "pakaon", which also appears in
	// questions like "pila ka gramos ang akon ipakaon?"
	const isPredictIntent =
		locale === "hil"
			? lower.includes("magkado") ||
				lower.includes("pila") ||
				lower.includes("gramos") ||
				lower.includes("grames")
			: lower.includes("how much feed") ||
				lower.includes("how many grams") ||
				lower.includes("how much gram") ||
				lower.includes("predict") ||
				lower.includes("grams should");

	if (isPredictIntent) {
		if (!ctx || ctx.predictedFeedGrams === null) {
			return t("intentPredictNoData");
		}
		if (ctx.currentGramsPerFeeding !== null) {
			return t("intentPredictActive", {
				grams: ctx.predictedFeedGrams.toFixed(1),
				current: ctx.currentGramsPerFeeding.toFixed(1),
			});
		}
		return t("intentPredictActiveNoCurrent", { grams: ctx.predictedFeedGrams.toFixed(1) });
	}

	// INTENT 2: Next feeding time
	const isScheduleIntent =
		locale === "hil"
			? lower.includes("masunod") || lower.includes("iskedyul") || lower.includes("san-o")
			: lower.includes("next feed") ||
				lower.includes("when is the") ||
				lower.includes("feeding time") ||
				lower.includes("schedule");

	if (isScheduleIntent) {
		if (!ctx) {
			return t("intentScheduleNoPond");
		}
		if (ctx.devicePaused) {
			return t("intentSchedulePaused");
		}
		return t("intentScheduleActive", {
			feedsPerDay: ctx.feedsPerDay,
			startTime: formatTime(ctx.scheduleStart),
			endTime: formatTime(ctx.scheduleEnd),
		});
	}

	// INTENT 3: How to log a sample
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

	// INTENT 4: Current FCR
	const isFcrIntent = lower.includes("fcr") || lower.includes("feed conversion");

	if (isFcrIntent) {
		if (!ctx || ctx.latestFcr === null) {
			return t("intentFcrNoData");
		}
		return t("intentFcrActive", { fcr: ctx.latestFcr.toFixed(2) });
	}

	// INTENT 5: Missed/failed feeding
	const isMissedIntent =
		locale === "hil"
			? lower.includes("miss") ||
				lower.includes("palpak") ||
				lower.includes("guba") ||
				lower.includes("wala") ||
				lower.includes("ngaa")
			: lower.includes("missed") || lower.includes("failed") || lower.includes("error");

	if (isMissedIntent) {
		const failedEvent = await prisma.deviceStateEvent.findFirst({
			where: {
				eventType: "command_failed",
				device: { pond: { ownerId } },
			},
			orderBy: { createdAt: "desc" },
		});
		if (!failedEvent) {
			return t("intentMissedNoData");
		}
		return t("intentMissedActive", { time: formatFull(failedEvent.createdAt) });
	}

	// FALLBACK
	return t("fallback");
}
