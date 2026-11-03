#!/usr/bin/env node
/**
 * Guard OptiFeed's deployment policy against drift.
 *
 * Owner decision D7 (reconfirmed 2026-11-04): this repository deploys `main` +
 * `staging` only. The global OpenCode governance default (`main` + `develop`)
 * does not apply here, and `develop` is validation-only.
 *
 * The check is deliberately narrow and static:
 *
 * 1. `apps/web/vercel.json` must enable exactly `main` and `staging`.
 * 2. `*` and `**` must be `false`, `develop` must not be enabled, and no other
 *    branch key may be `true` (so a feature branch cannot become deployable).
 * 3. The allowlist block in `docs/deployment-workflow.md` must match the config.
 * 4. The document must keep stating the required Vercel Deployment Protection
 *    control for preview deployments. The control itself is dashboard-only and
 *    cannot be verified from the repository.
 *
 * Usage:
 *   node scripts/ops/deployment-policy.mjs [--repo <dir>]
 *
 * Exit codes: 0 = policy and documentation agree, 1 = drift, 2 = the check
 * could not run (unreadable or malformed input).
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const DECISION = "D7";
export const DEPLOY_BRANCHES = Object.freeze(["main", "staging"]);
export const DENY_GLOBS = Object.freeze(["*", "**"]);
export const CONFIG_PATH = "apps/web/vercel.json";
export const DOC_PATH = "docs/deployment-workflow.md";

const DOC_MARKER = "Deployment eligibility is restricted in `apps/web/vercel.json`";
const PROTECTION_MARKERS = Object.freeze(["Deployment Protection", "Vercel Authentication"]);

/** @param {"error" | "notice"} level @param {string} message */
function annotate(level, message) {
	if (process.env.GITHUB_ACTIONS === "true") {
		console.error(`::${level}::${message.replace(/\r?\n/g, " ")}`);
		return;
	}
	console.error(`${level}: ${message}`);
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {Record<string, unknown>} entries */
function describeEntries(entries) {
	const keys = Object.keys(entries).sort();
	return `{${keys.map((key) => `${JSON.stringify(key)}: ${JSON.stringify(entries[key])}`).join(", ")}}`;
}

/** @param {Record<string, unknown>} left @param {Record<string, unknown>} right */
function sameEntries(left, right) {
	const leftKeys = Object.keys(left).sort();
	const rightKeys = Object.keys(right).sort();
	if (leftKeys.length !== rightKeys.length) return false;
	return leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

/**
 * Read the documented allowlist from the fenced JSON block that follows the
 * marker. The document shows a partial object (`{ "git": { ... } }`), which is
 * intentional: it is the same shape as the config.
 *
 * @param {string} document
 * @returns {{ value?: Record<string, unknown>; error?: string }}
 */
export function parseDocumentedPolicy(document) {
	const markerAt = document.indexOf(DOC_MARKER);
	if (markerAt === -1) {
		return {
			error: `${DOC_PATH} no longer contains the allowlist block ("${DOC_MARKER}"); the policy document must show the same deploymentEnabled set as ${CONFIG_PATH}.`,
		};
	}
	const fenceAt = document.indexOf("```json", markerAt);
	if (fenceAt === -1) {
		return {
			error: `${DOC_PATH} has no \`\`\`json block after the allowlist marker; show the deploymentEnabled object there.`,
		};
	}
	const bodyStart = fenceAt + "```json".length;
	const fenceEnd = document.indexOf("```", bodyStart);
	if (fenceEnd === -1) {
		return { error: `${DOC_PATH} has an unterminated \`\`\`json allowlist block.` };
	}
	try {
		const value = JSON.parse(document.slice(bodyStart, fenceEnd));
		return { value };
	} catch (error) {
		return {
			error: `${DOC_PATH} allowlist block is not valid JSON: ${error instanceof Error ? error.message : error}`,
		};
	}
}

/**
 * Evaluate the repository policy. Returns every problem instead of stopping at
 * the first one, so one run reports all drift.
 *
 * @param {string} repo
 * @returns {{ problems: string[]; config: Record<string, unknown> | null; documented: Record<string, unknown> | null }}
 */
export function evaluatePolicy(repo) {
	/** @type {string[]} */
	const problems = [];

	/** @type {unknown} */
	let config;
	try {
		config = JSON.parse(readFileSync(join(repo, CONFIG_PATH), "utf8"));
	} catch (error) {
		return {
			problems: [
				`cannot read ${CONFIG_PATH}: ${error instanceof Error ? error.message : error}. The acceptance policy must declare git.deploymentEnabled.`,
			],
			config: null,
			documented: null,
		};
	}

	const enabled = isRecord(config) && isRecord(config.git) ? config.git.deploymentEnabled : null;
	if (!isRecord(enabled)) {
		return {
			problems: [
				`${CONFIG_PATH} must contain git.deploymentEnabled as an object; found ${JSON.stringify(enabled)}.`,
			],
			config: null,
			documented: null,
		};
	}

	for (const branch of DEPLOY_BRANCHES) {
		if (enabled[branch] !== true) {
			problems.push(
				`${CONFIG_PATH} must set git.deploymentEnabled[${JSON.stringify(branch)}] = true; ${branch} is a deployment branch (decision ${DECISION}).`,
			);
		}
	}
	for (const glob of DENY_GLOBS) {
		if (enabled[glob] !== false) {
			problems.push(
				`${CONFIG_PATH} must set git.deploymentEnabled[${JSON.stringify(glob)}] = false; otherwise branches that do not match main/staging can deploy.`,
			);
		}
	}
	if (enabled.develop !== undefined && enabled.develop !== false) {
		problems.push(
			`${CONFIG_PATH} sets git.deploymentEnabled.develop = ${JSON.stringify(enabled.develop)}; develop is validation-only and must never deploy (decision ${DECISION}).`,
		);
	}
	for (const [branch, value] of Object.entries(enabled)) {
		if (branch === "main" || branch === "staging" || branch === "develop") continue;
		if (value !== false) {
			problems.push(
				`${CONFIG_PATH} sets git.deploymentEnabled[${JSON.stringify(branch)}] = ${JSON.stringify(value)}; only main and staging may be true (decision ${DECISION}).`,
			);
		}
	}

	/** @type {string} */
	let document;
	try {
		document = readFileSync(join(repo, DOC_PATH), "utf8");
	} catch (error) {
		return {
			problems: [
				...problems,
				`cannot read ${DOC_PATH}: ${error instanceof Error ? error.message : error}. The policy document must state the allowlist.`,
			],
			config: enabled,
			documented: null,
		};
	}

	const parsed = parseDocumentedPolicy(document);
	if (parsed.error || !isRecord(parsed.value)) {
		problems.push(parsed.error ?? `${DOC_PATH} allowlist block is empty.`);
	} else {
		const documentedEnabled = isRecord(parsed.value.git)
			? parsed.value.git.deploymentEnabled
			: null;
		if (!isRecord(documentedEnabled)) {
			problems.push(
				`${DOC_PATH} allowlist block does not contain git.deploymentEnabled; show the same object as ${CONFIG_PATH}.`,
			);
		} else if (!sameEntries(enabled, documentedEnabled)) {
			problems.push(
				`${DOC_PATH} documents ${describeEntries(documentedEnabled)} but ${CONFIG_PATH} has ${describeEntries(enabled)}; update the document (or the config) so they agree. The repository policy is main + staging (decision ${DECISION}).`,
			);
		}
	}

	for (const marker of PROTECTION_MARKERS) {
		if (!document.includes(marker)) {
			problems.push(
				`${DOC_PATH} no longer documents the required preview control ("${marker}"); Vercel Deployment Protection for preview deployments is a hard requirement (decision ${DECISION}).`,
			);
		}
	}

	return { problems, config: enabled, documented: parsed.value ?? null };
}

function usage() {
	return [
		"Usage: node scripts/ops/deployment-policy.mjs [--repo <dir>]",
		"",
		"Checks that apps/web/vercel.json deploys main + staging only, that",
		"docs/deployment-workflow.md documents the same allowlist, and that the",
		"preview Deployment Protection requirement is still documented.",
	].join("\n");
}

/** @param {string[]} argv */
function parseArgs(argv) {
	/** @type {{ repo: string; help: boolean }} */
	const options = { repo: process.cwd(), help: false };
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--help" || argument === "-h") {
			options.help = true;
			continue;
		}
		if (argument === "--repo") {
			const value = argv[index + 1];
			if (!value) throw new Error("--repo requires a value");
			options.repo = value;
			index += 1;
			continue;
		}
		throw new Error(`unknown argument: ${argument}`);
	}
	return options;
}

function main() {
	let options;
	try {
		options = parseArgs(process.argv.slice(2));
	} catch (error) {
		console.error(
			`deployment-policy: ${error instanceof Error ? error.message : error}\n\n${usage()}`,
		);
		return 2;
	}
	if (options.help) {
		console.log(usage());
		return 0;
	}

	const { problems } = evaluatePolicy(resolve(options.repo));
	if (problems.length > 0) {
		for (const problem of problems) annotate("error", problem);
		annotate(
			"error",
			`deployment-policy: ${problems.length} drift problem(s). OptiFeed deploys main + staging only (decision ${DECISION}); keep the config and the document in agreement.`,
		);
		return 1;
	}

	console.log(
		`deployment-policy: OK - main + staging deploy; develop, feature branches and the default globs do not; ${DOC_PATH} matches the config (decision ${DECISION}).`,
	);
	return 0;
}

try {
	process.exitCode = main();
} catch (error) {
	annotate(
		"error",
		`deployment-policy could not run: ${error instanceof Error ? error.message : error}`,
	);
	process.exitCode = 2;
}
