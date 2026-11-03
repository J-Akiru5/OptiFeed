#!/usr/bin/env node
/**
 * Prove both directions of the deployment-policy drift check against throwaway
 * fixtures:
 *
 * - the documented `main` + `staging` allowlist passes;
 * - enabling `develop`, a feature branch, or a default glob fails with a
 *   message that names the branch and the decision;
 * - a document that disagrees with the config fails;
 * - removing the allowlist block or the Deployment Protection requirement
 *   fails.
 *
 * Run: node --test scripts/ops/__tests__/deployment-policy-drift.test.mjs
 *
 * The fixtures live under the OS temporary directory. The OptiFeed repository
 * itself is only read by the final smoke test.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const CHECK = fileURLToPath(new URL("../deployment-policy.mjs", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MARKER = "Deployment eligibility is restricted in `apps/web/vercel.json`";
const tempRepos = [];

const GOOD = Object.freeze({
	"*": false,
	"**": false,
	main: true,
	staging: true,
});

after(() => {
	for (const repo of tempRepos) {
		rmSync(repo, { recursive: true, force: true });
	}
});

/** @param {string} repo @param {string} relative @param {string} content */
function writeFile(repo, relative, content) {
	const target = join(repo, relative);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, content, "utf8");
}

/**
 * @param {string} repo
 * @param {Record<string, unknown>} [documented]
 */
function writeDocument(repo, documented = GOOD, options = {}) {
	const { marker = true, protection = true, json = true } = options;
	const lines = ["# Deployment workflow", ""];
	if (marker) lines.push(`${MARKER}:`, "");
	if (json) {
		lines.push(
			"```json",
			JSON.stringify({ git: { deploymentEnabled: documented } }, null, "\t"),
			"```",
			"",
		);
	}
	if (protection) {
		lines.push(
			"## 2.1 Deployment Protection",
			"",
			"Vercel Deployment Protection uses Vercel Authentication for preview deployments.",
			"",
		);
	}
	writeFile(repo, "docs/deployment-workflow.md", `${lines.join("\n")}\n`);
}

/**
 * @param {Record<string, unknown>} enabled
 * @param {{ documented?: Record<string, unknown>; marker?: boolean; protection?: boolean; json?: boolean }} [options]
 */
function createRepo(enabled = GOOD, options = {}) {
	const repo = mkdtempSync(join(tmpdir(), "optifeed-deployment-policy-"));
	tempRepos.push(repo);
	writeFile(
		repo,
		"apps/web/vercel.json",
		`${JSON.stringify({ git: { deploymentEnabled: enabled } }, null, "\t")}\n`,
	);
	writeDocument(repo, options.documented ?? enabled, options);
	return repo;
}

/** @param {string} repo @param {string[]} [extraArgs] */
function runCheck(repo, extraArgs = []) {
	const result = spawnSync(process.execPath, [CHECK, "--repo", repo, ...extraArgs], {
		encoding: "utf8",
		env: { ...process.env, GITHUB_ACTIONS: "" },
		windowsHide: true,
	});
	return {
		status: result.status,
		stdout: result.stdout,
		stderr: result.stderr,
	};
}

test("passes when main + staging deploy and the document matches", () => {
	const result = runCheck(createRepo());
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /deployment-policy: OK/);
	assert.match(result.stdout, /main \+ staging deploy/);
	assert.match(result.stdout, /decision D7/);
});

test("passes with an explicit develop: false and extra denied branches", () => {
	const result = runCheck(
		createRepo({
			...GOOD,
			develop: false,
			"feature/*": false,
			"agent/*": false,
		}),
	);
	assert.equal(result.status, 0, result.stderr);
});

test("fails when develop is enabled and names the branch", () => {
	const result = runCheck(createRepo({ ...GOOD, develop: true }));
	assert.equal(result.status, 1);
	assert.match(
		result.stderr,
		/apps\/web\/vercel\.json sets git\.deploymentEnabled\.develop = true/,
	);
	assert.match(result.stderr, /develop is validation-only/);
	assert.match(result.stderr, /decision D7/);
	assert.match(
		result.stderr,
		/deployment-policy: 1 drift problem\(s\)\. OptiFeed deploys main \+ staging only/,
	);
});

test("fails when staging is no longer enabled", () => {
	const result = runCheck(createRepo({ "*": false, "**": false, main: true }));
	assert.equal(result.status, 1);
	assert.match(
		result.stderr,
		/must set git\.deploymentEnabled\["staging"\] = true; staging is a deployment branch/,
	);
	assert.match(result.stderr, /decision D7/);
});

test("fails when the default glob is enabled", () => {
	const result = runCheck(createRepo({ ...GOOD, "*": true }));
	assert.equal(result.status, 1);
	assert.match(
		result.stderr,
		/must set git\.deploymentEnabled\["\*"\] = false; otherwise branches that do not match main\/staging can deploy/,
	);
});

test("fails when a feature branch key is enabled", () => {
	const result = runCheck(createRepo({ ...GOOD, "feature/policy-drift": true }));
	assert.equal(result.status, 1);
	assert.match(result.stderr, /"feature\/policy-drift"\] = true/);
	assert.match(result.stderr, /only main and staging may be true/);
});

test("fails when the document disagrees with the config", () => {
	const result = runCheck(createRepo(GOOD, { documented: { ...GOOD, develop: true } }));
	assert.equal(result.status, 1);
	assert.match(
		result.stderr,
		/docs\/deployment-workflow\.md documents .*"develop": true.* but apps\/web\/vercel\.json has/,
	);
	assert.match(result.stderr, /update the document \(or the config\) so they agree/);
	assert.match(result.stderr, /repository policy is main \+ staging/);
});

test("fails when the document no longer shows the allowlist block", () => {
	const result = runCheck(createRepo(GOOD, { marker: false }));
	assert.equal(result.status, 1);
	assert.match(
		result.stderr,
		/docs\/deployment-workflow\.md no longer contains the allowlist block/,
	);
});

test("fails when the Deployment Protection requirement is no longer documented", () => {
	const result = runCheck(createRepo(GOOD, { protection: false }));
	assert.equal(result.status, 1);
	assert.match(result.stderr, /no longer documents the required preview control/);
	assert.match(
		result.stderr,
		/Deployment Protection for preview deployments is a hard requirement/,
	);
});

test("fails when vercel.json is missing", () => {
	const repo = mkdtempSync(join(tmpdir(), "optifeed-deployment-policy-"));
	tempRepos.push(repo);
	writeDocument(repo);
	const result = runCheck(repo);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /cannot read apps\/web\/vercel\.json/);
});

test("fails when deploymentEnabled is not an object", () => {
	const repo = mkdtempSync(join(tmpdir(), "optifeed-deployment-policy-"));
	tempRepos.push(repo);
	writeFile(repo, "apps/web/vercel.json", '{"git":{"deploymentEnabled":true}}\n');
	writeDocument(repo);
	const result = runCheck(repo);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /git\.deploymentEnabled as an object/);
});

test("--help exits 0 and prints usage", () => {
	const result = runCheck(createRepo(), ["--help"]);
	assert.equal(result.status, 0);
	assert.match(result.stdout, /Usage: node scripts\/ops\/deployment-policy\.mjs/);
});

test("the checked-out OptiFeed repository matches its documented policy", () => {
	const result = runCheck(REPO_ROOT);
	assert.equal(result.status, 0, result.stderr);
});
