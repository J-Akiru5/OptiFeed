import manifest from "@/lib/feeder/model-manifest.json";

/**
 * Pure viewer rules for the feeder 3D scene (plan v1.1.0).
 *
 * Kept free of React, three.js and Prisma so the status/tier/camera maths can
 * be unit-tested in Node and reused by both the server detail page and the
 * client viewer.
 */

const FEEDER_VIEWER_CONTRACT = manifest.contract;
export const FEEDER_MODEL_FILE = manifest.file;
export const FEEDER_MODEL_VERSION = manifest.version;

export type FeederStatus = "idle" | "dispensing" | "paused" | "offline";
export type FeederViewerTier = "high" | "medium" | "low";

const FEEDER_STATUS_LABEL_KEYS: Record<FeederStatus, string> = {
	idle: "statusIdle",
	dispensing: "statusDispensing",
	paused: "statusPaused",
	offline: "statusOffline",
};

/** Dispensing remains "live" for this long after the newest dispense. */
export const DISPENSING_WINDOW_MS = 20_000;

export interface FeederStatusInput {
	isPaused: boolean;
	lastSeenAt: Date | string | null;
	lastFedAt: Date | string | null;
	now?: Date;
}

function toDate(value: Date | string | null): Date | null {
	if (value === null) return null;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isFinite(date.getTime()) ? date : null;
}

/** Derive the one status every viewer surface uses. */
export function feederStatus({
	isPaused,
	lastSeenAt,
	lastFedAt,
	now = new Date(),
}: FeederStatusInput): FeederStatus {
	const seen = toDate(lastSeenAt);
	if (!seen || now.getTime() - seen.getTime() > 15 * 60 * 1000) return "offline";
	if (isPaused) return "paused";
	const fed = toDate(lastFedAt);
	if (fed && now.getTime() - fed.getTime() <= DISPENSING_WINDOW_MS) return "dispensing";
	return "idle";
}

/** Clamp a level to 0–100; null stays null. */
export function clampLevel(level: number | null): number | null {
	if (level === null || !Number.isFinite(level)) return null;
	return Math.min(100, Math.max(0, level));
}

/** Scale for the grain mesh. Keep a visible seed bed at 0 %. */
export function grainFillScale(level: number | null): number {
	const percent = clampLevel(level) ?? 0;
	return 0.02 + (percent / 100) * 0.98;
}

export type FeederComponentId = "hopper" | "sensor" | "controller" | "motor" | "auger" | "outlet";

export type FeederComponentState =
	| "live"
	| "lastKnown"
	| "noReading"
	| "online"
	| "running"
	| "idle"
	| "paused"
	| "dispensing"
	| "ready"
	| "offline";

export interface FeederComponentReading {
	id: FeederComponentId;
	state: FeederComponentState;
	percent: number | null;
}

/** The hopper and its lid sensor share the level-derived state. */
function levelComponentState(status: FeederStatus, percent: number | null): FeederComponentState {
	if (percent === null) return "noReading";
	return status === "offline" ? "lastKnown" : "live";
}

function controllerComponentState(status: FeederStatus): FeederComponentState {
	if (status === "offline") return "offline";
	if (status === "paused") return "paused";
	return "online";
}

function motorComponentState(status: FeederStatus): FeederComponentState {
	if (status === "offline") return "offline";
	if (status === "paused") return "paused";
	if (status === "dispensing") return "running";
	return "idle";
}

function outletComponentState(status: FeederStatus): FeederComponentState {
	if (status === "offline") return "offline";
	if (status === "paused") return "paused";
	if (status === "dispensing") return "dispensing";
	return "ready";
}

/**
 * Describe every part of the feeder for the status labels.
 * Offline feeders keep the last hopper reading instead of dropping it.
 */
export function feederComponentStatus({
	status,
	level,
}: {
	status: FeederStatus;
	level: number | null;
}): FeederComponentReading[] {
	const percent = clampLevel(level);
	const levelState = levelComponentState(status, percent);
	return [
		{ id: "hopper", state: levelState, percent },
		{ id: "sensor", state: levelState, percent },
		{ id: "controller", state: controllerComponentState(status), percent: null },
		{ id: "motor", state: motorComponentState(status), percent: null },
		{ id: "auger", state: motorComponentState(status), percent: null },
		{ id: "outlet", state: outletComponentState(status), percent: null },
	];
}

export interface ViewerCapabilities {
	webgl2: boolean;
	renderer: string;
	deviceMemory?: number;
	hardwareConcurrency?: number;
	saveData?: boolean;
}

/**
 * Choose the cheapest viewer that can still render the product well.
 * SwiftShader/llvmpipe, data-saver, very low memory or no WebGL2 go to the
 * illustrated fallback instead of risking a broken canvas.
 */
export function chooseViewerTier({
	webgl2,
	renderer,
	deviceMemory,
	hardwareConcurrency,
	saveData,
}: ViewerCapabilities): FeederViewerTier {
	if (!webgl2 || saveData) return "low";
	const software = /swiftshader|llvmpipe|software|basic render/i.test(renderer);
	if (software) return "low";
	if (typeof deviceMemory === "number" && deviceMemory <= 2) return "medium";
	if (typeof hardwareConcurrency === "number" && hardwareConcurrency <= 2) return "medium";
	return "high";
}

export const CAMERA_PRESETS = {
	iso: [-1.1, 0.45, 1.3],
	front: [0, 0.42, 1.75],
	left: [-1.75, 0.42, 0.1],
	right: [1.75, 0.42, 0.1],
	rear: [0, 0.42, -1.75],
	top: [0, 1.9, 0.01],
} as const;

export type CameraPreset = keyof typeof CAMERA_PRESETS;

export const CAMERA_PRESET_LABELS: Record<CameraPreset, string> = {
	iso: "presetIso",
	front: "presetFront",
	left: "presetLeft",
	right: "presetRight",
	rear: "presetRear",
	top: "presetTop",
};

/** Named nodes the viewer binds. Missing nodes are ignored, not fatal. */
export const FEEDER_NODES = {
	grain: "Grain_Fill",
	auger: "Auger",
	coupling: "Motor_Coupling",
	powerLed: "LED_Power",
	statusLed: "LED_Status",
	hopperGlass: "Hopper_Glass",
	tubeGlass: "Tube_Glass",
} as const;

const FEEDER_MODEL_MANIFEST = manifest;
