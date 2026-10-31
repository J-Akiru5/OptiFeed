# Audit trail benchmark — farmer timeline vs. industry practice (I-50, #273)

Worker I-50 (`opencode-go/deepseek-v4.1-flash`), branch `mission/I-50-audit-trail`,
worktree `S:\Dev\optifeed\mission-I-05`, based on `origin/develop` @ `74a0582`
(2026-10-28).

Issue #273: the farmer **Audit Trail** (Pond Operator → Audit Trail) lists device
events with a time, device label, event-type chip, source and device time, but
it cannot answer *who last touched this* and the actor id is not human-readable.
The issue also asks how an industry-grade audit trail handles this, together with
the RBAC equivalence.

This document compares five reference systems on eight properties, then records
the gap between them and OptiFeed. It deliberately ends with what **cannot** be
fixed without a schema migration, all of which is out of scope for #273.

## TL;DR

- The scope bug was real: `getAuditLog` read **one** `Pond.findFirst(...)` row,
  so a farm with two or more active ponds saw only the first pond's devices
  (`apps/web/lib/actions/audit.ts:38-54` before this change).
- Actor ids in `DeviceStateEvent` are written as **two different things** —
  `User.id` (cuid) in some paths and `User.farmId` (login slug, the `ownerId`
  used by schedule/settings/time actions) in others. Resolving only one shape
  leaves half the timeline raw. The fix indexes both.
- Industry systems converge on the same four properties: **when/who/what**,
  a **stable actor identity**, **before/after context**, and **tamper-evident,
  retention-bounded storage**. OptiFeed now has the first two on the farmer page
  and inspectable metadata; it still lacks IP/user-agent, a typed diff,
  retention, and cryptographic integrity.
- The RBAC equivalence is explicit: farmer → own farm's ponds; tenant admin →
  organization (`/admin/audit`); platform admin → `PlatformAuditLog`
  (`/superadmin/operations/audit`). The farmer page never widens to the org.

## Sources

All pages retrieved 2026-10-28.

| Ref | System | URL |
| --- | --- | --- |
| [OWASP] | OWASP Logging Cheat Sheet (guidance, not a product) | https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html |
| [CT-CONCEPTS] | AWS CloudTrail concepts | https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-concepts.html |
| [CT-HISTORY] | AWS CloudTrail event history | https://docs.aws.amazon.com/awscloudtrail/latest/userguide/view-cloudtrail-events.html |
| [CT-INTEGRITY] | AWS CloudTrail log-file integrity validation | https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-log-file-validation-intro.html |
| [CT-RECORD] | AWS CloudTrail record contents | https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-record-contents.html |
| [GH] | GitHub organization audit log | https://docs.github.com/en/organizations/keeping-your-organization-secure/managing-security-settings-for-your-organization/reviewing-the-audit-log-for-your-organization |
| [DD] | Datadog Audit Trail | https://docs.datadoghq.com/account_management/audit_trail/ |
| [LIN] | Linear audit log | https://linear.app/docs/audit-log |

## Comparison matrix

Legend: **Yes** = documented first-class capability; **Partial** = present but
limited or action-specific; **No** = not documented for this surface.

| Property | OWASP guidance [OWASP] | AWS CloudTrail [CT-*] | GitHub audit log [GH] | Datadog Audit Trail [DD] | Linear audit log [LIN] | OptiFeed before #273 | OptiFeed after #273 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Immutable / append-only storage** | Recommends tamper detection, read-only media, and recording all access to logs; not a storage product | Event history is an **immutable** record of the past 90 days per Region [CT-HISTORY]. Optional log-file integrity validation hashes each file (SHA-256) and signs hourly digest files with RSA; modification or deletion is detectable [CT-INTEGRITY] | GitHub generates the entries; the documented surface is search, filter and export, with no edit/delete operation [GH] | Events are read-only in-product; optional archive ships them to customer-owned S3/GCS/Azure every 15 minutes [DD] | Read-only audit records; streamed to a webhook/SIEM for durable retention [LIN] | Append-only by convention only: no `deviceStateEvent.update` call in runtime code, but cleanup paths use `deleteMany` and there is no DB trigger or hash chain | Unchanged (no migration); the doc records the gap |
| **Who / what / when** | Requires "when, where, who and what" for every entry; optional action, object, status, reason [OWASP] | `eventTime`, `userIdentity`, `eventSource`/`eventName`, `resources` [CT-RECORD] | Actor, affected user, repository, action, country, timestamp [GH] | Actor, API key id, user email, method, resource, timestamp; facets for each [DD] | Actor id/name/email, event type, timestamp, metadata [LIN] | When + event type + device + source; actor is a raw id (mixed conventions) | When + event type + device + source + resolved actor label/role/farm; empty actors fall back to System/Device/Unknown actor |
| **Before / after** | Recommends action, object, result, reason and extended details [OWASP] | `requestParameters` (request body) and `responseElements` (the change); read-only APIs return `null` [CT-RECORD] | Action-specific `data`; webhook events carry `data.events` and `data.events_were` [GH] | **Inspect Changes (Diff)** compares the previous and new JSON for dashboards, notebooks and monitors [DD] | `metadata` payload per event; no documented generic diff view [LIN] | `metadata` JSON is stored but only a few known keys are surfaced; no generic inspector | Every event has a Details block with actor, role, farm id and a pretty-printed, 2,000-character-capped metadata preview |
| **Actor identity** | User identity (database key, username) plus optional IP, device id [OWASP] | `userIdentity` (IAM principal), `sourceIPAddress`, `userAgent` [CT-RECORD] | GitHub username; `actor_location.country_code` in exports [GH] | `usr.email`, actor id, API key id, `client.ip`, user agent in event attributes [DD] | Actor id/name/email plus IP and country [LIN] | Raw `actorId`; no name, role or farm resolution | Batched `User` lookup by both `User.id` and `User.farmId`, farm-scoped; returns `actorLabel`, `actorRole`, `actorFarmId` |
| **IP / user-agent** | Optional event attributes; also warns not to log secrets/PII [OWASP] | `sourceIPAddress` and `userAgent` are first-class record fields [CT-RECORD] | Country only in the documented export keys; no IP/UA [GH] | `client.ip` and user agent are searchable attributes [DD] | IP and country recorded automatically [LIN] | Absent from `DeviceStateEvent` | Still absent — **requires a schema migration** |
| **Retention** | Must keep for the required period and must not keep beyond it; legal/regulatory input [OWASP] | 90 days in event history; trails/event data stores and S3/Glacier retain indefinitely [CT-HISTORY][CT-INTEGRITY] | Fixed 180 days [GH] | Default 90 days; configurable 3/7/15/30/90; archive is the long-term path [DD] | Fixed 90 days (Enterprise plan) [LIN] | No retention policy; rows live until the pond/account cleanup deletes them | Unchanged; documented as a migration item |
| **Export** | Recommends an industry-standard export format [OWASP] | Event history download up to 200,000 events/file; trails deliver JSON to S3; Lake supports SQL queries [CT-HISTORY] | JSON or CSV; hard limits of 100 MB compressed or 10 minutes processing [GH] | CSV up to 100,000 events; archive to object storage [DD] | GraphQL API with cursor pagination; webhook/SIEM stream [LIN] | Generic data export includes `audit_events` (raw ids, `EXPORT_ROW_LIMIT = 50_000`) | Unchanged; the page now presents the same data with labels and details |
| **RBAC scoping** | Restrict log-read privileges and record access to the logs themselves [OWASP] | IAM policies; organization trails aggregate member accounts [CT-CONCEPTS] | Only organization **owners** can open the audit log [GH] | `Audit Trail Read` / `Audit Trail Write` permissions [DD] | Only workspace **owners** [LIN] | `Pond.findFirst({ ownerId, status: "ACTIVE" })` → first active pond only; other farms excluded by `ownerId`, but the farm's own trail was incomplete | All `ACTIVE` ponds owned by the caller; actor names resolved only for `User.farmId === ownerId`; explicit tested matrix (farmer / tenant admin / platform admin) |

## What each reference gets right (and what we copied)

### OWASP Logging Cheat Sheet [OWASP]

- The entry must answer **when, where, who and what**; action, object, result,
  reason and extended details are recommended additions. Our page now shows
  who/what/when together and keeps the details behind a disclosure rather than
  removing them.
- **Log injection**: use structured formats and bound user-controlled values.
  The metadata preview is a JSON string capped at 2,000 characters and rendered
  as a React text node, so a payload cannot become markup.
- **Protection**: build in tamper detection, restrict who can read logs, and
  record access to logs. We have the read restriction; tamper evidence and
  read-access auditing are still missing (gap table).
- **Disposal**: retention must be defined and enforced. We have no retention
  job today.

### AWS CloudTrail [CT-*]

- CloudTrail separates the **immutable 90-day event history** from durable
  trails/event data stores, and makes integrity validation optional but
  explicit: SHA-256 file hashes plus hourly RSA-signed digest files, enough to
  prove a file was not modified or deleted [CT-INTEGRITY].
- Record contents are the closest analogue to a strong audit schema:
  `eventTime`, `userIdentity`, `eventSource`/`eventName`, `sourceIPAddress`,
  `userAgent`, `requestParameters`, `responseElements`, `resources`, and a
  unique `eventID` [CT-RECORD].
- Access is IAM-scoped, and an organization trail can aggregate member
  accounts [CT-CONCEPTS]. This mirrors our three-surface split, but with real
  policy enforcement rather than application filters alone.

### GitHub audit log [GH]

- A deliberately narrow surface: organization owners only, 180 days, rich
  search qualifiers (`actor`, `action`, `repo`, `created`, `country`) and
  JSON/CSV export. It proves that a fixed retention window plus a tight RBAC
  gate is an acceptable product decision when the export path is good.
- It records the actor and the affected user separately, which is useful when
  an admin acts on someone else's account. Our events do not model "affected
  user" separately yet; the device is the object.
- Export limits are explicit (100 MB compressed / 10 minutes), not silent. Our
  generic export caps at 50,000 rows without telling the user which rows were
  dropped; that is a follow-up.

### Datadog Audit Trail [DD]

- The closest match to a modern SaaS audit UX: searchable facets for actor,
  API key, email and `client.ip`; a before/after **Inspect Changes** diff; CSV
  export up to 100,000 events; retention configurable from 3 to 90 days with
  archive to customer storage every 15 minutes.
- Permissioning is split into `Audit Trail Read` and `Audit Trail Write`, so
  reading the audit log is its own privilege. OptiFeed's farmer page inherits
  the farmer's read access rather than a separate audit permission; tenant and
  platform consoles have their own gates.

### Linear audit log [LIN]

- A compact enterprise implementation: 90 days, workspace owners only, actor
  id/name/email, IP and country, metadata, GraphQL filtering and a signed
  webhook/SIEM stream. It shows that a small schema (actor + type + metadata +
  request information) is enough for a credible trail, provided identity and
  request context are captured at write time.
- Linear does not document a generic before/after diff; metadata is the
  payload. That is where OptiFeed is today, but without the IP/user-agent
  request context.

## OptiFeed gap table

`develop` @ `74a0582` is the baseline. "This change" is #273 only.

| Capability | Today (baseline) | This change (#273) | Later — explicitly out of scope |
| --- | --- | --- | --- |
| Farm scope | One arbitrary active pond (`findFirst`) | All active ponds owned by the caller, via `device: { pondId: { in: pondIds } }` | Per-pond filter in the UI (nice-to-have, no schema change) |
| Actor identity | Raw `actorId`, mixed `User.id` / `User.farmId` conventions | One batched `User.findMany` per page keyed by both; `actorLabel`, `actorRole`, `actorFarmId` on every event; raw-id fallback | Persist an **actor snapshot** (name/role/farm at event time) so a rename or deletion cannot rewrite history — needs columns or a dedicated audit table |
| Cross-tenant names | Raw ids only (no resolution) | Resolution restricted to `User.farmId === ownerId`; foreign ids stay raw and expose no name; allow + deny tests | Org-admin actor names on a farmer's device events: decide product policy, then model it explicitly |
| Last touch | Not shown | Summary card with newest user-touched event (actor, event label, timestamp), queried separately so device heartbeats cannot hide it | "Last touch per device" roll-up (query/index change, no schema change) |
| Details / before-after | A few known metadata keys rendered inline | Collapsible `<details>` with actor, role, farm id and a pretty-printed, capped metadata preview; React-escaped, no raw HTML | Typed `before`/`after` columns and a real diff view — needs a schema migration |
| IP / user-agent | Not stored | Not stored | Add `ip`, `userAgent`, and request id to the event row (or an append-only audit table) — schema migration |
| Immutability / integrity | No update path in runtime code, but `deleteMany` in admin cleanup/seed; no trigger, hash or signature | Documented only | DB grant/trigger that rejects UPDATE/DELETE, `prevHash` chain, signed daily digest, WORM/object-lock archive — schema + infrastructure |
| Retention | Rows live until pond/account cleanup | Documented only | Retention policy per plan, partition/archive job, deletion evidence — schema + operations |
| Export | Generic data export includes raw `audit_events` (50,000-row cap) | Unchanged | Audit-specific export with the same RBAC scope, explicit truncation notice, and actor labels — code, no schema change |
| RBAC | Farmer scope implicit in `ownerId`; tenant admin org scope in `lib/actions/admin.ts`; platform admin in `lib/platform/audit-log.ts` | Matrix documented in `lib/audit/trail.ts` and asserted by tests; farmer page cannot widen to the org | A dedicated audit-read permission if customers need to separate "can view the farm" from "can read the trail" — needs a permission model change |

## What #273 actually enforces

- **Scope**: `getAuditLog` loads every `Pond` where `ownerId = caller` and
  `status = "ACTIVE"`, then filters events through the device→pond relation.
  The old `findFirst` is gone; adding a pond no longer silently hides events.
- **Tenant boundary**: ponds are owner-scoped, and actor names are resolved
  with `farmId: ownerId` in the same query. A stale/forged `actorId` from
  another farm remains the raw id, with `actorRole` and `actorFarmId` null.
- **Last touch**: a separate `findFirst` with
  `OR: [{ actorId: { not: null } }, { source: "user" }]`, ordered newest-first,
  and only rendered when a user-touched row exists. It respects the active
  category filter, so "last touch in Feeding" means what it says.
- **Details**: actor, role, farm id and metadata; the preview is capped at
  2,000 characters, truncated with `…`, and rendered as text (React escapes it).
- **RBAC matrix**: farmer → own farm; tenant admin → organization through
  `/admin/audit`; platform admin → `PlatformAuditLog` through
  `/superadmin/operations/audit`. See `AUDIT_VISIBILITY_MATRIX` in
  `apps/web/lib/audit/trail.ts`.

## Residual risks

1. **Actor renames rewrite history.** Labels are resolved at read time, so a
   user renamed today changes yesterday's display. An actor snapshot column is
   the fix; it is a migration.
2. **A user row deleted after an event** falls back to the raw id. That is safe
   (no PII leak) but not human-readable. Same migration.
3. **No IP/user-agent, no retention, no tamper evidence.** These are the three
   largest differences from CloudTrail/Datadog and all require schema or
   infrastructure work.
4. **Generic export leaks raw ids and caps silently.** #273 does not change the
   export path; it is tracked in the gap table.
5. **Actor resolution is one query per page, not cached.** That is deliberate
   (fresh names, one round trip); a very large page size would still be one
   `findMany`, bounded by the page size.
6. **View-as sessions** resolve the target farm's actors, not the admin's. A
   platform-admin action recorded against the target farm's device therefore
   shows a raw id on the farmer page rather than the admin's name. That is the
   safe default for cross-tenant disclosure.
