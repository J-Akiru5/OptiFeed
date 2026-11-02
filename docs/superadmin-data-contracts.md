# Superadmin data contracts and visualization gap register

Audited against `origin/develop` `c3750e9` (PR #615 merged); rebased onto
`bdcb300` (release-only delta). Issue **#630** (Lane J), epic **#627**.

This document is the data contract between `apps/web/lib/platform/**` and the
Superadmin redesign (Lanes H/I). A chart may only ship if a row below says it is
**Backed** or **New**. A row marked **Gap** must not be rendered, even as a
placeholder with invented values.

No database write, migration or production query was made for this audit. Query
counts are counted from the code paths, not measured with `EXPLAIN`; row-count
expectations are labelled as estimates.

**Status legend**

| Status | Meaning |
| --- | --- |
| **Backed** | An existing exported function returns the required shape today. |
| **New** | Added additively in this lane; no existing signature changed. |
| **Derive** | The rows are already returned; the visual is a pure grouping/count in the component. No query. |
| **Partial** | Some of the visual is backed; the missing part is named in the gap register. |
| **Gap** | No backing data. Do not ship. |

---

## 1. Section contracts (A–G)

Paths are relative to `apps/web/`. Line numbers are the exported function or the
returned-shape interface, not the call site.

### A. Global platform overview

| Required visual | Backing function | Shape | Source | Status | Queries |
| --- | --- | --- | --- | --- | --- |
| Organizations: value + delta | `getPlatformAnalytics().kpis.organizations` | `CountKpi { total, newInRange, previousNew, deltaPct, direction }` | `lib/platform/analytics.ts:169`, type `:64` | Backed | shares the loader |
| Users: value + delta | `.kpis.users` | `CountKpi` | same | Backed | — |
| Ponds: value + delta | `.kpis.ponds` | `CountKpi` | same | Backed | — |
| Feeders + online % | `.kpis.feedersOnline` | `{ total, online, pct, previousPct, deltaPct, direction }` | same | Backed | — |
| Feeding operations | `.kpis.feeds` | `FlowKpi { total, previous, deltaPct, direction }` | same, return `:458` | Backed | — |
| Feed dispensed (mass) | `.kpis.kgDispensed` | `FlowKpi` (kg) | same, return `:464` | Backed | — |
| Open alerts | `.kpis.openAlerts` | `CountKpi` | same, return `:470` | Backed | — |
| Open **incidents** (platform) | `getIncidentQueue().tracked.totalOpen` / `.summary.open` | `number` / `IncidentSummary` | `lib/platform/incidents.ts:94`, `lib/platform/incident-lifecycle.ts:262` | Partial — not on the overview today; full loader is 12–15 queries | see G15 |
| Per-KPI trend | `.signupsPerDay`, `.feedsPerDayBySource`, `.kgPerDay`, `.deviceSplit` | `ChartPoint[]`, `StackedSeries`, `ChartPoint[]`, split | `analytics.ts:485–491` | Backed | — |
| Organization/pond/device registration trend | `getGrowthSeries()` | `GrowthSeries` (four `ChartPoint[]` + totals) | **new** `lib/platform/growth.ts:59` | New | **1** |

### B. Global platform health

| Required visual | Backing function | Shape | Source | Status | Queries |
| --- | --- | --- | --- | --- | --- |
| Platform band (jobs, queue, cron, errors) | `getStatusBands().bands["platform"]` | `StatusBand { key, state, facts: BandFact[] }` | `lib/platform/status-bands.ts:218`, `:61` | Backed | 4 |
| Tenant band (active/suspended/deleting) | `.bands["tenants"]` | `StatusBand` | `:109` | Backed | 1 |
| Device band (offline %) | `.bands["devices"]` | `StatusBand` | `:142` | Backed | 2 (policy shared) |
| Security band (lockouts, grants, MFA, approvals) | `.bands["security"]` | `StatusBand` | `:174` | Backed | 6 |
| Background jobs: counts + per-day + recent failures | `getSystemHealth().jobs` | `JobHealth { counts, total, queued, running, succeeded, failed, oldestQueued, recentFailures, jobsPerDay, failuresPerDay }` | `lib/platform/health.ts:150`, type `:67` | Backed | 4 |
| Cron freshness | `getSystemHealth().cron` | `CronActivityRow[]` | `health.ts:270`, type `:52` | Backed | 2 |
| App/error register | `listErrorEvents()` unresolved count / rows | `ErrorEventListResult` | `lib/platform/error-events.ts:86`, `:42` | Partial — rows exist, no rate/trend | see G3 |
| AI service health | — | — | — | **Gap** | G1 |
| App latency / uptime | — | — | — | **Gap** | G2 |
| Tenant health trend | — | — | — | **Gap** | G4 |

> The four bands together are 13 queries (the `device.status` policy is React
> `cache()`d, so the analytics and band reads share one). Do not call
> `getStatusBands` per band.

### C. Device fleet analytics

| Required visual | Backing function | Shape | Source | Status | Queries |
| --- | --- | --- | --- | --- | --- |
| Online/offline split | `getPlatformAnalytics().deviceSplit` | `{ name, value, segment }[]` | `analytics.ts:488` | Backed | — |
| Fleet verdict + per-tenant rows | `getFleetMonitor()` | `FleetMonitor { rows: TenantFleetRow[], summary, totalDevices, truncated, sourceError }` | `lib/platform/fleet-health.ts:161` | Backed | 7 |
| Connectivity trend | `getPlatformAnalytics().connectivity.trend` | `ConnectivityTrendPoint[]` (90 completed UTC days) | `lib/platform/connectivity-rules.ts:206` | Backed | 1 |
| Uptime share | `.connectivity.trend[].onlineSharePct` | `number \| null` (0–100, one decimal) | `connectivity-rules.ts:223` | Backed | — |
| Registered vs active (30 d) | `.connectivity` | `PlatformConnectivity { registered, active30d, activePct, activeWindowDays, activeCutoff, windowDays, trend, daysWithoutData }` | `connectivity-rules.ts:249` | Backed | 1 |
| Status by organization | `getTenantHealthDataset()` | `TenantHealthRow[]` (`members`, `ponds`, `devices`, `reporting`, `offline`, `offlinePct`, `state`) | `lib/platform/tenant-health.ts:69`, type in `tenant-health-rules.ts:53` | Backed | 6 |
| Firmware distribution | `getFirmwareFleet().versionCounts` + `.unknownCount` | `FirmwareVersionCount[]`, `number` | `lib/platform/firmware.ts:121`, type `:71` | Backed (500-device cap) | 5 |
| Telemetry freshness histogram | `summarizeTelemetryFreshness(getFleetMonitor().rows)` | `FleetTelemetryFreshness { devices, rssi, feedLevel, waterTemp }` | **new** `lib/platform/fleet-health-rules.ts:437` | New | **0** |
| Current device fault distribution | `summarizeFleetFaults(getFleetMonitor().rows)` | `FleetFaultCount[]` | **new** `lib/platform/fleet-health-rules.ts:467` | New | **0** |
| Historical error distribution | — | — | — | **Gap** | G6 |
| Heartbeat distribution per device | — | — | — | **Gap** | G5 |
| Firmware adoption trend | — | — | — | **Gap** | G8 |

### D. Tenant ecosystem analytics

| Required visual | Backing function | Shape | Source | Status | Queries |
| --- | --- | --- | --- | --- | --- |
| Organization distribution | `getStatusBands().bands["tenants"].facts` + `getTenantHealthDataset().summary` | `BandFact[]`, `TenantHealthSummary` | `status-bands.ts:109`; `tenant-health-rules.ts:134` | Backed (derive counts) | 1 + 6 |
| Users per organization | `getTenantHealthDataset().rows[].members` | `number` | `tenant-health.ts:69`, rules `:53` | Backed | — |
| Ponds per organization | `.rows[].ponds` | `number` | same | Backed | — |
| Devices per organization | `.rows[].devices` / `.reporting` / `.offline` | `number` | same | Backed | — |
| Feeding per organization | `getFeedBreakdown().byOrg` | `FeedBreakdownSlice[]` (`operations`, `grams`, `kg`) | **new** `lib/platform/feed-analytics.ts:147` | New | **4** |
| Drill-down | `getOrgDetail()` (actions layer) + existing `/superadmin/orgs/[orgId]` | org detail shape | `lib/actions/platform/members.ts` | Backed, outside `lib/platform` | varies |
| Per-org activity trend | — | — | — | **Gap** | G9 |
| Per-org uptime | — | — | — | **Gap** | G10 |

### E. Feeding and operational analytics

| Required visual | Backing function | Shape | Source | Status | Queries |
| --- | --- | --- | --- | --- | --- |
| Feed over time (mass) | `getPlatformAnalytics().kgPerDay` | `ChartPoint[]` (kg/day) | `analytics.ts:487` | Backed | — |
| Operations over time | `.feedsPerDayBySource` | `StackedSeries` (counts by source/day) | `analytics.ts:486` | Backed | — |
| Consumption by organization | `getFeedBreakdown().byOrg` | `FeedBreakdownSlice[]` | **new** `feed-analytics.ts:147` | New | **4** |
| Consumption by pond | `getFeedBreakdown().byPond` | `FeedBreakdownSlice[]` | **new** `feed-analytics.ts:147` | New | — |
| Day × hour feeding heatmap | `getFeedHeatmap()` | `PlatformFeedHeatmap { cells, dayKeys, maxOperations }` | **new** `feed-analytics.ts:228` | New | **1** |
| Feeding anomalies | — | — | — | **Gap** | G11 |
| General device-activity heatmap | — | — | — | **Gap** (index) | G12 |

Operation count and consumed mass are separate fields in every new shape.
`hand_fed` imports are excluded from both: they are daily totals, not dispenses.

### F. Incident and alert visualization

| Required visual | Backing function | Shape | Source | Status | Queries |
| --- | --- | --- | --- | --- | --- |
| Severity distribution (derived queue) | `getIncidentQueue().summary.counts` | `Record<IncidentSeverity, number>` | `lib/platform/incident-rules.ts:361` | Backed | 12–15 |
| Severity distribution (stored lifecycle) | `getIncidentQueue().tracked.summary.counts` | `Record<PlatformIncidentSeverity, number>` | `lib/platform/incident-lifecycle-rules.ts:253` | Backed | included |
| Lifecycle distribution | `.tracked.rows[].status` / `.tracked.summary` | statuses + `{ open, escalated, overdue, resolved }` | `incident-lifecycle-rules.ts:262` | Derive (count rows) | 0 extra |
| Unacknowledged | `.incidents` (`acknowledgedAt === null`) + `.tracked.summary.overdue` | row fields / `number` | `incidents.ts:47`; `incident-lifecycle-rules.ts:262` | Backed | — |
| By organization | `.tracked.rows[].orgId/ownerName`; `.incidents[].tenantName` | row fields | `incident-lifecycle.ts:45` | Derive (group rows) | 0 extra |
| Recent critical | tracked rows sorted by severity/age | `TrackedIncidentRow[]` | `incident-lifecycle.ts:262` | Backed | — |
| Incident trend over time | — | — | — | **Gap** | G13 |

### G. Growth analytics

| Required visual | Backing function | Shape | Source | Status | Queries |
| --- | --- | --- | --- | --- | --- |
| User registrations | `getPlatformAnalytics().signupsPerDay` | `ChartPoint[]` | `analytics.ts:485` | Backed | — |
| Organization registrations | `getGrowthSeries().series.organizations` | `ChartPoint[]` | **new** `growth.ts:59` | New | **1 (shared)** |
| Pond registrations | `.series.ponds` | `ChartPoint[]` | **new** `growth.ts:59` | New | - |
| Device registrations | `.series.devices` | `ChartPoint[]` | **new** `growth.ts:59` | New | - |
| Registration totals | `.totals` | `Record<GrowthSeriesKey, number>` | **new** `growth.ts:59` | New | - |
| Activity trends | `feedsPerDayBySource`, `kgPerDay`, `getFeedHeatmap` | see E | `analytics.ts`, `feed-analytics.ts` | Backed / New | 1 |
| Date-range control (7/30/90) | `parseAnalyticsRange`, `resolveAnalyticsWindow` | `AnalyticsRange`, `AnalyticsWindow` | `analytics.ts:133`, `:145` | Backed for A/E/G | — |
| Date range on fleet/tenant/incidents/health | — | — | fixed windows (14 d / 90 d / current) | **Gap** | G14 |

---

## 2. Gap register

A **Gap** is a required visual with no backing data today. “Query-only” means the
data exists in current tables; “Index/Schema” means a migration would be needed
and must be filed separately under the migration ledger (never in this lane).

| ID | Section | Required visual | What is missing | Source table / field | Type | Cost | Severity | Recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G1 | B | AI service health | No provider/usage monitoring is stored anywhere; the console has no real signal to show | none — external provider metrics | External + schema | L | P1 | Do **not** ship. Omit the tile or label “not monitored”. Needs a separate monitoring source before any chart. |
| G2 | B | App latency / uptime | No APM or request-timing history; `withApi` timing is per request and not persisted | none — external APM | External | L | P1 | Do not ship. Error counts are the only real app-health signal today. |
| G3 | B | Error-rate trend | `ErrorEvent` rows exist, but nothing aggregates them by day/severity; list is paginated | `ErrorEvent.severity`, `lastSeenAt`, `count`, `resolved` | Query-only | S (1 query) | P1 | Add `groupBy` over the 14/30/90-day window; index `(resolved, lastSeenAt)` already supports it. |
| G4 | B | Tenant health trend | Only the current snapshot is stored; no daily tenant-health history | — | Schema (daily snapshot table) | L | P1 | Do not ship a trend. Current state is backed. Snapshotting is a separate design. |
| G5 | C | Heartbeat distribution per device | `DeviceConnectivityDaily.heartbeatCount` is per device/day, but no histogram of devices by heartbeat count | `DeviceConnectivityDaily.heartbeatCount`, `day` | Query-only | S–M (1 query) | P2 | Bucket the latest completed day; `@@index([day])` supports it. |
| G6 | C | Error distribution (command failures / historical faults) | `command_failed` and `device_health` metadata are JSON with no structured error/fault column; only current faults are derivable | `DeviceStateEvent.metadata`, `eventType = command_failed` | Query-only (JSON parse) | M | P1 | Current faults are New (zero queries). Add a bounded 30-day `command_failed` query; historical fault counts need a structured column if they must be exact. |
| G7 | C | Firmware adoption over time | Only the current reported version per unit is read; no version-per-day series | `DeviceStateEvent` version events (metadata `version`) | Query-only (metadata parse) | M | P2 | Current distribution is backed. A trend must bound by event type/date and accept unknown versions. |
| G8 | C | Firmware distribution above the cap | `getFirmwareFleet` reads 500 devices; a larger fleet gets a floored distribution | `EnergyDevice`, version events | Query-only (paginate/raise cap) | S–M | P1 if fleet > 500 | Surface `devicesTruncated`; do not label a capped count “fleet total”. |
| G9 | D | Per-org activity trend | No per-org daily series; global series only | `FeedEvent.farmId`, `receivedAt` | Query-only | M (1 aggregate + 3 resolution) | P1 | Same shape as `getFeedBreakdown`, grouped by day and farm. Bound the range; `(eventType, receivedAt)` carries the scan. |
| G10 | D | Per-org uptime | `DeviceConnectivityDaily` is per device, not mapped to org at query time | `DeviceConnectivityDaily`, `EnergyDevice.pondId` → farm → org | Query-only | M (1 + 3) | P2 | Join device → pond → farm, then resolve orgs; reuse `resolveFarmsToOrganizations`. |
| G11 | E | Feeding anomalies | No expected-vs-actual model; schedules/plans are not joined to dispensed mass in one read | `FeedEvent`, schedule/plan tables | Query-only + rules | L | P1 | Do not ship a “anomaly” score until the expected baseline is defined. Alerts already cover pellet/command failures. |
| G12 | E | General device-activity heatmap | `DeviceStateEvent` has no leading `createdAt` index; a platform-wide day×hour scan would be unbounded | `DeviceStateEvent.createdAt` | Index (migration) | S | P2 | Feed heatmap is backed. For device activity, file a separate `(createdAt)` or `(farmId, createdAt)` index. |
| G13 | F | Incident trend over time | No daily opened/resolved series; rows exist | `PlatformIncident.openedAt`, `resolvedAt`, `status` | Query-only | S–M (1 query) | P1 | Add a bounded range aggregate; the current `(status, severity, openedAt)` index is not openedAt-leading, so add `(openedAt)` if the table grows. |
| G14 | G | Date-range controls on every section | Fleet uses a fixed 1000-device snapshot; tenant/health/incidents use their own windows; only analytics accepts `?range=` | — | Plumbing | M | P1 | Pass the parsed `AnalyticsRange` into the section loaders; do not add a second range parser. |
| G15 | A | Open-incident KPI on the overview | The overview shows open *alerts*, not tracked incidents; the full incident loader is too heavy for a KPI | `PlatformIncident.status` | Query-only | S (1 count) | P1 | Add a one-count loader gated by `requirePlatformAdmin`; link to `/superadmin/incidents`. |

### Gaps that are deliberately **not** charts

- AI service health (G1) and app latency/uptime (G2) have no real monitoring
  source. The epic’s “where real monitoring data exists” rule means these tiles
  are omitted, not filled with a green placeholder.
- Tenant health trend (G4) would require storing daily snapshots. Until that
  exists, render the current state with its `checkedAt`.

---

## 3. New additive queries in this lane

No existing signature changed. Nothing below is wired into a page in this PR;
Lane I/H can consume the functions when the section is built.

| Function | File | Shape | Queries | Index / bound |
| --- | --- | --- | --- | --- |
| `getGrowthSeries(range, now?)` | `lib/platform/growth.ts` | `{ range, window, dayKeys, series, totals }`; four `ChartPoint[]` | 1 | `createdAt` range on four registry tables; bounded to 7/30/90 days |
| `getFeedBreakdown(range, now?)` | `lib/platform/feed-analytics.ts` | `{ totals, byOrg, byPond, unattributed }`; `FeedBreakdownSlice` keeps operations and kg separate | 4 (1 aggregate + 3 tenant-resolution reads) | `FeedEvent(eventType, receivedAt)`; grouped by farm/pond, no per-row query |
| `getFeedHeatmap(range, now?)` | same | `{ cells, dayKeys, maxOperations }`; sparse day×hour | 1 | same index; bounded range |
| `summarizeTelemetryFreshness(rows)` | `lib/platform/fleet-health-rules.ts` | `FleetTelemetryFreshness` | 0 | pure over `getFleetMonitor().rows` |
| `summarizeFleetFaults(rows)` | same | `FleetFaultCount[]` | 0 | pure over current `device_health` rows |

`getFeedBreakdown` falls back to `Pond.ownerId` when `FeedEvent.farmId` is null,
so older rows are not silently dropped. It still exposes an explicit
`Unattributed` slice: an unattributed operation is never assigned to a guessed
tenant.

### Row-count expectations

| Query | Expected rows | Plan / bound |
| --- | --- | --- |
| `getGrowthSeries` | ≤ 4 × `dayKeys` (≤ 360 for 90 days) | Four `createdAt`-range scans; registry tables are small. `Organization`/`Pond`/`EnergyDevice` have no `createdAt` index, so this is a bounded scan, not an index-only read. Revisit if the registries grow past ~100k rows. |
| `getFeedBreakdown` | ≤ distinct (farm, pond) pairs with a dispense in the window; realistically hundreds | `FeedEvent(eventType, receivedAt)` drives the range; `EnergyDevice`/`Pond` joins are by primary key; `GROUP BY` returns one row per pair. |
| `getFeedHeatmap` | ≤ `dayKeys` × 24, sparse (≤ 2,160 for 90 days) | Same index and range; one aggregate row per active (day, hour). |
| `summarizeTelemetryFreshness` / `summarizeFleetFaults` | ≤ `FLEET_DEVICE_LIMIT` (1,000) | Pure loop over rows already loaded by `getFleetMonitor`; zero queries. |

---

## 4. Query count per dashboard render

Counted from the code paths, with React `cache()` calls counted once. This is
not an `EXPLAIN` measurement.

### Current overview (`/superadmin`)

| Layer | Queries |
| --- | --- |
| `getPlatformAnalytics` | 29 (the parallel wave) + 1 shared `device.status` policy |
| `getStatusBands` | 12 + the same cached policy |
| **Platform data subtotal** | **42** |
| Auth: `getCurrentUser` (cached) | 1 |
| Auth: `requirePlatformAdmin` × 4 (layout, page, analytics, bands) | 4 `PlatformAdmin` lookups |
| Shell: active-membership + help flag | 2 |
| **Approximate total** | **≈ 49** |

`getSignedAvatarUrls` reads Storage, not Postgres, and is excluded.

### If a single redesigned page loads every section

| Addition | Queries |
| --- | --- |
| `getGrowthSeries` | +1 |
| `getFeedBreakdown` | +4 |
| `getFeedHeatmap` | +1 |
| `getFleetMonitor` (freshness/faults are free) | +7 |
| `getTenantHealthDataset` | +6 |
| `getIncidentQueue` | +15 |
| **Total** | **≈ 76** |

**Recommendation:** do not load every section on one route. Use tabs/routes and
load only the visible section. The existing overview is already ~49 queries; a
single-page “everything” view would be a regression even though each individual
loader is bounded. The new loaders are additive and can be composed per tab.

---

## 5. Authorization and tenant boundary

- Every existing loader in `lib/platform/**` that returns platform-wide data
  calls `requirePlatformAdmin()` itself; the pages call it again. The new
  `getGrowthSeries`, `getFeedBreakdown` and `getFeedHeatmap` follow that rule.
- `listDeadLetterJobs` and `listIssueReports` intentionally do **not** gate
  themselves; their pages do. Do not reuse them from an ungated surface.
- The new queries are **platform-scoped aggregates** by design. They never
  accept an org id from the caller and never return tenant-private rows to a
  tenant session. A per-org drill-down must keep using `getOrgDetail` and the
  existing ownership checks, not a new unfiltered query.
- No authorization, session or RLS code was changed in this lane.

---

## 6. What Lane I must not ship

Until the gap is closed, do not render:

1. AI service health (G1).
2. App latency/uptime (G2).
3. Tenant-health trend (G4).
4. A historical error distribution labelled as current (G6).
5. Firmware adoption trend (G7).
6. A “fleet firmware distribution” that ignores `devicesTruncated` (G8).
7. Per-org activity trend (G9) or per-org uptime (G10).
8. Feeding anomaly scores (G11).
9. A device-activity heatmap over `DeviceStateEvent` without the index (G12).
10. An incident trend (G13) or an incidents KPI that silently uses open alerts
    instead (G15).
11. A date-range control that only changes the analytics charts (G14).

An empty state is acceptable. A fabricated or silently substituted series is
not.
