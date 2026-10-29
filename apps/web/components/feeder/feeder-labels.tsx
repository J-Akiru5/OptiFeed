"use client";

import {
	FEEDER_LABEL_SLOTS,
	type FeederLabelSlot,
	projectFeederAnchors,
} from "@/lib/feeder/feeder-label-layout";
import {
	type FeederComponentId,
	type FeederComponentReading,
	type FeederStatus,
	feederComponentStatus,
} from "@/lib/feeder/feeder-parts";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";

export interface FeederLabelsProps {
	status: FeederStatus;
	level: number | null;
	active: boolean;
}

export const FEEDER_COMPONENT_STATUS_ID = "feeder-component-status";

type LabelTone = "live" | "active" | "paused" | "muted";
type ViewerTranslate = (key: string) => string;

const LABEL_INSET_PX = 16;
const LEADER_GAP_PX = 6;
const ANCHOR_EDGE_PX = 8;
const LABEL_STAGGER_MS = 35;
const LABEL_MAX_WIDTH_DESKTOP_PX = 168;
const LABEL_MAX_WIDTH_TABLET_PX = 144;

const TONE_COLOR: Record<LabelTone, string> = {
	live: "#4ADE80",
	active: "#FF9A70",
	paused: "#FBBF24",
	muted: "#9BAEC0",
};

const NAME_COLOR = "#A9C1D3";
const VALUE_COLOR = "#FFFFFF";
const ANCHOR_COLOR = "#FF8A5C";
const UNDERSTROKE_COLOR = "#061520";
const LEADER_COLOR = "rgba(255, 255, 255, 0.45)";
const TEXT_SHADOW = "0 1px 2px rgba(3, 12, 20, 0.55)";

const COMPONENT_NAME_KEYS: Record<FeederComponentId, string> = {
	hopper: "componentHopper",
	sensor: "componentSensor",
	controller: "componentController",
	motor: "componentMotor",
	auger: "componentAuger",
	outlet: "componentOutlet",
};

/** Fixed slots are art-directed; only the stagger follows their visual order. */
const VISUAL_SLOTS = [...FEEDER_LABEL_SLOTS].sort((a, b) => a.top - b.top);

const LABEL_STYLES = `
@keyframes ofd-feeder-iso-label-in {
  from { opacity: 0; transform: translateY(calc(-50% + 4px)) scale(0.98); }
  to { opacity: 1; transform: translateY(-50%) scale(1); }
}
@keyframes ofd-feeder-iso-leaders-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@media (prefers-reduced-motion: no-preference) {
  .ofd-feeder-iso-label {
    animation: ofd-feeder-iso-label-in 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  .ofd-feeder-iso-leaders {
    animation: ofd-feeder-iso-leaders-in 180ms ease-out 60ms both;
  }
}
@media (forced-colors: active) {
  .ofd-feeder-iso-dot {
    border: 1px solid CanvasText;
  }
}
`;

interface LabelState {
	statusKey: string;
	wordTone: LabelTone;
	dotTone: LabelTone;
	valueActive: boolean;
}

interface FeederLabelContent {
	name: string;
	value: string;
	status: string;
	wordTone: LabelTone;
	dotTone: LabelTone;
	valueActive: boolean;
}

function liveState(): LabelState {
	return { statusKey: "componentLive", wordTone: "live", dotTone: "live", valueActive: false };
}

function pausedState(): LabelState {
	return { statusKey: "statusPaused", wordTone: "paused", dotTone: "paused", valueActive: false };
}

function lastKnownState(): LabelState {
	return {
		statusKey: "componentLastKnown",
		wordTone: "paused",
		dotTone: "paused",
		valueActive: false,
	};
}

function noReadingState(): LabelState {
	return {
		statusKey: "componentNoReading",
		wordTone: "muted",
		dotTone: "muted",
		valueActive: false,
	};
}

function offlineState(): LabelState {
	return { statusKey: "statusOffline", wordTone: "muted", dotTone: "muted", valueActive: false };
}

/**
 * Map the shared component readings onto the five allowed status words.
 * The outlet is the only module whose dot takes the active material-flow tone.
 */
function readingState(reading: FeederComponentReading): LabelState {
	switch (reading.id) {
		case "hopper":
		case "sensor":
			if (reading.state === "live") return liveState();
			if (reading.state === "lastKnown") return lastKnownState();
			return noReadingState();
		case "controller":
			if (reading.state === "online") return liveState();
			if (reading.state === "paused") return pausedState();
			return offlineState();
		case "motor":
		case "auger":
			if (reading.state === "idle" || reading.state === "running") return liveState();
			if (reading.state === "paused") return pausedState();
			return offlineState();
		case "outlet":
			if (reading.state === "dispensing") {
				return {
					statusKey: "componentLive",
					wordTone: "live",
					dotTone: "active",
					valueActive: true,
				};
			}
			if (reading.state === "ready") return liveState();
			if (reading.state === "paused") return pausedState();
			return offlineState();
	}
}

function readingValue(reading: FeederComponentReading, t: ViewerTranslate): string {
	switch (reading.id) {
		case "hopper":
			return reading.percent === null ? "—" : `${reading.percent}%`;
		case "sensor":
			return reading.percent === null ? "—" : t("componentReading");
		case "controller":
			return reading.state === "online" ? t("componentOnline") : "—";
		case "motor":
		case "auger":
			if (reading.state === "running") return t("componentRunning");
			if (reading.state === "idle") return t("statusIdle");
			return "—";
		case "outlet":
			if (reading.state === "dispensing") return t("statusDispensing");
			if (reading.state === "ready") return t("componentReady");
			return "—";
	}
}

function buildLabelContents(
	readings: readonly FeederComponentReading[],
	t: ViewerTranslate,
): Record<FeederComponentId, FeederLabelContent> {
	const contents = {} as Record<FeederComponentId, FeederLabelContent>;

	for (const reading of readings) {
		const state = readingState(reading);
		contents[reading.id] = {
			name: t(COMPONENT_NAME_KEYS[reading.id]),
			value: readingValue(reading, t),
			status: t(state.statusKey),
			wordTone: state.wordTone,
			dotTone: state.dotTone,
			valueActive: state.valueActive,
		};
	}

	return contents;
}

function clampToStage(value: number, maximum: number): number {
	return Math.min(Math.max(value, ANCHOR_EDGE_PX), Math.max(ANCHOR_EDGE_PX, maximum));
}

function sameCardWidths(
	current: Partial<Record<FeederComponentId, number>>,
	next: Partial<Record<FeederComponentId, number>>,
): boolean {
	const ids = Object.keys(next) as FeederComponentId[];
	if (ids.length !== Object.keys(current).length) return false;
	return ids.every((id) => Math.abs((current[id] ?? -1) - (next[id] ?? -2)) < 0.5);
}

function FeederLabelCard({
	slot,
	content,
	animationDelay,
	cardRef,
}: {
	slot: FeederLabelSlot;
	content: FeederLabelContent;
	animationDelay: string;
	cardRef: (node: HTMLDivElement | null) => void;
}) {
	const isRight = slot.side === "right";

	return (
		<div
			ref={cardRef}
			className={cn(
				"ofd-feeder-iso-label absolute max-w-[144px] lg:max-w-[168px]",
				isRight ? "right-4 text-right" : "left-4 text-left",
			)}
			style={{
				top: `${slot.top}%`,
				transform: "translateY(-50%)",
				animationDelay,
				textShadow: TEXT_SHADOW,
			}}
		>
			<p
				className="text-[10px] font-extrabold leading-[1.2] tracking-[0.16em] uppercase"
				style={{ color: NAME_COLOR }}
			>
				{content.name}
			</p>
			<p
				className="mt-0.5 text-[22px] font-extrabold leading-[1.05] tracking-[-0.02em] tabular-nums lg:text-[26px]"
				style={{ color: content.valueActive ? TONE_COLOR.active : VALUE_COLOR }}
			>
				{content.value}
			</p>
			<p
				className={cn(
					"mt-1 flex items-center gap-1.5 text-[10px] font-bold leading-[1.2] tracking-[0.02em] lg:text-[10.5px]",
					isRight && "justify-end",
				)}
				style={{ color: TONE_COLOR[content.wordTone] }}
			>
				<span
					aria-hidden="true"
					className="ofd-feeder-iso-dot inline-block size-[5px] shrink-0 rounded-full"
					style={{ backgroundColor: TONE_COLOR[content.dotTone] }}
				/>
				{content.status}
			</p>
		</div>
	);
}

/**
 * Presentational ISO callouts: fixed-slot text, one leader per projected model
 * anchor and a decorative SVG layer. It never intercepts orbit, hover or focus
 * and is hidden below `md`, where the semantic status list takes over.
 */
export function FeederLabels({ status, level, active }: FeederLabelsProps): ReactElement | null {
	const t = useTranslations("dashboard.feederViewer");
	const overlayRef = useRef<HTMLDivElement | null>(null);
	const cardRefs = useRef<Partial<Record<FeederComponentId, HTMLDivElement | null>>>({});
	const [stage, setStage] = useState({ width: 0, height: 0 });
	const [cardWidths, setCardWidths] = useState<Partial<Record<FeederComponentId, number>>>({});

	const measureCards = useCallback(() => {
		const next: Partial<Record<FeederComponentId, number>> = {};

		for (const slot of VISUAL_SLOTS) {
			const card = cardRefs.current[slot.id];
			if (!card) continue;
			const width = card.offsetWidth;
			if (width > 0) next[slot.id] = width;
		}

		// Keep the last good widths while the overlay is display:none below md;
		// the observer measures again as soon as it is shown.
		if (Object.keys(next).length === 0) return;
		setCardWidths((current) => (sameCardWidths(current, next) ? current : next));
	}, []);

	useEffect(() => {
		if (!active) return;
		const node = overlayRef.current;
		if (!node) return;

		const measure = () => {
			const rect = node.getBoundingClientRect();
			const width = rect.width > 0 ? rect.width : node.clientWidth;
			const height = rect.height > 0 ? rect.height : node.clientHeight;
			setStage((current) =>
				current.width === width && current.height === height ? current : { width, height },
			);
			measureCards();
		};

		measure();

		// jsdom and very old browsers have no ResizeObserver; keep the overlay
		// usable with a window resize fallback rather than failing to render.
		if (typeof ResizeObserver === "undefined") {
			window.addEventListener("resize", measure);
			return () => window.removeEventListener("resize", measure);
		}

		const observer = new ResizeObserver(measure);
		observer.observe(node);
		return () => observer.disconnect();
	}, [active, measureCards]);

	// Card widths set the leader origin. Runs after each commit so a locale or
	// status change that widens a card also moves its leader; the equality guard
	// keeps it from looping.
	useEffect(() => {
		if (!active) return;
		measureCards();
	});

	if (!active) return null;

	const readings = feederComponentStatus({ status, level });
	const contents = buildLabelContents(readings, t);
	const anchors = projectFeederAnchors(stage.width, stage.height);
	const visibleSlots = VISUAL_SLOTS.filter((slot) => anchors[slot.id].visible);
	const hasStage = stage.width > 0 && stage.height > 0;
	const fallbackCardWidth =
		stage.width >= 1024 ? LABEL_MAX_WIDTH_DESKTOP_PX : LABEL_MAX_WIDTH_TABLET_PX;

	return (
		<div
			ref={overlayRef}
			aria-hidden="true"
			data-feeder-labels="iso"
			data-testid="feeder-labels"
			className="pointer-events-none absolute inset-0 z-10 hidden select-none md:block"
		>
			<style>{LABEL_STYLES}</style>

			{hasStage && (
				<svg
					aria-hidden="true"
					focusable="false"
					className="ofd-feeder-iso-leaders pointer-events-none absolute inset-0 h-full w-full"
				>
					{visibleSlots.map((slot) => {
						const anchor = anchors[slot.id];
						const cardWidth = cardWidths[slot.id] ?? fallbackCardWidth;
						const startX =
							slot.side === "left"
								? LABEL_INSET_PX + cardWidth + LEADER_GAP_PX
								: stage.width - LABEL_INSET_PX - cardWidth - LEADER_GAP_PX;
						const startY = (slot.top / 100) * stage.height;
						const endX = clampToStage(anchor.x, stage.width - ANCHOR_EDGE_PX);
						const endY = clampToStage(anchor.y, stage.height - ANCHOR_EDGE_PX);

						return (
							<g key={slot.id}>
								<line
									x1={startX}
									y1={startY}
									x2={endX}
									y2={endY}
									stroke={UNDERSTROKE_COLOR}
									strokeOpacity={0.6}
									strokeWidth={2}
									vectorEffect="non-scaling-stroke"
								/>
								<line
									x1={startX}
									y1={startY}
									x2={endX}
									y2={endY}
									stroke={LEADER_COLOR}
									strokeWidth={1}
									vectorEffect="non-scaling-stroke"
								/>
								<circle
									cx={endX}
									cy={endY}
									r={2.5}
									fill={ANCHOR_COLOR}
									stroke={UNDERSTROKE_COLOR}
									strokeOpacity={0.6}
									strokeWidth={1}
								/>
							</g>
						);
					})}
				</svg>
			)}

			{visibleSlots.map((slot, index) => (
				<FeederLabelCard
					key={slot.id}
					slot={slot}
					content={contents[slot.id]}
					animationDelay={`${index * LABEL_STAGGER_MS}ms`}
					cardRef={(node) => {
						cardRefs.current[slot.id] = node;
					}}
				/>
			))}
		</div>
	);
}

/**
 * The semantic component summary. It is the visible 2 × 3 list below `md` and
 * stays available to screen readers on desktop, where the visual callouts are
 * `aria-hidden`.
 */
export function FeederComponentStatusList({
	status,
	level,
	active,
}: FeederLabelsProps): ReactElement | null {
	const t = useTranslations("dashboard.feederViewer");

	if (!active) return null;

	const readings = feederComponentStatus({ status, level });
	const contents = buildLabelContents(readings, t);

	return (
		<dl
			id={FEEDER_COMPONENT_STATUS_ID}
			data-testid="feeder-component-status"
			className="grid grid-cols-2 gap-x-2 gap-y-1.5 border-t border-white/10 px-1 py-2 md:sr-only"
		>
			{readings.map((reading) => {
				const content = contents[reading.id];

				return (
					<div
						key={reading.id}
						className="flex min-h-12 flex-col justify-center gap-0.5 px-2.5 py-2"
					>
						<dt
							className="text-[10px] font-extrabold leading-[1.2] tracking-[0.14em] uppercase"
							style={{ color: NAME_COLOR }}
						>
							{content.name}
						</dt>
						<dd className="m-0 flex flex-wrap items-baseline justify-between gap-2">
							<span
								className="text-[15px] font-extrabold leading-tight tabular-nums"
								style={{ color: content.valueActive ? TONE_COLOR.active : VALUE_COLOR }}
							>
								{content.value}
							</span>
							<span
								className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold leading-none tracking-[0.02em]"
								style={{ color: TONE_COLOR[content.wordTone] }}
							>
								<span
									aria-hidden="true"
									className="ofd-feeder-iso-dot inline-block size-[5px] rounded-full"
									style={{ backgroundColor: TONE_COLOR[content.dotTone] }}
								/>
								{content.status}
							</span>
						</dd>
					</div>
				);
			})}
		</dl>
	);
}
