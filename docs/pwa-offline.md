# PWA Offline Dashboard

Status: implemented on `feat/pwa-offline-dashboard`; extended with multi-page snapshots
and an offline biomass outbox on `feat/offline-first`.

## Purpose

The app is installable and keeps the last-known operator state available after the
browser goes offline. This is **operational resilience**, not an offline feeding control.

The ESP32 remains the authoritative offline feeding path:

- its DS3231 RTC keeps the schedule through a brownout, so scheduled dispensing does
  not depend on the browser;
- the separate `feat/offline-queue-littlefs` work adds flash-backed dispense-event
  replay when WiFi returns; it is not part of this PWA change.

The browser does not send feed commands offline. `Feed Now`, schedule changes, cycle
edits, harvest and calibration stay online-only. Biomass samples are the one write that
can be queued safely: they are append-only and replay idempotently.

## What is cached

| Layer | Behaviour |
| --- | --- |
| Service worker | Pre-caches `offline.html`, the manifest, icons and favicon; caches same-origin `/_next/static/`, icon, logo and font assets at runtime. |
| Navigations | Network-first. When the network fails, the service worker serves the cached offline page. |
| API and auth | Never intercepted or cached. |
| Authenticated HTML/RSC | Never cached. Only the static offline page is used as a navigation fallback. |
| Page snapshots | Dashboard, Schedule, Growth, Harvest and History write compact JSON snapshots to IndexedDB `optifeed-offline` (localStorage fallback). The offline shell renders them as tabs. |
| Dashboard legacy snapshot | The dashboard also writes `optifeed:pwa:dashboard:v1` to localStorage for backward compatibility. |
| Offline writes | Biomass samples from the offline shell or the Log Sample form are queued in `optifeed-offline-outbox` / localStorage, then replayed through `saveBiomassLog` when online. |

The snapshot is cleared when the user signs out and when the login page mounts, so a
shared browser does not keep the previous user's farm values or queued samples.

## Offline writes

- The offline shell has a **Log sample** tab with fish count, total sample weight,
  average length and batch label.
- The online Log Sample form queues the same payload if the browser is offline or the
  server call throws before a response.
- Every queued sample carries a client event id. The server uses that id as the
  `BiomassLog` primary key and treats a duplicate replay as success, so a lost response
  cannot create two samples.
- Replay runs on dashboard load and on the browser `online` event, sequentially, and
  stops on a lost session so the queue is not burned through with 401s.
- Feed commands and schedule/cycle edits are never queued.

## Files

- `apps/web/app/manifest.ts` — installable manifest.
- `apps/web/public/sw.js` — service worker and cache policy.
- `apps/web/public/offline.html` — static offline shell, tabs and offline sample form.
- `apps/web/public/icons/` — 192/512/maskable/apple-touch icons.
- `apps/web/components/pwa/pwa-register.tsx` — production-only registration.
- `apps/web/components/pwa/snapshot-writer.tsx` — writes page snapshots.
- `apps/web/components/pwa/offline-sync.tsx` — replays the biomass outbox.
- `apps/web/components/pwa/dashboard-snapshot.tsx` — legacy dashboard snapshot.
- `apps/web/components/pwa/offline-banner.tsx` — in-app offline notice.
- `apps/web/lib/offline/db.ts` — IndexedDB snapshot store + localStorage fallback.
- `apps/web/lib/offline/outbox.ts` — queued biomass samples.
- `apps/web/lib/offline/sync.ts` — server-action replay.

## Testing

1. Build and start the app:
   ```powershell
   pnpm --filter web build
   pnpm --filter web start
   ```
2. Sign in and open `/dashboard`, `/dashboard/schedule`, `/dashboard/growth`,
   `/dashboard/harvest` and `/dashboard/history` once. This writes the page snapshots.
3. In DevTools → Application:
   - confirm `/sw.js` is activated and controls the page;
   - confirm the cache contains `pakaonai-static-v2` and the offline assets;
   - confirm `optifeed-offline` has `snapshots` and `meta` stores.
4. Set Network → Offline, then reload the dashboard.
   - The service worker serves `offline.html`.
   - Overview, Schedule, Growth, Harvest and History render the saved values.
   - The page states that feed commands are disabled offline.
5. Open the **Log sample** tab offline, fill it and save. Confirm the queued item exists
   in `optifeed-offline-outbox`.
6. Go back online, open the dashboard, and confirm the offline sample syncs (the outbox
   empties and no duplicate sample appears). Refresh the dashboard.
7. Sign out online and confirm `optifeed:pwa:dashboard:v1`,
   `optifeed:offline:snapshots:v1`, `optifeed:offline:active:v1` and the outbox are gone.

## Limits

- Snapshots are per browser profile and per pond, not encrypted. Sign out on shared
  devices; the data and queued samples are cleared on logout/login.
- A first-ever offline visit still needs one prior online visit to the page.
- Only the **active pond** is rendered by the offline shell; snapshots for other ponds
  are stored but the tab does not yet offer a pond switcher.
- The offline shell's sample form has no individual-fish rows; it queues the aggregate
  count/weight/length. Individual rows remain available on the online form.
- Calendar task completion, schedule/cycle edits, harvest, calibration and feed commands
  are not queued. The ESP32 RTC, local schedule and physical button remain the offline
  feeding path.
- The service worker is registered only in production builds (or with
  `NEXT_PUBLIC_PWA_DEV=1` for local testing).
- iOS installation is manual (Share → Add to Home Screen); background sync is not
  relied upon; replay runs while the app is open and online.
- The PWA does not replace the ESP32 RTC, local schedule, physical controls or flash
  queue.
