import { readFileSync } from "node:fs";
import path from "node:path";
import { projectModelPoint } from "@/lib/feeder/feeder-label-layout";
import { FEEDER_MODEL_FILE, FEEDER_MODEL_VERSION } from "@/lib/feeder/feeder-parts";
import { describe, expect, it } from "vitest";

/**
 * Issue #400: the water-temperature probe must be a real, visible part of the
 * GLB — not a label anchor or a leader line. A WebGL render cannot run in
 * jsdom, so this test reads the exported asset directly and checks the probe's
 * geometry against the pond level and the default ISO camera frustum.
 */

interface GltfAccessor {
	min?: number[];
	max?: number[];
}

interface GltfPrimitive {
	attributes: Record<string, number>;
	material?: number;
}

interface GltfMesh {
	primitives: GltfPrimitive[];
}

interface GltfNode {
	name?: string;
	mesh?: number;
	translation?: number[];
}

interface GltfMaterial {
	name?: string;
}

interface GltfJson {
	nodes: GltfNode[];
	meshes: GltfMesh[];
	accessors: GltfAccessor[];
	materials: GltfMaterial[];
}

interface ProbeDimensions {
	water_probe: {
		body_center: [number, number, number];
		body_length: number;
		water_level_y: number;
	};
}

// Vitest runs with `apps/web` as its root, and jsdom gives `import.meta.url`
// an http scheme, so resolve the repository files from the working directory.
const MODEL_PATH = path.resolve(process.cwd(), "public/models/feeder-v1.2.0.glb");
const DIMENSIONS_PATH = path.resolve(process.cwd(), "../../tools/feeder-model/dimensions.json");

const PROBE_NODES = [
	"Water_Probe_Clip",
	"Water_Probe_Cable",
	"Water_Probe_Connector",
	"Water_Probe_Body",
] as const;

/** Read the JSON chunk of a GLB without decoding the binary buffers. */
function readGlbJson(filePath: string): GltfJson {
	const buffer = readFileSync(filePath);
	const magic = buffer.readUInt32LE(0);
	const chunkLength = buffer.readUInt32LE(12);
	const chunkType = buffer.readUInt32LE(16);
	if (magic !== 0x46546c67 || chunkType !== 0x4e4f534a) {
		throw new Error(`not a GLB JSON chunk: ${filePath}`);
	}
	return JSON.parse(buffer.subarray(20, 20 + chunkLength).toString("utf8")) as GltfJson;
}

function nodeBounds(gltf: GltfJson, name: string) {
	const node = gltf.nodes.find((candidate) => candidate.name === name);
	if (!node || node.mesh === undefined) throw new Error(`missing GLB node: ${name}`);
	const accessor = gltf.accessors[gltf.meshes[node.mesh].primitives[0].attributes.POSITION];
	const translation = node.translation ?? [0, 0, 0];
	if (!accessor.min || !accessor.max) throw new Error(`missing bounds on: ${name}`);
	const min = accessor.min.map((value, index) => value + translation[index]);
	const max = accessor.max.map((value, index) => value + translation[index]);
	return { min, max, translation };
}

const gltf = readGlbJson(MODEL_PATH);
const dimensions = JSON.parse(readFileSync(DIMENSIONS_PATH, "utf8")) as ProbeDimensions;
const waterLevelY = dimensions.water_probe.water_level_y / 1000;

describe("feeder water-temperature probe", () => {
	it("ships in the current model asset", () => {
		expect(FEEDER_MODEL_VERSION).toBe("1.2.0");
		expect(FEEDER_MODEL_FILE).toBe("/models/feeder-v1.2.0.glb");

		const names = gltf.nodes.map((node) => node.name);
		for (const name of PROBE_NODES) expect(names, name).toContain(name);
	});

	it("hangs below the base plate and crosses the pond surface", () => {
		const body = nodeBounds(gltf, "Water_Probe_Body");
		expect(body.max[1]).toBeLessThan(0);
		expect(body.min[1]).toBeGreaterThan(-0.2);
		expect(body.min[1]).toBeLessThan(waterLevelY);
		expect(body.max[1]).toBeGreaterThan(waterLevelY);
	});

	it("stacks the cable, connector and body without gaps", () => {
		const cable = nodeBounds(gltf, "Water_Probe_Cable");
		const connector = nodeBounds(gltf, "Water_Probe_Connector");
		const body = nodeBounds(gltf, "Water_Probe_Body");

		expect(cable.max[1]).toBeLessThan(0.01);
		expect(connector.max[1]).toBeCloseTo(cable.min[1], 5);
		expect(body.max[1]).toBeCloseTo(connector.min[1], 5);
		expect(body.min[1]).toBeLessThan(connector.min[1]);
	});

	it("keeps the exported node positions identical to the measurement sheet", () => {
		const body = nodeBounds(gltf, "Water_Probe_Body");
		const [x, y, z] = dimensions.water_probe.body_center;
		expect(body.translation[0]).toBeCloseTo(x / 1000, 5);
		expect(body.translation[1]).toBeCloseTo(y / 1000, 5);
		expect(body.translation[2]).toBeCloseTo(z / 1000, 5);
		expect(dimensions.water_probe.body_length / 1000).toBeCloseTo(body.max[1] - body.min[1], 5);
	});

	it("uses materials that contrast with the white feeder and dark water", () => {
		const materials = new Map<string, string | undefined>();
		for (const name of PROBE_NODES) {
			const node = gltf.nodes.find((candidate) => candidate.name === name);
			if (!node || node.mesh === undefined) throw new Error(`missing GLB node: ${name}`);
			const material = gltf.meshes[node.mesh].primitives[0].material;
			materials.set(name, material === undefined ? undefined : gltf.materials[material]?.name);
		}

		expect(materials.get("Water_Probe_Clip")).toBe("Rubber_Black");
		expect(materials.get("Water_Probe_Cable")).toBe("Cable_Gray");
		expect(materials.get("Water_Probe_Connector")).toBe("Blue_PETG");
		expect(materials.get("Water_Probe_Body")).toBe("Metal_Silver");
	});

	it("is inside the default ISO camera frustum at every viewer stage size", () => {
		const body = nodeBounds(gltf, "Water_Probe_Body");
		const center: [number, number, number] = [
			(body.min[0] + body.max[0]) / 2,
			(body.min[1] + body.max[1]) / 2,
			(body.min[2] + body.max[2]) / 2,
		];

		for (const [width, height] of [
			[720, 440],
			[720, 380],
			[390, 300],
			[390, 220],
		] as const) {
			const projected = projectModelPoint(width, height, center);
			expect(projected.visible, `${width} × ${height}`).toBe(true);
			expect(projected.x, `${width} × ${height}`).toBeGreaterThan(width * 0.4);
			expect(projected.x, `${width} × ${height}`).toBeLessThan(width * 0.6);
			expect(projected.y, `${width} × ${height}`).toBeGreaterThan(height * 0.6);
			expect(projected.y, `${width} × ${height}`).toBeLessThan(height);
		}
	});

	it("returns an inert projection for an unlaid-out stage", () => {
		expect(projectModelPoint(0, 440, [0, 0, 0])).toEqual({ x: 0, y: 0, visible: false });
	});
});
