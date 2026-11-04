# Cron schedules and heartbeats (#725, #729)

The pg_cron jobs are provisioned from `CRON_JOBS` in
`apps/web/lib/ops/cron-jobs.ts`, not by editing SQL by hand:

| Job | Schedule | Path | Stale after | Request budget |
| --- | --- | --- | --- | --- |
| `device-watch` | `*/5 * * * *` | `/api/cron/device-watch` | 20 min | 8 s |
| `background-jobs` | `* * * * *` | `/api/cron/jobs?max=5` | 15 min | 15 s |
| `crop-watch` | `0 22 * * *` | `/api/cron/crop-watch` | 26 h | 8 s |
| `heartbeat-watch` | `*/15 * * * *` | `/api/cron/heartbeat-watch` | 40 min | 8 s |

## Apply

From the repository root:

```bash
APP_BASE_URL=https://app.example.com \
CRON_SECRET=... \
DATABASE_URL=postgres://... \
pnpm --filter web cron:apply
```

`apply-cron-schedules.ts`:

- enables `pg_cron` and `pg_net`;
- creates or updates the Vault secrets from each job's `vaultName`
  (`device_watch_secret`, `jobs_worker_secret`, `crop_watch_secret`,
  `heartbeat_watch_secret`) with `CRON_SECRET`;
- calls `cron.schedule(name, schedule, command)`, which replaces an existing
  schedule with the same name;
- prints only job names, schedules, timeouts and secret state, never the secret;
- re-reads `cron.job` and fails if the applied schedule/timeout/active state
  does not match `CRON_JOBS`.

`pnpm --filter web cron:apply -- --dry-run` prints the SQL without connecting
(only `APP_BASE_URL` is required). `--check` is read-only and compares the
applied `cron.job` rows with `CRON_JOBS` without applying anything; it needs a
database URL but no cron secret and no app URL.

```bash
pnpm --filter web cron:apply -- --check
```

The `cron-schedules.yml` workflow exposes the same command via
`workflow_dispatch`; it reads `APP_BASE_URL`, `CRON_SECRET` and
`SUPABASE_DB_URL` from the protected `production` environment. It never runs on
push. It runs `--check` after applying, then smoke-calls each endpoint with the
secret (`pnpm --filter web cron:smoke`) and fails on a non-2xx response.

## Heartbeat / dead-man's switch

Each cron writes a **start marker** before its work begins
(`recordCronHeartbeat(name, "running")`), then replaces it with `ok` or `error`.
`CronHeartbeat.lastStatus` is text, so `running` needs no migration.

`GET /api/health/cron` returns 200 when every heartbeat is healthy and 503 when
one is not. Each job carries a `state`:

| State | Meaning |
| --- | --- |
| `never-run` | No heartbeat row at all. The schedule may never have been provisioned. |
| `running` | A start marker inside the job's request budget plus `RUNNING_HEARTBEAT_MARGIN_MS` (60 s). In flight, not a fault. |
| `hung` | A start marker older than that threshold: "started, never finished". |
| `error` | The last completed run recorded an error. |
| `stale` | The last completed run is older than `staleAfterMs`. |
| `ok` | Fresh completed run. |

The body also carries `summary` arrays of job names per bucket, and job names,
timestamps and scrubbed error text only — no tenant data or secrets.

```bash
APP_BASE_URL=https://app.example.com pnpm --filter web cron:health
```

`GET /api/cron/heartbeat-watch` is the alerting half: pg_cron calls it every 15
minutes with the same `CRON_SECRET`, and it pages `CRITICAL` for every job whose
state is `never-run`, `hung`, `error` or `stale`. It returns 200 when the check
ran, even when it paged; `/api/health/cron` is the 503-on-stale probe. A stale
`heartbeat-watch` row means the watcher itself stopped, which is why it is in
the same list it checks.

## 2026-11-04 `crop-watch` incident

Production returned `503 {"status":"stale"}` with only `crop-watch`
`lastRunAt: null`. `cron.job` had the schedule active at `0 22 * * *` and
`cron.job_run_details` showed successful runs on 10-31, 11-01, 11-02 and 11-03,
but those rows only prove pg_net queued the HTTP request. `CronHeartbeat` had
never contained a `crop-watch` row, and auth was not the cause (all Vault
secrets hash identically and device-watch used the same credential).

Cause: the completion heartbeat was the handler's last statement, after
`processCropReminders()`, while both `withApi` and pg_net abort at 8 s. A
permanently slow job was indistinguishable from a never-scheduled one. The
start marker and the `hung` state exist so the next slow run says "started,
never finished" instead of nothing.

Do not "fix" this by removing the 8 s budget or changing
`processCropReminders` here; if the next 22:00 run still lands in `hung`, the
reminder pass needs to move to the background job queue as a separate,
measured change.

The heartbeat table is additive (`20261104130000_cron_heartbeat`).
