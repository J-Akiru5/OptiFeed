# Mission 2026-10-31 — Hopper diameter calibration (#415)

Requested by Jeff (issue #415): "To make the feeder capacity accurate. Add the actual
diameter to the calibration."

## Problem

The hopper capacity was a manually typed gram figure (`EnergyDevice.hopperCapacityG`).
The operator had to guess how much feed the tank holds, and every downstream number —
grams remaining, days of feed left, the physical daily-cap ceiling — inherited that
guess. The tank diameter is measurable with a ruler, and the full/empty distances were
already calibrated, so the capacity can be computed instead.

## Decision

Capacity is the volume of the cylinder between the two sensor marks times the feed
bulk density:

```
V         = π · (diameter / 2)² · (empty − full)   [cm³]
capacity  = V · bulk density                        [g]
```

- The diameter and density are stored per device (`hopperDiameterCm`,
  `hopperBulkDensityGCm3`), both nullable.
- The density defaults to **0.65 g/cm³**, a typical floating pellet; the operator can
  override it (0.20–1.20 g/cm³) when the feed label says otherwise.
- The server recomputes the capacity on save from the same pure helper the form
  previews (`lib/hopper-capacity.ts`); the client never sends a capacity it computed.
- A device with no diameter keeps its stored `hopperCapacityG`, so every feeder
  calibrated before this change is untouched until an operator measures the tank.
- Assumption: a straight cylinder between the full and empty marks. A strongly
  tapered bottle still keeps the legacy capacity path.

## Built (feature/415-hopper-diameter)

- `lib/hopper-capacity.ts`: `hopperUsableVolumeCm3`, `hopperUsableVolumeL`,
  `hopperCapacityFromGeometry`, the default density and the plausible density range.
- `lib/limits.ts`: the hopper schema accepts `hopperDiameterCm` and
  `hopperBulkDensityGCm3`, validates them, and rejects a geometry whose computed
  capacity exceeds the 50 kg ceiling.
- `lib/actions/energy.ts`: `saveHopperCalibration` derives and stores the capacity,
  keeps the stored one when no diameter is supplied, and records the geometry in the
  `hopper_calibrated` audit row.
- `components/HopperCalibrationForm.tsx`: diameter and density inputs, a live
  capacity summary (grams, litres and the density used), and the legacy stored
  capacity shown until a diameter is entered.
- Migration `20261031130000_add_hopper_diameter_density`: two nullable columns,
  additive only, no data rewrite. Applied by the production release process.
- Backup export lists the two new columns.
- Strings in en, hil and tl; the Tagalog keys are machine drafts in
  `tl.draft-keys.json` for native review.

## Verification

- `lib/__tests__/hopper-capacity.test.ts`: geometry, default and override density,
  null-safe invalid input, density bounds.
- `lib/__tests__/settings-components.test.tsx`: live preview and the payload the form
  sends (geometry, not a capacity).
- `lib/__tests__/server-actions.test.ts`: server-side computation, stored-capacity
  fallback, and the error when neither a diameter nor a capacity exists.
- `i18n-parity` and `settings-i18n`: new keys are present in all catalogues with the
  same placeholders.
