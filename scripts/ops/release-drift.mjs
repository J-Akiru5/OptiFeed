#!/usr/bin/env node
/**
 * Validate the release version set and refuse unreleased commits on `main`.
 *
 * The release workflow runs this on every push to `main`, after a checkout with
 * full history and tags. It answers one question: is `HEAD` covered by the
 * published tag for the version in `package.json`?
 *
 * The version is one set, so all of these must agree:
 *
 * - `package.json`
 * - `apps/web/package.json`
 * - `apps/web/lib/legal/config.ts` (`LEGAL_APP_RELEASE`)
 * - `CHANGELOG.md` (`## [x.y.z]`)
 * - the `vx.y.z` tag
 *
 * When the tag exists and is an ancestor of `HEAD`, every commit in
 * `vx.y.z..HEAD` must be an explicit exemption: a release-preparation merge, a
 * revert of a failed release, or a `chore(release): x.y.z` commit. Anything
 * else fails with the exact range and the fix. There is no environment
 * variable, label or `[skip ci]` bypass.
 *
 * Usage:
 *   node scripts/ops/release-drift.mjs [--repo <dir>] [--head <ref>] [--version <x.y.z>]
 *
 * Exit code 0 means the version set is consistent and `HEAD` is released (or is
 * an untagged new version the workflow is about to tag). Exit code 1 means the
 * release must not proceed.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SEMVER = /^\d+\.\d+\.\d+$/;
const CHORE_RELEASE = /^chore\(release\):\s*v?\d+\.\d+\.\d+\b/i;
const REVERT = /^(?:Revert|revert)\b/;
const RELEASE_PREP_PR =
	/^Merge pull request #\d+ from [^/\s]+\/(?:release\/|release-|chore\/release-)/i;
const RELEASE_PREP_BRANCH = /^Merge branch '(?:release\/|release-|chore\/release-)/i;
const RELEASE_FILES = new Set([
	"package.json",
	"apps/web/package.json",
	"apps/web/lib/legal/config.ts",
	"CHANGELOG.md",
]);

/** @param {string} message */
function info(message) {
	console.log(`release-drift: ${message}`);
}

/** @param {"error" | "notice"} level @param {string} message */
function annotate(level, message) {
	if (process.env.GITHUB_ACTIONS === "true") {
		console.error(`::${level}::${message.replace(/\r?\n/g, " ")}`);
		return;
	}
	console.error(`${level}: ${message}`);
}

/**
 * Run git in the target repository without a shell, so arguments cannot be
 * interpreted by the host shell (important on Windows).
 *
 * @param {string} repo
 * @param {string[]} args
 * @param {{ allowFailure?: boolean }} [options]
 * @returns {string | null}
 */
function git(repo, args, options = {}) {
	const result = spawnSync("git", ["-C", repo, ...args], {
		encoding: "utf8",
		maxBuffer: 10 * 1024 * 1024,
		windowsHide: true,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		if (options.allowFailure) return null;
		const detail = (result.stderr || result.stdout || "").trim();
		throw new Error(`git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
	}
	return result.stdout.replace(/\r\n/g, "\n").trim();
}

/** @param {string} repo @param {string} ancestor @param {string} descendant */
function isAncestor(repo, ancestor, descendant) {
	const result = spawnSync(
		"git",
		["-C", repo, "merge-base", "--is-ancestor", ancestor, descendant],
		{ encoding: "utf8", windowsHide: true },
	);
	if (result.status === 0) return true;
	if (result.status === 1) return false;
	throw new Error(
		`git merge-base --is-ancestor ${ancestor} ${descendant} failed: ${(
			result.stderr || ""
		).trim()}`,
	);
}

/** @param {string} repo @param {string} sha */
function commitDetails(repo, sha) {
	const parents = git(repo, ["show", "-s", "--format=%P", sha]) ?? "";
	const subject = git(repo, ["show", "-s", "--format=%s", sha]) ?? "";
	const body = git(repo, ["show", "-s", "--format=%b", sha]) ?? "";
	return {
		sha,
		parents: parents ? parents.split(" ").filter(Boolean) : [],
		subject,
		body,
	};
}

/** @param {string} repo @param {string} sha @param {string[]} parents */
function changedFiles(repo, sha, parents) {
	if (parents.length === 0) return [];
	const output = git(repo, ["diff", "--name-only", parents[0], sha]) ?? "";
	return output ? output.split("\n").filter(Boolean) : [];
}

/**
 * A `chore(release): x.y.z` commit is exempt only when every file it changes is
 * part of the release metadata. It cannot carry application code.
 *
 * @param {string} repo
 * @param {{ parents: string[]; subject: string; sha: string }} commit
 */
function isChoreReleaseCommit(repo, commit) {
	if (!CHORE_RELEASE.test(commit.subject)) return false;
	const files = changedFiles(repo, commit.sha, commit.parents);
	return files.length > 0 && files.every((file) => RELEASE_FILES.has(file));
}

/** @param {string} repo @param {{ parents: string[]; subject: string; sha: string }} commit */
function isReleasePrepMerge(repo, commit) {
	if (commit.parents.length < 2) return false;
	if (!RELEASE_PREP_PR.test(commit.subject) && !RELEASE_PREP_BRANCH.test(commit.subject)) {
		return false;
	}
	return changedFiles(repo, commit.sha, commit.parents).some((file) => RELEASE_FILES.has(file));
}

/**
 * A reverted commit counts as a release commit when it is a version-bump
 * commit, a release-preparation merge, or a merge that changed a version file.
 *
 * @param {string} repo
 * @param {string} sha
 */
function isReleaseCommit(repo, sha) {
	const commit = commitDetails(repo, sha);
	if (isChoreReleaseCommit(repo, commit)) return true;
	if (isReleasePrepMerge(repo, commit)) return true;
	if (commit.parents.length >= 2) {
		return changedFiles(repo, commit.sha, commit.parents).some(
			(file) => file === "package.json" || file === "apps/web/package.json",
		);
	}
	return false;
}

/**
 * Return a human-readable reason when the commit is an explicit exemption, or
 * null when it is ordinary unreleased work.
 *
 * @param {string} repo
 * @param {{ sha: string; parents: string[]; subject: string; body: string }} commit
 * @returns {string | null}
 */
function exemptionFor(repo, commit) {
	if (CHORE_RELEASE.test(commit.subject)) {
		return isChoreReleaseCommit(repo, commit) ? "chore(release) version commit" : null;
	}

	if (REVERT.test(commit.subject)) {
		const target = commit.body.match(/This reverts commit ([0-9a-f]{7,40})\.?/i);
		if (!target) return null;
		const reverted =
			git(repo, ["rev-parse", "--verify", `${target[1]}^{commit}`], { allowFailure: true }) ?? "";
		if (!reverted) return null;
		if (!isReleaseCommit(repo, reverted)) return null;
		return `revert of release commit ${reverted.slice(0, 7)}`;
	}

	if (isReleasePrepMerge(repo, commit)) {
		return "release-preparation merge";
	}

	return null;
}

/** @param {string} repo @param {string} tag @param {string} headSha */
function listCommits(repo, tag, headSha) {
	const output = git(repo, ["rev-list", "--reverse", `${tag}..${headSha}`]) ?? "";
	return output ? output.split("\n").filter(Boolean) : [];
}

/**
 * @param {string} repo
 * @param {string} headRef
 * @param {string} version
 */
function checkTag(repo, headRef, version) {
	const tag = `v${version}`;
	const tagRef = `refs/tags/${tag}`;
	const headSha = git(repo, ["rev-parse", "--verify", `${headRef}^{commit}`]);
	if (!headSha) throw new Error(`cannot resolve ${headRef}`);

	const tagSha = git(repo, ["rev-parse", "--verify", tagRef], { allowFailure: true });
	if (!tagSha) {
		annotate(
			"notice",
			`${tag} does not exist yet; the release workflow will create it at ${headRef}.`,
		);
		info(`HEAD is the first commit for ${tag}; the tag is pending.`);
		return;
	}

	const tagCommit = git(repo, ["rev-parse", "--verify", `${tagRef}^{commit}`]);
	if (!tagCommit) throw new Error(`${tag} does not resolve to a commit`);

	if (tagCommit === headSha) {
		info(`HEAD is ${tag}; every commit on main belongs to this release.`);
		return;
	}

	if (!isAncestor(repo, tagCommit, headSha)) {
		if (isAncestor(repo, headSha, tagCommit)) {
			annotate(
				"error",
				`${headRef} is behind ${tag} (${tagCommit.slice(0, 7)}); a release tag may not point past main.`,
			);
		} else {
			annotate(
				"error",
				`${tag} points at ${tagCommit.slice(0, 7)}, which is not an ancestor of ${headRef}. Published tags are immutable; bump the version instead of moving ${tag}.`,
			);
		}
		process.exitCode = 1;
		return;
	}

	const commits = listCommits(repo, tag, headSha);
	const classified = commits.map((sha) => {
		const commit = commitDetails(repo, sha);
		return { ...commit, exemption: exemptionFor(repo, commit) };
	});
	const exempt = classified.filter((commit) => commit.exemption);
	const offending = classified.filter((commit) => !commit.exemption);

	if (offending.length === 0) {
		annotate(
			"notice",
			`All ${classified.length} commits after ${tag} are explicit release exemptions; no version bump is required.`,
		);
		for (const commit of exempt) {
			info(`exempt ${commit.sha.slice(0, 7)} ${commit.subject} -- ${commit.exemption}`);
		}
		return;
	}

	const count = classified.length;
	const plural = count === 1 ? "commit" : "commits";
	const offendingPhrase =
		offending.length === 1
			? "is not an explicit release exemption"
			: "are not explicit release exemptions";
	annotate(
		"error",
		`main is ${count} ${plural} past ${tag} (${tag}..${headRef}); ${offending.length} of ${count} ${plural} ${offendingPhrase}, so main carries code that no published release covers.`,
	);

	if (exempt.length > 0) {
		for (const commit of exempt) {
			info(`exempt ${commit.sha.slice(0, 7)} ${commit.subject} -- ${commit.exemption}`);
		}
	}

	console.error("release-drift: commits that need a release:");
	for (const commit of offending) {
		console.error(`  ${commit.sha.slice(0, 7)} ${commit.subject}`);
	}

	annotate(
		"error",
		"Fix: bump the version in package.json, apps/web/package.json and apps/web/lib/legal/config.ts (LEGAL_APP_RELEASE), add a matching '## [<next version>]' section to CHANGELOG.md, commit it as 'chore(release): <next version>', and promote that commit to main. The release workflow then tags and publishes the new version.",
	);
	process.exitCode = 1;
}

/** @param {string} repo */
function readLegalRelease(repo) {
	try {
		const source = readFileSync(join(repo, "apps", "web", "lib", "legal", "config.ts"), "utf8");
		const match = source.match(/export const LEGAL_APP_RELEASE\s*=\s*["']([^"']+)["']/);
		return match ? match[1] : null;
	} catch {
		return null;
	}
}

/** @param {string[]} argv */
function parseArgs(argv) {
	const options = { repo: process.cwd(), head: "HEAD", version: null };
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--help" || argument === "-h") {
			console.log(
				"usage: node scripts/ops/release-drift.mjs [--repo <dir>] [--head <ref>] [--version <x.y.z>]",
			);
			process.exit(0);
		}
		if (argument === "--repo" || argument === "--head" || argument === "--version") {
			const value = argv[index + 1];
			if (!value) throw new Error(`${argument} requires a value`);
			options[argument.slice(2)] = value;
			index += 1;
			continue;
		}
		throw new Error(`unknown argument: ${argument}`);
	}
	return options;
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	const repo = resolve(options.repo);

	const root = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
	const app = JSON.parse(readFileSync(join(repo, "apps", "web", "package.json"), "utf8"));
	const changelog = readFileSync(join(repo, "CHANGELOG.md"), "utf8");
	const rootVersion = String(root.version ?? "");
	const appVersion = String(app.version ?? "");
	const legalVersion = readLegalRelease(repo);

	const problems = [];
	if (!SEMVER.test(rootVersion)) {
		problems.push(`package.json version "${rootVersion}" is not a major.minor.patch version.`);
	}
	if (appVersion !== rootVersion) {
		problems.push(
			`apps/web/package.json version "${appVersion}" does not match package.json version "${rootVersion}".`,
		);
	}
	if (legalVersion !== rootVersion) {
		problems.push(
			`apps/web/lib/legal/config.ts LEGAL_APP_RELEASE "${legalVersion ?? "missing"}" does not match package.json version "${rootVersion}".`,
		);
	}
	if (options.version && options.version !== rootVersion) {
		problems.push(
			`--version "${options.version}" does not match package.json version "${rootVersion}".`,
		);
	}
	if (!changelog.split(/\r?\n/).some((line) => line.startsWith(`## [${rootVersion}]`))) {
		problems.push(
			`CHANGELOG.md has no '## [${rootVersion}]' section; add it in the release PR before promoting to main.`,
		);
	}

	if (problems.length > 0) {
		for (const problem of problems) annotate("error", problem);
		annotate(
			"error",
			"The release version set (root and apps/web manifests, LEGAL_APP_RELEASE, CHANGELOG.md and the tag) must agree before main can be released.",
		);
		process.exitCode = 1;
		return;
	}

	info(
		`version set OK: root=${rootVersion} apps/web=${appVersion} legal=${legalVersion} changelog=present`,
	);
	checkTag(repo, options.head, rootVersion);
}

try {
	main();
} catch (error) {
	annotate(
		"error",
		`release-drift could not run: ${error instanceof Error ? error.message : error}`,
	);
	process.exitCode = 1;
}
