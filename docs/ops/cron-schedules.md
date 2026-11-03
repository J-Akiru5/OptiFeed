# Cron schedules and heartbeats (#725)

The three pg_cron jobs are provisioned from environment values, not by editing
SQL by hand:

| Job | Schedule | Path | Stale after |
| --- | --- | --- | --- |
| `device-watch` | `*/5 * * * *` | `/api/cron/device-watch` | 20 min |
| `background-jobs` | `* * * * *` | `/api/cron/jobs?max=5` | 15 min |
| `crop-watch` | `0 22 * * *` | `/api/cron/crop-watch` | 26 h |

## Apply

From the repository root:

```bash
APP_BASE_URL=https://app.example.com \
CRON_SECRET=... \
DATABASE_URL=postgres://... \
pnpm --filter web cron:apply
```

`apply-cron-schedules.mjs`:

- enables `pg_cron` and `pg_net`;
- creates or updates the three Vault secrets (`device_watch_secret`,
  `jobs_worker_secret`, `crop_watch_secret`) with `CRON_SECRET`;
- calls `cron.schedule(name, schedule, command)`, which replaces an existing
  schedule with the same name;
- prints only job names, schedules and secret state, never the secret.

`pnpm --filter web cron:apply -- --dry-run` prints the SQL without connecting
(only `APP_BASE_URL` is required).

The `cron-schedules.yml` workflow exposes the same command via
`workflow_dispatch`; it reads `APP_BASE_URL`, `CRON_SECRET` and
`SUPABASE_DB_URL` from the protected `production` environment. It never runs on
push. By default it also smoke-calls each endpoint with the secret
(`pnpm --filter web cron:smoke`) and fails on a non-2xx response.

## Heartbeat / dead-man's switch

Each cron writes `CronHeartbeat` after its work completes (or records its error).
`GET /api/health/cron` returns 200 when every heartbeat is fresh, 503 when one
is missing, stale, or last errored:

```bash
APP_BASE_URL=https://app.example.com pnpm --filter web cron:health
```

Point an external monitor at that command or at the endpoint directly. The body
contains job names, timestamps, ages and error text; no tenant data or secrets.

The heartbeat table is additive (`20261104130000_cron_heartbeat`).
