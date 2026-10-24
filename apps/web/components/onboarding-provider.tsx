"use client";

import "driver.js/dist/driver.css";
import { useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useEffect, useRef } from "react";

const STORAGE_KEY = "optifeed:onboarded";

const OnboardingContext = createContext<{ startTour: () => void }>({
	startTour: () => {},
});

export function useOnboarding() {
	return useContext(OnboardingContext);
}

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
	const hasRun = useRef(false);

	const startTour = useCallback(async () => {
		const { driver } = await import("driver.js");
		const t = (key: string) => {
			const translations: Record<string, string> = {
				"step1.title": "Welcome to OptiFeed",
				"step1.desc":
					"This dashboard monitors your fish feeding system in real-time. Let's take a quick tour.",
				"step2.title": "Next Feeding",
				"step2.desc": "See when the next feeding is scheduled and the volume to dispense.",
				"step3.title": "Feed Now",
				"step3.desc": "Manually trigger a feeding anytime from here.",
				"step4.title": "FCR Tracking",
				"step4.desc": "Monitor your Feed Conversion Ratio — the key metric for feeding efficiency.",
				"step5.title": "Settings",
				"step5.desc": "Configure your feeding schedule, notification preferences, and more.",
			};
			return translations[key] ?? key;
		};

		const driverObj = driver({
			showProgress: true,
			allowClose: true,
			steps: [
				{
					element: "[data-onboard='welcome']",
					popover: {
						title: t("step1.title"),
						description: t("step1.desc"),
						side: "bottom",
						align: "start",
					},
				},
				{
					element: "[data-onboard='next-feeding']",
					popover: { title: t("step2.title"), description: t("step2.desc"), side: "bottom" },
				},
				{
					element: "[data-onboard='feed-now']",
					popover: { title: t("step3.title"), description: t("step3.desc"), side: "left" },
				},
				{
					element: "[data-onboard='fcr']",
					popover: { title: t("step4.title"), description: t("step4.desc"), side: "right" },
				},
				{
					element: "[data-onboard='settings']",
					popover: { title: t("step5.title"), description: t("step5.desc"), side: "bottom" },
				},
			],
			onDestroyStarted: () => {
				driverObj.destroy();
				localStorage.setItem(STORAGE_KEY, "true");
			},
			onHighlighted: () => {},
		});

		driverObj.drive();
	}, []);

	useEffect(() => {
		if (hasRun.current) return;
		hasRun.current = true;
		const done = localStorage.getItem(STORAGE_KEY);
		if (!done) {
			const timer = setTimeout(() => {
				void startTour();
			}, 1500);
			return () => clearTimeout(timer);
		}
	}, [startTour]);

	return <OnboardingContext.Provider value={{ startTour }}>{children}</OnboardingContext.Provider>;
}
