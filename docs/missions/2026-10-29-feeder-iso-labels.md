# Mission 2026-10-29: Feeder ISO component labels

Owner: Jeff. Orchestrator: OpenCode lead.
Branch: `feat/feeder-iso-labels`. Worktree: `S:/Dev/optifeed/feeder-iso-labels`.
Base: `origin/develop` @ `fdfc830`.
App release target: **1.31.0** (MINOR: new labels feature). No model-asset change.

## Objective

Show component labels with live statuses on the feeder 3D viewer, **only while the ISO camera preset is selected**. The ISO preset is the owner-approved front-left angle. Borrow the Solis app's airy composition — floating product, thin leader lines, small uppercase labels over large values, soft pills, orange active state — while keeping PakaonAI navy/orange branding and readable contrast.

## Decisions

- Six live modules: hopper, ultrasonic sensor, controller, motor, auger, outlet. No structural labels.
- Statuses are derived from the one live feeder status + hopper level; they do not imply independent telemetry.
- ISO camera: `[-1.1, 0.45, 1.3]`, target `[0, 0.37, 0.03]`.
- Labels are read-only and must not block orbit.
- Desktop: floating callouts with 1 px leaders and anchor dots. Mobile: compact status list under the canvas, ISO only.
- Keep the PakaonAI dark product stage; do not clone the Solis light theme.
- Labels disappear when Front/Left/Right/Rear/Top is selected, and manual orbit clears them; press ISO to restore the composed view.

## Status mapping

| Component | Offline | Idle | Dispensing | Paused |
| --- | --- | --- | --- | --- |
| Hopper | last known level | live % | live % | live % |
| Ultrasonic sensor | last known / no reading | live / no reading | live / no reading | live / no reading |
| Controller | offline | online | online | paused |
| Motor | offline | idle | running | paused |
| Auger | offline | idle | running | paused |
| Outlet | offline | ready | dispensing | paused |

Tones: green = live/online/running/ready; orange = dispensing; amber = last known/paused; slate = offline/no reading.

## Workstreams

| Wave | Owner | Scope |
| --- | --- | --- |
| 1 | Subagent A | `feeder-parts.ts`: `feederComponentStatus` + ISO camera; unit tests. |
| 1 | Subagent B | `messages/{en,hil,tl}.json`: component/status keys; parity test. |
| 1 | Subagent C | Read-only audit: viewer/state data, anchors, tests, theme, risks. |
| 1 | Subagent D | `docs/feeder-iso-labels-design.md`: Solis/PakaonAI design spec. |
| 2 | Subagent E1 | Pure `feeder-label-layout.ts`: anchors, ISO projection, fixed slots + tests. |
| 2 | Subagent E2 | New `feeder-labels.tsx`: fixed-slot callouts, SVG leaders, mobile status list. |
| 2 | Subagent F | Read-only public-page audit for the model showcase. |
| 3 | Parent | Wire labels into `feeder-viewer.tsx`, stage/pill polish, tests, build. |
| 4 | Parent | PR → CI → `develop` → staging promotion. |

## Acceptance criteria

- ISO shows the six labels with the correct derived statuses; every other preset hides them.
- The ISO camera is the front-left angle and is the default.
- The model remains interactive; labels have `pointer-events: none`.
- Desktop callouts do not overlap the model or each other at 834/1440 px.
- Mobile shows a legible status list under the canvas; no labels floating over a 300 px model.
- Labels are readable in both app themes; status is not conveyed by colour alone.
- Screen readers receive the component statuses outside the canvas.
- `pnpm lint`, `pnpm typecheck`, focused Vitest, `pnpm build` pass; CI is green.
- No schema, migration, dependency, model-asset or service-worker cache change.

## Model correction

The post top is **615 mm** (105 mm above the 510 mm hopper/lid top), not the earlier 750 mm. Model asset **1.1.2**, service-worker cache **v8**, previews regenerated.

## Verification record

- i18n parity: **6/6 passed** (subagent B).
- Component status: **14/14 passed** (subagent A).
- Pending: labels component, parent integration, full gates, visual QA.

## Public showcase

The public landing hardware section now shows the model as a lazy 4:3 transparent ISO
poster (`apps/web/public/landing/feeder-stage.webp`, 20.9 kB) rendered from model `1.1.2`,
with the six-row parts table below and a research-prototype caption. No 3D runtime, device
polling or live telemetry is added to the public page; the labels are the in-app feature.
