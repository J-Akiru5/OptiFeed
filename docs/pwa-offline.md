# PWA Offline Dashboard

Status: implemented on `feat/pwa-offline-dashboard`.

## Purpose

The dashboard is installable and keeps a small, read-only snapshot available after the
browser goes offline. This is **dashboard resilience**, not an offline feeding control.

The ESP32 remains the authoritative offline feeding path:

- its DS3231 RTC keeps the schedule through a brownout, so scheduled dispensing does
  not depend on the browser;
- the separate `feat/offline-queue-littlefs` work adds flash-backed dispense-event
  replay when WiFi returns; it is not part of this PWA change.

The browser does not send feed commands offline. `Feed Now` and other mutations stay
online-only, and the feed button disables itself when the browser loses connectivity.

## What is cached

| Layer | Behaviour |
| --- | --- |
| Service worker | Pre-caches `offline.html`, the manifest, icons and favicon; caches same-origin `/_next/static/`, icon, logo and font assets at runtime. |
| Navigations | Network-first. When the network fails, the service worker serves the cached offline page. |
| API and auth | Never intercepted or cached. |
| Authenticated HTML/RSC | Never cached. Only the static offline page is used as a navigation fallback. |
| Dashboard snapshot | The dashboard writes a compact JSON snapshot to `localStorage` under `optifeed:pwa:dashboard:v1`. The offline page reads it and renders the last-known values. |

The snapshot is cleared when the user signs out and when the login page mounts, so a
shared browser does not keep the previous user's dashboard values.

## Files

- `apps/web/app/manifest.ts` — installable manifest.
- `apps/web/public/sw.js` — service worker and cache policy.
- `apps/web/public/offline.html` — static offline shell and snapshot renderer.
- `apps/web/public/icons/` — 192/512/maskable/apple-touch icons.
- `apps/web/components/pwa/pwa-register.tsx` — production-only registration.
- `apps/web/components/pwa/dashboard-snapshot.tsx` — writes the dashboard snapshot.
- `apps/web/components/pwa/offline-banner.tsx` — in-app offline notice.
- `apps/web/lib/pwa/snapshot.ts` — snapshot key, types and storage helpers.

## Testing

1. Build and start the app:
   ```powershell
   pnpm --filter web build
   pnpm --filter web start
   ```
2. Sign in and open `/dashboard` once. This writes the snapshot.
3. In DevTools → Application:
   - confirm `/sw.js` is activated and controls the page;
   - confirm the cache contains `pakaonai-static-v1` and the offline assets.
4. Set Network → Offline, then reload the dashboard.
   - The service worker serves `offline.html`.
   - The saved pond/device/feed/water/cycle values are shown.
   - The page states that feed commands are disabled offline.
5. Go back online and use **Refresh dashboard**.
6. Sign out online and confirm `optifeed:pwa:dashboard:v1` is removed from localStorage.

## Limits

- The snapshot is per browser profile, not per device; it is not encrypted.
- A first-ever offline visit still needs one prior online dashboard load.
- The service worker is registered only in production builds (or with
  `NEXT_PUBLIC_PWA_DEV=1` for local testing).
- iOS installation is manual (Share → Add to Home Screen); background sync is not
  relied upon.
- The PWA does not replace the ESP32 RTC, local schedule, physical controls or flash
  queue.
