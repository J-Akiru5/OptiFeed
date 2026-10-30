import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const cwd = process.cwd();
const repoRoot = existsSync(join(cwd, ".github", "workflows", "release.yml"))
	? cwd
	: join(cwd, "..", "..");
const workflow = readFileSync(join(repoRoot, ".github", "workflows", "release.yml"), "utf8");

describe("release workflow", () => {
	it("sets a git identity before creating the annotated tag", () => {
		const name = workflow.indexOf('git config user.name "github-actions[bot]"');
		const email = workflow.indexOf(
			'git config user.email "41898282+github-actions[bot]@users.noreply.github.com"',
		);
		const tag = workflow.indexOf('git tag -a "v${VERSION}"');

		expect(name).toBeGreaterThan(-1);
		expect(email).toBeGreaterThan(-1);
		expect(tag).toBeGreaterThan(-1);
		expect(name).toBeLessThan(tag);
		expect(email).toBeLessThan(tag);
	});
});
