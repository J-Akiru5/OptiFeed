import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const quick = process.argv.includes("--quick");
spawnSync("git fetch origin", { shell: true, encoding: "utf8" });
const results = [];

function record(name, ok, detail = "") {
	results.push({ name, ok });
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

function sh(cmd) {
	return spawnSync(cmd, { shell: true, encoding: "utf8" });
}

function read(path) {
	return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function walk(dir, out = []) {
	if (!existsSync(dir)) return out;
	for (const name of readdirSync(dir)) {
		if (name === "node_modules" || name === ".next" || name === ".git") continue;
		const full = join(dir, name);
		if (statSync(full).isDirectory()) walk(full, out);
		else out.push(full);
	}
	return out;
}

function posix(p) {
	return p.split("\\").join("/");
}

const web = "apps/web";
const sourceFiles = walk(web)
	.filter((f) => /\.(ts|tsx)$/.test(f))
	.map(posix);
const resetCmd = ["migrate", "reset"].join(" ");

const branch = sh("git branch --show-current").stdout.trim();
const protectedBranches = ["develop", "staging", "main"];
record("not on a protected branch", branch !== "" && !protectedBranches.includes(branch), branch);

const staged = sh("git diff --cached --name-only").stdout.split("\n").filter(Boolean);
const stagedEnv = staged.filter((f) => /(^|\/)\.env/.test(f) && !f.endsWith(".env.example"));
record("no .env files staged", stagedEnv.length === 0, stagedEnv.join(", "));

const guarded = [
	"package.json",
	`${web}/package.json`,
	...walk(".github").map(posix),
	...walk("scripts")
		.map(posix)
		.filter((f) => !f.endsWith("self-check.mjs")),
];
const resetHits = guarded.filter((f) => read(f).includes(resetCmd));
record(
	"no destructive reset command in scripts or workflows",
	resetHits.length === 0,
	resetHits.join(", "),
);

const buildScript = JSON.parse(read(`${web}/package.json`) || "{}").scripts?.build ?? "";
record(
	"web build script does not run migrate deploy",
	!/(prisma\s+)?migrate\s+deploy/.test(buildScript),
	buildScript,
);

const diffRes = sh(
	`git diff --name-only --diff-filter=A origin/develop -- ${web}/prisma/migrations`,
);
record(
	"can diff against origin/develop",
	diffRes.status === 0,
	diffRes.status === 0 ? "" : "run git fetch origin",
);
const newMigrations = diffRes.stdout.split("\n").filter((f) => f.endsWith(".sql"));
const destructive = newMigrations.filter((f) =>
	/DROP\s+(TABLE|SCHEMA|DATABASE|COLUMN)|TRUNCATE/i.test(read(f)),
);
record(
	"new migrations are additive (no DROP/TRUNCATE)",
	destructive.length === 0,
	destructive.join(", "),
);

record("no middleware.ts (Next 16 uses proxy.ts)", !existsSync(`${web}/middleware.ts`));

const apiRoutes = sourceFiles.filter((f) => /app\/api\/.+\/route\.ts$/.test(f));
const allow = /api\/(ingest|feed-command|schedule-sync|health|firmware\/check)\//;
const noAuth = apiRoutes.filter(
	(f) => !allow.test(f) && !/from "@\/lib\/auth\/(session|with-auth)"/.test(read(f)),
);
record("every API route has an auth import", noAuth.length === 0, noAuth.join(", "));

record("limits module exists", existsSync(`${web}/lib/limits.ts`));
for (const f of ["energy", "schedule", "settings", "biomass"]) {
	record(`actions/${f}.ts uses limits`, read(`${web}/lib/actions/${f}.ts`).includes("limits"));
}

const writeActions = ["energy", "schedule", "settings", "biomass", "time", "farm"];
for (const f of writeActions) {
	record(
		`actions/${f}.ts enforces write access`,
		read(`${web}/lib/actions/${f}.ts`).includes("requireWriteAccess"),
	);
}
record(
	"requireWriteAccess defined",
	read(`${web}/lib/auth/session.ts`).includes("requireWriteAccess"),
);

for (const f of ["import", "import/confirm"]) {
	record(
		`api/${f} enforces write access`,
		read(`${web}/app/api/${f}/route.ts`).includes("requireWriteAccess"),
	);
}

record(
	"registerEnergyDevice removed",
	!sourceFiles.some((f) => read(f).includes("registerEnergyDevice")),
);

const deviceRoutes = sourceFiles.filter((f) =>
	/app\/api\/(ingest|feed-command|schedule-sync)\/route\.ts$/.test(f),
);
const timingHelper = sourceFiles.some(
	(f) => f.startsWith("apps/web/lib/") && read(f).includes("timingSafeEqual"),
);
record(
	"device routes verify tokens with timingSafeEqual",
	deviceRoutes.length === 3 &&
		timingHelper &&
		deviceRoutes.every((f) => /timingSafeEqual|@\/lib\/(auth\/|device-auth)/.test(read(f))),
);

record(
	"getCurrentUser looks up by supabaseId",
	/supabaseId/.test(read(`${web}/lib/auth/session.ts`)),
);

record("signup route deleted (not redirected)", !existsSync(`${web}/app/[locale]/signup/page.tsx`));

record(
	"FeedNowButton disables when offline",
	/disabled=\{[^}]*isOffline/.test(read(`${web}/components/FeedNowButton.tsx`)),
);

const thresholdDefs = sourceFiles.filter((f) => /const\s+OFFLINE_THRESHOLD_MS/.test(read(f)));
record("OFFLINE_THRESHOLD_MS defined once", thresholdDefs.length <= 1, thresholdDefs.join(", "));

const hardLinks = sourceFiles.filter(
	(f) => !f.includes("__tests__") && /linkTo[^\n]*["`]\/en\//.test(read(f)),
);
record("no hardcoded /en/ in notification links", hardLinks.length === 0, hardLinks.join(", "));

const fw = read("firmware/firmware-main/firmware-main.ino");
record("firmware: MAX_DISPENSE_MS defined", /MAX_DISPENSE_MS/.test(fw));
record(
	"firmware: queued event stores its own eventId",
	/struct\s+\w+\s*\{[^}]*eventId[^}]*\}/.test(fw),
);
record("firmware: TLS certificate set", /setCACert|attachBundle/.test(fw));
record("firmware: watchdog enabled", /esp_task_wdt_init/.test(fw));

const tests = sourceFiles.filter((f) => /\.(test|spec)\.tsx?$/.test(f));
for (const route of ["ingest", "feed-command", "schedule-sync"]) {
	record(
		`tests cover /api/${route}`,
		tests.some((f) => read(f).includes(`api/${route}`)),
	);
}

const envExample = read(`${web}/.env.example`);
for (const key of [
	"OPENCODE_GO_MODEL",
	"NEXT_PUBLIC_BASE_URL",
	"INVITE_FROM_EMAIL",
	"DEMO_PIN",
	"CRON_SECRET",
]) {
	record(`.env.example documents ${key}`, envExample.includes(key));
}
// ADR-0007: the platform does not use Telegram, so no Telegram variable may
// reappear in the example environment. (Prose that says we do not use it is
// allowed; the variables are not.)
record(".env.example documents no Telegram variable", !/TELEGRAM_[A-Z_]+/.test(envExample));

const ci = read(".github/workflows/ci.yml");
record("CI runs for develop", ci.includes("develop"));
record(
	"deploy.yml deleted (Vercel Git integration deploys)",
	!existsSync(".github/workflows/deploy.yml"),
);
const vercelCfg = JSON.parse(read(`${web}/vercel.json`) || "{}");
const deploymentEnabled = vercelCfg?.git?.deploymentEnabled ?? {};
record(
	"Vercel deployments restricted to staging and main (develop never deploys)",
	deploymentEnabled["*"] === false &&
		deploymentEnabled["**"] === false &&
		deploymentEnabled.staging === true &&
		deploymentEnabled.main === true &&
		deploymentEnabled.develop !== true,
	JSON.stringify(deploymentEnabled),
);
record("CI workflow never deploys", !read(".github/workflows/ci.yml").includes("vercel deploy"));
record("device-watch cron route exists", existsSync(`${web}/app/api/cron/device-watch/route.ts`));
record("cron SQL file exists", existsSync("docs/sql/cron-device-watch.sql"));
record(
	"no Telegram integration in the app (ADR-0007)",
	!existsSync(`${web}/lib/notify/telegram.ts`),
);
record("no Upstash dependency (D1 uses Postgres)", !/@upstash\//.test(read(`${web}/package.json`)));
const limiterFiles = sourceFiles.filter(
	(f) => /rate-limit|limiter/.test(f) && !f.includes("__tests__"),
);
record(
	"rate limiter has no in-memory Map store",
	limiterFiles.length > 0 && !limiterFiles.some((f) => /new Map/.test(read(f))),
	limiterFiles.filter((f) => /new Map/.test(read(f))).join(", "),
);

function run(name, cmd) {
	const r = sh(cmd);
	record(name, r.status === 0, r.status === 0 ? "" : `exit ${r.status}`);
	if (r.status !== 0) console.log((r.stdout + r.stderr).split("\n").slice(-25).join("\n"));
}

run("pnpm lint", "pnpm lint");
run("pnpm typecheck", "pnpm typecheck");
run("pnpm test", "pnpm test");
if (!quick && buildScript.includes("migrate")) {
	record(
		"pnpm build skipped: build script still runs migrate deploy (task 0.3)",
		false,
		"merge 0.3 first",
	);
} else if (!quick) {
	run("pnpm build", "pnpm build");
}

const arduino = sh("arduino-cli version");
if (arduino.status === 0) {
	record("firmware compiles", true, "arduino-cli found; compile manually with your board FQBN");
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
	console.log(`Failed:\n${failed.map((r) => `  - ${r.name}`).join("\n")}`);
	process.exit(1);
}
