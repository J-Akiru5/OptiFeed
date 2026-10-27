import type { MascotPose } from "@/components/assistant/mascot";
import type { TourAlign, TourSide } from "./onboarding-position";

export type OnboardingTourStep = {
	/** `null` means the step is centred instead of anchored to an element. */
	selector: string | null;
	title: string;
	description: string;
	side: TourSide;
	align: TourAlign;
	/** Optional Pakoy art shown above the step's title (#221). */
	mascot?: MascotPose;
};

/**
 * Ordered top to bottom to match the dashboard layout: header action first,
 * then the feeding snapshot tiles, then the sidebar settings entry.
 */
export const ONBOARDING_TOUR_STEPS: OnboardingTourStep[] = [
	{
		selector: null,
		title: "Welcome to PakaonAI",
		description:
			"Let's set up your pond! This dashboard monitors your fish feeding system in real-time.",
		side: "bottom",
		align: "center",
		mascot: "hero",
	},
	{
		selector: "[data-onboard='feed-now']",
		title: "Feed Now",
		description: "Manually trigger a feeding anytime from here.",
		side: "bottom",
		align: "center",
	},
	{
		selector: "[data-onboard='next-feeding']",
		title: "Next Feeding",
		description: "See when the next feeding is scheduled and the volume to dispense.",
		side: "bottom",
		align: "center",
	},
	{
		selector: "[data-onboard='fcr']",
		title: "FCR Tracking",
		description: "Monitor your Feed Conversion Ratio — the key metric for feeding efficiency.",
		side: "bottom",
		align: "center",
	},
	{
		selector: "[data-onboard='settings']",
		title: "Settings",
		description: "Configure your feeding schedule, notification preferences, and more.",
		side: "right",
		align: "center",
	},
];
