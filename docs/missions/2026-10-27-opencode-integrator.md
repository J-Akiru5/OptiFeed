# OpenCode integrator: delegated release loop (2026-10-27 evening)

Jeff asked Claude Code to delegate integration to OpenCode because Claude is near its rate limit. You are the **integrator**. Model: `opencode-go/deepseek-v4.1-flash`.

Read first:
- `docs/missions/2026-10-27-issues.md`: decisions E1–E24, the discussion log, the integration log. **E24 means every update is promoted to `main`.**
- `docs/missions/2026-10-26-autonomous-mission.md`: worker rules.

Paths:
- Integration worktree `S:\Dev\optifeed\integration-mission`, branch `integration/batch-2026-10-27b` (= open PR #210 into `develop`, release **v1.13.0**).
- Worker worktrees `S:\Dev\optifeed\mission-I-15`, `mission-I-11`, `mission-I-17`; their logs are `C:\Users\Lenovo\AppData\Local\Temp\claude\S--Dev-optifeed-pakaonai-sticker-wifi-label-da3580\75279ecb-235a-4bbc-8330-1aa21e1b847f\scratchpad\worker-I-xx.log`.

## Job, in order
1. **Ship v1.13.0 (PR #210).**
   - Wait for its CI (`gh pr checks 210 --repo J-Akiru5/OptiFeed`). If it fails, fix it on the branch, or report and stop.
   - When green: `gh pr merge 210 --merge`.
   - Open `develop → staging`, wait for CI, merge with `--merge`. Open `staging → main`, wait for CI, merge with `--merge`.
   - Verify production:
     - `vercel ls --prod` from the scratchpad `vercel-link` folder shows Ready for the main merge SHA;
     - `curl https://pakaonai.syntaxure.dev/api/health` returns ok;
     - the live `/en/privacy` page shows `1.13.0`.
   - Then close #198, #202 and #211 with a comment naming the release and the main SHA.
2. **Integrate finished workers** (I-15 ops/health, I-11 control-room dashboard, I-17 firmware 1.5.0). A worker is finished when its branch has commits beyond its base, its worktree is clean, and its log ends with a report. For each, one at a time, on a NEW branch `integration/batch-2026-10-27c` from `origin/develop` (after v1.13.0 is in develop):
   - review the scope: no schema changes, and guards unchanged or stronger (`requirePlatformAdmin`, `requireTenantAdmin`, `requirePermission`, `requireWriteAccess`, org/owner scoping);
   - `git merge --no-ff --no-commit`; resolve only obvious unions (imports, keys, attributes; keep both sides). Keep JSON message files valid. For a semantic conflict in `lib/auth`, `lib/actions/platform`, device API routes or `prisma`: abort, log it, skip that worker;
   - gates, all required:
     - `pnpm lint`
     - `pnpm typecheck`
     - `pnpm api:check`
     - `cd apps/web && pnpm exec vitest run --maxWorkers=3`
     - `pnpm build` (from `apps/web`, with `VERCEL_ENV` unset);
     - for I-17 also `pio run -d firmware -e esp32dev` and `-e esp32dev-lan`;
   - commit `chore(merge): integrate I-xx <description>` ending with `Co-Authored-By: OpenCode deepseek-v4.1-flash (delegated integrator)`, and push;
   - when all finished workers are in: bump the version (MINOR **1.14.0** if any feature landed, else PATCH) in the root and `apps/web` `package.json`, set `LEGAL_APP_RELEASE` in `apps/web/lib/legal/config.ts` to match (a test enforces it), and add a `## [x.y.z] - <date>` section in `CHANGELOG.md` with the workers' entries under it (check they are not under an older version);
   - then promote exactly as in step 1 (PR to develop → staging → main, CI each step, verify production).
3. **Log everything** in `docs/missions/2026-10-27-issues.md` ("Integration log" rows and dated "Discussion log" rows), and commit/push on the current integration branch.

## Hard rules
- Never force-push, never `git reset --hard` a shared branch, never skip CI or merge a red PR, never deploy by CLI (Vercel deploys from the merges), never run `prisma migrate` or touch the database, never print secrets.
- Do not flash firmware (I-17 is merged as code; Jeff flashes).
- If blocked or unsure, stop and write what you found under "Takeover log" in the mission doc.
- Finish with a short report: releases shipped (versions, main SHAs, deploy URLs), issues closed, workers merged or skipped, anything for Jeff.
