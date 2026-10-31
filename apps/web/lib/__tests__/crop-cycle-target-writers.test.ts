import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #318: every writer of `CropCycle.targetHarvestWeightG` must pass through the
 * one guarded module (`lib/crop-cycle/target-write.ts`).
 *
 * The cycle mirror had two writers and the Replace/Keep guard existed in only
 * one of them. A source scan is the only way to keep a future import, admin
 * bulk edit or assistant action from quietly adding a third. It is deliberately
 * narrow: it looks for a `targetHarvestWeightG` key inside a `data: { ... }`
 * write block, not for reads, selects, types or test fixtures.
 */

const WEB_ROOT = join(__dirname, "..", "..");
const SCANNED_ROOTS = ["lib", "app", "components", "scripts"];

/** Files allowed to write the mirror, and why. */
const ALLOWED_WRITERS = new Set(["lib/crop-cycle/target-write.ts", "lib/actions/crop-cycle.ts"]);

/** `data: { ... targetHarvestWeightG: ... }` with no nested object braces. */
const DIRECT_WRITE = /data:\s*\{[^{}]*targetHarvestWeightG\s*:/g;

function sourceFiles(dir: string): string[] {
	const absolute = join(WEB_ROOT, dir);
	const found: string[] = [];
	for (const entry of readdirSync(absolute)) {
		if (entry === "node_modules" || entry === "__tests__") continue;
		const full = join(absolute, entry);
		const stat = statSync(full);
		if (stat.isDirectory()) {
			found.push(...sourceFiles(join(dir, entry)));
			continue;
		}
		if (!/\.(ts|tsx)$/.test(entry) || /\.test\.(ts|tsx)$/.test(entry)) continue;
		found.push(join(dir, entry).replaceAll("\\", "/"));
	}
	return found;
}

function relative(path: string): string {
	return path.replaceAll("\\", "/");
}

function read(path: string): string {
	return readFileSync(join(WEB_ROOT, relative(path)), "utf8");
}

describe("targetHarvestWeightG writers", () => {
	const files = SCANNED_ROOTS.flatMap((root) => sourceFiles(root));
	const writers = files.filter((file) => {
		DIRECT_WRITE.lastIndex = 0;
		return DIRECT_WRITE.test(read(file));
	});

	it("routes every direct write through the guarded module", () => {
		expect(writers.sort()).toEqual([...ALLOWED_WRITERS].sort());
	});

	it("the cycle action uses both guarded entry points", () => {
		const action = read("lib/actions/crop-cycle.ts");
		// Create: range guard. Update: Replace/Keep decision + pond write.
		expect(action).toContain("cycleTargetForCreate(");
		expect(action).toContain("resolveCycleTargetWrite(");
		expect(action).toContain("writePondGrowthTarget(");
	});

	it("the calculator store no longer writes either store itself", () => {
		const store = read("lib/growth-target-store.ts");
		expect(store).not.toMatch(DIRECT_WRITE);
		expect(store).toContain("writePondGrowthTarget(");
		expect(store).toContain("writeCycleTargetMirror(");
	});

	it("the guarded module keeps the single mirror write", () => {
		const module = read("lib/crop-cycle/target-write.ts");
		expect(module).toContain("data: { targetHarvestWeightG: params.weightG }");
	});
});
