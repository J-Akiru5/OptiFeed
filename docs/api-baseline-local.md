# Local API baseline — 2026-10-22

This is a **local** L2 baseline, not a production or Supabase certification. It exists so the
instrumentation, budgets, and suites are validated against a real PostgreSQL database with realistic
row volume, without touching the production project.

## Environment

| Item | Value |
|---|---|
| Commit | `9d3caaf` (merge of PR #101 into `develop`) + the auth fast path |
| Runtime | Windows, Node 24, Next.js 16.4.2, production build (`next start`) |
| Database | PostgreSQL 16 (embedded, local, `initdb --encoding=UTF8`), 29 Prisma migrations |
| Auth | Local ES256 JWKS fixture + a `@supabase/ssr`-shaped session cookie; same `getClaims()` path as production |
| Dataset | 10,056 `FeedEvent` rows, 56 seeded feed events, 45 feed-level logs, 4 biomass logs, 3 FCR reports |
| Rate limits | 10/min prediction, 30/min general API; samples paced across fixed windows |
| Samples | 30 per endpoint, 5 warm-up, sequential |

Reproduce (with a local database and auth fixture):

```bash
pnpm install --offline --frozen-lockfile
pnpm --filter web prisma:generate
DATABASE_URL=... DIRECT_URL=... pnpm --filter web prisma migrate deploy
DATABASE_URL=... DIRECT_URL=... pnpm --filter web seed:dev
pnpm exec next build && pnpm exec next start -p 3100
API_BASE_URL=http://localhost:3100 API_TEST_COOKIE=... pnpm api:live -- --mode warn
```

## Contract suite (§11.2)

| Endpoint | Status |
|---|---|
| `GET /api/v1/health` | 200, flat probe body |
| `GET /api/v1/user-role` | 200, envelope, `private` cache + ETag |
| `GET /api/v1/export?type=biomass_logs` | 200, CSV |
| `GET /api/v1/export/batch?types=biomass_logs` | 200, ZIP |
| `GET /api/v1/export-pdf` | 200, PDF |

**Coverage: measured 5 / skipped 0 / total 5 (100%).** Unknown-path 404, envelope, `Server-Timing` and
`X-Request-Id` assertions all passed.

## Latency suite (§11.1)

| Endpoint | p50 | p95 | p99 | max | Server-Timing (last sample) |
|---|---|---|---|---|---|
| `GET /api/v1/user-role` | 3.3 ms | **4.4 ms** | 4.6 ms | 4.6 ms | `total=1.1, db=0.7, app=0.2, auth=0.1, queries=1` |
| `POST /api/v1/predict-feeding` | 5.8 ms | **18.5 ms** | 233.3 ms | 233.3 ms | `total=3.9, db=6.1, app=0, auth=0.1, queries=8` |

- **Coverage: 2 / 2 (100%).** No request exceeded the 400 ms ceiling; p95 is far below 300 ms.
- `predict-feeding` p99/max of 233 ms is an outlier (one sample), still under the hard ceiling. The
  median is 5.8 ms. Likely a session-cache/JWKS re-verification or a GC pause; tracked in the backlog.
- `db` can exceed `total` because the handler issues parallel queries and the instrumentation sums
  per-query durations. This is a known measurement flaw; the v1.2 proposal adds a `db_wall` metric.

## What this does and does not prove

**Proves:** the envelope, headers, request-id propagation, query counting, auth fast path, error
normalisation, `/api/v1` rewrites, and both budgets hold against a real Postgres with 10k rows.

**Does not prove:** Supabase network latency, Supabase pooler behaviour, production dataset size,
cross-region latency, cold starts, or L3 load capacity. Those require a non-production Supabase project
and the §11.4 load test.
