#!/usr/bin/env node
/**
 * Generate the Prisma client after `pnpm install` when the schema is present.
 *
 * A fresh clone or a pull that changes `apps/web/prisma/schema.prisma` used to
 * leave the generated client stale, so `pnpm typecheck` failed until someone
 * ran `pnpm prisma:generate` by hand (#715). Running it from the root
 * postinstall fixes that without making installs impossible in contexts that
 * only have the package manifests:
 *
 *   - the Docker `deps` stage copies package.json, the lockfile and this
 *     script, but not the Prisma schema, so the wrapper exits 0;
 *   - that stage also sets PRISMA_SKIP_POSTINSTALL_GENERATE=true for
 *     @prisma/client, which this wrapper honours for the same reason.
 *
 * Usage:
 *   node scripts/prisma-generate-if-present.mjs
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = join(repoRoot, "apps/web/prisma/schema.prisma");

function skip(reason) {
	console.log(`prisma-generate-if-present: skipped (${reason})`);
	process.exit(0);
}

if (
	process.env.PRISMA_SKIP_POSTINSTALL_GENERATE === "true" ||
	process.env.PRISMA_SKIP_POSTINSTALL_GENERATE === "1"
) {
	skip("PRISMA_SKIP_POSTINSTALL_GENERATE is set");
}

if (!existsSync(schemaPath)) {
	skip("apps/web/prisma/schema.prisma is not present");
}

// pnpm installs the Prisma CLI under apps/web, so the filter is the same
// command `pnpm prisma:generate` runs at the root.
const result =
	process.platform === "win32"
		? spawnSync("pnpm --filter web prisma:generate", {
				cwd: repoRoot,
				shell: true,
				stdio: "inherit",
			})
		: spawnSync("pnpm", ["--filter", "web", "prisma:generate"], {
				cwd: repoRoot,
				stdio: "inherit",
			});

if (result.error) {
	console.error(`prisma-generate-if-present: could not run pnpm: ${result.error.message}`);
	process.exit(1);
}

if (result.status !== 0) {
	console.error(
		`prisma-generate-if-present: prisma generate failed with exit code ${result.status ?? "unknown"}`,
	);
	process.exit(result.status ?? 1);
}
