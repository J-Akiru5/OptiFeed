# Retention, PII inventory and erasure

Last verified: 2026-11-04 (code review, no database access). Implements the
retention half of issue **#726**.

This document is the technical retention and privacy record for OptiFeed. It is
deliberately narrower than the public Privacy Policy: the policy describes the
promise to data subjects, while this document records what the code actually
does, including gaps that are not yet implemented. If the two disagree, this
document states the code's behaviour and the disagreement is called out in
[Known gaps](#6-known-gaps-and-owner-decisions).

## 1. Source of truth

- Windows and sweeps: `apps/web/lib/retention.ts`.
- Error-event retention: `apps/web/lib/error-capture.ts`
  (`ERROR_EVENT_RETENTION_DAYS` = 30).
- Runner: `GET /api/cron/device-watch`
  (`apps/web/app/api/cron/device-watch/route.ts`), in the existing housekeeping
  block. There is no second cron for retention.
- Batch contract: each sweep selects at most **5,000** ids (`DEFAULT_BATCH_SIZE`)
  oldest first and deletes only those ids. A backlog drains over successive
  runs; no sweep widens its batch or holds a long table lock.

## 2. Retention schedule

"Closed" means a row that is no longer an active alert or an open report. The
two guarded tables are called out explicitly because deleting their open rows
would lose the only copy of an active condition or a reporter's message.

| Data | Table | Purpose | Retention | Lawful basis | Deletion mechanism |
| --- | --- | --- | --- | --- | --- |
| Device heartbeat | `FeedEvent` (`eventType = heartbeat`) | Device health and connectivity rollups | **7 days** | Legitimate interest (service reliability) | `deleteOldHeartbeatEvents()` |
| Device command/acknowledgement audit | `DeviceStateEvent` | Post-incident investigation of commands, acknowledgements and schedule changes | **180 days** | Legitimate interest (security and incident response) | `deleteOldDeviceStateEvents()`; rows for a pond with an open alert or a FeedRequest still pending/dispatched are kept |
| Unsaved settings draft | `PondSettingsDraft` | Let a user resume an unsaved pond-settings form | **30 days** after last edit | Contract (requested feature) | `deleteExpiredPondSettingsDrafts()` |
| First-party error capture | `ErrorEvent` | Reliability diagnostics; scrubbed before write | **30 days** after last seen | Legitimate interest (service reliability) | `deleteExpiredErrorEvents()` |
| Water temperature | `WaterTempLog` | Water-quality trend charts | **365 days** | Contract (farm monitoring feature); farm is controller, PakaonAI processor | `deleteOldWaterTempLogs()` |
| Hopper feed level | `FeedLevelLog` | Feed-level trend charts | **365 days** | Contract (farm monitoring feature); farm is controller, PakaonAI processor | `deleteOldFeedLevelLogs()` |
| Notifications | `Notification` | Alert and episode history | **180 days**, **closed rows only** | Contract / legitimate interest (alert history) | `deleteOldNotifications()`; an open alert (`resolvedAt` null, `autoCleared` false, `supersededById` null) is never deleted |
| Calibration history | `CalibrationRun` | Feeder calibration and equipment-performance history | **730 days** | Contract / legitimate interest (equipment maintenance) | `deleteOldCalibrationRuns()` |
| Assistant proposals | `AssistantAction` | Audit of AI-proposed actions the user accepted or rejected | **180 days** | Contract (requested AI feature) / legitimate interest (accountability) | `deleteOldAssistantActions()` |
| Issue reports | `IssueReport` | Support triage and product quality | **365 days**, **resolved or non-OPEN rows only** | Legitimate interest (handling the report); the optional email is volunteered for follow-up | `deleteOldIssueReports()`; an open report is never deleted |
| Reminder delivery log | `ReminderLog` | Deduplicate and record reminders; `recipient` may hold an email address | **180 days** after `sentAt` | Contract / legitimate interest (delivering requested reminders) | `deleteOldReminderLogs()` |
| Platform audit log | `PlatformAuditLog` | Security and administrative accountability; includes `ip` and `userAgent` | **730 days** | Legitimate interest (security) and legal obligation (accountability and security measures under the Data Privacy Act) | `deleteOldPlatformAuditLogs()` |
| Organization record | `Organization` | Tenant identity, membership and status | While the tenant is active | Contract | **No automated purge.** See section 5 |

The windows are exported constants (`WATER_TEMP_RETENTION_DAYS`,
`FEED_LEVEL_RETENTION_DAYS`, `NOTIFICATION_RETENTION_DAYS`,
`CALIBRATION_RUN_RETENTION_DAYS`, `ASSISTANT_ACTION_RETENTION_DAYS`,
`ISSUE_REPORT_RETENTION_DAYS`, `REMINDER_LOG_RETENTION_DAYS`,
`PLATFORM_AUDIT_LOG_RETENTION_DAYS`) so the policy can change in one place.

## 3. PII inventory

| Field | Table | What it is | Why it is processed | Retention and deletion |
| --- | --- | --- | --- | --- |
| `contactEmail` | `User` | Deliverable address recorded by an administrator; used for password-reset mail. Unique. | Account administration and account recovery | While the account exists. A tenant administrator can delete a member with `deleteUser()`, which removes the user subtree and the Supabase Auth login. There is no self-service account deletion. |
| `email` | `IssueReport` | Optional address a reporter volunteers on the public form or the in-app assistant entry point. | Follow-up on the report | **365 days after the report is closed** (`deleteOldIssueReports()`). Open reports are kept. |
| `ip`, `userAgent` | `PlatformAuditLog` | Network address and browser/agent string captured with a platform-admin action. | Security investigation and accountability | **730 days** (`deleteOldPlatformAuditLogs()`). |
| `recipient` | `ReminderLog` | Email address a reminder was sent to, when the channel is email. | Deliver the reminder and avoid duplicates | **180 days after `sentAt`** (`deleteOldReminderLogs()`). |

Also relevant, but not a contact identifier:

- `User.email` is a synthetic, non-deliverable login address
  (`<farmId>@pond.optifeed.local`) that is never edited or mailed.
- `User.displayName`, `IssueReport.message`, `AssistantAction.payload` and
  `ErrorEvent.context` may contain personal data typed by a user. They are
  covered by the row-level windows above; `ErrorEvent` content is scrubbed
  before write.
- `PlatformAuditLog.before` / `after` can contain account fields for the audited
  change. They age out with the row.

## 4. Subject access and erasure

There is **no self-service data-subject portal**. The process is owner-mediated:

1. The data subject contacts the Data Protection Officer at
   **privacy@pakaonai.syntaxure.dev** (the contact recorded in
   `docs/legal/research-information-and-consent.md`). The public Privacy Policy
   states an aim to respond within 14 business days.
2. The owner verifies the requester's identity and authority over the farm or
   account.
3. The owner produces the export or performs the erasure manually with the
   platform tooling, then records what was removed and what must be retained.
4. Erasure is bounded by legal retention: audit rows may be kept for their
   documented window, and records under a legal hold are not deleted.

What the code currently supports:

- A tenant administrator can delete a member account (`deleteUser()` in
  `apps/web/lib/actions/admin.ts`), which removes the farmer's ponds, devices,
  operational rows and `User` row, then deletes the Supabase Auth login. This is
  an administrative action, not a data-subject self-service request.
- Retention sweeps remove the telemetry, notification, report, reminder and
  audit rows described above once their windows expire.

What the code does **not** support:

- A farm owner cannot delete their own account or organization from the app.
- There is no organization-wide export or erasure button.
- `IssueReport` intentionally has no relation to `User`, so a report survives
  account deletion and is removed only by its 365-day resolved-report sweep.
- `AssistantAction` has no foreign key to `User`; rows can outlive an account
  until the 180-day sweep.
- Backups are retained for up to 30 days by the hosting arrangement; an erasure
  is not instantaneous across backups.

## 5. Organization deletion is not implemented

`Organization.status` includes `PENDING_DELETION` and `PURGED`, and the schema
has `deletionRequestedAt` and `purgeAfter`. **No application code sets those
fields and no purge worker exists.** The status is only read for access checks
(a `PENDING_DELETION` organization grants no scope or permissions) and rendered
in the superadmin console.

This means:

- Requesting deletion of an organization today is a manual owner process, not a
  product feature.
- Deleting an organization must not be simulated by setting `status` and
  `purgeAfter`: nothing would ever act on them, so the promise would be false.
- Implementing a deletion request/purge flow remains an **owner decision**. It
  requires an approved deletion order that respects foreign keys, a grace
  period, legal-hold handling, and evidence of what was deleted. The owner has
  not approved those details.
- Alternatively, removing the unused `PENDING_DELETION`/`purgeAfter` promise is
  acceptable, but that is also an owner decision and a schema change.

No code in this change deletes tenant, farm, pond, device or user rows. The
sweeps delete only the aged telemetry, notification, report, reminder and audit
rows listed in section 2.

## 6. Known gaps and owner decisions

1. **Public policy vs. code: audit-log window.** The public Privacy Policy
   (`apps/web/components/legal/privacy-policy-content.tsx`, "How long we keep
   data") says security, rate-limit and audit logs are kept **90 days**. The
   implemented `PlatformAuditLog` window is **730 days**. One of the two must
   change; this document records the code as implemented and does not silently
   rewrite the public promise.
2. **Public policy vs. code: account deletion.** The policy says account and
   access data is kept for 30 days after deletion for recovery and audit. The
   current `deleteUser()` path deletes the user subtree immediately, while
   audit and assistant-action rows age out on their own windows. The owner
   should reconcile the wording with the actual process.
3. **Organization purge.** As described in section 5, the organization deletion
   promise is unimplemented. It needs an owner-approved deletion order, grace
   period and legal-hold rule before code is written.
4. **Subject-access export.** There is no one-click export of all personal data
   for a data subject. Today the owner assembles it manually.
5. **Legal hold.** The sweeps have no legal-hold switch. If a hold is required,
   the owner must pause the relevant sweep or preserve the rows before the
   window expires.
6. **Index coverage for global sweeps.** `WaterTempLog` and `FeedLevelLog` lead
   their indexes with `deviceId`; the retention sweeps filter on `recordedAt`
   without a device prefix. The 5,000-row batch bounds the delete, not the scan.
   If the tables grow enough for the scan to matter, an additive
   `recordedAt`-leading index is the next step; it needs a migration and is an
   owner decision.

## 7. Verification

- Unit tests: `apps/web/lib/__tests__/retention.test.ts` pins each cutoff, the
  closed-row filters, the deleted count, the no-stale no-op and the batch size.
  `apps/web/lib/__tests__/device-watch.test.ts` pins that the cron runs every
  sweep once and reports the counts.
- This change adds no schema or migration. The existing
  `WaterTempLog(deviceId, recordedAt)`, `FeedLevelLog(deviceId, recordedAt)` and
  `PlatformAuditLog(createdAt)` indexes serve the per-device trend and the
  global audit list; the notification sweep is served by the pond/farm
  `createdAt` indexes only when a scope is supplied. The retention sweeps are
  global and therefore rely on the 5,000-row batch bound, not on a new index.
- No sweep was executed against a database as part of this change. The first
  real deletion happens on the deployed cron after release.
