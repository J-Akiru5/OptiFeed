"use client";

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
import { cn } from "@/lib/utils";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { RotateCcw, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { Suspense, useEffect, useMemo, useState } from "react";
import { type Object3D, PMREMGenerator } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

interface FeederViewerProps {
	label: string;
	status: FeederStatus;
	feedLevelPercent: number | null;
	lastFedLabel: string | null;
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

function CameraRig({ preset }: { preset: CameraPreset }) {
	const { camera } = useThree();
	useEffect(() => {
		const [x, y, z] = CAMERA_PRESETS[preset];
		camera.position.set(x, y, z);
		camera.lookAt(0, 0.37, 0.03);
	}, [camera, preset]);
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
	onSimpleView,
}: FeederViewerProps) {
	const t = useTranslations("dashboard.feederViewer");
	const [preset, setPreset] = useState<CameraPreset>("iso");
	const statusLabel = t(`status${status.charAt(0).toUpperCase()}${status.slice(1)}`);
	const level = feedLevelPercent === null ? null : Math.min(100, Math.max(0, feedLevelPercent));

	return (
		<div className="overflow-hidden rounded-3xl border border-[#0A3D62]/10 bg-[#0B2336] text-white shadow-sm dark:border-white/10">
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
									: "bg-sky-300/15 text-sky-200",
					)}
				>
					{statusLabel}
				</span>
			</div>

			<div
				className="relative h-[300px] w-full sm:h-[380px]"
				role="img"
				aria-label={t("canvasLabel", { label })}
			>
				<Canvas
					camera={{ position: [...CAMERA_PRESETS.iso], fov: 34 }}
					dpr={[1, 2]}
					shadows
					gl={{ antialias: true, alpha: true }}
				>
					<color attach="background" args={["#0B2336"]} />
					<StudioEnvironment />
					<ambientLight intensity={0.6} />
					<hemisphereLight args={["#e8f2ff", "#081624", 0.7]} />
					<directionalLight position={[2.6, 4, 3]} intensity={2.2} castShadow />
					<directionalLight position={[-3, 2, -2]} intensity={0.8} color="#9ec5ea" />
					<directionalLight position={[0, 2.6, -3]} intensity={1.1} color="#d8ecff" />
					<Suspense fallback={null}>
						<FeederModel level={level} status={status} />
					</Suspense>
					<CameraRig preset={preset} />
					<OrbitControls
						makeDefault
						enablePan={false}
						enableDamping
						dampingFactor={0.08}
						minDistance={0.8}
						maxDistance={2.8}
						minPolarAngle={0.25}
						maxPolarAngle={Math.PI / 2.02}
						target={[0, 0.37, 0.03]}
					/>
				</Canvas>
			</div>

			<div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
				<div className="flex flex-wrap gap-1" aria-label={t("presetsLabel")}>
					{(Object.keys(CAMERA_PRESETS) as CameraPreset[]).map((key) => (
						<button
							key={key}
							type="button"
							onClick={() => setPreset(key)}
							aria-pressed={preset === key}
							className={cn(
								"rounded-lg px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
								preset === key
									? "bg-white text-[#0A3D62]"
									: "bg-white/10 text-white/70 hover:bg-white/15",
							)}
						>
							{t(CAMERA_PRESET_LABELS[key])}
						</button>
					))}
				</div>
				{onSimpleView && (
					<button
						type="button"
						onClick={onSimpleView}
						className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-white/70 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
					>
						<RotateCcw className="size-3" aria-hidden="true" />
						{t("simpleView")}
					</button>
				)}
			</div>

			<div className="grid grid-cols-3 gap-2 border-t border-white/10 px-4 py-3 text-xs">
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
