# OptiFeed — project adoption of the API Regulation

**Standard version:** 1.1 (the text below is the unmodified standard)
**Adopted:** 2026-10-22
**Canonical tree:** `/api/v1/*` (rewritten to the same handlers as legacy `/api/*`)
**Legacy sunset:** 2027-06-30

## Project decisions (required by §6 and §3.1)

| Decision | Value |
|---|---|
| JSON field style | `camelCase` for browser/JSON responses. ESP32 firmware payloads stay `snake_case` because the device contract is external and already deployed. |
| Canonical API prefix | `/api/v1` |
| Legacy paths | Dual-served through a `beforeFiles` rewrite in `apps/web/next.config.ts`. Removal date **2027-06-30**; legacy responses carry `Deprecation: true` and `Sunset`. |
| Money | No money fields today. When added: integer minor units plus an ISO-4217 `currency`. |
| Timestamps | ISO-8601 UTC with `Z` in JSON; Prisma `DateTime` in storage. |
| IDs | Opaque cuid/uuid strings; clients never parse them. |
| Envelope helpers | `apps/web/lib/api` (`ok`, `created`, `noContent`, `fail`, `paginated`, `cachedOk`). |
| Instrumentation | `withApi` wraps every route handler; query counting happens in `apps/web/lib/prisma.ts` at the Prisma extension hook (§8.2 rule 13). |
| Verification | `pnpm api:check` (static, runs in CI) and `pnpm api:live -- --mode warn` (live §11 suites). |

## Endpoint inventory

| Endpoint | Auth | Shape | Level target | Notes |
|---|---|---|---|---|
| `GET /api/v1/health` | none | flat probe body | L1 | Uptime-monitor contract; exempt from §4 |
| `GET /api/v1/user-role` | session | envelope | L2 | Private, 60 s cache + ETag |
| `POST /api/v1/predict-feeding` | session | envelope | L2 | CPU-bound inference |
| `POST /api/v1/import` | session (write role) | envelope | L1 | 15 s guard; backlog: background job |
| `POST /api/v1/import/confirm` | session (write role) | envelope | L1 | 35 s guard; backlog: background job |
| `GET /api/v1/export` | session | CSV file | L1 | Envelope applies to errors only |
| `GET /api/v1/export/batch` | session | ZIP file | L1 | Envelope applies to errors only |
| `GET /api/v1/export-pdf` | session | PDF file | L1 | Compatibility path; new clients use the PDF job |
| `POST /api/v1/chat` | session | SSE | L1 | Envelope applies to errors only |
| `GET /api/v1/feed-command` | device token | flat firmware JSON | Exempt | External device contract |
| `GET /api/v1/schedule-sync` | device token | flat firmware JSON | Exempt | External device contract |
| `POST /api/v1/ingest` | device token | 204 / plain text | Exempt | External device contract |
| `GET /api/v1/cron/device-watch` | cron bearer | envelope | L1 | Internal scheduled job |
| `POST /api/v1/export-jobs` | session | envelope (202) | L1 | Queues CSV/ZIP/PDF export; `Location` + status URL |
| `POST /api/v1/import-jobs` | session (write role) | envelope (202) | L1 | Queues import confirmation |
| `GET /api/v1/jobs/{id}` | session | envelope | L1 | Owner-scoped job status |
| `GET /api/v1/jobs/{id}/download` | session | file | L1 | Finished export artifact |
| `GET /api/v1/jobs/metrics` | session (ADMIN) | envelope | L1 | Queue depth, oldest queued age, 24 h failures, artifact bytes |
| `GET /api/v1/cron/jobs` | cron bearer | envelope | L1 | Worker: claims and runs queued jobs |
| `ANY /api/v1/{fallback}` | none | envelope 404 | L1 | Contract 404 |

## Exemptions (justify in the PR that changes them)

1. **ESP32 firmware contract** (`feed-command`, `schedule-sync`, `ingest`): flat `snake_case` JSON or plain-text status. Changing the shape requires a firmware release. Instrumentation headers still apply.
2. **`GET /health`**: the flat `{ "status": ... }` body is consumed by uptime monitors; it is an external contract.
3. **File downloads** (`export`, `export/batch`, `export-pdf`): non-JSON success bodies. Errors still use §4.2.
4. **SSE** (`chat`): a `text/event-stream` success body. Errors before the stream starts use §4.2.

## Project preconditions (§11.3)

- **Entry point:** `API_BASE_URL`, default `http://localhost:3000`.
- **Test credential:** `API_TEST_COOKIE` (a `sb-<ref>-auth-token` cookie) or `API_TEST_BEARER`. Without one, the live suite reports 0 % coverage and fails, as required by §11.3.
- **Verification dependencies:** `scripts/api` uses Node built-ins only, so a clean checkout can run it without touching runtime dependencies.
- **Database statement timeout:** set `statement_timeout=1000` at the Postgres role level. Prisma cannot apply `SET LOCAL` per request without an explicit transaction, so this is **policy-only** until the role setting is applied. Tracked in `docs/api-regulation-backlog.md`.
- **Seeded volume:** `pnpm --filter web seed:dev` before the live latency suite.

## How to run

```bash
# Static conformance (no server or database required) — runs in CI
pnpm api:check

# Live contract + latency suites against a running app
pnpm api:live -- --mode warn --base-url http://localhost:3000

# Flip to enforcement once coverage is >= 90 % and the backlog is empty
pnpm api:live -- --mode fail
```

The coverage floor (`measured / total >= 0.90`) is enforced in every mode: a run that measures nothing is a failure, not a pass.

---

# API Regulation — Global Backend Contract for Fast Response

**Version:** 1.1
**Applies to:** any backend language or framework (Node, Go, Java, Python, Ruby, PHP, .NET, Rust, …) and any client (web, mobile, another service).
**Scope:** HTTP + JSON semantics only. Nothing in this document depends on a specific stack, runtime, or toolchain.

---

## 0. What this is, and how to adopt it

This file is a **standard**: paste it into any repository as `API_REGULATION.md` and treat it as a binding part of code review. It defines how a backend and its clients must communicate so that:

1. Every response has one predictable shape.
2. Data appears on screen fast — **server-side p95 ≤ 300 ms, hard ceiling 400 ms** per endpoint.
3. Slow or malformed behavior is detected automatically (headers, logs, CI), never discovered by users.

Adoption in any project (details in §13):

```
1. Paste this file into the repository root.
2. Add one timing layer (§9) and wire it to your stack's request pipeline.
3. Add the two verification suites from §11 to CI, in warn mode first.
4. Run every endpoint through the checklist in §10.
```

---

## 1. Purpose & Scope

- This regulation governs every endpoint a backend exposes for its own clients (excluding third-party integrations where an external contract already applies).
- Its primary goal is **perceived speed**: the UI must be able to render data without waiting longer than **300–400 ms** for the server.
- The rules are written as **observable requirements**: each MUST can be checked by a test, a header, or a log line, independent of implementation language.

---

## 2. Conformance Levels

The words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are used as in RFC 2119.

| Level | Meaning | Required for |
|-------|---------|--------------|
| **L1 – Compliant** | All MUST rules in §3–§9 pass | Every endpoint, before merge |
| **L2 – Fast** | L1 + p95 ≤ 300 ms and no request > 400 ms in the latency suite (§11.1) | Every endpoint on a screen's first render ("hot path") |
| **L3 – Hardened** | L2 + documented query plan, cache policy, and load test at 2× expected peak | Endpoints touching money, auth, or reports |

### 2.1 Coverage accounting (a run that measures nothing is a failed run)

- Every verification run **MUST** report, per suite: `measured / skipped / total` endpoints.
- A **skipped** endpoint (unauthenticated, not found, environment unavailable) is **not certified**. It counts as neither pass nor compliance.
- Certifying **L2** requires that **≥ 90 %** of the declared hot endpoints were actually *measured* (timed and checked) in the run. Below that threshold the run **MUST** be reported as a **failure**, in every mode.
- An endpoint that fails its level **MUST NOT** be merged. Existing non-conforming endpoints are tracked in a backlog and fixed in priority order (hot paths first).

---

## 3. Transport & Versioning

- **MUST** use HTTP/1.1 or newer over TLS in production.
- **MUST** exchange JSON: `Content-Type: application/json; charset=utf-8` for requests with a body and for all responses (file downloads excepted).
- **MUST** carry a major version in the path: `/api/v1/...`.
- **MUST NOT** make breaking changes inside a version. Breaking = removing/renaming a field, changing a type, changing meaning, tightening validation. Breaking changes ship as `/api/v2/...`; `v1` stays alive for a documented deprecation window.
- **MAY** add new optional fields to responses without a version bump. Clients **MUST** ignore unknown fields.
- **SHOULD** support gzip or brotli compression for responses larger than 1 KB.

### 3.1 Retrofit clause (adopting the versioned path on an existing API)

Systems that already expose unversioned endpoints **MAY** serve both trees during migration:

- New endpoints **MUST** be created only under `/api/v1/`.
- Legacy paths **MAY** keep serving the same handler (dual-serving) for a documented deprecation window.
- The legacy tree **MUST** have a removal date recorded, and each release **SHOULD** report how many clients remain on it.
- Dual-serving **MUST NOT** duplicate logic: both paths resolve to the same implementation.

---

## 4. Response Envelope

Every JSON response uses one of two shapes.

### 4.1 Success

```json
{
  "data": { "id": "9b2f…", "name": "Maria Santos" },
  "meta": { "request_id": "c1f4…" }
}
```

- `data` **MUST** be present. Object for single resources, array for collections.
- `meta` **MUST** be present (may hold only `request_id`).
- List endpoints **MUST** add pagination info to `meta`:

```json
{
  "data": [ { "id": "…" }, { "id": "…" } ],
  "meta": {
    "request_id": "c1f4…",
    "page": { "limit": 50, "next_cursor": "eyJpZCI6…", "has_more": true, "total": 1280 }
  }
}
```

  `total` **MAY** be omitted when computing it would break the latency budget (§8.2, rule 7).
- Operations with no result body (e.g., delete) **MUST** return `204 No Content` with an empty body.

### 4.2 Error

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Amount must be greater than zero.",
    "details": [ { "field": "amount", "issue": "must be > 0" } ],
    "request_id": "c1f4…"
  }
}
```

- `code`: stable, machine-readable, `UPPER_SNAKE_CASE`. Clients branch on this, never on `message`.
- `message`: human-readable, safe to display. **MUST NOT** contain stack traces, SQL, file paths, or secrets.
- `details`: optional array or object with field-level information.
- Every error body **MUST** contain `request_id` so logs can be correlated.

---

## 5. HTTP Status Code Map

| Status | When | `error.code` examples |
|--------|------|-----------------------|
| `200 OK` | Successful read/update returning a body | – |
| `201 Created` | Resource created. **MUST** include a `Location` header | – |
| `204 No Content` | Successful delete / no body | – |
| `400 Bad Request` | Malformed JSON, bad query params | `BAD_REQUEST` |
| `401 Unauthorized` | Missing/invalid credentials | `UNAUTHENTICATED` |
| `403 Forbidden` | Authenticated but not allowed | `FORBIDDEN` |
| `404 Not Found` | Resource does not exist | `NOT_FOUND` |
| `409 Conflict` | Duplicate, version clash, state conflict | `CONFLICT` |
| `422 Unprocessable Entity` | Well-formed but fails validation | `VALIDATION_FAILED` |
| `429 Too Many Requests` | Rate limited. **SHOULD** send `Retry-After` | `RATE_LIMITED` |
| `500 Internal Server Error` | Unexpected failure | `INTERNAL_ERROR` |
| `503 Service Unavailable` | Dependency down / overloaded | `UNAVAILABLE` |
| `504 Gateway Timeout` | Upstream or DB exceeded its timeout | `TIMEOUT` |

Rules:
- **MUST NOT** return `200` with an error inside the body.
- **MUST** use `GET` for reads (safe, no side effects), `POST` for create/actions, `PUT`/`PATCH` for updates, `DELETE` for removal.

---

## 6. Resource & Naming Rules

- Resources are **plural, lowercase, kebab-case nouns**: `/api/v1/students`, `/api/v1/payment-records`.
- Hierarchy at most two levels deep: `/api/v1/students/{id}/payments`. Beyond that, use query filters.
- Actions that do not fit CRUD use a sub-resource verb: `POST /api/v1/payments/{id}/refund`.
- JSON fields: `snake_case` **or** `camelCase` — one choice per project, documented at the top of this file's project copy.
- IDs are opaque strings or UUIDs. Clients **MUST NOT** parse them.

**Query conventions (lists):**

| Purpose | Parameter | Example |
|---------|-----------|---------|
| Page size | `limit` (default 50, max 100) | `?limit=50` |
| Cursor paging (preferred) | `cursor` | `?cursor=eyJpZCI6…` |
| Offset paging (allowed for small tables) | `offset` | `?offset=100` |
| Filter | `field=value` | `?status=unpaid` |
| Range | `field_from`, `field_to` | `?created_from=2026-01-01` |
| Sort | `sort=field` / `sort=-field` | `?sort=-created_at` |
| Field selection | `fields=a,b,c` | `?fields=id,name` |

- Only **whitelisted** filter and sort fields are accepted; unknown ones return `400`.
- Every sortable/filterable field **MUST** be backed by an index (§8.2).

---

## 7. Data Type Rules

| Type | Rule |
|------|------|
| **Money** | **MUST** be an integer in minor units (`"amount": 15050` = 150.50) **or** a decimal string (`"150.50"`). **MUST NOT** be a binary float. Always paired with a `currency` (ISO 4217) when more than one currency is possible. |
| **Timestamps** | ISO-8601 in UTC with `Z`: `2026-10-22T04:51:00Z`. Never local time, never epoch ints. |
| **Dates** | `YYYY-MM-DD` |
| **Booleans** | `true` / `false` only (never `"yes"`, `1`) |
| **Enums** | `lower_snake_case` strings, documented set |
| **Null vs missing** | A field that exists in the schema is always present; use `null` for "no value". |
| **Large numbers** | Integers above 2^53 **MUST** be strings. |

**No over-fetching.** Queries **MUST** list explicit columns (never `SELECT *` on the hot path), and responses **MUST** include only fields the client uses. Heavy fields (blobs, long text, nested lists) are opt-in via `fields=` or a dedicated endpoint.

---

## 8. Performance Contract (the core)

### 8.1 Latency Budget

The budget measures **server-side processing time**: from the moment the request is fully received to the moment the last byte of the response is handed to the network layer. Network transit and client rendering are covered in §8.3.

| Metric | Target | Consequence |
|--------|--------|-------------|
| **p95 latency** per endpoint | **≤ 300 ms** | Above this: logged as `SLOW`, fails L2 |
| **Max latency** per request | **≤ 400 ms** | Above this: logged as `VIOLATION`, fails CI |
| **Absolute timeout** | **2 000 ms** | Server aborts the request and returns `504 TIMEOUT` |

**Budget decomposition (guideline for where the time may go):**

| Stage | Budget |
|-------|--------|
| Database (all queries combined) | ≤ 150 ms |
| Application logic | ≤ 80 ms |
| Serialization & compression | ≤ 20 ms |
| Headroom (GC, scheduling, jitter) | ~ 50 ms |
| **Total** | **≈ 300 ms** |

If a stage exceeds its slice, the endpoint must be redesigned, not given a bigger budget.

### 8.2 Mandatory Rules

1. **One query round-trip per request on the hot path.** No N+1. Never run a query inside a loop over rows. Use joins, batched lookups (`IN (…)` / `ANY(…)`, or the equivalent in your data layer).
2. **Aggregate in the database.** Sums, counts, group-bys, and rankings are computed by the query engine, not by looping over rows in application code.
3. **Every filter, join, and sort column is indexed.** A sequential scan on a table expected to exceed 10 000 rows is a defect.
4. **Pagination on every list endpoint.** `limit` default 50, **hard max 100**. No unbounded lists.
5. **Response size cap: ≤ 256 KB** (uncompressed). Larger payloads must be paginated or split.
6. **Database statement timeout: 1 000 ms** (set at connection or role level). Queries that can legitimately exceed this move to background jobs.
7. **Count queries are optional.** `COUNT(*)` over large tables is expensive; return `total` only when it fits the budget, otherwise use `has_more`.
8. **Cache reference data.** Data that changes rarely (settings, categories, rate tables) **MUST** be cacheable:
   - HTTP: `Cache-Control: public, max-age=300` (or `private` if user-specific) plus `ETag`; honor `If-None-Match` with `304`.
   - Server: in-process or shared cache with explicit invalidation on write.
9. **No blocking external calls in the request path** (email, SMS, webhooks, PDF generation, third-party APIs). Queue them and return `202 Accepted` with a status URL.
10. **Bounded connection pool.** Pool size is set deliberately (not unlimited); pool-wait time counts toward the latency budget and is logged.
11. **Writes are fast too.** Create/update endpoints follow the same 300/400 ms rule; bulk imports use batch inserts (multi-row insert, `executemany`, `COPY`, or your driver's batch API), never one query per row.
12. **Idempotency.** `POST` endpoints that move money or create important records **SHOULD** accept an `Idempotency-Key` header so retries are safe.
13. **Query counting is automatic.** The number of data-layer round-trips per request **MUST** be counted at the connection/driver level by the instrumentation (§9) — not by manually wrapping individual calls, which silently measures zero when someone forgets.

### 8.3 Perceived-Speed Rules for Clients

The server budget only helps if the client uses it well. Frontend and mobile code **MUST**:

1. Use **one shared API client function** for every call (base URL, auth header, JSON parsing, envelope unwrapping, error mapping, timeout). No raw HTTP calls scattered through the UI.
2. Set a **client timeout of 1 000 ms** for reads (abort, then show a retry state) and a longer, explicit timeout for writes.
3. Fetch **independent resources in parallel**, never in sequential await chains.
4. **Render immediately.** Show the page shell and skeleton/placeholder content right away, then swap in data when it resolves. Never block the whole screen on a spinner.
5. Request only what the screen needs (`fields=`, `limit=`).
6. Cache and reuse recent reads on the client (memory or stale-while-revalidate) for navigation between screens.
7. Disable submit buttons while a write is pending and update the UI optimistically when safe.
8. Retry only idempotent requests (`GET`, or `POST` with `Idempotency-Key`), at most twice with backoff.

---

## 9. Observability

Measurement is what makes the budget real. Instrumentation **MUST** live in the request pipeline itself (middleware / filters / interceptors / decorators — whatever the stack calls them), not in individual handlers.

- **MUST** add a `Server-Timing` header to **every** response — success and error alike, including `4xx` and `5xx`:
  `Server-Timing: total;dur=142.3, db;dur=91.0`
  (`total` required; `db` and `app` SHOULD be included when measurable.)
  The instrumentation layer **MUST** wrap the error-handling layer: an uncaught-exception response must still carry the headers.
- **MUST** add `X-Request-Id` to every response (generate if the client did not send one; accept a client-supplied one only if it matches a safe pattern) and echo it in `meta.request_id` / `error.request_id`.
- **MUST** log every request slower than **300 ms** as `WARN SLOW` and every request slower than **400 ms** as `ERROR VIOLATION`, each with: method, route **template** (not the raw URL), status, duration, DB time, query count, request id.
- **MUST** count queries per request automatically (§8.2 rule 13) and log a warning when a single request issues more than **5** queries (N+1 smell).
- **SHOULD** export per-route p50/p95/p99 and error-rate metrics to the team's monitoring tool and alert when p95 > 300 ms for 5 consecutive minutes.
- **MUST NOT** log secrets, passwords, tokens, or full card/ID numbers.

---

## 10. Endpoint Conformance Checklist

Copy this into every pull request that adds or changes an endpoint.

```
Endpoint: METHOD /api/v1/…                       Level targeted: L1 / L2 / L3

Contract
[ ] Path is plural kebab-case, versioned (/api/v1)
[ ] Success uses {"data","meta"}; errors use {"error":{code,message,details,request_id}}
[ ] Correct HTTP status codes (§5); no 200-with-error
[ ] Money is integer minor units or decimal string; timestamps are ISO-8601 UTC
[ ] Unknown filter/sort fields rejected with 400

Performance
[ ] Explicit column list (no SELECT * on hot path)
[ ] Query count per request: ____  (target: 1 on hot path, never in a loop; counted automatically)
[ ] Aggregations done in query language
[ ] EXPLAIN (ANALYZE) pasted below; no seq scan on large tables
[ ] Indexes exist for every filter/join/sort column (migration included)
[ ] List endpoint paginated; limit default 50, max 100
[ ] Response ≤ 256 KB at max page size
[ ] Reference data has Cache-Control + ETag
[ ] No blocking external calls (email/SMS/PDF) in request path
[ ] Measured locally: p95 = ____ ms (≤ 300)   max = ____ ms (≤ 400)

Observability
[ ] Server-Timing and X-Request-Id present (including on error responses)
[ ] Contract test + latency test added to CI

EXPLAIN output:
<paste here>
```

---

## 11. CI Enforcement Recipe

Rules that are not tested are suggestions. Add the suites below to CI. Both are written in language-agnostic pseudocode; implement them with your stack's test runner.

### 11.1 Latency budget test

```
CONFIG:
  WARMUP        = 5 requests per endpoint (discarded)
  SAMPLES       = 30 requests per endpoint
  P95_BUDGET_MS = 300
  MAX_BUDGET_MS = 400
  DATASET       = seeded database with realistic volume
                  (e.g. 10 000+ rows in the largest tables)

measured = 0
skipped  = 0

for each endpoint in HOT_ENDPOINTS:            # GET list/detail/report routes
    first = http.request(endpoint)
    if first.status in (401, 403, 404, 405, 422):
        skipped += 1
        record_skip(endpoint, first.status, reason)
        continue                               # NOT certified — see §2.1
    enforce(status < 500)                      # same warn/fail gate as the budgets below

    send WARMUP requests
    timings = []
    for i in 1..SAMPLES:
        t0 = now()
        resp = http.request(endpoint)
        timings.append(now() - t0)
        enforce(resp.status < 500)
    p95 = percentile(timings, 95)
    mx  = max(timings)
    measured += 1
    record(endpoint, p95, mx)
    enforce(p95 <= P95_BUDGET_MS,  "p95 over budget")
    enforce(mx  <= MAX_BUDGET_MS,  "request over hard ceiling")

report(measured, skipped, total)               # §2.1 coverage accounting
enforce(measured / total >= 0.90, "coverage floor: too few endpoints measured")
```

### 11.2 Contract test

```
measured = 0; skipped = 0

for each endpoint in ALL_READ_ENDPOINTS:
    resp = http.get(endpoint)
    if resp.status in (401, 403, 404, 405, 422):
        skipped += 1
        continue
    measured += 1
    if resp.status == 200:
        assert resp.json has keys "data" and "meta"
        assert header "Server-Timing" present
        assert header "X-Request-Id" present
    if resp.status >= 400:
        assert resp.json["error"] has "code", "message", "request_id"
        assert header "Server-Timing" present        # errors must be instrumented too (§9)

assert http.get("/api/v1/this-route-does-not-exist").status == 404 with error envelope
assert list endpoints with limit=1000 return at most 100 items (or 400)

report(measured, skipped, total)
enforce(measured / total >= 0.90, "coverage floor")
```

### 11.3 Measurability preconditions

A suite that cannot measure must not report green. Before the suites above run:

1. **Configurable entry point.** The suites locate the application under test via configuration (environment variable or test config — e.g. `API_APP_IMPORT="module:factory"`), never a hardcoded path. The value MAY default to the repository's conventional entry point, with a small probe list as fallback.
2. **One warn/fail gate.** Every assertion — status, envelope, headers, budgets, coverage — routes through a single `enforce(mode, condition)` gate. Modes:
   - `warn` (rollout): report the problem, **keep CI green regardless of environment**;
   - `fail` (enforcement): fail CI on any breach.
   Environment problems (no database, no credentials) **skip with a visible reason** in `warn` mode; they only fail the run in `fail` mode.
3. **Test credential is mandatory.** The suites **MUST** provision a test credential (login against a seeded account, a minted token, or a test API key) before measuring. If authentication cannot be established, the run **MUST** be reported as failed — "everything returned 401 and was skipped" is §2.1 non-compliance, not a pass.
4. **Verification dependencies are declared separately** from runtime dependencies (`requirements-dev.txt`, `devDependencies`, a `test` task, etc.), so a clean checkout can run the suites without touching production dependencies.
5. **Coverage floor.** The final `enforce(measured/total ≥ 0.90)` from §11.1/§11.2 applies in **both** modes: insufficient coverage is always a failure.

**Rollout:** run the suites in **warn mode** for the first two weeks while existing endpoints are fixed and skip-gaps are closed, then switch to **fail mode**.

### 11.4 Optional load check

Before releasing an L3 endpoint, run a short load test (any tool: k6, wrk, autocannon, Locust, JMeter, vegeta) at 2× expected peak concurrency for 60 seconds. Pass condition: p95 ≤ 300 ms and error rate < 0.1 %.

### 11.5 Fix playbook for a failing endpoint

1. Look at `Server-Timing`: is the time in `db` or `app`?
2. If `db`: run the query plan (`EXPLAIN ANALYZE`); add the missing index; remove the loop/N+1; push the aggregation into the query language; select fewer columns.
3. If `app`: profile, remove repeated work, cache reference data, stream or paginate large results.
4. If both are fine but total is high: check serialization size and pool wait time.
5. Still over budget: move the work to a background job and return `202`.

---

## 12. Appendix (non-normative)

### 12.1 List with filter, sort, pagination

```
GET /api/v1/payments?status=unpaid&sort=-created_at&limit=2
```
```json
{
  "data": [
    { "id": "p_102", "student_id": "s_8", "amount": 150000, "currency": "PHP", "status": "unpaid", "created_at": "2026-10-20T08:15:00Z" },
    { "id": "p_101", "student_id": "s_3", "amount": 150000, "currency": "PHP", "status": "unpaid", "created_at": "2026-10-19T09:02:00Z" }
  ],
  "meta": {
    "request_id": "7a1c…",
    "page": { "limit": 2, "next_cursor": "eyJpZCI6InBfMTAxIn0", "has_more": true }
  }
}
```
Response headers:
```
Server-Timing: total;dur=48.7, db;dur=31.2
X-Request-Id: 7a1c…
```

### 12.2 Create

```
POST /api/v1/payments
Idempotency-Key: 5c9e0b2e-…
{ "student_id": "s_8", "amount": 150000, "currency": "PHP" }
```
```
201 Created
Location: /api/v1/payments/p_103
```
```json
{ "data": { "id": "p_103", "student_id": "s_8", "amount": 150000, "currency": "PHP", "status": "unpaid" },
  "meta": { "request_id": "b44d…" } }
```

### 12.3 Validation error

```
422 Unprocessable Entity
```
```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Amount must be greater than zero.",
             "details": [ { "field": "amount", "issue": "must be > 0" } ],
             "request_id": "e90a…" } }
```

### 12.4 N+1 → single round trip (illustrative query logic)

Bad (one query per row):
```
rows = query("SELECT id, name FROM customers")
for r in rows:
    r.total_paid = query("SELECT SUM(amount) FROM charges WHERE customer_id = ?", r.id)
```
Good (one query, aggregated in the database):
```sql
SELECT c.id, c.name, COALESCE(SUM(ch.amount), 0) AS total_paid
FROM customers c
LEFT JOIN charges ch ON ch.customer_id = c.id
GROUP BY c.id, c.name
ORDER BY c.name
LIMIT 50;
-- supporting index: CREATE INDEX idx_charges_customer_id ON charges (customer_id);
```

### 12.5 Reference-data caching

```
GET /api/v1/reference-years
→ 200
  Cache-Control: public, max-age=300
  ETag: "v7"

GET /api/v1/reference-years
  If-None-Match: "v7"
→ 304 Not Modified
```

### 12.6 Implementation map — where each rule lives, by stack family

Same rules, different names. Pick your family; the section numbers are the contract.

| Concern | Express middleware / plugin | Filter / interceptor chain | Decorator / wrapper | ASGI/WSGI or handler wrapper |
|---|---|---|---|---|
| §9 timing, `Server-Timing`, `X-Request-Id` | global plugin around the router | outermost filter/interceptor | wrap the router/endpoint function | wrap the application entry point |
| §9 error-path headers | error plugin registered **inside** the timing plugin | error interceptor **below** the timing filter | exception handler decorated with start-time | error hook receives start time from request scope |
| §9 query counting (§8.2 rule 13) | connection hook / query event listener on the pool | same | data-layer wrapper class | driver's logging/event hook |
| §4 error envelope | global error handler | error resolver | exception decorator | error callback |
| §8.1 timeouts | server read/write timeouts + DB statement timeout | same | same | same |
| §11 suites | your test runner + a real HTTP client | same | same | same |

Illustrative shapes (≤ 10 lines, syntax is irrelevant):

```
# timing layer (any stack)
handle(req):
    t0 = now()
    on_response(resp):
        resp.headers["Server-Timing"] = "total;dur=" + str(now() - t0)
        log_if(now() - t0 > 300 or now() - t0 > 400)
    proceed(req, on_response)

# enforcement gate (any test suite)
enforce(mode, ok, message):
    if ok: return
    if mode == "fail": fail_test(message)
    else:              warn(message)     # CI stays green
```

---

## 13. Retrofit Playbook — adopting this on an existing system (6 steps)

```
0. Declare preconditions
   - app entry point addressable from tests (config, not hardcoded)
   - test credential provision (seeded account / minted token / test key)
   - seeded data volume representative of production
   - verification dependencies declared separately from runtime dependencies

1. Instrument
   - add the timing layer (§9): Server-Timing, X-Request-Id, SLOW/VIOLATION logs
   - enable automatic query counting at the data layer (§8.2 rule 13)
   - make sure error responses are instrumented too

2. Observe
   - run the §11 suites in warn mode; publish the slowest endpoints
   - fix auth/skip gaps until ≥ 90% of hot endpoints are actually measured (§2.1)

3. Account
   - publish measured / skipped / total per suite
   - classify every endpoint: L1 / L2 / L3 / backlog

4. Contract
   - serve the §4 envelope behind adapters while old clients migrate
   - introduce the versioned path per §3.1 (dual-serve, removal date recorded)
   - move clients to the single shared API client (§8.3 rule 1)

5. Enforce
   - coverage floor passes → flip warn → fail
   - every new/changed endpoint carries the §10 checklist in its PR
   - backlog burns down in this order: hot-path screens → reports/aggregates → writes/imports
```

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-10-22 | First release: envelope, status map, naming, data types, 300/400 ms budget, 12 mandatory rules, observability, CI recipe. |
| 1.1 | 2026-10-22 | Added §2.1 coverage accounting (skipped ≠ passed), §3.1 retrofit clause, §8.2 rule 13 (automatic query counting), §11.3 measurability preconditions, §12.6 implementation map, expanded §13 retrofit playbook; §9 tightened so error responses carry instrumentation headers. |

---

*Changes to this regulation are made by pull request and bump the version in the header and the Changelog.*
