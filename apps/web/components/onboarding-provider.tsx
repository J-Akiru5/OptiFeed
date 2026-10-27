"use client";

import "driver.js/dist/driver.css";
import type { DriveStep, Driver } from "driver.js";
import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import {
	type TourAlign,
	type TourRect,
	type TourSide,
	computeTourPopoverPosition,
} from "./onboarding-position";
import { ONBOARDING_TOUR_STEPS } from "./onboarding-tour-steps";

const STORAGE_KEY = "optifeed:onboarded";
const VIEWPORT_MARGIN = 12;

type StepData = { side: TourSide; align: TourAlign };
type PopoverState = { wrapper: HTMLElement } | undefined;

const OnboardingContext = createContext<{ startTour: () => void }>({
	startTour: () => {},
});

export function useOnboarding() {
	return useContext(OnboardingContext);
}

function toRect(rect: DOMRect): TourRect {
	return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

function elementRect(element: Element | null): TourRect | null {
	if (!element || element.id === "driver-dummy-element") return null;
	const rect = element.getBoundingClientRect();
	// A target hidden at this width (for example the desktop sidebar on a
	// phone) has no usable position, so the card is centred instead.
	if (rect.width <= 0 || rect.height <= 0) return null;
	return toRect(rect);
}

function fabAvoidRect(): TourRect | null {
	const help = document.querySelector<HTMLElement>('[aria-label="Start onboarding tour"]');
	const cluster = help?.parentElement;
	if (!cluster) return null;
	const rect = cluster.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) return null;
	return toRect(rect);
}

function resolveTarget(selector: string | null): Element | null {
	if (!selector) return null;
	return document.querySelector(selector);
}

function applyPopoverPosition(
	wrapper: HTMLElement,
	target: Element | null,
	side: TourSide,
	align: TourAlign,
) {
	const viewport = { width: window.innerWidth, height: window.innerHeight };
	wrapper.style.maxHeight = `${Math.max(120, viewport.height - VIEWPORT_MARGIN * 2)}px`;
	wrapper.style.overflowY = "auto";

	const popoverRect = wrapper.getBoundingClientRect();
	const fab = fabAvoidRect();
	const position = computeTourPopoverPosition({
		target: elementRect(target),
		popover: { width: popoverRect.width, height: popoverRect.height },
		viewport,
		preferredSide: side,
		align,
		margin: VIEWPORT_MARGIN,
		avoid: fab ? [fab] : [],
	});

	const roundedLeft = Math.round(position.left);
	const roundedTop = Math.round(position.top);
	wrapper.style.position = "fixed";
	wrapper.style.left = `${roundedLeft}px`;
	wrapper.style.top = `${roundedTop}px`;
	wrapper.style.right = "auto";
	wrapper.style.bottom = "auto";

	const arrow = wrapper.querySelector<HTMLElement>(".driver-popover-arrow");
	if (!arrow) return;

	for (const className of [...arrow.classList]) {
		if (className.startsWith("driver-popover-arrow-side-")) arrow.classList.remove(className);
	}
	arrow.style.left = "";
	arrow.style.right = "";
	arrow.style.top = "";
	arrow.style.bottom = "";

	if (position.placement === "center") {
		arrow.classList.add("driver-popover-arrow-none");
		return;
	}

	arrow.classList.remove("driver-popover-arrow-none");
	arrow.classList.add(`driver-popover-arrow-side-${position.placement}`);
	if (position.placement === "top" || position.placement === "bottom") {
		arrow.style.left = `${Math.round(position.arrowOffset)}px`;
	} else {
		arrow.style.top = `${Math.round(position.arrowOffset)}px`;
	}
}

function positionFromDriver(driverObj: Driver) {
	const popover = driverObj.getState("popover") as PopoverState;
	const data = driverObj.getActiveStep()?.data as StepData | undefined;
	if (!popover?.wrapper || !data) return;
	applyPopoverPosition(
		popover.wrapper,
		driverObj.getActiveElement() ?? null,
		data.side,
		data.align,
	);
}

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
	const hasRun = useRef(false);

	const startTour = useCallback(async () => {
		const { driver } = await import("driver.js");
		let detach = () => {};

		const driverObj = driver({
			showProgress: true,
			allowClose: true,
			steps: ONBOARDING_TOUR_STEPS.map((step) => ({
				element: step.selector ?? undefined,
				data: { side: step.side, align: step.align } satisfies StepData,
				popover: {
					title: step.title,
					description: step.description,
					side: step.side,
					align: step.align,
					onPopoverRender: (popover) => {
						// driver.js positions the popover immediately after this hook,
						// so re-apply on the next frame to win without a visible jump.
						requestAnimationFrame(() => {
							if (popover.wrapper.isConnected) {
								applyPopoverPosition(
									popover.wrapper,
									resolveTarget(step.selector),
									step.side,
									step.align,
								);
							}
						});
					},
				},
				onHighlighted: (element, activeStep: DriveStep) => {
					const data = activeStep.data as StepData | undefined;
					const popover = driverObj.getState("popover") as PopoverState;
					if (!popover?.wrapper || !data) return;
					applyPopoverPosition(popover.wrapper, element ?? null, data.side, data.align);
				},
			})),
			onDestroyStarted: () => {
				detach();
				driverObj.destroy();
				localStorage.setItem(STORAGE_KEY, "true");
			},
		});

		let frame = 0;
		const schedule = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => positionFromDriver(driverObj));
		};
		window.addEventListener("resize", schedule);
		window.addEventListener("scroll", schedule);
		detach = () => {
			cancelAnimationFrame(frame);
			window.removeEventListener("resize", schedule);
			window.removeEventListener("scroll", schedule);
		};

		driverObj.drive();
		schedule();
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
