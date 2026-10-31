# OptiFeed Runbook

Operational triage for the common failure modes. Roles: ADMIN/OPERATOR can act
in the dashboard; VIEWER is read-only.

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
3. **Last resort: cut relay power** to the feeder (relay is GPIO 25, active
   HIGH; boots in the OFF/CLOSED state).
4. After the incident: check Admin → Audit and the `DeviceStateEvent` log for
   the offending `feed_request_id`, then re-enable the device.

## 2. Device shows offline

- "Offline" = no heartbeat within the platform device-connectivity window
  (default: 5 minutes of silence, no grace; see `lib/device-status.ts` and
  Superadmin → Settings → Device connectivity). The dashboard badge and
  Admin → Devices reflect this.
- The `/api/cron/device-watch` endpoint (pg_cron every 5 min, H10) raises one
  CRITICAL connectivity notification per outage. Alerts are in-app only —
  there is no Telegram channel (ADR-0007), so nobody is paged: check the
  dashboard alert panel and the notifications page.
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
