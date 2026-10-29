# ADR-0003: First-party error capture instead of an external error service

- **Status:** Accepted
- **Date:** 2026-10-29 (owner decision E1)
- **Deciders:** Jeff (owner)
- **Backfilled:** 2026-10-29
- **Related:** [ADR-0001](./0001-deployment-model.md), [ADR-0006](./0006-multi-tenant-rbac.md), issue #331

## Context

Before this decision, `reportError()` was console-only. The comment in
[`apps/web/lib/observability.ts`](../../apps/web/lib/observability.ts) records
why: Sentry was removed entirely on 2026-10-13, and the fallback was a
structured `console.error("[obs]", context, error)` line designed to stay
greppable in the Vercel function logs.

That is enough to debug a request while the log window is open and nothing else:
errors are invisible once the log retention expires, there is no count, no
deduplication, and no way for an administrator to see whether a failure is still
happening. The ISO readiness review recorded reliability as a gap for exactly
this reason.

The choice was not "add observability or not", but "which observability". An
external SaaS would add a vendor, a second data processor for production error
text, a new credential, and a dependency that CI cannot exercise. Owner decision
E1 (recorded in
[`docs/missions/2026-10-29-iso-readiness.md`](../missions/2026-10-29-iso-readiness.md))
chose a first-party implementation: persist errors in our own database, surface
them in an admin view, and add alerting later over the channel that already
exists (Telegram for critical device outages).

The implementation had to respect three existing constraints: no external
service or credential, an **additive-only** migration (the production database
is shared with staging), and no secret or personal data written to the new
table.

## Decision

1. **`reportError()` is still the single entry point.** Every route, action and
   catch path already funnels through it. It now writes the `[obs]` console line
   **and** persists a scrubbed `ErrorEvent` row. Persistence is fire-and-forget:
   it never blocks the caller, never throws, and falls back to the console line
   if the database is unavailable.
2. **Scrub before storing and before logging.** [`apps/web/lib/error-scrub.ts`](../../apps/web/lib/error-scrub.ts)
   removes header credentials (`Authorization`, `Cookie`, `X-Device-Token`),
   bearer tokens, JWTs, Supabase keys, key/value secrets and e-mail addresses,
   then truncates. The console line uses the same scrubbed text, so a secret
   cannot reach the Vercel log drain either.
3. **Deduplicate by fingerprint.** `fingerprint` is a SHA-256 of severity, route,
   the scrubbed message and the first stack frame with line/column stripped and
   long numbers parameterised. A repeat occurrence increments `count`, moves
   `lastSeenAt`, and **reopens a resolved row** - an error that recurs is not
   fixed.
4. **Retention is bounded.** `ERROR_EVENT_RETENTION_DAYS = 30`. Deletion runs as
   one bounded batch per execution of the existing five-minute `device-watch`
   cron, so the table cannot grow without limit and no new scheduler is needed.
5. **The console is platform-admin only.** `/superadmin/operations/errors`
   (`requirePlatformAdmin()`) lists unresolved errors newest-first and resolves
   them. A resolve writes one `PlatformAuditLog` row; a repeat resolve is
   idempotent and writes no second audit row.
6. **The schema change is additive.** The migration creates the enum, the table
   and three indexes; there is no `DROP`, `ALTER`, `RENAME` or `DELETE`.

## Consequences

### Positive

- No vendor, no additional data processor, no new credential, no per-event cost.
- Error text never leaves the application boundary, and the scrubber is unit
  tested against the shapes that actually occur (database errors, auth headers,
  device tokens).
- Errors now have a count and a last-seen time, which is what triage needs.
- The retention sweep reuses an existing cron; there is no second scheduler to
  monitor.

### Negative / accepted costs

- **We own the storage.** A table, an index set, a retention job and a console
  are maintenance surface that a SaaS would have carried.
- **The row is a dedupe bucket, not an occurrence log.** Per-occurrence detail is
  intentionally not stored; the count is the history.
- **No alerting yet.** The console is pull-based. A new `ERROR` severity does not
  wake anyone; critical device outages still use Telegram.
- **Capture depends on the database.** If Postgres is down, only the console line
  remains, which is the same place errors went before this decision.
- **Platform-admin visibility only.** Tenant administrators cannot see platform
  errors, deliberately, but it also means a tenant-side failure is invisible to
  the tenant.
- **A migration is pending production.** It applies on the next `main`
  deployment; until then persistence fails closed to the console (and logs that
  it failed).

### Follow-ups

- Add alerting on a new `ERROR` fingerprint (Telegram channel exists) without
  turning every repeat into a message.
- Correlate an event with the request that produced it (request id) if tracing is
  added later.
- Confirm the 30-day sweep actually runs in production (it depends on
  `CRON_SECRET` being configured); the environment matrix records that
  dependency.

## Links

- Implementation: [`apps/web/lib/observability.ts`](../../apps/web/lib/observability.ts),
  [`apps/web/lib/error-capture.ts`](../../apps/web/lib/error-capture.ts),
  [`apps/web/lib/error-scrub.ts`](../../apps/web/lib/error-scrub.ts),
  [`apps/web/lib/platform/error-events.ts`](../../apps/web/lib/platform/error-events.ts),
  [`apps/web/lib/actions/platform/error-events.ts`](../../apps/web/lib/actions/platform/error-events.ts)
- Schema: `apps/web/prisma/schema.prisma` (`ErrorEvent`),
  `apps/web/prisma/migrations/20261029010000_add_error_events/migration.sql`
- UI: `apps/web/app/[locale]/superadmin/operations/errors/page.tsx`,
  `apps/web/components/superadmin/resolve-error-button.tsx`
- Retention job: `apps/web/app/api/cron/device-watch/route.ts`
- Tests: `apps/web/lib/__tests__/error-capture.test.ts`,
  `apps/web/lib/__tests__/error-scrub.test.ts`,
  `apps/web/lib/__tests__/platform-error-events.test.ts`,
  `apps/web/lib/__tests__/superadmin-errors-page.test.tsx`
- Procedure: [`docs/operations/error-handling.md`](../operations/error-handling.md),
  [`docs/runbook.md`](../runbook.md) section 3
- Source of the decision: `docs/missions/2026-10-29-iso-readiness.md`, owner
  decision E1; `apps/web/lib/observability.ts` records the 2026-10-13 Sentry
  removal
