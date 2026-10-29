# Mission 2026-10-29: Feeder 3D viewer (plan v1.1.0)

Owner: Jeff. Implemented by the OpenCode lead after the original 3D worker timed out.
Branch: `mission/I-56-feeder-3d-viewer`. Base: `origin/develop` @ `21def62` (v1.25.0).
Plan: `docs/feeder-3d-viewer-plan.md` v1.1.0.

## What was taken over

The original worker's Blender process was orphaned (parent gone) and had produced no GLB.
Its uncommitted `tools/feeder-model/` script and provisional dimensions were preserved, copied
onto this branch, and built headlessly. No worker worktree was edited.

## Delivered

| Area | Result |
| --- | --- |
| Model | Blender 5.2.3 LTS headless build: `feeder-v1.0.0.glb`, **823,620 bytes**, **26,856 triangles**, manifest checksum, no Draco/Meshopt. |
| Previews | `docs/feeder/preview-iso.png`, `preview-front.png`, `preview-side.png`. |
| Viewer | Lazy React Three Fiber scene, orbit/zoom limits, six camera presets, live grain fill, dispensing auger animation, simple-view switch, error boundary. |
| Fallback | SVG illustration with the same live status and hopper reading; selected for no WebGL2, software renderers, data saver, low-memory devices and runtime failures. |
| Detail route | `/dashboard/devices/[id]` with guarded `getDeviceDetail`, status/hopper/MAC/RTC/last-fed cards. |
| Live state | `GET /api/devices/[id]/state`, session-authenticated, no-store, polled every 15 s only while visible. |
| Links | Dashboard controller card and admin device table/cards link to the detail route. |
| i18n | `en`, `hil` and `tl` keys for the viewer, fallback and admin 3D link. |
| Offline | Service worker cache v5; `/models/` is cache-first, the GLB is not precached. |
| Release | CHANGELOG `[1.26.0] - 2026-10-29`; root/web version and `LEGAL_APP_RELEASE` = 1.26.0. |

## Verification

- `pnpm lint` — pass
- `pnpm typecheck` — pass
- `pnpm test` — **233 files / 2374 tests pass**
- `pnpm api:check` — 28 routes / 56 checks, 0 failures
- `pnpm build` — production build succeeds
- Focused: feeder parts 7, detail scoping 4, fallback 2, PWA service worker 12; dashboard/admin i18n parity 12.

## Deferred / limits

- Dimensions are provisional; chassis, base plate, hopper, tube, motor and shelf height need
  tape measurements.
- Model is 26,856 triangles, above the 20k plan target but under the 2 MB ceiling.
- No browser E2E or FPS benchmark (resource constraints); the benchmark subagent should measure
  high/medium tiers and GLB load time when a browser/DB-capable environment is available.
- No staging/main promotion, no tag, no manual deployment.
