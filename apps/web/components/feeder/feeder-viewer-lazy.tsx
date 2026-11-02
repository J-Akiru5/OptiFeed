"use client";

import { FeederFallback } from "@/components/feeder/feeder-fallback";
import { DEFAULT_DEVICE_STATUS_POLICY } from "@/lib/device-status";
import {
	type FeederStatus,
	type FeederViewerTier,
	chooseViewerTier,
} from "@/lib/feeder/feeder-parts";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { Component, type ReactNode, useEffect, useRef, useState } from "react";

const FeederViewer = dynamic(
	() => import("./feeder-viewer").then((module) => module.FeederViewer),
	{
		ssr: false,
		loading: () => <ViewerSkeleton />,
	},
);

interface FeederViewerLazyProps {
	deviceId: string;
	label: string;
	initialStatus: FeederStatus;
	initialLevel: number | null;
	initialLastFedAt: string | null;
	/** Water-temperature probe health; null when never reported. */
	initialWaterTempOk: boolean | null;
	/** Last calibrated temperature the probe reported. */
	initialWaterTempC: number | null;
	/** When the probe last reported; null when it never did. */
	initialWaterTempUpdatedAt: string | null;
	/** RTC health as last reported. */
	initialRtcOk: boolean | null;
	/** When the unit last checked in; the freshness basis for the RTC bit. */
	initialLastSeenAt: string | null;
	/** Reading freshness window, from the device status policy. */
	staleAfterMs?: number;
}

interface StatePayload {
	status: FeederStatus;
	feedLevelPercent: number | null;
	lastFedAt: string | null;
	waterTempOk: boolean;
	waterTempC: number | null;
	waterTempUpdatedAt: string | null;
	rtcOk: boolean;
	lastSeenAt: string | null;
}

/** The client copy: health stays nullable because "not reported" is a state. */
type ViewerState = Omit<StatePayload, "waterTempOk" | "rtcOk"> & {
	waterTempOk: boolean | null;
	rtcOk: boolean | null;
};

type NavigatorWithHints = Navigator & {
	deviceMemory?: number;
	connection?: { saveData?: boolean };
};

function ViewerSkeleton() {
	return (
		<div
			className="h-[420px] animate-pulse rounded-3xl border border-[#0A3D62]/10 bg-[#0B2336]"
			aria-hidden="true"
			data-testid="feeder-viewer-skeleton"
		/>
	);
}

class ViewerBoundary extends Component<
	{ fallback: ReactNode; children: ReactNode },
	{ failed: boolean }
> {
	state = { failed: false };

	static getDerivedStateFromError() {
		return { failed: true };
	}

	render() {
		return this.state.failed ? this.props.fallback : this.props.children;
	}
}

function detectTier(): FeederViewerTier {
	try {
		const canvas = document.createElement("canvas");
		const gl = canvas.getContext("webgl2");
		const debug = gl?.getExtension("WEBGL_debug_renderer_info");
		const renderer = debug ? String(gl?.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : "";
		const nav = navigator as NavigatorWithHints;
		return chooseViewerTier({
			webgl2: Boolean(gl),
			renderer,
			deviceMemory: nav.deviceMemory,
			hardwareConcurrency: nav.hardwareConcurrency,
			saveData: Boolean(nav.connection?.saveData),
		});
	} catch {
		return "low";
	}
}

/**
 * Defers the three.js chunk until the viewer is near the viewport and the
 * device can actually render it. Low-tier devices get the illustrated view
 * immediately; a runtime WebGL failure also falls back rather than blanking.
 */
export function FeederViewerLazy({
	deviceId,
	label,
	initialStatus,
	initialLevel,
	initialLastFedAt,
	initialWaterTempOk,
	initialWaterTempC,
	initialWaterTempUpdatedAt,
	initialRtcOk,
	initialLastSeenAt,
	staleAfterMs = DEFAULT_DEVICE_STATUS_POLICY.offlineAfterMs,
}: FeederViewerLazyProps) {
	const t = useTranslations("dashboard.feederViewer");
	const locale = useLocale();
	const hostRef = useRef<HTMLDivElement>(null);
	const [visible, setVisible] = useState(false);
	const [tier, setTier] = useState<FeederViewerTier | null>(null);
	const [simple, setSimple] = useState(false);
	const [state, setState] = useState<ViewerState>({
		status: initialStatus,
		feedLevelPercent: initialLevel,
		lastFedAt: initialLastFedAt,
		waterTempOk: initialWaterTempOk,
		waterTempC: initialWaterTempC,
		waterTempUpdatedAt: initialWaterTempUpdatedAt,
		rtcOk: initialRtcOk,
		lastSeenAt: initialLastSeenAt,
	});

	useEffect(() => {
		setTier(detectTier());
	}, []);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					setVisible(true);
					observer.disconnect();
				}
			},
			{ rootMargin: "240px" },
		);
		observer.observe(host);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		let active = true;
		const poll = async () => {
			if (document.visibilityState !== "visible") return;
			try {
				const response = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/state`, {
					headers: { accept: "application/json" },
					cache: "no-store",
				});
				if (!response.ok) return;
				const body = (await response.json()) as { data?: StatePayload };
				if (!active || !body.data) return;
				const next = body.data;
				setState({
					status: next.status,
					feedLevelPercent: next.feedLevelPercent,
					lastFedAt: next.lastFedAt,
					// `waterTempOk` is only meaningful once the probe has reported;
					// the column defaults to false, so a never-reported probe stays
					// "unknown" instead of turning into a fault on the first poll.
					waterTempOk: next.waterTempUpdatedAt ? next.waterTempOk : null,
					waterTempC: next.waterTempC,
					waterTempUpdatedAt: next.waterTempUpdatedAt,
					rtcOk: next.rtcOk,
					lastSeenAt: next.lastSeenAt,
				});
			} catch {
				// Keep the last known reading; the next tick retries.
			}
		};
		void poll();
		const timer = window.setInterval(poll, 15_000);
		return () => {
			active = false;
			window.clearInterval(timer);
		};
	}, [deviceId]);

	const lastFedLabel = state.lastFedAt
		? new Intl.DateTimeFormat(locale, {
				month: "short",
				day: "numeric",
				hour: "numeric",
				minute: "2-digit",
			}).format(new Date(state.lastFedAt))
		: null;

	const fallback = (
		<FeederFallback
			label={label}
			status={state.status}
			feedLevelPercent={state.feedLevelPercent}
			lastFedLabel={lastFedLabel}
			waterTempOk={state.waterTempOk}
			waterTempC={state.waterTempC}
			waterTempUpdatedAt={state.waterTempUpdatedAt}
			rtcOk={state.rtcOk}
			lastSeenAt={state.lastSeenAt}
			staleAfterMs={staleAfterMs}
		/>
	);

	// #626: the simple view is a choice on a capable device, so it needs a way
	// back. The forced fallbacks (no WebGL, or the 3D scene crashed) do not get
	// the button, because there is nothing for them to return to.
	const simpleFallback = (
		<FeederFallback
			label={label}
			status={state.status}
			feedLevelPercent={state.feedLevelPercent}
			lastFedLabel={lastFedLabel}
			waterTempOk={initialWaterTempOk}
			rtcOk={initialRtcOk}
			onBackToViewer={() => setSimple(false)}
		/>
	);

	return (
		<div ref={hostRef} className="min-w-0">
			{tier === null || !visible ? (
				<ViewerSkeleton />
			) : tier === "low" ? (
				fallback
			) : simple ? (
				simpleFallback
			) : (
				<ViewerBoundary fallback={fallback}>
					<FeederViewer
						label={label}
						status={state.status}
						feedLevelPercent={state.feedLevelPercent}
						lastFedLabel={lastFedLabel}
						waterTempOk={state.waterTempOk}
						waterTempC={state.waterTempC}
						waterTempUpdatedAt={state.waterTempUpdatedAt}
						rtcOk={state.rtcOk}
						lastSeenAt={state.lastSeenAt}
						staleAfterMs={staleAfterMs}
						onSimpleView={() => setSimple(true)}
					/>
				</ViewerBoundary>
			)}
			<p className={cn("mt-2 text-[11px] text-[#3D5568] dark:text-gray-400", simple && "sr-only")}>
				{t("isoLabelsTip")}
			</p>
		</div>
	);
}
