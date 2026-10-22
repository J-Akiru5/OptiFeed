# API Regulation v1.2 — proposed amendments

**Status:** proposal for review (not yet part of the standard)
**Based on:** implementing v1.1 in OptiFeed and running the §11 suites against a Next.js 16 /
Supabase / Prisma backend
**Goal:** make every rule measurable without gaming, and close the gaps that let a slow or unsafe API
still certify.

The standard is strong: the envelope, the status map, the 300/400 ms budget, and the coverage floor
already prevent the most common failure ("it works on my machine"). The amendments below are ordered by
how much they change outcomes, not by how easy they are to write.

---

## 1. Priority table

| # | Area | v1.1 problem | Proposed amendment | Impact |
|---|---|---|---|---|
| A1 | Measurement | Latency is wall-clock HTTP time; network/proxy noise is indistinguishable from server work | Record both client time and `Server-Timing total`; gate on server time; assert the gap | **High** |
| A2 | Measurement | "p95 ≤ 300 ms" at unspecified concurrency is not a capacity statement | Add `CONCURRENCY` and a minimum throughput to the suite | **High** |
| A3 | Serverless | Cold starts are mixed into p95, so a correct app fails on a cold runner | Separate cold-start budget; discard cold samples from warm p95 | **High** |
| A4 | Auth | Identity-provider calls are invisible and unbounded | Add `auth` to `Server-Timing` with a budget; require cached/local verification | **High** |
| A5 | Caching | An `ETag` that includes `request_id` can never match | Define ETag inputs; require 304 to be tested | **High** |
| A6 | Indexing | "Every filter/sort column is indexed" is not testable | Require a query registry + `EXPLAIN` artifacts in CI | **High** |
| A7 | Coverage | The hot-endpoint list can be shrunk to game the 90 % floor | Freeze the list, require review, add traffic-weighted coverage | **High** |
| A8 | N+1 | `queries > 5` misses ORM batching and 1-row perf cases | Test query count at `limit=1` vs `limit=100`; count statements | Medium |
| B1 | Budget math | 1 000 ms statement timeout > 150 ms DB slice; 2 000 ms absolute > 6× p95 | Align the numbers: DB timeout 250 ms, absolute 1 000 ms | Medium |
| B2 | Idempotency | "SHOULD accept a key" has no semantics | Define key scope, TTL, replay, and conflict rules | Medium |
| B3 | Pagination | Cursor format is unspecified | Require the full sort tuple and forbid deep offsets | Medium |
| B4 | Errors | Taxonomy stops at 504; no retryability signal | Add `retryable`, `retry_after_ms`, `doc_url`; define 405/413/415 | Medium |
| B5 | Streaming | "Last byte" is undefined for SSE | Separate `ttfb` and `stream_total`; still require headers | Medium |
| B6 | Compression | 256 KB cap is uncompressed only | Add a compressed cap and `Content-Encoding` negotiation | Medium |
| B7 | Security | No CORS/CSRF/cache rules for cookie auth | Add explicit rules for cookie-authenticated APIs | Medium |
| B8 | Deprecation | §3.1 says "record a removal date" but not how | Require `Deprecation`/`Sunset` headers + per-path usage counts | Medium |
| C1 | Client | No rendering budget (only server time) | Add LCP/INP budgets and waterfall detection | Medium |
| C2 | Money | Minor units without currency exponent | Define exponent by ISO-4217 currency and rounding mode | Low |
| C3 | Dates | Range inclusivity unspecified | Define `_from` inclusive, `_to` exclusive, UTC | Low |
| C4 | Observability | Route-template rule lacks cardinality limits and sampling | Add cardinality cap and tail sampling | Low |
| C5 | Contract | No schema source of truth | Require OpenAPI (or equivalent) + diff check | Low |
| C6 | Test env | "Realistic volume" is not defined per engine | Require same engine/version + pooler mode + region | Low |

---

## 2. Detailed amendments

### A1. Measure server time, not the network — and verify the difference

**Problem.** §11.1 times `now()` around an HTTP request. That includes DNS, TLS, proxy buffering, and
CI-runner scheduling. A fast server behind a slow proxy fails; a slow server behind a warm keep-alive
connection can pass. The standard already requires `Server-Timing` (§9) but never uses it as the
measurement source.

**Evidence.** In our local run, `/api/health` reported `Server-Timing: total;dur=1973.8, db;dur=1972.6`
while total client time was ~1.98 s; on a remote runner the gap would be 20–80 ms and would decide
pass/fail near the 300 ms line.

**Proposed text (replace the measurement block in §11.1):**

```
For every sample record:
  client_total_ms  = now() before request .. last body byte
  server_total_ms  = Server-Timing "total";dur
  network_ms       = client_total_ms - server_total_ms

Gate 1 (server): percentile(server_total_ms, 95) <= 300 and max(server_total_ms) <= 400
Gate 2 (sanity): network_ms <= NETWORK_ALLOWANCE_MS (default 150, env-configurable)
If Server-Timing is missing: the sample is a contract failure, not a latency sample.
```

Keep the client number in the report for perceived speed, but do not fail the server budget on a
network artefact.

**Migration.** v1.1 reports remain valid; add the `Server-Timing` column. Endpoints without the header
already fail §9, so this makes the two suites agree.

---

### A2. State the concurrency and throughput

**Problem.** A single-user sequential loop measures an idle server. It cannot distinguish an endpoint
that handles 2 RPS from one that handles 200 RPS at the same p95.

**Proposed text (new §11.1 config):**

```
CONCURRENCY      = 1   # perceived-speed budget (default)
CAPACITY_CONCURRENCY = 10  # L3 only, with a 60 s soak
MIN_THROUGHPUT_RPS = 20    # L2 minimum at CONCURRENCY=1
```

Require the report to state concurrency and achieved RPS. For L3, run the §11.4 load check at the
declared peak and report both p95 and error rate.

---

### A3. Separate cold starts from warm latency

**Problem.** Serverless cold starts (bundle load, DB/TLS handshake, Prisma engine start) routinely add
300–1 500 ms. Mixing them into p95 makes a compliant function fail intermittently; excluding them
silently hides a real user experience.

**Proposed text (new §8.1.1):**

```
Cold start is measured separately:
  - first request after a deploy / scale-to-zero
  - budget: p95 <= 1 500 ms, max <= 3 000 ms
Warm latency: 5 warm-up requests, then 30 samples; cold samples are discarded.
The report MUST state whether the runtime is serverless and whether a cold sample occurred.
```

For Next.js: state the region and whether the Supabase pooler is in the same region; a cross-region
cold start is a configuration defect, not a code defect.

---

### A4. Make auth a first-class, budgeted phase

**Problem.** v1.1 treats the DB as the only dependency worth isolating. In practice an identity
provider call is the most common unbounded dependency in a request, and it is invisible in `db`/`app`.

**Evidence.** `withAuth` in OptiFeed performs `supabase.auth.getUser()` (network) plus one DB lookup
before every handler. We added `auth;dur=` to `Server-Timing`; without it the cost disappears into
`app`.

**Proposed text (extend §9):**

```
Server-Timing MUST include `auth;dur` whenever the request authenticates.
Budget: auth <= 30 ms p95 on a warm instance.
The request path MUST NOT make an unbounded identity-provider call per request.
Acceptable: local JWT verification (JWKS), a signed session cookie, or a bounded cache
(<= 60 s) keyed by the subject.
`getUser()`-style remote verification is allowed only on login, refresh, and writes that change identity.
```

Also require auth failures to be instrumented (they already are in 1.1's §9 wrapping rule; call it out
explicitly for the 401 path).

---

### A5. Define ETag inputs and test the 304 path

**Problem.** v1.1 says "plus ETag; honor If-None-Match with 304" but not what the ETag covers. A body
that embeds `request_id`, `Date`, or a trace id changes on every request, so the ETag never matches and
the 304 path is dead code that still passes review.

**Evidence.** Our first implementation hashed the full envelope including `request_id`; the unit test
caught that the conditional request returned 200. The fix was to hash `{ data, meta }` without
`request_id` while still returning the current request id in the body.

**Proposed text (replace rule 8's HTTP bullet):**

```
ETag is computed over the representation that can change: data + cacheable meta.
It MUST NOT include request_id, Date, trace ids, or any per-request value.
A cached response MUST set Vary (Authorization/Cookie for private, Accept-Encoding for public).
The contract suite MUST perform: GET -> capture ETag -> GET with If-None-Match -> expect 304
with the same ETag and an empty body.
```

---

### A6. Make indexing verifiable

**Problem.** "Every filter, join, and sort column is indexed" is unfalsifiable in review. ORMs hide
the SQL; composite-index column order matters; a partial index may not match the predicate. A
`SELECT *` check catches over-fetching but not a sequential scan.

**Proposed text (new §8.2 rule 3a):**

```
Every hot query is registered in queries.json:
  { "id": "feed-events-list", "route": "GET /api/v1/feed-events",
    "sql_file": "queries/feed-events-list.sql", "max_rows_scanned": 5000 }

CI runs EXPLAIN (ANALYZE, BUFFERS) against the seeded database and fails when:
  - a Seq Scan appears on a table above the declared row threshold, or
  - rows scanned > max_rows_scanned, or
  - the plan's actual time exceeds the DB slice (150 ms).

The EXPLAIN output is attached to the PR (the §10 checklist already asks for it; make it generated).
```

This also catches index-only-scan regressions after a schema change. For Supabase, add a check that RLS
predicates use `(select auth.uid())` rather than a bare `auth.uid()` per row.

---

### A7. Close the coverage-gaming holes

**Problem.** §2.1 requires ≥ 90 % of *declared* hot endpoints. The declaration is editable in the same
PR that adds a slow endpoint, so moving an endpoint to "not hot" raises coverage without measuring
anything.

**Proposed text (replace §2.1's last paragraph):**

```
The hot-endpoint declaration is a reviewed file (hot_endpoints.json), not prose.
Changes to it require the same review as the endpoint change and MUST list a reason.
Coverage is computed against the union of:
  (a) the declared hot endpoints, and
  (b) the top 20 routes by production request volume (when traffic data exists).
A skipped endpoint is skipped-for-now only: after 3 consecutive runs it is a failure in both modes.
A run that certifies L2 MUST publish the per-endpoint measured/skipped table.
```

Add a `MIN_HOT_ENDPOINTS` (e.g., 5) so an empty list cannot certify.

---

### A8. Detect N+1 by growth, not only by an absolute count

**Problem.** "More than 5 queries is a smell" catches loops over rows, but an ORM can batch 100 rows
into 1 query and still issue 6 fixed queries; conversely a 7-query request with constant cost is fine.
The absolute threshold is both noisy and blind to the real pattern.

**Proposed text (extend §8.2 rule 13 and §9):**

```
Count round-trips and statements separately.
Run the endpoint at limit=1 and limit=100 on the same dataset.
If the query count grows with the page size, it is an N+1: fail.
Absolute query count warns at >5 and fails at >10 on a hot path, with an inline justification
required above 5.
```

---

### B1. Align the timeout numbers with the budget

**Problem.** The DB slice is 150 ms, the p95 budget is 300 ms, the max is 400 ms, the statement timeout
is 1 000 ms, and the absolute timeout is 2 000 ms. A query allowed to run for 1 000 ms can never satisfy
the 150 ms slice; an absolute timeout 6.7× the p95 is not a budget, it is a hang detector.

**Proposed text (replace §8.1's table rows and §8.2 rule 6):**

```
DB statement timeout: 250 ms (1.7× the 150 ms DB slice)
Absolute request timeout: 1 000 ms (2.5× the max budget)
```

The 2 000 ms value can stay as a platform hard limit, but it must not be the application's budget.

---

### B2. Give idempotency semantics

**Problem.** "SHOULD accept an Idempotency-Key" leaves the hard parts undefined: scope, storage,
replay, and what happens when the same key is reused with a different body.

**Proposed text (new §8.2 rule 12a):**

```
Key scope: (tenant, route, key). TTL: 24 h (money: 7 days).
Storage: key, request hash, status, response headers, response body (or a pointer).
Replay: same key + same request hash -> return the stored status/body with Idempotency-Replayed: true.
Conflict: same key + different hash -> 409 IDEMPOTENCY_KEY_REUSED.
In-flight: same key while the first request runs -> 409 or 425, never a duplicate write.
A POST that moves money MUST require the header; a missing key is 400.
```

For Next.js, note that `after()`/background jobs must persist the stored response before acknowledging.

---

### B3. Make cursors stable

**Problem.** "Cursor paging (preferred)" does not specify the cursor contents. A cursor on a
non-unique sort key (`created_at`) duplicates or skips rows under equal timestamps; an offset cursor
degrades linearly.

**Proposed text (extend §6):**

```
A cursor MUST encode the full sort tuple, e.g. { created_at, id } with the same direction.
Ties are broken by the primary key.
Offset paging is allowed only with a documented max (<= 10 000); beyond that, require a cursor.
The response's next_cursor MUST be opaque and MUST NOT be parsed by clients.
```

---

### B4. Complete the error contract

**Problem.** Clients need to know whether to retry; the current envelope has no signal. 405/413/415 are
missing from §5 even though frameworks emit them.

**Proposed text (extend §4.2 and §5):**

```json
{
  "error": {
    "code": "UNAVAILABLE",
    "message": "The reporting service is temporarily unavailable.",
    "retryable": true,
    "retry_after_ms": 2000,
    "doc_url": "https://docs.example.com/errors/UNAVAILABLE",
    "request_id": "c1f4…"
  }
}
```

Add `405 METHOD_NOT_ALLOWED`, `413 PAYLOAD_TOO_LARGE` (with `max_bytes`), and `415
UNSUPPORTED_MEDIA_TYPE` to the map. `retryable` is required; `retry_after_ms` is required when true.

---

### B5. Define streaming timing

**Problem.** §8.1 measures "the last byte of the response". For SSE/streaming that is the end of a
conversation, not a request budget. Our `/api/chat` measures TTFB but labels it `total`.

**Proposed text (new §8.1.2):**

```
Streaming responses report:
  ttfb;dur  = time to first byte
  stream_total;dur = time to stream close (logged, not gated by the 300 ms read budget)
The response MUST still carry X-Request-Id and Server-Timing on the initial headers.
A stream that produces no first byte within 1 000 ms is a 504 before the stream starts.
```

---

### B6. Cap compressed size too

**Problem.** 256 KB uncompressed protects the database and serialization, but the network and CDN care
about compressed bytes; a highly compressible 250 KB payload is cheap, an incompressible 250 KB payload
is expensive.

**Proposed text (extend rule 5):**

```
Uncompressed body <= 256 KB.
Compressed body <= 64 KB for responses over 1 KB.
Serve gzip or brotli when the client advertises it; set Vary: Accept-Encoding.
```

---

### B7. Add explicit cookie-auth security rules

**Problem.** The standard is about speed and shape, but a cacheable response with `Set-Cookie`, or a
cookie-authenticated POST without CSRF protection, is a correctness bug that a fast API makes worse.

**Proposed text (new §3.2):**

```
Cookie-authenticated state-changing requests MUST be CSRF-protected
(SameSite=Lax/Strict plus an origin check or a token).
Responses that set cookies MUST be Cache-Control: no-store.
Private data MUST be private, max-age=... with Vary: Cookie; never public.
CORS is deny-by-default; allowed origins are an explicit list.
```

---

### B8. Make deprecation observable

**Problem.** §3.1 requires a removal date but not a mechanism. In practice legacy paths live forever
because nobody measures who still calls them.

**Proposed text (extend §3.1):**

```
Legacy responses MUST carry Deprecation: true and Sunset: <HTTP-date>.
Each legacy path MUST emit a counter (path template, client id if known).
The release notes report the count; the path is removed when the count is zero
for two consecutive releases or the sunset date passes, whichever is later.
```

We implemented the headers and a recorded sunset (2027-06-30) in `next.config.ts`; the counter is still
open.

---

### C1. Add a rendering budget

**Problem.** Server-side p95 can be 80 ms while the screen still takes 4 s because the client fetches
four resources in a waterfall, hydrates a huge bundle, or blocks on a font.

**Proposed text (new §8.3 rule 9):**

```
Hot screens MUST meet: LCP <= 2.5 s (p75, mobile), INP <= 200 ms (p75), CLS <= 0.1.
Independent data fetches MUST start in parallel; a sequential await chain on first render is a defect.
The client MUST abort in-flight reads on unmount and dedupe identical in-flight requests.
```

For Next.js: prefer server components + streaming with Suspense; do not gate the shell on data.

---

### C2–C6. Smaller correctness amendments

- **C2 Money:** require the ISO-4217 exponent (`JPY` = 0, `PHP` = 2), state the rounding mode
  (half-up), and forbid floats in JSON. Integer minor units are the default.
- **C3 Dates:** `field_from` is inclusive, `field_to` is exclusive, both interpreted in UTC; reject
  date-only values with a timezone offset.
- **C4 Observability:** cap metric label cardinality (route template only), sample successful requests
  at 10 % after 1 000 RPS, keep 100 % of 5xx/slow requests.
- **C5 Contract:** require an OpenAPI (or equivalent) document as the source of truth and run a
  breaking-change diff in CI; the prose standard explains *why*, the schema enforces *what*.
- **C6 Test environment:** require the same database engine and major version, the same pooler mode
  (transaction vs session), and a documented region; otherwise a green run is not evidence.

---

## 3. What v1.1 should keep unchanged

- The two-shape envelope and the stable `UPPER_SNAKE_CASE` codes.
- The 300 ms p95 / 400 ms max split, and the coverage floor.
- The rule that instrumentation wraps the error layer and must appear on 4xx/5xx.
- The warn → fail rollout with a mandatory credential and a non-zero coverage denominator.
- The explicit statement that a skipped endpoint is not certified.

These are the parts that changed behaviour in this adoption; weakening them would remove the standard's
main value.

---

## 4. Proposed v1.2 changelog entry

```
## 1.2 — <date>
- Measurement: latency gates use Server-Timing `total`; client time is reported and checked for
  network drift (§11.1). Added cold-start budget and discarded warm-up policy (§8.1.1).
- Capacity: declared concurrency and minimum RPS (§11.1).
- Auth: `auth` is a required Server-Timing phase with a 30 ms budget; remote identity calls are
  restricted to login/refresh/identity writes (§9).
- Caching: ETag inputs are defined; `request_id`/Date are excluded; 304 is a required contract
  assertion; `Vary` is mandatory (§8.2 rule 8).
- Indexing: query registry + EXPLAIN artifacts in CI; RLS predicate guidance (§8.2 rule 3a).
- N+1: query-count growth test at limit=1 vs limit=100; statement vs round-trip counting (§8.2 rule 13).
- Budgets: DB statement timeout 250 ms; application absolute timeout 1 000 ms (§8.1, §8.2 rule 6).
- Idempotency: scope, TTL, replay, and 409 semantics (§8.2 rule 12a).
- Pagination: compound cursor required; offset cap (§6).
- Errors: `retryable`, `retry_after_ms`, `doc_url`; 405/413/415 (§4.2, §5).
- Streaming: TTFB vs stream_total (§8.1.2). Compression: 64 KB compressed cap, Vary (§8.2 rule 5).
- Security: cookie-auth CSRF/cache rules and CORS deny-by-default (§3.2).
- Deprecation: Deprecation/Sunset headers plus per-path usage counts (§3.1).
- Client: LCP/INP/CLS budgets, parallel fetch, dedupe, abort-on-unmount (§8.3 rule 9).
- Coverage: reviewed hot-endpoint manifest, traffic-weighted union, 3-run skip expiry (§2.1).
- Contract: OpenAPI diff in CI (§11.2). Test environment parity (§11.3).
```

---

## 5. Suggested adoption order for OptiFeed

1. A4 + A5 + A8 (auth timing, ETag correctness, N+1 growth) — small, high signal, already half-built.
2. A6 (query registry/EXPLAIN) and B1 (timeout alignment) — prevents the next slow endpoint.
3. A1 + A2 + A3 (measurement protocol) — makes the live suite trustworthy on Vercel.
4. B2–B8 — contract hardening before external clients exist.
5. C1 + C5 — client budget and schema source of truth once the dashboard stabilises.
