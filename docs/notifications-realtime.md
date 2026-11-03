# Notification Realtime provisioning (#747)

The dashboard notification provider (`apps/web/components/notification-provider.tsx`)
subscribes to `postgres_changes` on `public."Notification"` for the active pond.
It listens to both events:

- `INSERT` — a new alert opens.
- `UPDATE` — an alert episode escalates or is re-opened. `openEpisode()` clears
  `acknowledgedAt`/`acknowledgedBy` and `read` so the reader sees the escalation
  again instead of a handled row.

## Source of truth

Migration `apps/web/prisma/migrations/20261104130000_notification_realtime_publication`
adds `"Notification"` to the `supabase_realtime` publication. The migration is
idempotent and guarded:

| Environment | Result |
| --- | --- |
| Hosted Supabase project with the publication | Table is added if missing |
| Publication already contains the table | No-op |
| Publication is `FOR ALL TABLES` | No-op (already published) |
| Plain PostgreSQL / restore drill without Realtime | No-op |

Do not replace this with a dashboard-only step. The dashboard remains a valid
manual recovery path if a project was provisioned before this migration, but
the migration is what records the requirement.

## Verification (read-only)

Run these against the project SQL editor or `psql`:

```sql
SELECT pubname, puballtables
FROM pg_publication
WHERE pubname = 'supabase_realtime';

SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND schemaname = 'public'
  AND tablename = 'Notification';
```

The second query must return one row. Also confirm the browser app is signed in
through Supabase Auth: Realtime applies the existing
`Users can view notifications on own farm` row-level security policy to the
subscription, so an unauthenticated client sees no rows.

## Fallback and limits

- If the publication or the table cannot be added, the dashboard still refreshes
  every 30 seconds (`dashboard-live-refresh.tsx`); alerts are delayed, not lost.
- Realtime delivery is best-effort. The in-app `Notification` row remains the
  source of truth.
- No deployment is needed to verify this document. Verification is the SQL
  inspection above plus a browser session after the migration is applied.
