import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const cwd = process.cwd();
const repoRoot = existsSync(join(cwd, "scripts", "perf", "api-latency.mjs"))
	? cwd
	: join(cwd, "..", "..");
const source = readFileSync(join(repoRoot, "scripts", "perf", "api-latency.mjs"), "utf8");

describe("api-latency spawned-server cleanup", () => {
	it("puts the POSIX server shell in its own process group", () => {
		expect(source).toContain('detached: process.platform !== "win32"');
	});

	it("signals the whole POSIX process group, not just the shell", () => {
		expect(source).toContain('process.kill(-child.pid, "SIGTERM")');
	});

	it("releases the child pipes so a leaked server cannot hold the job open", () => {
		expect(source).toContain("child.stdout?.destroy()");
		expect(source).toContain("child.stderr?.destroy()");
		expect(source).toContain("child.unref()");
	});

	it("has a bounded exit even if a handle survives stop()", () => {
		expect(source).toContain("setTimeout(() => process.exit(exitCode), 5_000).unref()");
	});
});
