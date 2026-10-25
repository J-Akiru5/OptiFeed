# Demo runbook — local "everything online" demo

Branch: `demo/system-online` (throwaway). Never merge, never deploy.
This branch adds demo-only tooling: a database helper, a heartbeat simulator, a
status check, and a local-only auth bypass guarded by `DEMO_MODE` that refuses to
activate on Vercel or in a production build.

## How the local database works

The demo uses the PostgreSQL 18 service already installed on this machine
(port 5433, trust auth on localhost) with a dedicated database `optifeed_demo`.
The helper only creates/drops that one database — it never stops the service and
never touches other databases.

## Prerequisites

- PostgreSQL 18 installed (`C:\Program Files\PostgreSQL\18\bin`, override with `PG_BIN`).
- `pnpm install` already run in this worktree.
- `apps/web/.env` copied from `apps/web/demo.env.example` (git-ignored).

## One-time setup (from the repository root of this worktree)

```powershell
# 1. Create the throwaway database (server must be running on port 5433)
.\scripts\demo\pg.ps1 init

# 2. Demo environment
Copy-Item apps\web\demo.env.example apps\web\.env

# 3. Generate the Prisma client and apply all migrations
pnpm prisma:generate
pnpm --filter web exec prisma migrate deploy

# 4. Seed the demo farm, pond, device, cycle, events and history
pnpm --filter web seed:dev
```

## Demo day

```powershell
# Terminal 1: web app (loads apps/web/.env automatically)
pnpm --filter web dev

# Terminal 2: keep the device "online" (heartbeat every 60 s)
# If Next reports another port (3000 busy), match it here:
$env:DEMO_BASE_URL = "http://localhost:3000"
node apps/web/scripts/demo/heartbeat.mjs

# Terminal 3: verify every online surface
pnpm --filter web exec tsx scripts/demo/status-check.ts
```

Open <http://localhost:3000/en/dashboard>. The demo login is bypassed; no PIN needed.

`status-check` must report all PASS:

- demo user exists (admin, `demo-farmer-1`)
- heartbeat fresh (< 15 min)
- device not paused
- hopper level >= 20 %
- water temperature probe ok
- no unread notifications
- active grow-out cycle exists
- upcoming pond events exist

Negative test (proves the demo is data-driven): stop the heartbeat, wait 15 minutes,
the header/sidebar/Feed Now flip to offline.

## Reset and teardown

```powershell
# Rebuild demo data (keeps the database)
pnpm --filter web seed:dev

# Wipe and recreate the whole demo database
.\scripts\demo\pg.ps1 reset
pnpm --filter web exec prisma migrate deploy
pnpm --filter web seed:dev

# Throw the demo database away when the demo is over
.\scripts\demo\pg.ps1 drop

# Remove the demo environment file
Remove-Item apps\web\.env

# Remove the throwaway branch (after the worktree is gone)
git worktree remove ..\OptiFeed-demo --force
git push origin --delete demo/system-online
git branch -D demo/system-online
```

## Guardrails

- The auth bypass only activates when `DEMO_MODE=1` **and** `VERCEL_ENV` is unset **and**
  `NODE_ENV !== "production"`. A deployed build cannot use it.
- Demo data lives only in the `optifeed_demo` database; the shared Supabase project is never touched.
- `pg.ps1` never stops or reconfigures the PostgreSQL service.
- Do not add this branch to the Vercel deployment allowlist.
