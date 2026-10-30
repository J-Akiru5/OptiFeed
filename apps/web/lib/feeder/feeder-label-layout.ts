import type { FeederComponentId } from "@/lib/feeder/feeder-parts";
import { PerspectiveCamera, Vector3 } from "three";

/**
 * Pure camera projection and fixed-slot layout for the six ISO component
 * labels (model v1.1.2).
 *
 * The slots are art direction: they never move with the orbit. Only the ISO
 * preset shows the overlay, and the leader lines connect these fixed cards to
 * the projected model anchors. Kept free of React, the DOM and browser globals
 * so the geometry can be unit-tested in Node and shared by the overlay.
 */

export interface FeederLabelSlot {
	id: FeederComponentId;
	side: "left" | "right";
	/** Vertical centre of the label card, percent of stage height. */
	top: number;
}

export interface FeederLabelAnchor {
	/** Horizontal centre of the anchor dot, in stage pixels. */
	x: number;
	/** Vertical centre of the anchor dot, in stage pixels. */
	y: number;
	visible: boolean;
}

/** The ISO camera the viewer renders the composed preset with. */
const ISO_CAMERA = {
	fov: 34,
	near: 0.05,
	far: 50,
	position: [-1.1, 0.45, 1.3],
	target: [0, 0.31, 0.03],
} as const;

/** Keep an edge dot mounted instead of popping it out on sub-pixel rounding. */
const STAGE_TOLERANCE_PX = 8;

/**
 * Component anchor centres in model metres (Y up, +Z front).
 *
 * `auger` points at the top of the dispensing tube in front of the shelf
 * plank; the tube further back (z ≈ 0.08) is hidden by the plank.
 */
export const FEEDER_LABEL_ANCHORS: Record<FeederComponentId, readonly [number, number, number]> = {
	hopper: [-0.0825, 0.34, 0.1275],
	sensor: [-0.0825, 0.522, 0.17],
	controller: [0.09, 0.17, 0.232],
	motor: [-0.114, 0.05, -0.25],
	auger: [-0.083, 0.079, 0.28],
	outlet: [-0.083, 0.05, 0.392],
};

/** Fixed callout cards, in visual top-to-bottom order. */
export const FEEDER_LABEL_SLOTS: readonly FeederLabelSlot[] = [
	{ id: "sensor", side: "left", top: 14 },
	{ id: "hopper", side: "left", top: 34 },
	{ id: "controller", side: "right", top: 42 },
	{ id: "motor", side: "left", top: 58 },
	{ id: "auger", side: "left", top: 80 },
	{ id: "outlet", side: "right", top: 70 },
];

const FEEDER_LABEL_IDS = Object.keys(FEEDER_LABEL_ANCHORS) as FeederComponentId[];

function hiddenAnchor(): FeederLabelAnchor {
	return { x: 0, y: 0, visible: false };
}

/**
 * Project the six model anchors through the ISO camera onto a stage of
 * `width` × `height` CSS pixels. An anchor is visible only when it is in
 * front of the camera and inside the stage (with a small edge tolerance).
 */
export function projectFeederAnchors(
	width: number,
	height: number,
): Record<FeederComponentId, FeederLabelAnchor> {
	const projected = {} as Record<FeederComponentId, FeederLabelAnchor>;

	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		for (const id of FEEDER_LABEL_IDS) projected[id] = hiddenAnchor();
		return projected;
	}

	const camera = new PerspectiveCamera(
		ISO_CAMERA.fov,
		width / height,
		ISO_CAMERA.near,
		ISO_CAMERA.far,
	);
	camera.position.set(...ISO_CAMERA.position);
	camera.lookAt(...ISO_CAMERA.target);
	camera.updateMatrixWorld();

	const point = new Vector3();
	for (const id of FEEDER_LABEL_IDS) {
		const [x, y, z] = FEEDER_LABEL_ANCHORS[id];
		point.set(x, y, z).project(camera);

		const px = ((point.x + 1) / 2) * width;
		const py = ((1 - point.y) / 2) * height;
		const inFront = point.z > -1 && point.z < 1;
		const insideStage =
			px >= -STAGE_TOLERANCE_PX &&
			px <= width + STAGE_TOLERANCE_PX &&
			py >= -STAGE_TOLERANCE_PX &&
			py <= height + STAGE_TOLERANCE_PX;

		projected[id] = { x: px, y: py, visible: inFront && insideStage };
	}

	return projected;
}
