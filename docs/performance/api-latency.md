# API + page latency baseline

Status: **baseline recorded, gate wired, database-backed endpoints deferred.**

- Harness: [`scripts/perf/api-latency.mjs`](../../scripts/perf/api-latency.mjs)
- Baseline: [`perf/baseline/api-latency.json`](../../perf/baseline/api-latency.json)
- Gate: `perf.yml` job `bundle-and-latency`, step "API + page latency budget"
- Measured: 2026-10-29, Windows 11, Node 24.14.0, `next start` on a production build, **no database**

This is a *latency* baseline. It complements [`docs/api-baseline-local.md`](../api-baseline-local.md),
which records the *contract* baseline with a real embedded PostgreSQL and an auth fixture, and
`scripts/api/live-check.mjs --suite latency`, which already implements the API-regulation §8.1 p95
(300 ms) / max (400 ms) budgets for the authenticated endpoints. Both use the same percentile helper
(`scripts/api/lib.mjs`), so the three surfaces cannot disagree about what p95 means.

## What could be measured here, and what could not

A latency number is only useful if it measures a handler's real work. In this environment there is
no database and no Supabase project, so the honest split is:

| Endpoint | Reachable without a database? | In the baseline? |
|---|---|---|
| `GET /api/<unknown>` (`[...fallback]` 404 envelope) | yes | gated |
| `POST /api/<unknown>` | yes | gated |
| `GET /en/dashboard` unauthenticated (the `307` guard) | yes | gated |
| `GET /en`, `/en/login`, `/en/privacy`, `/en/terms` | yes | recorded, evidence only (see below) |
| `GET /api/health` | reaches a handler, but the Prisma probe cannot succeed | diagnostic, **not gated** |
| `POST /api/ingest`, `POST /api/feed-command` | no | deferred |
| `GET /api/calendar/events`, `GET /api/jobs/metrics` | no | deferred |
| `GET /en/dashboard` authenticated | no | deferred |

### Why `/api/health` is not gated

The only DB-touching endpoint that answers without a session. With no database it has two
behaviours, both observed on this tree:

- **cold Prisma engine**: the `SELECT 1` connect attempt outlives the route's 2,000 ms budget
  (`withApi` in `apps/web/lib/api/instrumentation.ts`), so the route answers **504** and
  `Server-Timing` reports `db;dur=0, app;dur≈2020`. Ten samples: p50 2004 ms, p95 2016 ms.
- **after the driver has already failed once**: the same probe answers **503 degraded** in about
  4 ms (`db;dur≈1.6, queries=1`). The recorded run captured this state, because `--spawn` polls the
  server before measuring and that readiness probe is itself the first failed attempt.

Neither is the healthy path (`200 {"status":"ok"}`), so gating on it would measure a failure mode. It
is measured on every run and printed for evidence; `--enable api-health-degraded` promotes it to a
gate once a real database is reachable.

Side effect worth knowing: each cold probe logs an `[api] ERROR VIOLATION` line at 2 s. Probing the
health route in a loop against a missing database floods the server log.

## Recorded baseline

100 timed requests per endpoint after 20 warm-up (10/2 for the health diagnostic), sequential, one
process, one client, recorded on a quiet machine. `client` is the full round trip; `srv` is
`Server-Timing: total` from `withApi`.

| Endpoint | Status | client p50 | client p95 | client p99 | srv p50 | srv p95 | Gate |
|---|---|---|---|---|---|---|---|
| `GET /api/<unknown>` | 404 | 2.4 ms | 3.3 ms | 3.7 ms | 0.2 ms | 0.4 ms | ≤ 50 ms |
| `POST /api/<unknown>` | 404 | 2.3 ms | 3.0 ms | 3.6 ms | 0.2 ms | 0.3 ms | ≤ 50 ms |
| `GET /en/dashboard` (no session) | 307 | 2.2 ms | 3.0 ms | 3.6 ms | n/a | n/a | ≤ 50 ms |
| `GET /en` | 200 | 31.0 ms | 40.5 ms | 41.8 ms | n/a | n/a | evidence only |
| `GET /en/login` | 200 | 24.4 ms | 29.1 ms | 40.4 ms | n/a | n/a | evidence only |
| `GET /en/privacy` | 200 | 30.8 ms | 39.4 ms | 48.1 ms | n/a | n/a | evidence only |
| `GET /en/terms` | 200 | 28.6 ms | 38.1 ms | 47.8 ms | n/a | n/a | evidence only |
| `GET /api/health` | 503 | 4.0 ms | 4.8 ms | 4.8 ms | 1.6 ms | 2.1 ms | diagnostic |

Reading the numbers:

- The DB-free API pipeline costs **2-3 ms round trip** for **0.2-0.4 ms of handler time**. The rest is
  Node's HTTP server, the middleware matcher (`/api/*` is excluded from `proxy.ts`) and loopback, not
  application work. Earlier runs on the same tree under heavier unrelated load measured 5-7 ms; the
  50 ms floor exists precisely because that gap is machine noise.
- Refusing an unauthenticated request costs ~2 ms, so the auth guard is not a latency risk.
- A page render costs **24-31 ms p50** on a quiet machine.

### Why the page renders are recorded but not gated

Measuring the same four pages three times in a row on this machine, with **no code change**, produced
p50 values from 43 ms to 119 ms on `/en` depending on what else was running (Chrome, a second agent's
build, OneDrive indexing). A 1.5x gate on a 31 ms baseline would fail in that state; loosening it to
absorb a 3x swing would make it decorative.

The page therefore has two separate treatments:

- **Evidence:** recorded in `perf/baseline/api-latency.json` and printed on every run, so a change in
  server render cost is visible in the report.
- **Gate:** Lighthouse's `server-response-time` budget (≤ 1000 ms, three runs, median) in
  `lighthouserc.json`. It is measured in a controlled browser context alongside a full load, and it is
  the metric that actually reflects what a visitor waits for.

The stable endpoints - the API pipeline and the auth guard redirect - keep wall-clock gates.

## Gate semantics

The rule is stored in the baseline file so it is reviewable:

```
fail when  measured p95  >  max(floorMs, baseline p95 * factor)
       floorMs = 50, factor = 1.5
```

Three separate conditions can fail the job:

1. **Status contract.** Every observed status must be one of the baseline's `expectedStatuses`.
   A `404` that becomes a `500`, or a `307` that becomes a `200`, fails regardless of timing.
2. **Transport.** Any fetch/abort error fails the run.
3. **p95 ceiling.** Client p95 above `max(50 ms, 1.5 × baseline p95)`.

It applies to the three gated endpoints (`GET`/`POST /api/<unknown>`, `/en/dashboard` guard). The
rules are the same for every endpoint in the file; the page renders are opted out in the catalogue
with a reason, and `--enable <name>` opts any of them back in.

Why a 50 ms floor: the gated baselines are 3.0-3.3 ms p95. A 1.5× ceiling on 3.3 ms is 5 ms, which is
inside run-to-run noise on a shared machine, and CI runners are a different machine again. The same
endpoint measured 2.4 ms p50 when the machine was quiet and 5.3 ms p50 when it was busy - with no code
change. The floor is the smallest number that is stable for a sub-10 ms measurement; the 1.5× factor
still applies above it, so a regression from 3 ms to 200 ms fails on both clauses. `--strict` drops the
floor for a like-for-like comparison on the machine that recorded the baseline.

Known variance source: p95 with `n` samples is the `ceil(0.95n)`-th value, so a small sample count
inflates it towards the maximum. The default is 60 iterations (p95 = 57th of 60). A 10-sample run
reads 20-40% higher than the 60-sample run for the same endpoint; the reference run above used 100.

## Reproducing

```bash
# Recorded run (needs a production build: cd apps/web && npx next build)
node scripts/perf/api-latency.mjs --spawn --iterations 100 --warmup 20

# Gate, exactly as CI runs it
node scripts/perf/api-latency.mjs --spawn --baseline perf/baseline/api-latency.json

# Refresh the baseline after a reviewed, intentional change
node scripts/perf/api-latency.mjs --spawn --write --out perf/baseline/api-latency.json
```

`--spawn` runs `pnpm --filter web start -p 3111`, polls until it answers, and kills the whole process
tree on exit (including the Windows `taskkill /T` path). Without `--spawn`, point `--base-url` at a
server you started yourself.

## Deferred: the database-backed endpoints

The plan is executable as soon as a database and a session fixture exist. It reuses the machinery
that already ships:

### Step 1 - a database with realistic volume

Any PostgreSQL 16 instance will do; the local baseline document describes the embedded setup and the
seed script (`pnpm --filter web seed:dev`). Volume matters more than the server: the queries in
[`query-audit.md`](./query-audit.md) only behave realistically with six-figure `FeedEvent` and
`DeviceStateEvent` counts.

```bash
pnpm --filter web prisma migrate deploy
pnpm --filter web seed:dev
```

### Step 2 - a session fixture

`scripts/api/live-check.mjs` already consumes `API_TEST_COOKIE` / `API_TEST_BEARER` and treats a
missing credential as failed coverage rather than a green run. Generate the cookie with the local
JWKS fixture described in [`docs/api-baseline-local.md`](../api-baseline-local.md).

### Step 3 - measure with the existing suite, then fold it into this baseline

```bash
API_BASE_URL=http://localhost:3111 \
API_TEST_COOKIE="sb-<ref>-auth-token=..." \
pnpm api:live -- --suite latency --mode warn
```

The §8.1 budgets (p95 300 ms, max 400 ms) are the regulation's own numbers and already apply. Once a
run has recorded values, add the endpoints to `ENDPOINTS` in `scripts/perf/api-latency.mjs` with
`gated: true` and their observed status codes, and refresh
`perf/baseline/api-latency.json` with `--write`. Priority order, cheapest first:

| Priority | Endpoint | Why |
|---|---|---|
| 1 | `POST /api/ingest` | Hottest write path; cost scales with fleet size. Uses the transaction at `apps/web/app/api/ingest/route.ts:626`. |
| 2 | `GET /api/feed-command` | Device poll on a timer; its p95 is the device-visible latency. |
| 3 | `GET /en/dashboard` (authenticated) | Heaviest render: ~14 queries in three sequential waves. |
| 4 | `GET /api/calendar/events` | Fan-out read over Pond, CropCycle, EnergyDevice, PondEvent. |
| 5 | `GET /api/jobs/metrics` | Aggregates `BackgroundJob` / `JobArtifact`. |

`Server-Timing` already separates `auth`, `db`, `db_sum` and `app` per request, so the first recording
will show immediately whether a slow endpoint is the database or the handler.
