# Feeder 3D Viewer — Implementation Plan

**Status:** Active
**Plan version:** 1.1.0
**Branch:** `feat/feeder-3d-viewer`
**Base:** `origin/develop` @ `9ab1cab` (app 1.25.0)
**Created:** 2026-10-29
**Owner:** Jeff

---

## Amendment log

| Plan | Date | Change |
| --- | --- | --- |
| 1.0.0 | 2026-10-29 | Initial plan (chat draft): Blender 4.5 LTS, code-built fallback, detail route, offline scope. |
| 1.1.0 | 2026-10-29 | Amended for the real integration base and toolchain: Blender **5.2.3 LTS** is installed; clean product prototype, no internals; user-facing detail route with admin link; explicit four-layer versioning; service-worker **v4** cache policy; `tl` locale added; cold-offline behaviour corrected to the snapshot-only reality; app release remains MINOR and is not tagged by an agent. |

---

## 1. Decision

**Blender 5.2.3 LTS → versioned GLB → React Three Fiber viewer.**

| Approach | Verdict |
| --- | --- |
| **Blender → GLB** | **Chosen.** Bevels, weighted normals, proper UVs, PBR materials, separate nodes for live parts, reproducible from a script. |
| Code-only primitives | Rejected. Reads as a blockout, not a product render. |
| Photogrammetry | Rejected. Clear PET, glossy motor, thin straps and a cluttered background are the worst case. |
| AI image-to-3D | Rejected. Paid credits, messy topology, unclear licence, and device geometry leaves our control. |

Fidelity ceiling: **clean product-visual quality, not photoreal.** The clear hopper is an approximation.

Verified environment:

- Blender `5.2.3 LTS` at `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`
- Next.js `16.4.2`, React `19.2.4`, pnpm `10.33.3`
- `origin/develop` at `9ab1cab`, package version `1.25.0`
- `@react-three/fiber` `9.8.2` peer range is React `>=19 <19.4` — compatible
- CSP is `script-src 'self' 'unsafe-inline'`; no CDN scripts, no WASM eval
- Locales: `en`, `hil`, `tl`

---

## 2. Versioning contract

Four independent versions. They do not replace each other.

| Layer | Scheme | Current | Bump rule |
| --- | --- | --- | --- |
| **Plan document** | SemVer | `1.1.0` | MAJOR: scope/decision reversal; MINOR: added phase/contract; PATCH: wording or evidence |
| **Model asset** | SemVer | `1.1.0` | MAJOR: silhouette, topology or live-node contract breaks; MINOR: new detail/material; PATCH: geometry fix |
| **Viewer contract** | Integer | `1` | Increment on a breaking prop, status or node-name change |
| **App release** | SemVer | `1.30.2` | The tape-calibrated model rebuild ships as PATCH 1.30.2; applied at release prep |

Rules:

1. The GLB filename carries the model version: `feeder-v1.1.0.glb`. A new version is a new file; published versions are never overwritten.
2. `apps/web/lib/feeder/model-manifest.json` is the single source of truth for `version`, `contract`, `file`, `sha256`, triangle count, dimensions revision, generator and build time. The viewer imports it; it never hard-codes the URL.
3. The build script writes the manifest and the GLB together, so they cannot drift.
4. `CACHE_NAME` in `public/sw.js` is bumped when the model URL changes (`pakaonai-static-v5` → `v6`). Old cache entries are purged on activate.
5. A breaking node rename or removal increments the model MAJOR **and** the viewer contract, in the same change.
6. `CHANGELOG.md` gets an `Unreleased` entry with the change. Version files (`package.json` root and `apps/web`) are updated only during release prep, after all gates pass.
7. Agents prepare releases. The owner creates and pushes the tag and publishes. No tag, no GitHub Release and no npm publication by an agent.
8. The model source (`tools/feeder-model/`) is versioned with the app. The reference photos are **not** committed.

Proposed release note (draft, not final):

> Added: interactive 3D feeder viewer on the device detail page and pond dashboard, with live hopper level, motor state and a low-end illustrated fallback.

---

## 3. Model specification

### Source of truth

All dimensions live in `tools/feeder-model/dimensions.json`. Changing a measurement updates the model without touching code.

The current revision is `tape-2026-10-29`, built from Jeff's filled measurement sheet (`feeder-dimensions-2026-10-29.json`). It supersedes the photo-ratio estimates: a 340 × 450 mm base, a 145 × 450 × 315 mm chassis, one whole 400 mm PET jar on a 200 mm shelf, a 50 mm auger tube, a 60 mm motor, the ultrasonic sensor on the lid, and a 750 mm wire-guide post. The sheet's `B10 = 20` is applied as **200 mm** (20 cm), the only reading consistent with the 400 mm jar, the 530 mm sensor and the photos. The model asset is `1.1.0`; this is a PATCH to the app, not a viewer-contract change.

### Parts

| Node | Treatment |
| --- | --- |
| `Chassis` | Closed satin-white box, panel seam, lock. No internal geometry. |
| `Panel` | Clean label, dial, RUN/STOP, two LEDs — external only. |
| `Hopper_Glass` | One-piece lathe-profiled clear PET jar with a conical lower shoulder; two black straps. |
| `Hopper_Lid` | Sealed plywood, clean edge. |
| `Sensor_Top` | Ultrasonic module on the jar lid; the post and short arm are a wire guide. |
| `Shelf`, `Post` | White, tidy, no visible fasteners beyond structure. |
| `Funnel`, `Tube_Glass` | Clear tube, blue printed collar, red outlet cap. |
| `Auger` | Helical flight; separate node rotating on its local axis. |
| `Motor_Body`, `Motor_Coupling` | Olive body, label, coupling; separate rotating node. |
| `Grain_Fill` | Separate mesh, bottom pivot, scaled by feed level. |
| `Cable_Loom` | One tidy loom. No tape, no loose wires. |
| `Base_Plate` | Plate, studio backdrop, contact shadow. |

### Clean-product decisions

- White satin chassis with no dents, scratches or tape residue.
- Clear hopper without wrinkles, seams or plastic wrap.
- Black straps retained; blue printed collar and red outlet cap retained as functional accents.
- Sealed plywood lid retained to stay faithful to the build.
- Loose wiring replaced by a single tidy loom.
- No background clutter; neutral studio backdrop.

### IP rule

**No internal controller geometry, and no hidden internals.** Anything in a GLB can be downloaded and extracted, so hidden is not hidden. The enclosure stays closed and the panel is external only.

---

## 4. Build pipeline

```
tools/feeder-model/
  build.py             # reads dimensions.json, builds, exports GLB, writes manifest
  dimensions.json      # every measurement in one place (mm)
  preview.py           # optional preview renderer
apps/web/public/models/
  feeder-v1.1.0.glb
apps/web/lib/feeder/
  model-manifest.json
docs/feeder/
  preview-iso.png
  preview-front.png
```

Commands:

```powershell
blender --background --factory-startup --python tools/feeder-model/build.py -- `
  --dims tools/feeder-model/dimensions.json `
  --glb apps/web/public/models/feeder-v1.1.0.glb `
  --manifest apps/web/lib/feeder/model-manifest.json `
  --preview docs/feeder
```

Export settings:

- GLB, modifiers applied, +Y up, embedded textures, no cameras, no lights
- **No Draco / no Meshopt** — keeps CSP free of `'wasm-unsafe-eval'`
- Target **≤ 2 MB, ≤ 20k triangles**, one 1024² atlas
- If over budget: merge static meshes by material, prune, dedup, 512² textures; do not add a WASM decoder

Resource policy: the host is currently **amber (4 GB free)**. Use Workbench/EEVEE previews first; defer Cycles CPU renders until resources allow. Record any deferral.

---

## 5. Runtime architecture

Dependencies (MIT, React 19 compatible):

```
three@0.186.1
@react-three/fiber@9.8.2
@react-three/drei@10.7.9
@types/three (dev)
```

```
apps/web/components/feeder/
  feeder-viewer-lazy.tsx   "use client" — dynamic(ssr:false), IntersectionObserver, tier gate
  feeder-viewer.tsx        Canvas, lights, procedural RoomEnvironment (no CDN HDR)
  feeder-scene.tsx         useGLTF + named-node binding
  feeder-parts.ts          pure: clamps, status mapping, presets, tier rules (unit-tested)
  feeder-hotspots.tsx      DOM labels anchored to parts
  feeder-controls.tsx      preset buttons + quality toggle
  feeder-fallback.tsx      SVG cartoon, server-renderable
  use-viewer-tier.ts       detection
```

`ssr: false` must live inside a Client Component — confirmed in the local Next 16 lazy-loading guide. The page stays a Server Component.

### Props

```ts
type FeederViewerProps = {
  deviceId: string;
  status: "idle" | "dispensing" | "paused" | "offline";
  feedLevelPercent: number | null;
  hopperCapacityG: number | null;
  gramsPerFeeding: number | null;
  lastFedAt: string | null;
  rtcOk: boolean | null;
  mode?: "full" | "card";
};
```

Status derivation:

- `offline` — `lastSeenAt` is null or older than `OFFLINE_THRESHOLD_MS` (15 min)
- `paused` — `isPaused`
- `dispensing` — latest `feed_dispensed` event is under 20 s old
- `idle` — otherwise

### Behaviour

- Drag orbit with damping; pan disabled; zoom and polar limits
- Presets: **Iso** (default), **Front**, **Left**, **Right**, **Rear**, **Top**; damped camera tween
- Hotspots: hopper level, motor state, controller online/RTC, last fed — real buttons, not canvas text
- Live binding: `Grain_Fill` scale, `Auger` + `Motor_Coupling` rotation, LED emissive, grayscale overlay when offline
- `frameloop="demand"` when idle; continuous only while dispensing or transitioning
- No auto-rotate; `prefers-reduced-motion` makes transitions instant

### Quality tiers

| Tier | Behaviour |
| --- | --- |
| High | DPR 1.5–2, soft shadows, transmission glass, 60 fps target |
| Medium | DPR 1–1.5, blob shadow, alpha glass |
| Low | No WebGL — SVG cartoon with live fill level and status |

Detection: WebGL2, renderer string (SwiftShader/llvmpipe → low), `deviceMemory`, `hardwareConcurrency`, `saveData`. Runtime failure falls back to SVG. A manual "Simple view" toggle persists under `optifeed:feeder-viewer:quality`. `PerformanceMonitor` drops DPR below 45 fps.

---

## 6. Offline behaviour

Current policy (T-11, `sw.js` v4):

- Only same-origin static assets are cached, by destination and explicit path allowlist.
- HTML/navigation is **never** cached; offline navigation serves `offline.html` with IndexedDB/localStorage snapshots.
- API and auth are never intercepted.
- `CACHEABLE_DESTINATIONS` is `script, style, image, font, manifest`; a GLB requested by `fetch()` arrives as destination `empty` and is **not** cached today.

Changes:

1. Add `/models/` to `STATIC_PREFIXES`; allow destination `empty`/`other` **only** for `/models/`.
2. Bump `CACHE_NAME` to `pakaonai-static-v5`.
3. Do not precache the GLB at install — it is stored on first successful 3D load, cache-first afterwards.
4. Keep the offline shell's existing snapshot rendering; add the SVG feeder illustration driven by the last `feedLevelPercent`.

Honest offline limits:

- **Cold offline launch:** `offline.html` with the snapshot and the SVG illustration. No WebGL.
- **Connection drops while the page is open:** the 3D scene keeps rendering.
- **Cold-offline 3D is out of scope.** It would require caching authenticated HTML/RSC, which the PWA deliberately forbids.

---

## 7. Pages, data and auth

New query `apps/web/lib/feeder/detail.ts`:

```ts
getDeviceDetail(deviceId)
```

- `ADMIN` → `resolveOrgScope().pondIds`
- everyone else → `getCurrentPondOwnerId()` + active ponds
- one `energyDevice.findFirst({ where: { id, pondId: { in: pondIds } } })`
- returns device, pond, latest `feed_dispensed`, derived status
- returns `null` for out-of-scope or missing; the page calls `notFound()`

Pages:

- `app/[locale]/dashboard/devices/[id]/page.tsx` — device detail, user-facing
- `dashboard/page.tsx` — compact viewer card linking to the detail page
- `admin/devices/page.tsx` — device row links to the same detail route

The admin link works because `getDeviceDetail` resolves org scope for `ADMIN` as well as owner scope. The admin table remains `requireRole("ADMIN")`.

Live updates:

- `GET /api/devices/[id]/state` through `withApi(withAuth(...))`, `Cache-Control: no-store`
- returns the status DTO; 401 unauthenticated, 404 out of scope
- polled every 15 s only while the tab is visible; no polling offline; backoff on failure
- available on `/api/v1/devices/:id/state` through the existing rewrite

`params` is a `Promise` in this Next version — confirmed by the local docs and `api/jobs/[id]/route.ts`.

---

## 8. i18n and accessibility

- Add keys to `messages/en.json`, `hil.json`, `tl.json`; `tl` is an overlay that falls back to English.
- Canvas is `role="img"` with an `aria-label` summary; controls are real buttons.
- A visually hidden live region announces status changes politely.
- Keyboard: preset buttons and the quality toggle are tabbable; orbit is pointer-only but presets provide equivalent access.
- `prefers-reduced-motion` removes tweening and idle motion.
- The fallback is not decorative: it carries the same live status text.

---

## 9. Verification

| Check | Method |
| --- | --- |
| Pure logic | Vitest: clamps, status mapping, preset vectors, tier selection |
| Fallback | Component test in jsdom (no WebGL) |
| Detail route | Playwright: loads, presets set `data-camera-preset`, fallback visible on low tier |
| Offline | Playwright: warm load, then offline; offline shell renders the snapshot illustration |
| Bundle | `next build`; confirm three/R3F are absent from the dashboard first-load JS |
| Type/lint | `pnpm typecheck`, `pnpm lint` |
| Unit | `pnpm test` |
| Perf | `benchmark` subagent: FPS high/medium, GLB load time, memory; defer if resources stay amber |

E2E forces the 3D path with `optifeed:feeder-viewer:quality=high` because headless Chromium reports SwiftShader and would otherwise select the low tier.

---

## 10. Phases

| Phase | Deliverable | Acceptance |
| --- | --- | --- |
| 0 | This plan, versioned and committed | Plan 1.1.0 on the branch |
| 1 | Blender script, dimensions, GLB, manifest, previews | Silhouette matches photos; ≤2 MB; named nodes; no internals; manifest checksum matches |
| 2 | Viewer, detail page, SVG fallback | Orbit + presets, live status, no layout shift, tier fallback |
| 3 | Scoped query, polling endpoint, admin link | Cross-tenant access denied; admin row reaches the page |
| 4 | Pond card, i18n, offline illustration, SW cache | Lazy chunk absent from first load; offline shell shows illustration |
| 5 | Perf/a11y pass, benchmark, release prep | All gates green; `Unreleased` entry; proposed MINOR bump |

---

## 11. Inputs and assumptions

Blocking for accuracy, not for starting:

1. Chassis **W × H × D**
2. Base plate **W × D**
3. Hopper **max Ø × total height**
4. Tube **OD × length**
5. Motor **body length × Ø**
6. Shelf height (base to hopper shelf)

Also needed later:

- What is the blue board on the lid — load cell, ToF, or something else?
- Is the red cap the outlet, or a cap over the outlet?

Assumptions until corrected:

- Chassis is painted sheet metal/PVC over a frame.
- The hopper is one whole clear PET jar on its conical shoulder, with two black straps; the ultrasonic sensor sits on the lid and the post/arm is only a wire guide.
- The olive cylinder is a `TWT` gear motor driving an auger inside the clear tube.
- The controller is fully internal and remains unmodelled.

Reference photos stay in `Downloads`; they are not committed.

---

## 12. Risks

| Risk | Level | Mitigation |
| --- | --- | --- |
| No measurements | High | Provisional ratio calibration; one-file correction, model PATCH |
| Clear plastic cost/artifacts | High | Tiered material swap, render order, alpha fallback |
| Admin scope vs dashboard shell | Medium | Dual-scope query; detail page renders in the dashboard shell |
| GLB size | Medium | Merge/prune, 512² textures, no Draco |
| Cold-offline 3D expectation | High | Explicitly snapshot-only; documented |
| CI WebGL detection masks 3D | Low | Tier override in tests |
| Blender 5.2 API drift | Medium | Script pinned to 5.2.3; headless smoke test before modelling |
| IP leakage | High | No internal geometry, no hidden meshes, no CAD source in repo |

---

## 13. Definition of done

- Model reviewed against the reference photos and approved.
- Shared viewer on the device detail page, the pond dashboard card and the admin device link.
- Tiered rendering with an accessible SVG fallback; no three.js in the initial dashboard bundle.
- Offline shell renders the snapshot illustration; cold-offline 3D is documented as out of scope.
- All gates green: typecheck, lint, unit, build, targeted E2E.
- Benchmark recorded or deferral recorded.
- `Unreleased` changelog entry present; proposed MINOR release prepared; no tag or publication by an agent.

---

## Implementation status (2026-10-29)

| Phase | State |
| --- | --- |
| 0 — plan | Merged to `develop` in PR #295 (`21def62`). |
| 1 — model | Tape-calibrated and built headlessly with Blender 5.2.3 LTS: `feeder-v1.1.0.glb` is **1,147,420 bytes / 37,800 triangles**, with a generated manifest and `docs/feeder/preview-{iso,front,side,rear,top}.png`. Triangles are above the 20k target; the model is under the 2 MB ceiling and has no Draco/Meshopt. Dimensions revision is `tape-2026-10-29`. |
| 2 — viewer | Device detail route, lazy R3F scene, camera presets, live level/status binding, SVG fallback, and a full-viewer/simple-view switch. |
| 3 — data/auth | `getDeviceDetail` resolves org scope first and falls back to the caller's active farm; `/api/devices/[id]/state` is session-authenticated, no-store and scoped by the same query. |
| 4 — surfaces | Controller-card link, admin device-row/card 3D links, `en`/`hil`/`tl` keys, and service-worker v5 caching for `/models/`. |
| 5 — release | Unit/type/lint/build gates pass; **v1.26.0 release prep is included**. Browser E2E and a real FPS benchmark remain deferred. |

The tape measurements resolved the chassis, base plate, hopper, tube, motor and shelf gaps. The only interpretation left to confirm is `B10 = 20` being 20 cm (200 mm) rather than 20 mm; the photos, the 400 mm jar and the 530 mm lid sensor all support 200 mm. The fillable sheet is `docs/feeder-dimensions-form.html`.
