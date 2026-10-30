# Mission 2026-10-29: Feeder ISO component labels

Owner: Jeff. Orchestrator: OpenCode lead.
Branch: `feat/feeder-iso-labels`. Worktree: `S:/Dev/optifeed/feeder-iso-labels`.
Base: `origin/develop` @ `fdfc830`.
App release target: **1.31.0** (MINOR: new labels feature). Fix follow-up: **1.31.3** (PATCH: locked Iso, mobile callouts, bottom tip; 1.31.1 and 1.31.2 were already released from develop). No model-asset change.

## Objective

Show component labels with live statuses on the feeder 3D viewer, **only while the ISO camera preset is selected**. The ISO preset is the owner-approved front-left angle. Borrow the Solis app's airy composition — floating product, thin leader lines, small uppercase labels over large values, soft pills, orange active state — while keeping PakaonAI navy/orange branding and readable contrast.

## Decisions

- Six live modules: hopper, ultrasonic sensor, controller, motor, auger, outlet. No structural labels.
- Statuses are derived from the one live feeder status + hopper level; they do not imply independent telemetry.
- ISO camera: `[-1.1, 0.45, 1.3]`, target `[0, 0.31, 0.03]`. Iso locks rotate and zoom so the labels stay placed.
- Labels are read-only. Iso locks orbit/zoom; the other presets hide the labels and allow orbit/zoom.
- Both widths: floating callouts with 1 px leaders and anchor dots. Mobile uses compact 8/15/9 px type and caps cards at `min(96px, 28%)` instead of a list.
- Keep the PakaonAI dark product stage; do not clone the Solis light theme.
- Labels appear only in Iso. Choosing Front/Left/Right/Rear/Top hides them and enables orbit/zoom; pressing Iso restores the locked composition. A bottom hint explains the rule.

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
- The model allows orbit/zoom in every preset except Iso; labels have `pointer-events: none`.
- Desktop callouts do not overlap the model or each other at 834/1440 px.
- Mobile shows the same six callouts, dots and leaders in compact type; at 320-430 px they stay inside the stage and off the hopper.
- Labels are readable in both app themes; status is not conveyed by colour alone.
- Screen readers receive the component statuses outside the canvas.
- `pnpm lint`, `pnpm typecheck`, focused Vitest, `pnpm build` pass; CI is green.
- No schema, migration, dependency, model-asset or service-worker cache change.

## Latest fix: locked ISO and mobile callouts

The owner rejected the first cut because labels vanished as soon as the model was orbited and
because mobile replaced the callouts with a list. The current behavior is:

- Iso locks `enableRotate`/`enableZoom`; labels cannot drift. Other presets allow orbit/zoom and
  show no labels.
- Mobile renders the same six anchors, dots and leaders as desktop. Cards cap at `min(96px, 28%)`
  with 8/15/9 px type so the 300 px stage stays legible.
- The 2 x 3 list is now `sr-only` at every width and remains the `aria-describedby` summary.
- The bottom hint (`isoLabelsTip`) states that labels appear only in the Isometric view.

## Model correction

The post top is **615 mm** (105 mm above the 510 mm hopper/lid top), not the earlier 750 mm. Model asset **1.1.2**, service-worker cache **v8**, previews regenerated.

## Verification record

- i18n parity: **6/6 passed** (subagent B).
- Component status: **14/14 passed** (subagent A).
- Locked-ISO fix: focused suite **35/35** (labels 5, layout 10, parts 14, i18n 6).
- Local browser QA at **356 × 300** and **958 × 440**: six cards, six anchor dots and twelve leader strokes; an Iso drag produced an identical frame; a Front drag orbited and kept the labels hidden; Iso restored all six.
- Full gates: lint, typecheck, build and **282 files / 3,357 tests** passed; CI pending.

## Public showcase

The public landing hardware section now shows the model as a lazy 4:3 transparent ISO
poster (`apps/web/public/landing/feeder-stage.webp`, 20.9 kB) rendered from model `1.1.2`,
with the six-row parts table below and a research-prototype caption. No 3D runtime, device
polling or live telemetry is added to the public page; the labels are the in-app feature.
