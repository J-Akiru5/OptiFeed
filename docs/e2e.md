# E2E suite: targets, guards and the CI job

The Playwright suite (`apps/web/e2e`) has exactly **two** supported targets. It
never runs against an arbitrary database, and the guards in
`apps/web/scripts/e2e/guards.ts` are what enforce that.

| | Disposable local stack | Remote e2e fixture |
| --- | --- | --- |
| Who runs it | Any developer, and the `e2e` CI job on every PR to `develop` | The integrator only |
| Database | `supabase start` in Docker: Postgres, Auth and storage on `127.0.0.1` | The production Supabase project, isolated by the reserved `e2e-` fixture |
| Required env | `E2E_ALLOW_LOCAL_STACK=yes` + loopback `DATABASE_URL` | `E2E_ALLOWED_DB_HOST` (exact host match) + `E2E_CONFIRM_PRODUCTION=yes` |
| Production data at risk | None — the stack is created and destroyed per run | Only `e2e-`-owned rows; see [e2e-on-production.md](./e2e-on-production.md) |
| Typical use | Local iteration, CI | Pre-release verification against real Supabase configuration |

## Guard rules

`assertE2eEnvironment()` runs at the start of the seed, the cleanup and the
Playwright global setup. It throws before a single row is read or written.

1. `DATABASE_URL` must be set and parse as a URL.
2. **Local mode** (both conditions):
   - `E2E_ALLOW_LOCAL_STACK` is the literal string `yes`, **and**
   - the `DATABASE_URL` host is exactly `localhost`, `127.0.0.1`, `::1` or
     `[::1]`.

   Nothing else is required: the target is throwaway.
3. **Remote mode** (everything else):
   - `E2E_ALLOWED_DB_HOST` must be set and equal the `DATABASE_URL` host
     exactly, and
   - `E2E_CONFIRM_PRODUCTION` must be the literal string `yes`.

Enabling local mode does **not** weaken the remote path. A non-loopback host
falls through to the full allow-list and acknowledgement checks, so a stray
`E2E_ALLOW_LOCAL_STACK=yes` in a shell that also exports a production
`DATABASE_URL` is refused unless the production acknowledgement is present.
Host matching is exact, not a prefix or substring check: `127.0.0.1.example.com`
and `localhost.evil` are remote hosts.

`E2E_PASSWORD` is required by both paths (the three e2e logins share it). It is
read from the environment or `apps/web/.env`, and it is never logged.

## Disposable local stack

### Prerequisites

- Docker (or Podman) running.
- Supabase CLI **2.121.0** — the version the CI job pins and the version
  `apps/web/supabase/config.toml` was generated with. `supabase --version`.
- `pnpm install` completed in the repository.

### Run order

All commands run from `apps/web` (pnpm sets that as the script CWD).

```bash
# 1. Start Postgres + Auth + storage on the fixed local ports
#    (API 54321, DB 54322). Studio, analytics, the edge runtime and the SMTP
#    catcher are disabled in config.toml because the suite does not need them.
supabase start

# 2. Read the local connection values. These are the CLI's well-known demo
#    keys for the throwaway stack — not secrets, not a hosted project.
supabase status -o env
```

Export the values the app and the suite need. `supabase status -o env` prints
them as `KEY="value"` lines:

```bash
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
export DIRECT_URL="$DATABASE_URL"
export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="<ANON_KEY from supabase status>"
export SUPABASE_SERVICE_ROLE_KEY="<SERVICE_ROLE_KEY from supabase status>"
export E2E_ALLOW_LOCAL_STACK=yes
export E2E_PASSWORD=e2e-local-password-only

# 3. Apply the Prisma schema and seed the isolated fixture.
pnpm exec prisma migrate deploy
pnpm exec tsx scripts/e2e/seed-e2e.ts

# 4. Build and start the app.
pnpm exec next build
pnpm exec next start -p 3000

# 5. In a second terminal (apps/web), run the suite.
pnpm test:e2e

# 6. Throw the stack away. This also deletes the volumes.
supabase stop --no-backup
```

`pnpm dev` also works instead of `next build` + `next start` when iterating;
`PLAYWRIGHT_BASE_URL` defaults to `http://127.0.0.1:3000` and can point at the
dev server.

### Notes

- `supabase start` pulls several GB of images the first time. `supabase stop
  --no-backup` followed by `supabase start` gives a clean database; a plain
  `supabase stop` keeps the volumes.
- `apps/web/supabase/config.toml` disables `[db.seed]`: the fixture is created
  by `scripts/e2e/seed-e2e.ts`, which must create Supabase auth accounts through
  the admin API, so a SQL seed file cannot reproduce it.
- The local stack is not a copy of production. It proves the flows and the
  application wiring; it does not prove hosted Supabase settings (custom SMTP,
  Data API grants, storage policies, pooling) or production data volume. The
  remote fixture run remains the pre-release check.

## CI job

`.github/workflows/ci.yml` → `e2e` runs on pull requests targeting `develop`,
on pushes to `develop`, and on manual dispatch. It is deliberately not run for
every branch.

The job:

1. installs the Supabase CLI at the pinned version and starts the local stack;
2. exports the local stack's URL/keys from `supabase status` into the job env;
3. runs `prisma migrate deploy` and seeds `scripts/e2e/seed-e2e.ts`;
4. installs the Chromium Playwright browser and builds the app with
   `next build`;
5. starts `next start` and waits on `GET /api/health` (which probes the
   database) before running `pnpm test:e2e`;
6. always stops the app and runs `supabase stop --no-backup`, and uploads the
   Playwright report on failure.

No production or staging credential exists in the workflow. `E2E_PASSWORD` is a
literal string that only ever exists inside the disposable stack, so forked
pull requests can run the job without secrets.

The suite keeps `workers: 1` and `retries: 0` from
`apps/web/playwright.config.ts`. It is stateful against a shared fixture and
authenticates through the login endpoint that is rate-limited to 5 attempts per
60 seconds; parallel workers would trip it and the RBAC/device specs would race.
Do not raise the worker count to make the job finish sooner.

## Coverage gate

The unit suite is measured on `apps/web/lib` only, with
`@vitest/coverage-v8` (pinned to the vitest version) and thresholds in
`apps/web/vitest.config.ts`. CI runs `pnpm --filter web test:coverage`; the
thresholds are a ratchet — raise them, never lower them. `pnpm test` still runs
the same tests without coverage when you are iterating.
