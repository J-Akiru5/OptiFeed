# OptiFeed Runbook

Operational triage for the common failure modes. Roles: ADMIN/OPERATOR can act
in the dashboard; VIEWER is read-only.

## Alerting, SLOs and on-call (start here if you were paged)

### The honest on-call model

OptiFeed is run by **one owner-operator**, not a team. There is no rota, no
follow-the-sun handoff and no 24/7 commitment — `SECURITY.md` and
`docs/operations/backup-and-recovery.md` already state this. The pager added in
#729 is a signal, not a staffing promise: a page inside 08:00–18:00
Asia/Manila on weekdays is normally seen quickly; outside those hours it is
best-effort. Do not write an SLA that implies otherwise.

The external provider was **not chosen** when this was built. The application
speaks a neutral webhook contract (`ALERT_WEBHOOK_URL`), so Slack, Discord, a
pager adapter or an automation endpoint can be attached later without a code
change. Until that variable is set there is **no external page**: the
`console.error("[obs]", …)` line, `/api/health/cron` and the red `Uptime`
Actions run are the signal.

### What pages

| Signal | Source | Cadence | Page-worthy because |
| --- | --- | --- | --- |
| `[CRITICAL] cron/crop-watch`, `cron/device-watch`, `cron/jobs`, `cron/heartbeat-watch` | `reportError(..., "CRITICAL")` inside the cron route | On failure | The job is unattended; nobody sees a 500 |
| `cron:<job>:hung` / `:never-run` / `:error` / `:stale` | `/api/cron/heartbeat-watch` reading `CronHeartbeat` | Every 15 min | A dead-man's switch for the schedules themselves |
| `[CRITICAL][uptime] probe failed` | `.github/workflows/uptime.yml` | Every 15 min | `/api/health`, `/en/login` or `/api/health/cron` is failing |
| `[CRITICAL] action=loginWithPassword` | `lib/actions/auth.ts` catch-all | On failure | Sign-in is broken for everyone |
| `[CRITICAL] jobs/worker` | `lib/jobs/service.ts` after the final attempt | On dead-letter | The job has no retry left and the user is waiting |

Everything else is recorded and logged but **does not page**: `ERROR` reports
from ingest/feed-command/schedule-sync are visible to the caller or self-heal on
firmware retry; `WARNING` covers fallbacks such as the post-login destination
lookup. The mapping is in `lib/observability.ts`.

### SLOs (internal targets, not contractual)

Measured by the 15-minute `Uptime` workflow and the heartbeat checks. They are
review targets, not promises to a customer.

| Objective | Target (rolling 30 days) | Error budget |
| --- | --- | --- |
| `GET /api/health` returns 200 | 99.5 % of probes | ≈ 54 min/month |
| `GET /en/login` returns 200 | 99.5 % of probes | ≈ 54 min/month |
| `device-watch` heartbeat fresh (≤ 20 min) | 99 % of checks | ≈ 7 h/month |
| `background-jobs` heartbeat fresh (≤ 15 min) | 99 % of checks | ≈ 7 h/month |
| `crop-watch` completes once per day (≤ 26 h) | 99 % of days | ≈ 3 days/year |
| Page attempt after a detected condition | ≤ 15 min (one probe/watcher cycle) | — |

Detection is bounded by the schedule; **delivery** depends on the provider once
one is chosen. A webhook timeout is logged and consumes that fingerprint's
cooldown window — the next watcher run retries. Dedup is per process, so two
warm Vercel instances can each send once; the provider should own final dedupe
and acknowledgment.

### First three steps by alert type

#### A. `cron/crop-watch`, `cron/device-watch` or `cron/jobs` failed

1. Open the route in the payload (`/api/cron/crop-watch`, etc.) and the Vercel
   function log around the timestamp; search `[obs]` and the route name.
2. Open `/superadmin/operations/errors`, filter by route, and read the scrubbed
   message/stack; check whether the rate is rising or one request failed.
3. Check the dependency the error names (Postgres/Supabase, Supabase Auth,
   Resend) and call the route manually with the secret:
   `curl -i -H "Authorization: Bearer $CRON_SECRET" "$APP_BASE_URL/api/cron/crop-watch"`.
   A 403 means `CRON_SECRET` is unset or different, not that the job failed.

#### B. Cron is `never-run`, `hung`, `error` or `stale` (`/api/health/cron`)

1. Read the JSON: `state` names the bucket, `lastRunAt`/`lastError` narrow it.
   `never-run` = no row; `hung` = a `running` start marker older than the budget
   plus margin; `stale` = a completed run older than the schedule allows.
2. In Supabase, check `cron.job` (schedule active) and `cron.job_run_details`.
   `job_run_details` proves pg_net queued the request, **not** that the route
   finished — see the 2026-11-04 `crop-watch` incident in
   `docs/ops/cron-schedules.md`.
3. Run the drift check before touching anything:
   `pnpm --filter web cron:apply -- --check`. It compares the applied schedule,
   timeout and active flag with `CRON_JOBS`. Re-apply with `cron:apply` only
   when the check reports drift; it prints no secret.

#### C. `/api/health` degraded (Uptime workflow)

1. Check the Supabase project status and dashboard for the production project.
2. Open the Vercel deployment for the current production commit and read the
   `[health] database probe failed` line; the public body deliberately says only
   `{"status":"degraded"}`.
3. Confirm `DATABASE_URL`/`DIRECT_URL` in the Vercel production environment and
   whether the failure is connection-level or query-level. Recovery is
   Supabase-side; the app reconnects on its own. See section 3.

#### D. `/en/login` fails but `/api/health` is green

1. `curl -i "$APP_BASE_URL/en/login"` from outside; compare with the Vercel
   deployment status and build logs.
2. Check Supabase Auth status and the `NEXT_PUBLIC_SUPABASE_URL` /
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` values for that environment.
3. Search `[obs]` for `loginWithPassword`; a `[CRITICAL]` there means the
   action threw, not that the password was wrong (wrong passwords are `[auth]`
   lines, not `[obs]`).

#### E. `[CRITICAL]` application error with a route in the payload

1. Open `/superadmin/operations/errors`, find the fingerprint from the payload
   (`alert.fingerprint`), and read its context/count/last seen.
2. Correlate with the `[obs]` line in Vercel logs; the `X-Request-Id` from the
   same request is the join key when the caller supplied one.
3. Decide whether the route is failing broadly (page stays relevant) or one
   tenant/request hit an edge case (fix forward, then mark the row resolved in
   the admin view so recurrence reopens it).

#### F. Background job dead-letter

1. `/superadmin/operations/jobs` — filter `failed`, read `lastError`.
2. `/api/cron/jobs?max=5` claims work; if the queue is not moving, check the
   `background-jobs` heartbeat and the same three steps as A.
3. Requeue only after the cause is understood; an import that may have committed
   is deliberately not retried automatically (see `failJob`).

### Silencing a noisy alert

There is **no per-fingerprint mute switch in code** — that would be a second
alerting system. In order of preference:

1. Use the provider's own snooze/mute/acknowledgment once a provider is chosen.
   This is the intended home for silencing.
2. If the noise is a degenerate alert loop, raise `ALERT_COOLDOWN_MS` for the
   deployment (default 10 min, max 24 h). This is a blunt global delay, not a
   mute; it also delays real pages.
3. Temporarily remove `ALERT_WEBHOOK_URL` to stop external paging entirely. The
   logs, `/api/health/cron` and the `Uptime` workflow remain, so nothing is
   blind — this is the safe "silence everything" switch.
4. Fix the fingerprint: resolving an `ErrorEvent` row does **not** stop pages.
   The same error reappearing reopens the row and pages again after the cooldown.

Never delete the cron heartbeat row to silence a stale alert; that converts a
diagnosable `stale`/`hung` into `never-run`.

### Confirming recovery

- `/api/health` returns `{"status":"ok"}` with HTTP 200.
- `/en/login` returns HTTP 200.
- `/api/health/cron` returns 200 and every job `state` is `ok` (or `running`
  inside its budget); the `summary` arrays are empty.
- The failed fingerprint has not recurred for one cooldown window and the
  `Uptime` workflow is green on its next scheduled run.
- For a cron incident, the next scheduled run writes `ok`; `lastRunAt` moves
  forward. A `running` row that stays put past the budget means the handler is
  still hung — do not declare recovery from a start marker alone.

### Wiring the provider (owner action)

1. Create the webhook/channel with the chosen provider.
2. Set `ALERT_WEBHOOK_URL` in the Vercel **Production** environment (and Preview
   if preview pages are wanted). It is a secret: never commit it, never log it.
3. Optionally set the same value as the repository secret `ALERT_WEBHOOK_URL`
   so the `Uptime` workflow can page too. The workflow's
   `workflow_dispatch` input `test_alert` sends a synthetic page — use it to
   prove the wiring end to end.
4. Optional tuning: `ALERT_COOLDOWN_MS` (600000), `ALERT_TIMEOUT_MS` (3000),
   `ALERT_RUNBOOK_URL` (this file on `main`).
5. Re-run the cron provisioning workflow (`cron-schedules.yml`) so
   `heartbeat-watch` is scheduled; until then it reports `never-run`.

The payload is documented in `apps/web/lib/observability/alert.ts`:
`{"text": "...", "content": "...", "alert": {severity, fingerprint, route,
message, context, service, environment, timestamp, runbook}}`. Slack reads
`text`, Discord reads `content`, and a real pager maps the `alert` object.

## 1. Feeder is running wild (dosing nonstop or huge doses)

1. **Pause the device** — Dashboard → Settings (or Admin → Devices) → pause.
   Paused devices reject new `FeedRequest`s server-side.
2. **Firmware hard stops** — the ESP32 refuses doses above
   `MAX_GRAMS_PER_DISPENSE` (1,000 g) or a daily total above
   `MAX_GRAMS_PER_DAY` (5,000 g), and forces the relay off after
   `MAX_DISPENSE_MS` (300 s) even if a command is stuck. A dose larger than
   the cap is refused and reported, not truncated. The server's only gram cap
   is the daily ceiling, so a server-accepted dose above 1,000 g is still
   refused by this firmware guard until the guard itself is changed.
3. **Last resort: cut relay power** to the feeder. The relay is active HIGH and
   boots OFF (contacts open). The GPIO depends on the unit: **GPIO 5** on the
   CICT Building A field unit (`esp32dev-gpio5`, variant `gpio5`) and **GPIO 25**
   on the reference build (`esp32dev-gpio25`, variant `gpio25`). Check
   `diag.hw_variant` / `diag.relay_gpio` on the device page before assuming a
   pin. The authoritative pin map and build table are in
   `docs/hardware/2026-10-28-cict-pin-map-and-health.md`.
4. After the incident: check Admin → Audit and the `DeviceStateEvent` log for
   the offending `feed_request_id`, then re-enable the device.

## 2. Device shows offline

- "Offline" = no heartbeat within the platform device-connectivity window
  (default: 5 minutes of silence, no grace; see `lib/device-status.ts` and
  Superadmin → Settings → Device connectivity). The dashboard badge and
  Admin → Devices reflect this.
- The `/api/cron/device-watch` endpoint (pg_cron every 5 min, H10) raises one
  CRITICAL connectivity notification per outage. Tenant alerts are in-app only
  (ADR-0007); the platform pager covers *the job stopping*, not an individual
  device, so one offline feeder does not page the operator. Check the dashboard
  alert panel and the notifications page.
- Checklist: power/LED on the ESP32, WiFi credentials in range, device token
  still matches the `EnergyDevice.tokenHash` row (rotate via Admin if
  suspect), and the device's `mac` matches what the firmware reports.
- Device polls `/api/feed-command` on its own schedule — after WiFi returns,
  `lastSeenAt` resumes updating automatically; no restart needed.

## 3. Database is down / errors spike

- App behavior: device routes **fail open** on rate-limit outages (feeding is
  never blocked by the limiter being down); login rate limiting **fails
  closed** (no lockout table = no logins, by design).
- Check Supabase status (status.supabase.com) and the Vercel function logs
  (`[obs]` lines from `reportError` show route + deviceId context).
- The web app cannot serve reads while Postgres is unreachable; there is no
  local cache. Recovery is Supabase-side; the app recovers on its own.

## 4. Restore a backup

The full procedure, RPO/RTO, retention and the drill record live in
`docs/operations/backup-and-recovery.md`. This section is the short incident form.
PITR availability on this project has **not** been confirmed; check it there before
relying on it.

- **Supabase PITR** (preferred, if the plan provides it): Database → Backups →
  point-in-time restore to just before the incident. This creates a new project — repoint
  `DATABASE_URL`/`DIRECT_URL` after the restore.
- **Logical restore**: `pg_restore` from a scheduled `pg_dump`, or re-run
  migrations on an empty database and restore the dump:
  `pg_restore --no-owner --dbname="$DATABASE_URL" dump.dump`
- After any restore: run `pnpm --filter web exec prisma migrate deploy` to
  ensure the migration history is current, then spot-check the last pond's
  biomass logs and the most recent `FeedEvent` rows.
- Backups are a human responsibility (H7): take one before any batch that
  includes migrations (the `batchLabel` migration rides the current PR).

## 5. An account cannot sign in

Work down this list; the first route that fits is the one to use.

1. **Read the error.** "Too many failed attempts" means the account is
   temporarily locked out (per farm + IP). The lockout clears on its own — wait
   it out instead of resetting the password, because a reset does not shorten it.
2. **Self-service** — the user opens the sign-in page → *Forgot password?* and
   enters their farm ID. If their login address can receive mail, the link sets a
   new password on `/reset-password`. Login addresses are internal pond
   mailboxes, so in practice this mail cannot arrive.
3. **Platform console** (recommended) — Superadmin → Users → the account →
   *Reset password*. A reason and a step-up password check are required; a
   one-time temporary password is shown once, and the account must change it at
   the next sign-in. Copy it to the user before closing the dialog — it is not
   stored and cannot be shown again.
4. **CLI** — `pnpm --filter web manage-user reset-password --farm-id <id>
   --password <value>`. Temporary and forced-change by default.

Every route leaves a trace in Superadmin → Audit: `platform.user.reset_password`
for the console reset, `platform.user.password_reset_requested` for a
self-service request. If the reset seems to have had no effect, check that row
first, then the account's state (`pnpm --filter web manage-user list` shows the
`[must change password]` flag).

## 6. Build or release a firmware image

The relay GPIO is per unit, so **never build or sign a firmware image without
naming its hardware variant**. The full release procedure is in
`firmware/README.md` → **Release procedure (signed OTA)**; the pin map is
`docs/hardware/2026-10-28-cict-pin-map-and-health.md`.

- CICT Building A field unit (relay GPIO 5):

  ```bash
  pio run -d firmware -e esp32dev-gpio5
  node scripts/ota/sign-release.mjs \
    --bin firmware/.pio/build/esp32dev-gpio5/firmware.bin \
    --variant gpio5 --version <X.Y.Z> \
    --key <offline-private.pem> --key-id primary --targets all --out ota-out
  ```

- Reference / bench board (relay GPIO 25): use `esp32dev-gpio25` and
  `--variant gpio25`.

The signer refuses unless the PlatformIO environment declares the same variant
and relay pin. The signed manifest carries `variant` and `relay_gpio`; a unit
declines the other wiring, reports `ota_refusal = variant_mismatch` in its
heartbeat diagnostics, and shows it on the device page. A unit flashed over USB
with the other variant keeps `hw_variant_ok = false`, locks the relay off and
refuses doses with `hardware_variant_mismatch`; flash the correct image to
recover. A factory reset (GPIO 16, 10 s) clears the provisioned variant only
when the wiring was deliberately changed. **Flashing and OTA are owner-gated**
— do not upload until the physical wiring matches the variant.
