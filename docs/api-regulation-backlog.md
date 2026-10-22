# API regulation backlog — OptiFeed

This is the burn-down list created by adopting `API_REGULATION.md` v1.1. Items are ordered by
user-visible impact. Every item names its evidence and the rule it violates; add new items here when a
live run or review finds one.

**Status key:** `open` · `in progress` · `done` · `accepted` (documented exception, with expiry)

---

## P0 — hot path

### 1. Session verification is an external round-trip on every request
**Rule:** §8.1 (budget), §8.2 rule 9 (no blocking external calls in the request path), §9 (auth must be visible).
**Evidence:** `withAuth` calls `supabase.auth.getUser()` (network) and then `prisma.user.findUnique`
before the handler runs. `Server-Timing` now isolates it as `auth`; on the 401 path it measured 6.6 ms
locally, but a real Supabase round-trip from a Vercel region is typically 10–60 ms and is unbounded on a
cold TLS handshake.
**Why it matters:** auth is paid by every dashboard request, including `/api/user-role` on first paint.
**Options, in order:**
1. Verify the Supabase JWT locally against the project JWKS (`jose`/`getClaims()`), then resolve the
   farm from a short-TTL in-process cache keyed by `sub` (`Map<string, {farmId, role, expiresAt}>`).
2. Cache the `User.supabaseId → farmId` lookup per request with React `cache()` and per instance for
   30–60 s, invalidated on role/profile writes.
3. Keep `getUser()` only for mutations that change identity.
**Target:** `auth ≤ 20 ms` p95; no network call on a cached session.
**Status:** **done (fast path).** `lib/auth/verify-session.ts` now uses `getClaims()` (local JWKS
verification for asymmetric keys, server fallback for symmetric), backed by a 30 s session cache keyed
by a hash of the Supabase cookie, and a 60 s `supabaseId → farmId` cache. Concurrent requests with the
same cookie are single-flighted, so two refreshes cannot race and trigger Supabase reuse detection. A
cache hit performs no Supabase call and no DB lookup (covered by `lib/__tests__/auth-fast-path.test.ts`); the project JWKS
advertises ES256, so verification is local. A local microbenchmark measured 100 000 cache lookups in
7 ms (0.07 µs each). The `auth` phase is still emitted, so staging can verify the p95; that measurement
is the remaining step. Role changes are not cached by this path.

### 2. `getCurrentUser()` is called repeatedly per render and fetches the whole row
**Rule:** §8.2 rule 1 (no N+1), §7 (no over-fetching).
**Evidence:** `apps/web/lib/auth/session.ts` calls `createClient()` + `getUser()` + a full
`prisma.user.findUnique` on every call. Server components and actions call it through
`getCurrentPondOwnerId()`, `getCurrentUserRole()`, `canWrite()`, and `requireRole()`; a single page
render can repeat the pair several times.
**Fix:** wrap `getCurrentUser` in React `cache()` so a render tree performs it once, and add
`select: { id, farmId, role, displayName, email }`.
**Status:** **done.** `getCurrentUser` is wrapped in React `cache()`, so an RSC render tree or server
action performs the lookup once even when `getCurrentPondOwnerId`, `getCurrentUserRole`, `canWrite` and
`requireRole` all call it. Outside a React request scope the wrapper is a passthrough (verified against
React 19); route handlers rely on the session/farm caches instead.

### 3. `POST /api/predict-feeding` runs a second wave of queries
**Rule:** §8.1 (300/400 ms), §8.2 rule 1.
**Evidence:** the handler runs a `Promise.all` of three reads, then `resolveCurrentSchedule(pond.id,
deviceId)` as a separate awaited round-trip, then the prediction. `Server-Timing` shows the split
(`db` vs `app`).
**Fix:** fold the schedule lookup into the first wave (`Promise.all` with the other three), or read the
schedule from `pond` + latest command in one query. Measure again with `pnpm api:live`.
**Status:** open.

---

## P1 — correctness of the contract and large payloads

### 4. Bulk import and export exceed the request budget by design
**Rule:** §8.1 (400 ms max), §8.2 rules 9 and 11.
**Evidence:** `/api/import` has a 15 s guard, `/api/import/confirm` a 35 s guard and a 30 s Prisma
transaction, `/api/export` and `/api/export/batch` build up to `EXPORT_ROW_LIMIT` (50 000) rows
synchronously, and `/api/export-pdf` renders a PDF in-process.
**Fix:** return `202 Accepted` with a status URL and process the file in a background job (queue table
or Vercel cron worker). Until then these are declared exceptions in `API_REGULATION.md` and measured as
L1, not L2.
**Status:** accepted (expires 2027-03-31).

### 5. Database statement timeout is not enforced
**Rule:** §8.2 rule 6.
**Evidence:** the 1000 ms cap must be set at the role/connection level; Prisma cannot run `SET LOCAL`
per request without wrapping every request in a transaction. No migration sets it today.
**Fix:** `ALTER ROLE <app_role> SET statement_timeout = '1000ms';` in a migration, verified with
`SHOW statement_timeout`. Note that 1000 ms is **above** the 150 ms DB slice — the v1.2 proposal
recommends lowering it to 250 ms.
**Status:** open.

### 6. `rate_limit_bucket` adds a write to every API request
**Rule:** §8.1 (database slice), §8.2 rule 1.
**Evidence:** `checkApiRateLimit()` performs an atomic upsert before most handlers do their real work,
so every measured request costs an extra DB round-trip and row write. `Server-Timing` counts it.
**Fix:** keep the Postgres limiter for login/device (fail-closed semantics matter), move the general
API limiter to a shared cache with a token bucket, or fold the counter into the same statement as the
read where possible.
**Status:** open.

### 7. RSC pages and server actions are not instrumented
**Rule:** §9 (instrumentation in the request pipeline), §8.1 (the 300 ms budget is not only for `/api`).
**Evidence:** `withApi` covers route handlers. The dashboard's first render is a server component that
calls Prisma directly; a slow page never emits `Server-Timing` and never logs `WARN SLOW`.
**Fix:** wrap the data helpers in the same ALS metrics store (or add a `proxy.ts` request id and a
`reportRenderTiming` call in the dashboard layout) and export per-route p95 from Vercel logs.
**Status:** open.

---

## P2 — client and caching

### 8. Header role fetch is a client round-trip after hydration
**Rule:** §8.3 rule 4 (render immediately), §8.3 rule 6 (cache reads).
**Evidence:** `header-actions.tsx` fetches `/api/user-role` in `useEffect`. The page shell renders, but
the role-dependent UI pops in later. The route is now `private, max-age=60` + `ETag`, so repeat mounts
can be served from the browser cache — but the component still makes the first request.
**Fix:** read the role in the dashboard layout (server) and pass it as a prop; or add a small in-memory
client cache keyed by session.
**Status:** open.

### 9. SSE timing measures time-to-first-byte only
**Rule:** §8.1 (last byte), §9.
**Evidence:** `/api/chat` returns a `ReadableStream`; `withApi` measures until the `Response` object is
returned, not until `controller.close()`. `Server-Timing total` for chat is TTFB.
**Fix:** emit a completion log/timing from inside the stream's `flush`/`close` path (or a `TransformStream`
wrapper) and rename the header metric for streams (`ttfb`) in the v1.2 standard.
**Status:** open (documented limitation).

### 10. No list JSON endpoint yet, so pagination is only exercised by server actions
**Rule:** §4.1, §6.
**Evidence:** `getFeedEvents` and `getGrowthLogs` paginate with `take + 1` and an id cursor; no route
handler exposes a list. The envelope helper `paginated()` is ready but has no live caller.
**Fix:** when a list endpoint is added, include a compound cursor (`received_at, id`) and add it to
`scripts/api/endpoints.json` with `contract: true`.
**Status:** open.

---

## P3 — hardening

### 11. No load test for L3 endpoints
**Rule:** §11.4.
**Endpoints:** auth (`user-role`), reports (`export`), money-adjacent imports.
**Fix:** add a k6 scenario at 2× expected peak for 60 s and record the result next to the endpoint.
**Status:** open.

### 12. No OpenAPI/contract source of truth
**Rule:** §11.2 (contract test), §3 (versioning).
**Evidence:** the live suite declares endpoints by hand in `scripts/api/endpoints.json`; field-level
shape is not asserted, so adding/removing a field would not fail CI.
**Fix:** generate an OpenAPI document from the Zod schemas (or hand-maintain one) and diff it in CI;
derive the live suite from it.
**Status:** open.

### 13. Export success responses have no `ETag`
**Rule:** §8.2 rule 8 (reference data), not a violation — exports are user data.
**Note:** exports are generated on demand and never cached; adding `Cache-Control: no-store` makes that
explicit. Done in `withApi` config for the export routes.
**Status:** done.

---

## Verified baseline (local, 2026-10-22)

`next build` + `next start` against a deliberately unreachable database, to exercise the failure paths:

| Observation | Result |
|---|---|
| `/api/v1/health` rewrite reached the handler | yes |
| Request exceeded 2 000 ms | `504 TIMEOUT` with `Server-Timing`, `X-Request-Id` |
| `/api/v1/user-role` without a session | `401 UNAUTHENTICATED` envelope, `auth;dur` present, `Sunset` header |
| `/api/v1/this-route-does-not-exist` | `404 NOT_FOUND` envelope with headers |
| Legacy `/api/health` | flat body preserved, `queries;desc=1`, `db;dur` visible |
| Session cache hit | no Supabase call and no DB lookup (`auth-fast-path.test.ts`) |
| Live suite with no server | coverage `0/2`, exit 1 in **warn** mode |

These numbers are **not** a production baseline: the test database was unreachable, so DB timings show
connection failure, not query cost.

A second run used a real local PostgreSQL 16 database (29 migrations, 10 056 feed events) and a local
ES256 JWKS fixture that exercises the same `getClaims()` path as production:

| Endpoint | p95 | max | Queries |
|---|---|---|---|
| `GET /api/v1/user-role` | **4.4 ms** | 4.6 ms | 1 |
| `POST /api/v1/predict-feeding` | **18.5 ms** | 233.3 ms (outlier) | 8 |

Coverage was 5/5 contract and 2/2 latency, with zero violations. Full environment, method, and caveats:
[`docs/api-baseline-local.md`](./api-baseline-local.md). This is **not** a Supabase certification:
network latency, pooler behaviour, production volume, cross-region latency, cold starts, and L3 load
capacity still require a non-production Supabase project and the §11.4 load test.
