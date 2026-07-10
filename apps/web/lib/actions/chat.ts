"use server";

import { formatDateTimeLocal } from "@/lib/date-local";
import prisma from "@/lib/prisma";
import { getTranslations } from "next-intl/server";

export async function submitChatMessage(message: string, locale: string): Promise<string> {
	const lower = message.toLowerCase();
	const t = await getTranslations({ locale, namespace: "chat" });
	const tDates = await getTranslations({ locale, namespace: "dates" });

	try {
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
