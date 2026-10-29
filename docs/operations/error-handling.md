# Error handling and triage

How OptiFeed records application errors, where to look when something fails, and
what the capture does **not** cover.

Read this when a user reports a failure, when the error console shows a new
entry, or when you are deciding whether an error is worth fixing. For a live
incident (data loss, security, outage) read
[`docs/runbook.md`](../runbook.md) and
[`docs/security/incident-response.md`](../security/incident-response.md) first;
this document is the observability procedure, not the incident plan.

## 1. Two surfaces, one source

| Surface | What it is | Retention | Who can see it |
| --- | --- | --- | --- |
| Vercel function logs, lines starting with `[obs]` | The console line written by `reportError()` for every captured error | The platform log window (hours to days, not a store) | Anyone with Vercel project access |
| `/superadmin/operations/errors` | The `ErrorEvent` table: one row per distinct error fingerprint | 30 days after `lastSeenAt` | Platform administrators only |

Both are written by the same call, with the same scrubbed text, so the console
line and the row cannot disagree. The row is the durable record; the log line is
the per-occurrence detail.

## 2. What is captured

`reportError(error, context?, severity?)` is the single entry point
(`apps/web/lib/observability.ts`). It:

1. builds a record (`apps/web/lib/error-capture.ts`): scrubbed message, stack,
   route, severity, context;
2. writes the `[obs]` console line;
3. persists the record without awaiting, and never throws. If persistence fails
   (database down, migration not applied yet, duplicate race), the failure is
   logged and the request continues.

The persisted fields are `message`, `stack`, `route`, `severity`, `context`,
`count`, `firstSeenAt`, `lastSeenAt`, `resolved`, `resolvedAt`, `resolvedBy` and
the unique `fingerprint`.

**Scrubbing happens before both surfaces.** `apps/web/lib/error-scrub.ts` removes
`Authorization`/`Cookie`/`X-Device-Token` values, bearer tokens, JWTs, Supabase
keys, key/value secrets and e-mail addresses, then truncates. A secret that must
not reach the table cannot reach the log drain either.

## 3. Deduplication

A row is a bucket, not an occurrence. The fingerprint is a SHA-256 of severity,
route, the scrubbed message and the first stack frame with line/column numbers
stripped, so a code shift does not fork the row. A repeat:

- increments `count`,
- moves `lastSeenAt`,
- **reopens** the row if it was resolved, because an error that recurs is not
  fixed.

The list is newest-first by `lastSeenAt`, which is what operations needs first.

## 4. Triage procedure

1. Open `/superadmin/operations/errors`. The default view is unresolved.
2. Read the route and message. `count` tells you whether this is one failure or a
   recurring one; `lastSeenAt` tells you whether it is still happening.
3. Find the matching `[obs]` line in the Vercel function logs (same route, same
   message). The log line carries the per-request context that the row
   aggregates.
4. If it is a real defect, file an issue with the route, the message, the count
   and the log excerpt. Do not paste tokens, e-mail addresses or raw headers into
   an issue; the log text is already scrubbed, but surrounding output may not be.
5. If it is expected and handled (for example a client sent an invalid payload),
   resolve the row. A resolve writes one `PlatformAuditLog` row; resolving twice
   writes no second row.

Do not resolve a row to make the dashboard quiet. A resolved row reopens on the
next occurrence, so the only thing a premature resolve achieves is losing the
signal.

## 5. Retention and cleanup

`ERROR_EVENT_RETENTION_DAYS = 30`. `deleteExpiredErrorEvents()` removes one
bounded batch (500 rows) per execution of the `device-watch` cron, which runs
every five minutes. There is no separate scheduler.

The sweep depends on `CRON_SECRET` being configured and the cron being
scheduled. If cron is not running, errors are still captured but the table grows
without bound. Check the cron's response body for `errorEventsDeleted` when you
need to confirm the sweep is alive. Configuration details are in
[`environment-matrix.md`](./environment-matrix.md).

## 6. Failure modes

| Symptom | Meaning | What to do |
| --- | --- | --- |
| Errors appear in `[obs]` logs but the console is empty | Persistence is failing, or the migration is not applied | Look for `error event persistence failed` in the logs; confirm the migration is applied on the environment |
| `error event capture failed` in the logs | The record could not be built at all | Treat as a bug in the capture path; the request is unaffected |
| The console shows one row with a rising count | A recurring failure, not a duplicate | Fix the cause; the row reopens if it recurs after a resolve |
| Rows older than 30 days | The retention sweep is not running | Check `CRON_SECRET` and the cron schedule |
| No errors at all | Either nothing is failing or `reportError()` is not being called on that path | Check the route's catch block; a swallowed error is invisible to every surface |

## 7. What is not covered

- **No alerting.** The console is pull-based. A new error does not page anyone;
  critical device outages use the Telegram channel instead.
- **No request correlation.** There is no request id linking a row to a specific
  request; the route and timestamp are the correlation you have.
- **No tenant-visible errors.** Only platform administrators can see the console.
- **Client-side errors are not captured.** This is server-side only; a browser
  exception reaches the user's console, not this table.

These are recorded gaps, not accidental omissions. See
[ADR-0003](../adr/0003-first-party-error-capture.md) for the decision and its
follow-ups.

## 8. Related

- [`docs/runbook.md`](../runbook.md) section 3 - database down / error spike
- [`docs/security/incident-response.md`](../security/incident-response.md) - when
  an error is a security incident
- [`docs/operations/environment-matrix.md`](./environment-matrix.md) - `CRON_SECRET`
  and the other variables this procedure depends on
- [`docs/adr/0003-first-party-error-capture.md`](../adr/0003-first-party-error-capture.md)
