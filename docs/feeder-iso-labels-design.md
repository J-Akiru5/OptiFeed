# Feeder ISO Labels — Design Spec

**Status:** Proposed · **Branch:** `feat/feeder-iso-labels` · **Base:** `origin/develop` @ `fdfc830`
**Scope:** Six read-only component labels over the 3D feeder stage, ISO camera only · **Owner:** Jeff

## 1. Design intent

These labels borrow Solis's product-stage feel: an airy stage, thin 1px leaders, small anchor dots, value-first typography and one soft orange active pill on the selected camera preset. They keep PakaonAI's navy-and-orange brand, Inter typography, uppercase micro-labels and heavy tabular values, so the card reads as our device screen rather than a Solis screenshot. The stage stays `#0B2336` in both app themes; only the surrounding card chrome follows the theme. Labels are read-only annotations, never controls: they do not intercept orbit, hover, focus or selection. The Iso preset locks rotate and zoom so the callouts cannot drift; every other preset allows orbit and zoom and shows no labels.

Primary direction: **one dark stage in both themes.** The contained light stage in §2 is a future option only; it is not a theme flip and must not become the default.

## 2. Tokens

### 2.1 Colour

| Token | Dark stage (primary, both themes) | Contained light stage (optional) | Use |
| --- | --- | --- | --- |
| `--iso-stage` | `#0B2336` | `#F1F6F4` | Stage base |
| `--iso-stage-glow` | `#103049` → `#081B29` | `#F7FAF9` → `#E7EFEC` | Top/bottom gradient |
| `--iso-value` | `#FFFFFF` | `#0A2E47` | Large value (16.06 / 12.86) |
| `--iso-name` | `#A9C1D3` | `#38566B` | Component name (8.61 / 7.09) |
| `--iso-muted` | `#9BAEC0` | `#526B7E` | Offline / no reading (7.04 / 5.11) |
| `--iso-leader` | `rgba(255,255,255,0.45)` → `#798690` | `#6B8294` | 1px leader (4.30 / 3.67, non-text) |
| `--iso-anchor` | `#FF8A5C` | `#C2410C` | Anchor dot (6.91 / 4.74) |
| `--iso-live` | `#4ADE80` | `#16794A` | Live / online / idle / running / ready (9.21 / 4.97) |
| `--iso-active` | `#FF9A70` | `#B3470F` | Dispensing / material flow (7.73 / 5.03) |
| `--iso-paused` | `#FBBF24` | `#8A5A00` | Paused / last known (9.62 / 5.43) |
| `--iso-offline` | `#9BAEC0` | `#5A6B78` | Offline / no reading (7.04 / 5.05) |
| `--iso-pill-bg` | `#FF9A70` | `#C2410C` | Active preset pill |
| `--iso-pill-ink` | `#071A2A` | `#FFFFFF` | Pill text (8.49 / 5.18) |

Never put white on `#E85A2A` (3.54:1), `#FF6B35` (2.84:1) or `#FF9A70` (2.08:1) for label-size text. The dark-stage pill uses navy ink on soft orange; white is allowed only on the darker `#C2410C` light-stage pill.

The light column is a **contained stage** only: `#F1F6F4` inside the normal app page, keeping the existing card border/shadow. It is not a Solis light clone and is not recommended for v1.

### 2.2 Type and spacing

| Role | Desktop ≥1024 | Tablet 768–1023 | Mobile <768 |
| --- | --- | --- | --- |
| Name | 10px / 1.2 / 800 / `0.16em` / uppercase | 10px / 1.2 / 800 / `0.16em` | 8px / 1.2 / 800 / `0.1em` |
| Value | 26px / 1.05 / 800 / `-0.02em` / tabular | 22px / 1.05 / 800 / `-0.02em` | 15px / 1.05 / 800 / tabular |
| Status | 10.5px / 1.2 / 700 / `0.02em` | 10px / 1.2 / 700 / `0.02em` | 9px / 1.2 / 700 / `0.02em` |
| Active pill | 10px / 1 / 800 / `0.12em` / uppercase | same | same |
| Active pill | 10px / 1 / 800 / `0.12em` / uppercase | same | n/a |

Font: existing `var(--font-sans)` (Inter). No new typeface. Safe inset 16px desktop, 12px tablet, 8px mobile. Label max width 168px desktop, 144px tablet, `min(96px, 28%)` mobile. Internal spacing: name→value 2px, value→status 4px, dot→word 6px, same-column gap ≥12px, leader origin 6px outside the text. Radii: pill 999px, optional scrim 8px, stage keeps 24px, dot 50%. Leader 1px at 45% white with a 1px `#061520` under-stroke at 50%; anchor 5px core (4px mobile) with a 1px `#061520` ring at 60%. Text shadow only: `0 1px 2px rgba(3,12,20,0.55)`; no box-shadow or halo on labels. The active pill may carry `0 4px 16px rgba(255,154,112,0.28)`.

### 2.3 CSS token example

```css
.ofd-iso-stage {
  --iso-stage: #0b2336; --iso-value: #ffffff; --iso-name: #a9c1d3;
  --iso-muted: #9baec0; --iso-live: #4ade80; --iso-active: #ff9a70;
  --iso-paused: #fbbf24; --iso-offline: #9baec0; --iso-anchor: #ff8a5c;
  --iso-leader: rgba(255, 255, 255, 0.45); --iso-pill-bg: #ff9a70; --iso-pill-ink: #071a2a;
  background: radial-gradient(120% 90% at 50% 0%, #103049 0%, #0b2336 55%, #081b29 100%);
}
.ofd-iso-label, .ofd-iso-leaders { pointer-events: none; user-select: none; }
.ofd-iso-label__name { font-size: 10px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; color: var(--iso-name); }
.ofd-iso-label__value { font-size: 26px; font-weight: 800; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; color: var(--iso-value); }
```

Both app themes use this block unchanged. A `.dark` override is unnecessary and would fork the stage.

## 3. Status model

One live feeder status plus the hopper level drives all six labels. No module has independent telemetry, timestamps or alert thresholds. Source: `idle | dispensing | paused | offline`; `paused` is still online. Level: `number | null`, clamped 0–100.

| Module | Default / idle | Dispensing | Paused | Offline | Level null |
| --- | --- | --- | --- | --- | --- |
| Hopper | `30%` Live green | `30%` Live green | `30%` Live green | `30%` Last known amber, or `—` No reading gray | `—` No reading gray |
| Ultrasonic sensor | `Reading` Live green | `Reading` Live green | `Reading` Live green | `Reading` Last known amber, or `—` No reading gray | `—` No reading gray |
| Controller | `Online` Live green | `Online` Live green | `—` Paused amber | `—` Offline gray | n/a |
| Motor | `Idle` Live green | `Running` Live green | `—` Paused amber | `—` Offline gray | n/a |
| Auger | `Idle` Live green | `Running` Live green | `—` Paused amber | `—` Offline gray | n/a |
| Outlet | `Ready` Live green | `Dispensing` Live orange | `—` Paused amber | `—` Offline gray | n/a |

Rules:

1. The large value is the most useful fact: a percentage where one exists, otherwise the module state. When a state-only module is paused or offline, or when the level is missing, the value is `—` and the status word carries the reason, so a label never prints the same word twice.
2. Only `Live`, `Last known`, `No reading`, `Paused`, `Offline` are status words. `Online`, `Idle`, `Running`, `Dispensing`, `Ready` are values.
3. Colour is supplementary; the status word is always present and the dot only reinforces tone. No red critical tone in this feature; a low-hopper alarm needs a separate decision.
4. Hopper "last known" uses the existing stale/offline rule. If `feedLevelUpdatedAt` exists, put the age in the accessible summary, not the visual label.

Tone: green = healthy and current, including running components; orange = active material flow (outlet dispensing); amber = intentionally stopped or stale; gray = no contact or no data.

## 4. Label anatomy

```
   HOPPER                        ← 10px / 800 / 0.16em / #A9C1D3
   30%                           ← 26px / 800 / tabular / #FFFFFF
   ● Live                        ← 5px dot + 10.5px status / #4ADE80
          ╲
           ╲  1px leader, 45% white + 1px dark under-stroke
            ●  anchor dot, 5px #FF8A5C with a 1px #061520 ring
```

- No background box, border or glass card; the stage is the surface.
- The leader leaves the label edge 6px from the text, runs straight to the dot, and has no elbows, curves or arrowheads.
- The dot sits on the model at the module anchor; the label is placed so its text never overlaps the product silhouette.
- The active camera preset is the only pill this feature adds: `#FF9A70` fill, `#071A2A` text, 999px radius. It replaces the current white active preset.
- No icons: six text-led labels, so icons would compete with the value. Visible names are HOPPER, SENSOR, CONTROLLER, MOTOR, AUGER, OUTLET; the accessible summary expands SENSOR to "Ultrasonic sensor".

## 5. ISO position map

ISO camera `[-1.1, 0.45, 1.3]`, target `[0, 0.31, 0.03]`, fov 34. Front-left, so the outlet (front-right) projects right and low and the motor (rear-left) projects left and low. The projected percentages are for a 16:9 stage and are art direction, not fixed coordinates: project the real anchors at runtime and keep the slot sides.

| Module | Anchor (x, y, z) | Projected (x%, y%) | Slot | Leader |
| --- | --- | --- | --- | --- |
| Hopper | `-0.0825, 0.34, 0.1275` | 50, 54 | Left, top 40% | Right edge → down-right |
| Ultrasonic sensor | `-0.0825, 0.522, 0.17` | 52, 35 | Top-left, top 12% | Right edge → down-right |
| Controller | `0.09, 0.17, 0.232` | 62, 70 | Right, top 46% | Left edge → down-left |
| Motor | `-0.114, 0.05, -0.25` | 38, 78 | Left, top 60% | Right edge → down-right |
| Auger | `-0.083, 0.079, 0.28` | 48, 83 | Bottom-left, top 80% | Top edge → right |
| Outlet | `-0.083, 0.05, 0.392` | 60, 93 | Right, top 74% | Left/bottom edge → down-left |

Anchors come from the model and may be tuned a few millimetres after visual QA. Only these six modules; post, shelf, plank, chassis and base plate are never labelled. Keep the stage glow behind the model: labels sit on the darker edge field where the §8.1 pairs hold. If a glow reaches a label, move the label outward before changing its colour.

Placement rules:

1. Central exclusion zone: x 30–70%, y 28–90%. No label text may enter it; leaders may cross it. This keeps the hopper clear.
2. Every label stays 16px inside the stage (12px tablet). Clamp, never clip.
3. Same column: ≥12px between boxes. On collision, move the lower label down, never inward over the model.
4. Leader slope −10° to 45° from horizontal; a steeper line means the label is misplaced vertically. Longest leader 55% of stage width.
5. A leader may cross the model and at most one other leader; it must not cross a label or another dot. If anchors project within 20px, keep both dots and add a 1px stage-coloured ring between them.
6. On portrait tablets (768–900), reduce width to 144px and value to 22px before changing slot sides.

For this view: sensor top-left, hopper left-upper, motor left-lower, auger bottom-left, controller right, outlet right-lower. No label sits top-right; that stays empty air.

## 6. Desktop vs mobile

| Width | Layout | Stage | Notes |
| --- | --- | --- | --- |
| ≥1024 | Six callouts + 1px leaders + dots | 440px | 26px values |
| 768–1023 | Six callouts, tighter | 400px | 22px values, 144px max width |
| <768 | Six compact callouts + 1px leaders + dots | 300px | 15px values, card width capped at `min(96px, 28%)` |

The same six anchors, fixed slots, dots and leader directions are used at every width. Mobile
does not swap to a list: the callouts stay inside an 8px inset and the card width is capped at
28% of the stage so the model stays visible at 320–430px. The left column is sensor, hopper,
motor and auger; the right column is controller and outlet. Leaders are measured from the real
card boxes, so a locale or status change cannot detach a line from its label.

- A visually hidden `<dl>` carries the same six readings for screen readers at every width. It
  is referenced by the canvas wrapper's `aria-describedby`; the visual callouts are
  `aria-hidden="true"` to avoid duplicate, out-of-order announcements.
- Label mode is bound to the ISO preset. Iso disables orbit and zoom, so the composition is
  persistent; choosing Front/Left/Right/Rear/Top hides the callouts and enables orbit/zoom.
  Never reflow labels during a drag or let them float over an arbitrary angle.
- The viewer's bottom hint states that labels appear only in the Isometric view and that Iso is
  locked. It is the only place that explains the rule; no duplicate tip lives inside the card.
- At 200% zoom on 1440px the effective width drops below 768px, so the compact callout sizes
  apply automatically. Do not build a separate zoom layout.

## 7. Motion

- Entering ISO: labels fade `0 → 1` and scale `0.98 → 1` once, 240ms, `cubic-bezier(0.22, 1, 0.36, 1)`.
- Stagger 35ms in visual top-to-bottom order (sensor, hopper, controller, motor, auger, outlet); total under 450ms. Leaders fade at 60ms delay, 180ms; no line drawing.
- Leaving ISO removes labels immediately; no exit animation that delays orbit.
- No continuous animation: no pulsing dots, floating labels, scanning lines, auto-rotate or shimmer. Status updates swap text and dot colour without motion.
- `prefers-reduced-motion: reduce` removes all animation and stagger, including the preset-chip transition; the final state renders instantly.

```css
@keyframes iso-label-in {
  from { opacity: 0; transform: translateY(4px) scale(0.98); }
  to   { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: no-preference) {
  .ofd-iso-label { animation: iso-label-in 240ms cubic-bezier(0.22, 1, 0.36, 1) both; }
}
```

## 8. Accessibility

### 8.1 Contrast (WCAG AA)

| Pair | Ratio |
| --- | --- |
| `#FFFFFF` value on `#0B2336` | 16.06:1 |
| `#A9C1D3` name on `#0B2336` | 8.61:1 |
| `#9BAEC0` muted on `#0B2336` | 7.04:1 |
| `#4ADE80` live on `#0B2336` | 9.21:1 |
| `#FF9A70` active on `#0B2336` | 7.73:1 |
| `#FBBF24` paused on `#0B2336` | 9.62:1 |
| `#071A2A` on `#FF9A70` pill | 8.49:1 |
| `#798690` leader on `#0B2336` | 4.30:1 (non-text) |
| `#FF8A5C` anchor on `#0B2336` | 6.91:1 (non-text) |
| `#0A2E47` value on `#F1F6F4` | 12.86:1 |
| `#38566B` name on `#F1F6F4` | 7.09:1 |
| `#526B7E` muted on `#F1F6F4` | 5.11:1 |
| Light statuses on `#F1F6F4`: live `#16794A`, active `#B3470F`, paused `#8A5A00`, offline `#5A6B78` | 4.97 / 5.03 / 5.43 / 5.05 |
| `#FFFFFF` on `#C2410C` pill | 5.18:1 |

Leader contrast is measured on the stage as a non-text graphic. Over the white chassis the dark under-stroke provides the edge; never rely on the white line alone there. Dark ratios use `#0B2336`; labels sit on the darker edge field, so those values are a conservative floor.

### 8.2 Semantics and behaviour

- Not colour-only: every dot has a status word. `—` plus `Paused`/`Offline`/`No reading` carries the state without colour.
- Every width: one visually hidden `<dl>` summary referenced by the canvas wrapper's `aria-describedby`, e.g. "Feeder components: Hopper 30 percent, live. Ultrasonic sensor: reading, live. Controller online. Motor idle. Auger idle. Outlet ready." Visual callouts are `aria-hidden="true"` to avoid duplicate, out-of-order announcements.
- Mobile uses the same hidden summary; the compact callouts are visual only and are not duplicated in the accessibility tree.
- Reuse the viewer's existing polite live region for overall status. Do not add six live regions; component changes are not announced individually.
- Labels, leaders and dots are not focusable: no `tabindex`, `role="button"`, `aria-pressed`, hover or focus styles. The overlay is `pointer-events: none` and `user-select: none`, including the SVG leader layer, so orbit drags pass through.
- Decorative SVG leaders and dots are `aria-hidden="true"`. Forced colours: text uses `CanvasText`, dots get a `CanvasText` border, and status words still carry meaning if leaders disappear. No motion is required to understand the labels.

## 9. Acceptance criteria

**ISO trigger**

- [ ] Labels render only when `preset === "iso"`; no other preset shows labels, leaders, dots or callouts.
- [ ] ISO uses `[-1.1, 0.45, 1.3]` with target `[0, 0.31, 0.03]`; Iso disables rotate and zoom, so the six labels stay perfectly placed. Switching to another preset hides the overlay and enables orbit/zoom.
- [ ] Only Hopper, Ultrasonic sensor, Controller, Motor, Auger and Outlet are labelled. Post, shelf, plank, chassis and base plate are never labelled.

**Status derivation**

- [ ] All six labels match the §3 matrix for idle, dispensing, paused and offline; `paused` keeps hopper/sensor live.
- [ ] Null level shows `—` and `No reading`; offline with a level shows `Last known`.
- [ ] No label invents a metric, timestamp, alert or independent connection state.

**Desktop and tablet (834, 1440)**

- [ ] At 1440×900 and 834×1112, every label is 16px inside the stage with no clipping.
- [ ] No label text enters x 30–70%, y 28–90%; the hopper is never covered.
- [ ] Same-column gap ≥12px; no label overlaps another label or dot. Leaders are 1px, end within 2px of their dot, and do not cross a label.
- [ ] No background, border or box-shadow on labels; the only new pill is the active preset.
- [ ] Orbit works when dragging across a label, leader or dot; text is not selectable while dragging.

**Mobile (390, 320)**

- [ ] At 390 × 844 the six compact callouts, leaders and dots render over the stage; no list replaces them.
- [ ] Card width is capped at `min(96px, 28%)`; at 320px the labels stay inside the 8px inset and do not cover the hopper jar.
- [ ] Names are 8px uppercase, values 15px, status 9px with a dot; no horizontal scroll at 320–430px.
- [ ] Leaders are measured from the real card boxes and point at the same six anchors as desktop; the tip below the viewer explains that labels appear only in the Isometric view.
- [ ] At 200% zoom the compact layout still applies, not overlapping callouts.

**Motion, themes, accessibility**

- [ ] Labels fade/scale in once, total stagger under 450ms, and never animate continuously; reduced motion renders instantly.
- [ ] Both app themes show the same `#0B2336` stage; the card border/shadow follow the theme only.
- [ ] All §8.1 pairs pass at runtime, including the preset pill; no white on `#E85A2A`, `#FF6B35` or `#FF9A70`.
- [ ] Every width exposes one status summary via `aria-describedby`; the visual callouts are `aria-hidden`. No label is focusable or tappable, and forced-colours mode keeps text and dots distinguishable.
- [ ] Dark and light app themes are screenshotted at 390, 834 and 1440 for visual QA.

## 10. Anti-patterns

1. **Heavy cards or a box around every label.** No glass, borders, drop shadows or blur; six boxes turn airy annotations into a dashboard.
2. **Labels over the hopper.** The clear jar is the product; covering it with text destroys the stage. Use the exclusion zone.
3. **Independent telemetry.** Do not show sensor distance, controller temperature, motor RPM or per-part connectivity the API does not have.
4. **Light Solis clone.** No white stage, orange header band, generic green accent or copied Solis typography. Navy, orange, Inter and our micro-labels stay.
5. **Motion as status.** No pulsing live dots, scanning lines, floating labels or animated leaders.
6. **Interactive-looking labels.** No hover lift, pointer cursor, focus ring, tab stop or click handler.
7. **Colour as the only cue.** Never drop the status word; never use a red dot without words.
8. **Leader spaghetti.** No crossing labels, lines through other dots, or elbow routing that hides a placement problem.
9. **More than six labels.** Structural parts stay unlabelled; this is not an exploded parts list.
10. **Tiny type or white on orange.** Nothing below 10px desktop; mobile keeps 8px names, 15px values and 9px status words. White on orange fails AA (3.54:1 on `#E85A2A`, 2.08:1 on `#FF9A70`).

## Open design questions

1. **Sensor value.** `Reading` is used because the API exposes no distance. If distance is added later, show it as the value and keep the status word. Confirm for v1.
2. **ISO preset change.** The front-left vector replaces the existing front-right `CAMERA_PRESETS.iso`, changing the default view on every viewer surface, not just this feature. Confirm that global change.
3. **Low hopper.** A level at or below 30% still shows green `Live` because amber is reserved for paused/last known. A low-level warning needs a new tone and word, not an amber percentage.
