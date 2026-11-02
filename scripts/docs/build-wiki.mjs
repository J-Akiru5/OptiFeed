import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Build the GitHub wiki mirror from the repository.
 *
 * The repo is the single source of truth: the plan, the ADRs, the mission log
 * and the runbooks are versioned with the code and reviewed through pull
 * requests. The wiki is a **generated window** onto them, pinned to one commit
 * so a stale page is visible at a glance.
 *
 * The builder is pure apart from reading the repository: it writes Markdown
 * into `--out` and never talks to GitHub. Publishing is the documented
 * `git -C <wiki clone> add/commit/push` step in `docs/README.md`.
 */

export const REPO_SLUG = "J-Akiru5/OptiFeed";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const PLAN = "docs/OPTIFEED-INDUSTRY-GRADE-PLAN v3.md";
const ADR_DIR = "docs/adr";
const MISSIONS_DIR = "docs/missions";

/**
 * @typedef {object} BuildOptions
 * @property {string} outDir
 * @property {string} [sha] Commit the pages claim to describe; defaults to HEAD.
 * @property {string} [repo] GitHub `owner/name`; defaults to this repository.
 * @property {string} [root] Repository root; defaults to this checkout.
 * @property {string} [date] Banner date; defaults to today (UTC).
 */

function read(root, path) {
	return readFileSync(join(root, path), "utf8");
}

function firstHeading(source, fallback) {
	const match = source.match(/^#\s+(.+)$/m);
	return match ? match[1].trim() : fallback;
}

function listFiles(root, dir, suffix = ".md") {
	return readdirSync(join(root, dir))
		.filter((name) => name.endsWith(suffix))
		.sort();
}

function encodePath(path) {
	return path.split("/").map(encodeURIComponent).join("/");
}

function blob(repo, sha, path) {
	return `https://github.com/${repo}/blob/${sha}/${encodePath(path)}`;
}

function banner(repo, sha, date, source, label) {
	return [
		"> **Generated mirror — do not edit this page.**",
		`> Source: [\`${source}\`](${blob(repo, sha, source)}) at \`${sha.slice(0, 7)}\` (${date}).`,
		`> ${label}`,
		"> Open a pull request against `develop` to change the canonical file.",
	].join("\n");
}

function table(headers, rows) {
	const head = `| ${headers.join(" | ")} |`;
	const rule = `| ${headers.map(() => "---").join(" | ")} |`;
	return [head, rule, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");
}

function truncate(value, limit = 160) {
	const cleaned = value.replace(/\s+/g, " ").trim();
	if (cleaned.length <= limit) return cleaned;
	const slice = cleaned.slice(0, limit - 1);
	const cut = slice.lastIndexOf(" ");
	const body = cut > limit * 0.6 ? slice.slice(0, cut) : slice;
	return `${body.trimEnd()}…`;
}

/** A Markdown table separator row, with or without spaces around the pipes. */
function isSeparatorRow(cells) {
	const filled = cells.filter(Boolean);
	return filled.length > 0 && filled.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function homePage(repo, sha, date) {
	return `${banner(repo, sha, date, "docs/README.md", "The map below is generated from the repository's documentation index.")}

# OptiFeed documentation

OptiFeed (PakaonAI) is a precision feeding console for African catfish farms:
Next.js 16, Supabase (Postgres + Auth), Prisma, pnpm workspace, English,
Hiligaynon and Tagalog.

## Read these first

| If you are… | Read |
| --- | --- |
| new to the codebase | [Developer handoff](${blob(repo, sha, "HANDOFF.md")}) |
| about to commit or open a PR | [Contributing](${blob(repo, sha, "CONTRIBUTING.md")}) — branch model and review rules |
| deploying or promoting a release | [Deployment](Deployment) |
| planning the next phase | [Plan](Plan) |
| checking why something is the way it is | [Decisions](Decisions) |
| picking up a task | [Missions](Missions) — the dated record, newest first |
| running the gates before a PR | [Quality](Quality) |

## How work moves

One task = one branch = one worktree. Work opens as a pull request into
\`develop\`; releases flow \`develop → staging → main\`. \`develop\` is
validation-only, \`staging\` is the release candidate and preview, \`main\` is
production. Agents stop at \`develop\`; only the owner promotes.

The full rules live in [Contributing](${blob(repo, sha, "CONTRIBUTING.md")}) and
the deployment matrix in [ADR-0001](${blob(repo, sha, "docs/adr/0001-deployment-model.md")}).

## What this wiki is

Every page here is generated from a file in the repository and pinned to the
commit shown at the top. If a page and the code disagree, the code wins — the
page is stale and should be regenerated. The canonical entry point is
[docs/README.md](${blob(repo, sha, "docs/README.md")}).
`;
}

function planPage(repo, sha, date, root) {
	const source = read(root, PLAN);
	const headings = source
		.split("\n")
		.filter((line) => /^##\s+/.test(line))
		.map((line) => line.replace(/^##\s+/, "").trim())
		.filter((heading) => heading.toLowerCase() !== "plan update log");

	const log = source.match(/## Plan update log([\s\S]*?)\n## /);
	const logRows = (log ? log[1] : "")
		.split("\n")
		.filter(
			(line) => line.startsWith("|") && !line.startsWith("| Date") && !line.startsWith("| ---"),
		)
		.map((line) => line.split("|").map((cell) => cell.trim()))
		.filter((cells) => cells.length > 4 && !isSeparatorRow(cells))
		.slice(0, 5)
		.map((cells) => [cells[1], truncate(cells[4])]);

	return `${banner(repo, sha, date, PLAN, "The plan is one versioned file; this page only summarises its shape.")}

# The hardening plan

[Read the plan at \`${sha.slice(0, 7)}\`](${blob(repo, sha, PLAN)}). It records
what to change, in what order, how each change is proven, and an update log with
the base commit of every amendment.

## Sections

${headings.map((heading) => `- ${heading}`).join("\n")}

## Recent amendments

${logRows.length > 0 ? table(["Date", "What changed"], logRows) : "See the update log in the plan."}
`;
}

function decisionsPage(repo, sha, date, root) {
	const files = listFiles(root, ADR_DIR).filter(
		(name) => name !== "README.md" && name !== "template.md",
	);
	const rows = files.map((name) => {
		const path = `${ADR_DIR}/${name}`;
		return [
			`\`${name}\``,
			firstHeading(read(root, path), name),
			`[read](${blob(repo, sha, path)})`,
		];
	});

	return `${banner(repo, sha, date, `${ADR_DIR}/README.md`, "One page per locked decision, each with its context and consequences.")}

# Decisions

Architecture decision records. A decision that changes behaviour gets an ADR
before the code that depends on it.

${table(["File", "Decision", "Link"], rows)}
`;
}

function missionsPage(repo, sha, date, root) {
	const all = listFiles(root, MISSIONS_DIR);
	const dated = all.filter((name) => /^\d{4}-\d{2}-\d{2}/.test(name)).sort().reverse();
	const undated = all.filter((name) => !/^\d{4}-\d{2}-\d{2}/.test(name));
	const files = [...dated, ...undated];
	const rows = files.map((name) => {
		const path = `${MISSIONS_DIR}/${name}`;
		return [
			`\`${name}\``,
			firstHeading(read(root, path), name),
			`[read](${blob(repo, sha, path)})`,
		];
	});

	return `${banner(repo, sha, date, MISSIONS_DIR, "Dated mission records: what was asked, what changed, what was verified.")}

# Missions

Newest first. A mission record is the durable answer to "why did this change
land, and what proved it worked?".

${table(["Date / task", "Title", "Link"], rows)}
`;
}

function deploymentPage(repo, sha, date) {
	const links = [
		["CONTRIBUTING.md", "Branch model, review rules and who may promote", "CONTRIBUTING.md"],
		["docs/deployment-workflow.md", "The pipeline itself", "docs/deployment-workflow.md"],
		["ADR-0001", "Which branches deploy, and why", "docs/adr/0001-deployment-model.md"],
		["docs/runbook.md", "Operational procedures", "docs/runbook.md"],
		[
			"docs/vercel-deployment-checklist.md",
			"Release checklist",
			"docs/vercel-deployment-checklist.md",
		],
	].map(([label, description, path]) => [`[${label}](${blob(repo, sha, path)})`, description]);

	return `${banner(repo, sha, date, "docs/deployment-workflow.md", "The deployment matrix is authoritative in ADR-0001; this page links to it rather than restating it.")}

# Deployment

| Branch | Role | Deploys? |
| --- | --- | --- |
| \`develop\` | Integration; every task lands here first | No — validation only |
| \`staging\` | Release candidate and preview | Yes — preview, with production credentials |
| \`main\` | Production | Yes — production |

Only the owner promotes \`develop → staging → main\`. Agents stop at \`develop\`.

## Read

${table(["Document", "Why"], links)}
`;
}

function qualityPage(repo, sha, date, root) {
	const rootPkg = JSON.parse(read(root, "package.json"));
	const webPkg = JSON.parse(read(root, "apps/web/package.json"));
	const scripts = { ...(rootPkg.scripts || {}), ...(webPkg.scripts || {}) };
	const gates = [
		["self-check", "Migration, schema and repository invariants", "pnpm self-check"],
		["lint", "Biome formatting and lint", "pnpm lint"],
		["typecheck", "TypeScript across the workspace", "pnpm typecheck"],
		["api:check", "Every API route declares its guard and its endpoint entry", "pnpm api:check"],
		[
			"test:coverage",
			"Unit and integration tests with the coverage gate",
			"pnpm --filter web test:coverage",
		],
		["test:e2e", "Playwright against a local Supabase stack", "pnpm --filter web test:e2e"],
		["i18n:tl-coverage", "Tagalog catalogue coverage", "pnpm --filter web i18n:tl-coverage"],
	];
	const rows = gates
		.filter(([key]) => key in scripts)
		.map(([, description, command]) => [`\`${command}\``, description]);

	return `${banner(repo, sha, date, "package.json", "Commands are read from the repository's package.json; run them before a pull request.")}

# Quality gates

CI runs these on every pull request into \`develop\`. Run the cheap ones locally
first; the full list is in [\`package.json\`](${blob(repo, sha, "package.json")}).

${table(["Command", "What it proves"], rows)}

## Testing guides

- [End-to-end tests](${blob(repo, sha, "docs/e2e.md")})
- [Internationalisation](${blob(repo, sha, "docs/i18n.md")})
- [Quality pass, 2026-10-22](${blob(repo, sha, "docs/quality-pass-2026-10-22.md")})
`;
}

function sidebar(repo, sha) {
	return `### OptiFeed

- [Start here](Home)
- [Plan](Plan)
- [Decisions](Decisions)
- [Missions](Missions)
- [Deployment](Deployment)
- [Quality](Quality)

---

[Canonical repository](https://github.com/${repo}/tree/${sha})
`;
}

function footer(repo, sha, date) {
	return `Generated mirror of \`docs/\` at [\`${sha.slice(0, 7)}\`](https://github.com/${repo}/tree/${sha}) on ${date}. Canonical source is the repository — open a pull request, do not edit this page.`;
}

/**
 * Write the wiki pages into `outDir`.
 * @param {BuildOptions} options
 * @returns {string[]} the page filenames that were written
 */
export function buildWiki(options) {
	const root = options.root || ROOT;
	const sha =
		options.sha ||
		execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
	const repo = options.repo || REPO_SLUG;
	const date = options.date || new Date().toISOString().slice(0, 10);

	const pages = {
		"Home.md": homePage(repo, sha, date),
		"Plan.md": planPage(repo, sha, date, root),
		"Decisions.md": decisionsPage(repo, sha, date, root),
		"Missions.md": missionsPage(repo, sha, date, root),
		"Deployment.md": deploymentPage(repo, sha, date),
		"Quality.md": qualityPage(repo, sha, date, root),
		"_Sidebar.md": sidebar(repo, sha),
		"_Footer.md": footer(repo, sha, date),
	};

	mkdirSync(options.outDir, { recursive: true });
	for (const [name, content] of Object.entries(pages)) {
		writeFileSync(join(options.outDir, name), content);
	}
	return Object.keys(pages);
}

function main() {
	const args = process.argv.slice(2);
	const outIndex = args.indexOf("--out");
	if (outIndex === -1 || !args[outIndex + 1]) {
		console.error("usage: node scripts/docs/build-wiki.mjs --out <wiki clone> [--sha <commit>]");
		process.exit(1);
	}
	const shaIndex = args.indexOf("--sha");
	const sha = shaIndex === -1 ? undefined : args[shaIndex + 1];
	const written = buildWiki({ outDir: args[outIndex + 1], sha });
	console.log(`wiki: wrote ${written.length} page(s) to ${args[outIndex + 1]}`);
	console.log("wiki: review the diff, then commit and push from the wiki clone");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main();
}
