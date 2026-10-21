#!/usr/bin/env node
/**
 * Applies Prisma migrations only when Vercel is building the production
 * deployment.
 *
 * Vercel sets `VERCEL_ENV` to `production`, `preview`, or `development`:
 *
 *   - `production` -> the `main` deployment. Migrations run, exactly as the
 *     established release process expects (docs/vercel-deployment-checklist.md).
 *   - `preview`    -> every non-production deployment, including the `staging`
 *     branch. Migrations are skipped: previews share credentials with
 *     production today, so a preview build must never mutate a shared schema.
 *   - unset        -> local shells and GitHub Actions. Skipped, because local
 *     builds and CI must never reach a real database.
 *
 * Exits non-zero when production migration fails, so a broken migration fails
 * the deployment instead of shipping an app against an unmigrated schema.
 */
import { spawnSync } from "node:child_process";

const vercelEnv = process.env.VERCEL_ENV ?? "";

if (vercelEnv !== "production") {
	console.log(`[migrate] skipped (VERCEL_ENV=${vercelEnv || "unset"}).`);
	console.log("[migrate] Prisma migrations only run for the production deployment of main.");
	process.exit(0);
}

console.log("[migrate] production deployment detected; running prisma migrate deploy");

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
	stdio: "inherit",
	shell: true,
	env: process.env,
});

if (result.error) {
	console.error(`[migrate] could not start prisma: ${result.error.message}`);
	process.exit(1);
}

process.exit(result.status ?? 1);
