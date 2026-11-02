"use client";

import { DEFAULT_DEVICE_STATUS_POLICY } from "@/lib/device-status";
import {
	CAMERA_PRESETS,
	CAMERA_PRESET_LABELS,
	type CameraPreset,
	FEEDER_MODEL_FILE,
	FEEDER_MODEL_VERSION,
	FEEDER_NODES,
	type FeederStatus,
	grainFillScale,
} from "@/lib/feeder/feeder-parts";
import { type ReadingAge, isReadingStale, readingAge } from "@/lib/feeder/reading-freshness";
import { cn } from "@/lib/utils";
import { CameraControls, CameraControlsImpl, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { LayoutGrid, Lock, RotateCcw, Sparkles, Unlock } from "lucide-react";
import { useTranslations } from "next-intl";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Box3, type Object3D, PMREMGenerator, Vector3 } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
	FEEDER_COMPONENT_STATUS_ID,
	FeederComponentStatusList,
	FeederLabels,
} from "./feeder-labels";

interface FeederViewerProps {
	label: string;
	status: FeederStatus;
	feedLevelPercent: number | null;
	lastFedLabel: string | null;
	/** Water-temperature probe health; null when the firmware never reported it. */
	waterTempOk: boolean | null;
	/** Last calibrated temperature the probe reported. */
	waterTempC?: number | null;
	/** When the probe last reported; null when it never did. */
	waterTempUpdatedAt?: string | null;
	/** RTC health as last reported on the heartbeat. */
	rtcOk: boolean | null;
	/** When the unit last checked in; the freshness basis for the RTC bit. */
	lastSeenAt?: string | null;
	/** Reading freshness window, from the device status policy. */
	staleAfterMs?: number;
	onSimpleView?: () => void;
}

/**
 * A tiny procedural studio environment. The clear PET jar needs something to
 * reflect; a CDN HDR would be an extra request and a CSP exception.
 */
function StudioEnvironment() {
	const { gl, scene } = useThree();
	useEffect(() => {
		const pmrem = new PMREMGenerator(gl);
		const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
		scene.environment = texture;
		scene.environmentIntensity = 0.55;
		return () => {
			scene.environment = null;
			texture.dispose();
			pmrem.dispose();
		};
	}, [gl, scene]);
	return null;
}

/**
 * The orbit target every preset frames: the feeder's mid-height, front third.
 */
export const CAMERA_TARGET = [0, 0.31, 0.03] as const;

/** Distance of the ISO preset from the target. This is the fitted distance. */
export const FITTED_CAMERA_DISTANCE = Math.hypot(
	CAMERA_PRESETS.iso[0] - CAMERA_TARGET[0],
	CAMERA_PRESETS.iso[1] - CAMERA_TARGET[1],
	CAMERA_PRESETS.iso[2] - CAMERA_TARGET[2],
);

/**
 * Dolly range around the fitted distance. Every preset sits inside it, so a
 * preset switch is never clamped by the zoom limit.
 */
export const CAMERA_MIN_DISTANCE = FITTED_CAMERA_DISTANCE * 0.55;
export const CAMERA_MAX_DISTANCE = FITTED_CAMERA_DISTANCE * 1.65;

/**
 * Truck/pan limit around the model. The orbit target may never leave this box,
 * so panning cannot take the feeder out of frame.
 */
export const CAMERA_PAN_BOUNDS = {
	min: [-0.34, 0.11, -0.34],
	max: [0.34, 0.51, 0.34],
} as const;

/** Persisted camera lock. Locked is the default until the user unlocks. */
export const FEEDER_CAMERA_LOCK_KEY = "feeder-viewer:locked";

/** Only an explicit stored `"false"` unlocks the camera. */
export function parseCameraLocked(stored: string | null | undefined): boolean {
	return stored !== "false";
}

const ACTIONS = CameraControlsImpl.ACTION;

/** Left-drag orbits, right-drag pans, wheel and middle-drag dolly. */
const CAMERA_MOUSE_BUTTONS = {
	left: ACTIONS.ROTATE,
	middle: ACTIONS.DOLLY,
	right: ACTIONS.TRUCK,
	wheel: ACTIONS.DOLLY,
} as const;

/** One finger orbits; two fingers dolly and truck together. */
const CAMERA_TOUCHES = {
	one: ACTIONS.TOUCH_ROTATE,
	two: ACTIONS.TOUCH_DOLLY_TRUCK,
	three: ACTIONS.TOUCH_TRUCK,
} as const;

function usePrefersReducedMotion(): boolean {
	const [reduced, setReduced] = useState(false);

	useEffect(() => {
		if (typeof window.matchMedia !== "function") return;
		const query = window.matchMedia("(prefers-reduced-motion: reduce)");
		setReduced(query.matches);
		const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
		query.addEventListener("change", onChange);
		return () => query.removeEventListener("change", onChange);
	}, []);

	return reduced;
}

/**
 * Drives the CameraControls rig. Preset changes use CameraControls' own
 * transition; the first frame and reduced-motion users snap instead. A reset
 * token re-applies the ISO preset even when ISO is already selected.
 */
function CameraRig({ preset, resetToken }: { preset: CameraPreset; resetToken: number }) {
	const controls = useThree((state) => state.controls) as CameraControlsImpl | null;
	const reducedMotion = usePrefersReducedMotion();
	const reducedMotionRef = useRef(reducedMotion);
	const firstRun = useRef(true);
	reducedMotionRef.current = reducedMotion;

	// biome-ignore lint/correctness/useExhaustiveDependencies: resetToken is the trigger that re-applies the preset after a Reset view.
	useEffect(() => {
		if (!controls) return;
		const [x, y, z] = CAMERA_PRESETS[preset];
		const [targetX, targetY, targetZ] = CAMERA_TARGET;
		const animate = !firstRun.current && !reducedMotionRef.current;
		firstRun.current = false;
		void controls.setLookAt(x, y, z, targetX, targetY, targetZ, animate);
	}, [controls, preset, resetToken]);

	useEffect(() => {
		if (!controls) return;
		const [minX, minY, minZ] = CAMERA_PAN_BOUNDS.min;
		const [maxX, maxY, maxZ] = CAMERA_PAN_BOUNDS.max;
		controls.setBoundary(new Box3(new Vector3(minX, minY, minZ), new Vector3(maxX, maxY, maxZ)));
		return () => controls.setBoundary(undefined);
	}, [controls]);

	return null;
}

function FeederModel({ level, status }: { level: number | null; status: FeederStatus }) {
	const { scene } = useGLTF(FEEDER_MODEL_FILE);
	const nodes = useMemo(
		() => ({
			grain: scene.getObjectByName(FEEDER_NODES.grain) as Object3D | undefined,
			auger: scene.getObjectByName(FEEDER_NODES.auger) as Object3D | undefined,
			coupling: scene.getObjectByName(FEEDER_NODES.coupling) as Object3D | undefined,
		}),
		[scene],
	);

	useEffect(() => {
		if (!nodes.grain) return;
		nodes.grain.scale.y = grainFillScale(level);
	}, [nodes.grain, level]);

	useFrame((_state, delta) => {
		if (status !== "dispensing") return;
		if (nodes.auger) nodes.auger.rotation.x += delta * 5;
		if (nodes.coupling) nodes.coupling.rotation.x += delta * 5;
	});

	return <primitive object={scene} />;
}

/**
 * The lazy 3D scene. The first paint is the fallback; this module is only
 * requested when the card enters the viewport and the tier check passes.
 */
export function FeederViewer({
	label,
	status,
	feedLevelPercent,
	lastFedLabel,
	waterTempOk,
	waterTempC = null,
	waterTempUpdatedAt = null,
	rtcOk,
	lastSeenAt = null,
	staleAfterMs = DEFAULT_DEVICE_STATUS_POLICY.offlineAfterMs,
	onSimpleView,
}: FeederViewerProps) {
	const t = useTranslations("dashboard.feederViewer");
	const tWater = useTranslations("dashboard.waterTemp");
	const [preset, setPreset] = useState<CameraPreset>("iso");
	const [resetToken, setResetToken] = useState(0);
	const [locked, setLocked] = useState<boolean>(() => {
		if (typeof window === "undefined") return true;
		try {
			return parseCameraLocked(window.localStorage.getItem(FEEDER_CAMERA_LOCK_KEY));
		} catch {
			return true;
		}
	});
	const statusLabel = t(`status${status.charAt(0).toUpperCase()}${status.slice(1)}`);
	const level = feedLevelPercent === null ? null : Math.min(100, Math.max(0, feedLevelPercent));

	const toggleLock = () => {
		const next = !locked;
		setLocked(next);
		try {
			window.localStorage.setItem(FEEDER_CAMERA_LOCK_KEY, String(next));
		} catch {
			// Private browsing may refuse the write; the lock still applies now.
		}
	};

	const resetView = () => {
		setPreset("iso");
		setResetToken((token) => token + 1);
	};

	const healthOf = (health: boolean | null) =>
		health === null
			? { label: t("healthUnknown"), tone: "text-white/55", dot: "bg-white/40" }
			: health
				? { label: t("healthOk"), tone: "text-emerald-200", dot: "bg-emerald-300" }
				: { label: t("healthFault"), tone: "text-rose-200", dot: "bg-rose-400" };
	// #620: a reading older than the freshness window is stale, not current.
	const ageLabel = (age: ReadingAge | null): string | null => {
		if (!age) return null;
		switch (age.unit) {
			case "seconds":
				return tWater("secondsAgo", { count: age.count });
			case "minutes":
				return tWater("minutesAgo", { count: age.count });
			case "hours":
				return tWater("hoursAgo", { count: age.count });
			case "days":
				return tWater("daysAgo", { count: age.count });
		}
	};
	const staleHealth = (updatedAt: string | null) =>
		isReadingStale(updatedAt, staleAfterMs)
			? {
					label: [tWater("statusStale"), ageLabel(readingAge(updatedAt))]
						.filter(Boolean)
						.join(" · "),
					tone: "text-amber-200",
					dot: "bg-amber-300",
				}
			: null;
	const waterHealth = staleHealth(waterTempUpdatedAt) ?? healthOf(waterTempOk);
	const rtcHealth = staleHealth(lastSeenAt) ?? healthOf(rtcOk);
	const waterValue = waterTempC === null ? null : `${waterTempC.toFixed(1)} °C`;

	return (
		<div className="overflow-hidden rounded-3xl border border-[#0A3D62]/10 bg-[radial-gradient(circle_at_50%_42%,rgba(125,211,252,0.16),transparent_38%),radial-gradient(ellipse_at_50%_40%,#143c5e_0%,#0B2336_58%,#071a2a_100%)] text-white shadow-sm dark:border-white/10">
			<div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
				<div>
					<p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/55">
						{t("viewerLabel")}
					</p>
					<p className="mt-1 text-lg font-black">{label}</p>
				</div>
				<span
					className={cn(
						"rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider",
						status === "offline"
							? "bg-white/10 text-white/70"
							: status === "dispensing"
								? "bg-emerald-400/15 text-emerald-200"
								: status === "paused"
									? "bg-amber-300/15 text-amber-200"
									: status === "weak"
										? "bg-amber-400/15 text-amber-200"
										: "bg-sky-300/15 text-sky-200",
					)}
				>
					{statusLabel}
				</span>
			</div>

			<div
				className="relative h-[300px] w-full md:h-[400px] lg:h-[440px]"
				role="img"
				aria-label={t("canvasLabel", { label })}
				aria-describedby={preset === "iso" ? FEEDER_COMPONENT_STATUS_ID : undefined}
				data-camera-preset={preset}
				data-camera-locked={locked ? "true" : "false"}
			>
				<Canvas
					camera={{ position: [...CAMERA_PRESETS.iso], fov: 34 }}
					dpr={[1, 2]}
					shadows
					gl={{ antialias: true, alpha: true }}
				>
					<StudioEnvironment />
					<ambientLight intensity={0.6} />
					<hemisphereLight args={["#e8f2ff", "#081624", 0.7]} />
					<directionalLight position={[2.6, 4, 3]} intensity={2.2} castShadow />
					<directionalLight position={[-3, 2, -2]} intensity={0.8} color="#9ec5ea" />
					<directionalLight position={[0, 2.6, -3]} intensity={1.1} color="#d8ecff" />
					<Suspense fallback={null}>
						<FeederModel level={level} status={status} />
					</Suspense>
					<CameraRig preset={preset} resetToken={resetToken} />
					<CameraControls
						makeDefault
						enabled={!locked}
						minDistance={CAMERA_MIN_DISTANCE}
						maxDistance={CAMERA_MAX_DISTANCE}
						mouseButtons={CAMERA_MOUSE_BUTTONS}
						touches={CAMERA_TOUCHES}
						smoothTime={0.35}
						draggingSmoothTime={0.12}
					/>
				</Canvas>
				<FeederLabels status={status} level={level} active={preset === "iso"} />
			</div>
			<FeederComponentStatusList status={status} level={level} active={preset === "iso"} />

			<div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
				<div className="flex flex-wrap gap-1" aria-label={t("presetsLabel")}>
					{(Object.keys(CAMERA_PRESETS) as CameraPreset[]).map((key) => (
						<button
							key={key}
							type="button"
							onClick={() => setPreset(key)}
							aria-pressed={preset === key}
							className={cn(
								"rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
								preset === key
									? "bg-[#ff9a70] text-[#071a2a] shadow-[0_4px_16px_rgba(255,154,112,0.28)]"
									: "bg-white/[0.07] text-white/65 hover:bg-white/15",
							)}
						>
							{t(CAMERA_PRESET_LABELS[key])}
						</button>
					))}
				</div>
				<div className="flex flex-wrap items-center gap-1">
					<button
						type="button"
						onClick={resetView}
						className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white/70 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
					>
						<RotateCcw className="size-3" aria-hidden="true" />
						{t("resetView")}
					</button>
					<button
						type="button"
						onClick={toggleLock}
						data-camera-lock-toggle={locked ? "locked" : "unlocked"}
						className={cn(
							"inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
							locked
								? "border-[#ff9a70]/45 bg-[#ff9a70]/15 text-[#ffd2c0] hover:bg-[#ff9a70]/25"
								: "border-white/15 text-white/70 hover:bg-white/10",
						)}
					>
						{locked ? (
							<Unlock className="size-3" aria-hidden="true" />
						) : (
							<Lock className="size-3" aria-hidden="true" />
						)}
						{locked ? t("unlockCamera") : t("lockCamera")}
					</button>
					{onSimpleView && (
						<button
							type="button"
							onClick={onSimpleView}
							className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white/70 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
						>
							<LayoutGrid className="size-3" aria-hidden="true" />
							{t("simpleView")}
						</button>
					)}
				</div>
			</div>

			<div className="grid grid-cols-2 gap-2 border-t border-white/10 px-4 py-3 text-xs sm:grid-cols-3 lg:grid-cols-5">
				<div>
					<p className="text-[10px] font-black uppercase tracking-wider text-white/45">
						{t("hopperLevel")}
					</p>
					<p className="mt-0.5 font-bold">{level === null ? "—" : `${level}%`}</p>
				</div>
				<div>
					<p className="text-[10px] font-black uppercase tracking-wider text-white/45">
						{t("lastFed")}
					</p>
					<p className="mt-0.5 font-bold">{lastFedLabel ?? t("noReading")}</p>
				</div>
				<div>
					<p className="text-[10px] font-black uppercase tracking-wider text-white/45">
						{t("waterTempSensor")}
					</p>
					<p className={cn("mt-0.5 inline-flex items-center gap-1.5 font-bold", waterHealth.tone)}>
						<span
							className={cn("size-1.5 shrink-0 rounded-full", waterHealth.dot)}
							aria-hidden="true"
						/>
						{[waterValue, waterHealth.label].filter(Boolean).join(" · ")}
					</p>
				</div>
				<div>
					<p className="text-[10px] font-black uppercase tracking-wider text-white/45">
						{t("rtc")}
					</p>
					<p className={cn("mt-0.5 inline-flex items-center gap-1.5 font-bold", rtcHealth.tone)}>
						<span
							className={cn("size-1.5 shrink-0 rounded-full", rtcHealth.dot)}
							aria-hidden="true"
						/>
						{rtcHealth.label}
					</p>
				</div>
				<div>
					<p className="text-[10px] font-black uppercase tracking-wider text-white/45">
						{t("modelVersion")}
					</p>
					<p className="mt-0.5 inline-flex items-center gap-1 font-bold">
						<Sparkles className="size-3 text-[#ff9a70]" aria-hidden="true" />v{FEEDER_MODEL_VERSION}
					</p>
				</div>
			</div>

			<p className="sr-only" aria-live="polite">
				{t("statusAnnouncement", { status: statusLabel })}
			</p>
		</div>
	);
}
