# API verification suites

Implements §11 of [`API_REGULATION.md`](../../API_REGULATION.md). Two layers:

| Script | Needs a server? | Runs in CI | Purpose |
|---|---|---|---|
| `conformance-check.mjs` (part of `pnpm api:check`) | no | yes | Static: instrumentation, bounded lists, versioned rewrite, endpoint declarations |
| `auth-check.mjs` (part of `pnpm api:check`) | no | yes | Static: every non-public route calls its guard inside the exported handler (session, cron, device token, platform admin or tenant admin) |
| `live-check.mjs` (`pnpm api:live`) | yes | optional (scheduled/manual) | Contract (§11.2) + latency (§11.1) with coverage accounting |

The live suite needs a running app and a **test credential**. Without one, every session endpoint is
skipped and the coverage floor fails — that is intentional (§11.3 rule 3).

## Run

```bash
# Static (no database, no server)
pnpm api:check

# Rollout: breaches are reported, CI stays green; coverage still fails
API_BASE_URL=http://localhost:3000 \
API_TEST_COOKIE="sb-<ref>-auth-token=..." \
pnpm api:live -- --mode warn

# Enforcement
API_BASE_URL=https://staging.example.com \
API_TEST_BEARER="..." \
pnpm api:live -- --mode fail
```

Options:

| Flag | Default | Meaning |
|---|---|---|
| `--mode warn\|fail` | `warn` | Breaches warn or fail; coverage fails in both modes |
| `--base-url` | `API_BASE_URL` or `http://localhost:3000` | App under test |
| `--suite contract\|latency\|all` | `all` | Run one suite |
| `--endpoint <id[,id]>` | all | Run only the named endpoint(s) from `endpoints.json` |
| `--samples` | 30 | Timed requests per endpoint |
| `--warmup` | 5 | Discarded requests per endpoint |
| `--p95-budget` / `--max-budget` | 300 / 400 | Milliseconds (§8.1) |
| `--cookie` / `--bearer` | env | Test credential (never commit it) |
| `--report` | none | Write the JSON report |

## Declaring endpoints

Edit `endpoints.json`. The static check fails when a `route.ts` exists without an entry.

```json
{
  "id": "user-role",
  "method": "GET",
  "path": "/api/v1/user-role",
  "shape": "envelope",      // envelope | flat | file
  "auth": "session",        // none | session | cron
  "level": "L2",
  "contract": true,         // included in §11.2
  "latency": true           // included in §11.1
}
```

`excluded[]` documents endpoints that are intentionally not measured, with a reason. Add a reason; the
static check does not accept silence.

## What "certified" means here

- `measured / (measured + skipped)` must be ≥ 90 % for each suite, in **both** modes.
- A skipped endpoint is not a pass. A network failure (`status 0`) is a skip, not a fast sample.
- A `429` is not a latency sample. The suite waits for the next fixed rate-limit window and retries up
  to three times; if the limit does not clear, the endpoint is skipped. `429` responses are never
  counted as fast.
- `warn` mode keeps CI green for breaches so the team can burn down the backlog; coverage is never
  waived.
- Flip to `fail` once the backlog is empty and coverage is stable above 90 %. Record the date of the
  flip in the PR.
