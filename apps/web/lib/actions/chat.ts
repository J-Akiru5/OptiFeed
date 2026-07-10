"use server";

import prisma from "@/lib/prisma";

export async function submitChatMessage(message: string): Promise<string> {
	const lower = message.toLowerCase();

	try {
		// INTENT 1: Next feeding time
		if (
			lower.includes("next feed") ||
			lower.includes("when is the") ||
			lower.includes("feeding time") ||
			lower.includes("schedule")
		) {
			const pond = await prisma.pond.findFirst({
				where: { ownerId: "demo-farmer-1" },
				include: { devices: true },
			});
			if (!pond || pond.devices.length === 0) {
				return "I couldn't find your pond schedule. Please ensure your devices are configured.";
			}
			const device = pond.devices[0];
			if (device.isPaused) {
				return "Your automated schedule is currently **Paused**. No feedings will occur until you resume it on the Schedule page.";
			}

			const formatTime = (d: Date) =>
				d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
			return `Your device is active and scheduled to feed **${pond.feedsPerDay} times per day** between **${formatTime(pond.scheduleStart)}** and **${formatTime(pond.scheduleEnd)}**.`;
		}

		// INTENT 2: How to log a sample
		if (
			lower.includes("log a sample") ||
			lower.includes("how to log") ||
			lower.includes("biomass") ||
			lower.includes("weigh")
		) {
			return "To log a new biomass sample:\n1. Navigate to the **Log Sample** tab in the sidebar.\n2. Enter the average weight and count of your sampled shrimp.\n3. The system will automatically calculate your new recommended daily feed volume based on your feeding rate!";
		}

		// INTENT 3: Current FCR
		if (lower.includes("fcr") || lower.includes("feed conversion")) {
			const pond = await prisma.pond.findFirst({
				where: { ownerId: "demo-farmer-1" },
				include: { fcrReports: { orderBy: { periodEnd: "desc" }, take: 1 } },
			});
			if (!pond || pond.fcrReports.length === 0) {
				return "I couldn't find any recent FCR reports for your pond.";
			}
			const latestFcr = pond.fcrReports[0].fcrValue.toFixed(2);
			return `Your most recent Feed Conversion Ratio (FCR) is **${latestFcr}**. You can view your full historical performance on the Growth tab.`;
		}

		// INTENT 4: Missed feeding
		if (lower.includes("missed") || lower.includes("failed") || lower.includes("error")) {
			const missedEvent = await prisma.feedingEvent.findFirst({
				where: { status: "missed" },
				orderBy: { scheduledTime: "desc" },
			});
			if (!missedEvent) {
				return "Good news! I don't see any recent missed feedings in your logs.";
			}
			return `I see a missed feeding event from ${missedEvent.scheduledTime.toLocaleString()}. Missed feedings usually occur when the **hopper is empty** or the device **loses its Wi-Fi connection** before dispensing. Please check the physical feeder.`;
		}

		// FALLBACK
		return 'I\'m your OptiFeed support assistant! You can ask me things like:\n- "When is the next feeding time?"\n- "What is my current FCR?"\n- "How do I log a sample?"\n- "Why was a feeding missed?"';
	} catch (error) {
		console.error("Chat Action Error:", error);
		return "Sorry, I ran into an error trying to fetch that data. Please try again.";
	}
}
