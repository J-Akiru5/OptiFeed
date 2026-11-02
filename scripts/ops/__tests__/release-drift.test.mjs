#!/usr/bin/env node
/**
 * Prove both directions of the release-drift check against throwaway git
 * repositories:
 *
 * - a bumped and tagged version passes;
 * - main advancing past the tag with ordinary commits fails with the range;
 * - the narrow exemptions pass only when every commit is exempt.
 *
 * Run: node --test scripts/ops/__tests__/release-drift.test.mjs
 *
 * The fixtures live under the OS temporary directory. No tag, branch or commit
 * is created in the OptiFeed repository itself.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const CHECK = fileURLToPath(new URL("../release-drift.mjs", import.meta.url));
const tempRepos = [];

after(() => {
	for (const repo of tempRepos) {
		rmSync(repo, { recursive: true, force: true });
	}
});

/** @param {string} repo @param {string[]} args */
function runGit(repo, args) {
	const result = spawnSync("git", ["-C", repo, ...args], {
		encoding: "utf8",
		windowsHide: true,
	});
	assert.equal(
		result.status,
		0,
		`git ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`,
	);
	return result.stdout.trim();
}

/** @param {string} repo @param {string} relative @param {string} content */
function writeFile(repo, relative, content) {
	const target = join(repo, relative);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, content, "utf8");
}

/**
 * Write the complete release version set for one version.
 *
 * @param {string} repo
 * @param {string} version
 */
function writeRelease(repo, version) {
	writeFile(
		repo,
		"package.json",
		`${JSON.stringify({ name: "release-drift", version }, null, 2)}\n`,
	);
	writeFile(
		repo,
		"apps/web/package.json",
		`${JSON.stringify({ name: "web", version }, null, 2)}\n`,
	);
	writeFile(
		repo,
		"apps/web/lib/legal/config.ts",
		`export const LEGAL_APP_RELEASE = "${version}";\n`,
	);
	writeFile(
		repo,
		"CHANGELOG.md",
		`# Changelog\n\n## [Unreleased]\n\n## [${version}] - 2026-01-01\n\n- fixture\n`,
	);
}

/**
 * @param {string} repo
 * @param {string} message
 * @param {Record<string, string>} [files]
 */
function commit(repo, message, files = {}) {
	for (const [relative, content] of Object.entries(files)) writeFile(repo, relative, content);
	runGit(repo, ["add", "-A"]);
	runGit(repo, ["commit", "-q", "-m", message]);
}

/** @param {string} repo */
function createRepo() {
	const repo = mkdtempSync(join(tmpdir(), "optifeed-release-drift-"));
	tempRepos.push(repo);
	runGit(repo, ["init", "-q", "-b", "main"]);
	runGit(repo, ["config", "user.name", "Release Drift Test"]);
	runGit(repo, ["config", "user.email", "release-drift@example.test"]);
	runGit(repo, ["config", "commit.gpgsign", "false"]);
	writeRelease(repo, "1.0.0");
	commit(repo, "chore(release): 1.0.0");
	runGit(repo, ["tag", "-a", "v1.0.0", "-m", "v1.0.0"]);
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

test("passes when HEAD is the tagged release commit", () => {
	const repo = createRepo();
	const result = runCheck(repo);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /HEAD is v1\.0\.0; every commit on main belongs to this release/);
});

test("validates the --version the workflow passes", () => {
	const repo = createRepo();
	const matching = runCheck(repo, ["--version", "1.0.0"]);
	assert.equal(matching.status, 0, matching.stderr);

	const mismatch = runCheck(repo, ["--version", "9.9.9"]);
	assert.equal(mismatch.status, 1);
	assert.match(
		mismatch.stderr,
		/--version "9\.9\.9" does not match package\.json version "1\.0\.0"/,
	);
});

test("passes after a version bump, before and after the new tag", () => {
	const repo = createRepo();
	commit(repo, "feat: add the next release content", { "feature.txt": "feature\n" });
	writeRelease(repo, "1.1.0");
	commit(repo, "chore(release): 1.1.0");

	const untagged = runCheck(repo);
	assert.equal(untagged.status, 0, untagged.stderr);
	assert.match(untagged.stderr, /notice: v1\.1\.0 does not exist yet/);

	runGit(repo, ["tag", "-a", "v1.1.0", "-m", "v1.1.0"]);
	const tagged = runCheck(repo);
	assert.equal(tagged.status, 0, tagged.stderr);
	assert.match(tagged.stdout, /HEAD is v1\.1\.0; every commit on main belongs to this release/);
});

test("fails when main advanced past the tag without a version bump", () => {
	const repo = createRepo();
	commit(repo, "feat: unreleased work", { "feature.txt": "feature\n" });
	commit(repo, "fix: another unreleased change", { "fix.txt": "fix\n" });

	const result = runCheck(repo);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /error: main is 2 commits past v1\.0\.0 \(v1\.0\.0\.\.HEAD\)/);
	assert.match(result.stderr, /2 of 2 commits are not explicit release exemptions/);
	assert.match(result.stderr, /feat: unreleased work/);
	assert.match(result.stderr, /fix: another unreleased change/);
	assert.match(result.stderr, /Fix: bump the version in package\.json/);
	assert.match(result.stderr, /LEGAL_APP_RELEASE/);
	assert.match(result.stderr, /CHANGELOG\.md/);
});

test("a chore(release) commit does not hide an ordinary commit after it", () => {
	const repo = createRepo();
	commit(repo, "chore(release): 1.0.0", {
		"CHANGELOG.md":
			"# Changelog\n\n## [Unreleased]\n\n- note\n\n## [1.0.0] - 2026-01-01\n\n- fixture\n",
	});
	commit(repo, "feat: still unreleased", { "feature.txt": "feature\n" });

	const result = runCheck(repo);
	assert.equal(result.status, 1);
	assert.match(result.stdout, /exempt [0-9a-f]{7} chore\(release\): 1\.0\.0/);
	assert.match(result.stderr, /feat: still unreleased/);
	assert.doesNotMatch(
		result.stderr,
		/All 2 commits after v1\.0\.0 are explicit release exemptions/,
	);
});

test("a chore(release) commit that carries code is not exempt", () => {
	const repo = createRepo();
	commit(repo, "chore(release): 1.0.1", {
		"CHANGELOG.md":
			"# Changelog\n\n## [Unreleased]\n\n- note\n\n## [1.0.0] - 2026-01-01\n\n- fixture\n",
		"src/feature.ts": "export const unreleased = true;\n",
	});

	const result = runCheck(repo);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /chore\(release\): 1\.0\.1/);
	assert.match(result.stderr, /1 of 1 commit is not an explicit release exemption/);
});

test("passes when every commit is a release commit followed by its revert", () => {
	const repo = createRepo();
	writeRelease(repo, "1.0.1");
	commit(repo, "chore(release): 1.0.1");
	runGit(repo, ["revert", "--no-edit", "HEAD"]);

	const result = runCheck(repo);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stderr, /All 2 commits after v1\.0\.0 are explicit release exemptions/);
	assert.match(result.stdout, /chore\(release\) version commit/);
	assert.match(result.stdout, /revert of release commit/);
});

test("passes when every commit is a release-preparation merge and its preparatory commit", () => {
	const repo = createRepo();
	runGit(repo, ["switch", "-q", "-c", "release/1.0.1"]);
	commit(repo, "chore(release): 1.0.1", {
		"CHANGELOG.md":
			"# Changelog\n\n## [Unreleased]\n\n- note\n\n## [1.0.0] - 2026-01-01\n\n- fixture\n",
	});
	runGit(repo, ["switch", "-q", "main"]);
	runGit(repo, [
		"merge",
		"-q",
		"--no-ff",
		"-m",
		"Merge pull request #7 from owner/release/1.0.1",
		"release/1.0.1",
	]);

	const result = runCheck(repo);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stderr, /All 2 commits after v1\.0\.0 are explicit release exemptions/);
	assert.match(result.stdout, /release-preparation merge/);

	commit(repo, "feat: after the exempt merge", { "feature.txt": "feature\n" });
	const afterFeature = runCheck(repo);
	assert.equal(afterFeature.status, 1);
	assert.match(afterFeature.stderr, /feat: after the exempt merge/);
});

test("fails when apps/web package version disagrees", () => {
	const repo = createRepo();
	writeFile(repo, "apps/web/package.json", `${JSON.stringify({ version: "9.9.9" }, null, 2)}\n`);
	commit(repo, "chore: drift the app version");

	const result = runCheck(repo);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /apps\/web\/package\.json version "9\.9\.9" does not match/);
});

test("fails when LEGAL_APP_RELEASE disagrees", () => {
	const repo = createRepo();
	writeFile(repo, "apps/web/lib/legal/config.ts", 'export const LEGAL_APP_RELEASE = "9.9.9";\n');
	commit(repo, "chore: drift the legal release");

	const result = runCheck(repo);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /LEGAL_APP_RELEASE "9\.9\.9" does not match/);
});

test("fails when the changelog section is missing", () => {
	const repo = createRepo();
	writeFile(repo, "CHANGELOG.md", "# Changelog\n\n## [Unreleased]\n");
	commit(repo, "chore: drop the changelog section");

	const result = runCheck(repo);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /CHANGELOG\.md has no '## \[1\.0\.0\]' section/);
});
