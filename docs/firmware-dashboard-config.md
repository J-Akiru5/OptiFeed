# Firmware 1.7.0 — dashboard-driven device configuration (I-100)

Status: implemented in `mission/I-100-firmware-dashboard-config` (branch from
`develop` v1.34.0). **Not flashed.** A reflash needs Jeff's explicit yes.

Governing decisions: E38 (the daily ceiling is the only gram cap), E35 (Wi-Fi
RSSI is stored), E36 (alerts follow the platform connectivity policy), I-95
(`PlatformSetting` `device.status`), I-100 (this task).

## Why

Every feeding, safe-mode, hopper, button, poll, OTA and calibration value used
to be a `#define`. Changing any of them needed a reflash, which is impossible
for a unit in the field. Firmware 1.7.0 takes a versioned `config` object from
the poll response the device already makes every ~5 s, validates it against an
absolute safety envelope, applies it all-or-nothing, keeps the last-good copy in
NVS and echoes the revision so the server can confirm the change.

The fleet is a mixture: units that still run 1.6.x keep the flat response
fields and ignore `config`; a 1.7.0 unit against an old server gets no `config`
and keeps the compile-time defaults. Neither direction breaks.

## Contract

`GET /api/feed-command?device_id=<mac>` (the existing device-authenticated poll;
the device auth contract is unchanged: `X-Device-Token` + `device_id ===
EnergyDevice.mac`) adds one object:

```json
"config": {
  "version": 1,
  "rev": 1543210987,
  "min_dispense_gap_s": 10,
  "max_dispenses_per_hour": 6,
  "max_grams_per_day": 2000,
  "max_dispense_ms": 300000,
  "calibration_max_grams": 5000,
  "calibration_max_dispense_ms": 600000,
  "brownout_hold_s": 60,
  "safe_mode_abnormal_window_s": 600,
  "safe_mode_abnormal_threshold": 3,
  "safe_mode_quiet_s": 1800,
  "safe_mode_healthy_clear_s": 600,
  "motor_min_pulse_ms": 250,
  "grams_per_feeding": 150,
  "button_feed_grams": 80,
  "grams_per_second": 4,
  "temp_offset_c": 0,
  "hopper_full_cm": 5,
  "hopper_empty_cm": 30,
  "hopper_low_pct": 20,
  "hopper_refill_margin_pct": 10,
  "hopper_reject_below_cm": 2,
  "hopper_reject_above_margin_cm": 10,
  "hopper_ema_alpha": 0.35,
  "hopper_jump_pct": 15,
  "hopper_persist_cycles": 3,
  "hopper_state_hold_s": 600,
  "button_debounce_ms": 250,
  "button_startup_grace_ms": 5000,
  "button_quiet_after_dispense_ms": 2000,
  "button_cooldown_ms": 30000,
  "button_log_interval_ms": 10000,
  "button_noise_window_ms": 60000,
  "button_noise_max": 5,
  "button_disable_ms": 600000,
  "heartbeat_interval_s": 5,
  "weak_after_min": 4,
  "offline_after_min": 5,
  "ota_check_interval_s": 1800,
  "ota_min_uptime_s": 600,
  "ota_min_rssi_dbm": -75,
  "ota_feed_guard_min": 20,
  "ota_window_start_min": 600,
  "ota_window_end_min": 900,
  "ota_min_free_heap_bytes": 60000,
  "ota_no_data_timeout_ms": 60000,
  "ota_download_timeout_ms": 900000,
  "ota_health_check_timeout_ms": 300000
}
```

The authoritative tables are `firmware/firmware-main/config.h` (device side) and
`apps/web/lib/firmware/config.ts` (server side). A vitest contract test parses
the header and fails on any drift in key, envelope, integer flag or default.

### Envelope (class A)

The `min`/`max` in the table is the outer bound a dashboard value can never
leave. In particular:

| Guard | Bound |
|---|---|
| relay on-time | `max_dispense_ms` ≤ 300,000 ms (5 min), ≥ 5,000 ms |
| calibration | ≤ 5,000 g and ≤ 600,000 ms (10 min) |
| daily hard guard | `max_grams_per_day` ≤ 5,000 g |
| minimum dose gap | ≥ 10 s |
| doses per rolling hour | ≤ 6 |
| safe-mode threshold | 2–10 abnormal resets in the 60 s–24 h window |
| post-brownout hold | ≥ 10 s (it can be lengthened, never disabled) |
| OTA near-feed guard | ≥ 5 min either side of a scheduled feed (never disabled) |
| relay overrun trip | 2,000 ms, compile-time, never configurable |
| motor minimum pulse | `motor_min_pulse_ms` 50–2,000 ms (a shorter dose is refused, never rounded up) |
| pins, NVS namespace `optifeed`, TLS roots, OTA public keys | compile-time |

A per-field bound is not the only check: `hopper_full_cm < hopper_empty_cm` and
`ota_window_start_min < ota_window_end_min` are validated too, because an
inverted pair would silently break a guard.

### Fallback rules

| Situation | Behaviour |
|---|---|
| No `config` object | keep the last-good copy (an old server) |
| `version` != 1 | ignore the object (`unsupported`), keep last-good |
| `rev` missing | ignore the object (`malformed`) |
| Field of the wrong type, NaN/Infinity, fractional whole number | ignore the whole object (`malformed`) |
| Any field out of its envelope, or an impossible pair | ignore the whole object (`out_of_range`) |
| A field absent from the object | keep the last-good value for that field |
| First boot, no NVS copy | compile-time defaults |

Nothing is ever clamped on the device. A bad config can never raise a bound,
shorten the gap or disable a guard; the server also clamps when it builds the
object, so the two sides agree on the same envelope. The motor floor follows the
same rule: a stored or served `0` is outside its envelope, so it rejects the
object and the default `250 ms` (never "no floor") stays in force.

### Last-good storage

Namespace `optifeed`, **new keys only**:

| Key | Content |
|---|---|
| `cfg_json` | the 47 operational fields as JSON (no `version`/`rev`) |
| `cfg_rev` | the `rev` last applied |

`cal_gps` and every existing key are untouched. A corrupt or hand-edited blob
falls back to the defaults; one bad field rejects the whole blob.

### Acknowledgement

The firmware echoes `config_rev` on every heartbeat. The ingest route accepts it
(`heartbeat.config_rev`, an optional non-negative integer; a malformed value is
dropped rather than failing the heartbeat) and writes one `DeviceStateEvent`
(`eventType: "config_applied"`, `metadata.configRev`) when the revision changes.
The lookup runs only on a heartbeat that is already being written (changed or
due), so it adds one query per device per few minutes, not per beat. No schema
change.

## Server mapping (where each value comes from)

| Config values | Source |
|---|---|
| `max_grams_per_day` | `resolveDailyCapG({ EnergyDevice.dailyCapG, hopperCapacityG, dailyCapFactor })` — the same single daily-cap calculation as the dashboard |
| `max_dispense_ms` | `PlatformSetting` `feeding.limits.maxDispenseMs` (reader clamps to 300,000) |
| `grams_per_feeding`, `button_feed_grams`, `grams_per_second`, `temp_offset_c` | `EnergyDevice` columns |
| `hopper_full_cm`, `hopper_empty_cm` | `EnergyDevice` columns (null → default geometry) |
| `min_dispense_gap_s`, `max_dispenses_per_hour`, `brownout_hold_s`, `safe_mode_*`, `motor_min_pulse_ms` | `PlatformSetting` `firmware.gates`, edited in Superadmin → Settings → Firmware safety gates |
| `ota_check_interval_s`, `ota_min_uptime_s`, `ota_min_rssi_dbm`, `ota_feed_guard_min`, `ota_window_start_min`, `ota_window_end_min`, `ota_min_free_heap_bytes`, `ota_no_data_timeout_ms`, `ota_download_timeout_ms`, `ota_health_check_timeout_ms` | `PlatformSetting` `firmware.gates` (same row as the gates), edited in Superadmin → Settings → OTA rollout policy (#660) |
| `weak_after_min`, `offline_after_min` | `PlatformSetting` `device.status` (I-95), diagnostics only: the server still classifies connectivity and E36 keeps alerts on the platform policy |
| `hopper_low_pct` | `OrgSetting.hopperLowPct` — device pond → pond owner (farm) → active organization → row (the same chain ingest alerts use). Cached per device for 60 s; a missing/unreadable org returns 20 % |
| `hopper_refill_margin_pct`, `hopper_reject_below_cm`, `hopper_reject_above_margin_cm`, `hopper_ema_alpha`, `hopper_jump_pct`, `hopper_persist_cycles`, `hopper_state_hold_s` | `EnergyDevice` columns (#659): the per-device hopper filter tuning, edited in Device settings -> Calibration. A null column sends nothing, so the firmware keeps its compile-time value; see "Farmer device settings: the hopper filter and the raw distance" below |
| Calibration ceiling, button guard, heartbeat interval | `firmware.gates` defaults (server-driven; stored and sent so a future UI or setting can move them without a reflash) |

No schema change was required for I-100: `PlatformSetting` is the existing
key/value JSON store, so no item needed an additive migration. The hopper
filter (#659) is the one later exception and is recorded below.

### Organization hopper threshold (#456)

`OrgSetting.hopperLowPct` (bounds 5–50 %, schema default 20) is set per
organization in Settings, and the ingest low-hopper alert already reads it. The
poll now sends the same value as `hopper_low_pct` so the unit's local hopper
filter warns at the organization's threshold instead of the compile-time 20 %.

- **Resolution**: `EnergyDevice.pondId` → `Pond.ownerId` (farm slug) →
  `getOrgSettingsForFarm` → `settings.hopperLowPct`. Only the farm slug is
  selected; no token or auth column is read.
- **Cache**: per device, `ORG_HOPPER_CACHE_TTL_MS` = 60 s, bounded by
  `ORG_HOPPER_CACHE_MAX_ENTRIES` (least recently used evicted). A 5 s poll
  therefore runs the org chain about once a minute, not on every request. A
  threshold change reaches a unit within about a minute.
- **Fallbacks**: no pond / no device owner / no org → 20 % (schema default). A
  failed read or a malformed value → 20 % plus one warning. The helper never
  throws, because a throw would hit the route's catch, which drops the whole
  `config` object and leaves every 1.7.0 unit unanswered.
- **Envelope**: the org row is 5–50, inside the firmware's 1–90; the server
  still clamps through `normalizeFirmwareValues`, and 1.6.x firmware ignores the
  field entirely.

## Superadmin UI

Superadmin → Settings → **Firmware safety gates**: eight number inputs generated
from the field table (the seven gates plus the motor minimum pulse), inline
min/max validation, a required reason of at least 10 characters, and one
`PlatformAuditLog` row (`platform.settings.firmware_gates`) in the
same transaction as the `PlatformSetting` upsert, carrying the before/after
values. Non-gate values already stored (OTA, calibration, button guard,
heartbeat) are preserved on save.

Superadmin → Settings → **OTA rollout policy** (#660): the ten `ota_*` keys that
previously had no surface, generated from `FIRMWARE_OTA_FIELDS` (a `surface: "ota"`
marker on the same field table). They write through `setFirmwareOtaPolicy`, which
merges into the same `firmware.gates` row, refuses any id outside the ten, refuses
`ota_window_start_min >= ota_window_end_min` instead of letting
`normalizeFirmwareValues` repair it to the defaults, and writes one
`PlatformAuditLog` row (`platform.settings.firmware_ota_policy`) with the
before/after values in the same transaction.

The same section renders what the fleet reports back. Firmware 1.7.0+ echoes one
`config_rev` for the whole config plus `config_source` (`server` / `nvs` /
`default`); ingest already records `config_applied` when that revision changes.
`getOtaPolicyStatus` compares the newest `config_applied` row per device with the
newest `platform.settings.firmware_ota_policy` audit row, so a unit that has not
echoed a config since the last change is shown as **pending** and a unit with no
`config_applied` row at all as **never reported**. Per-key device values are not
available: the firmware reports one revision, never the individual numbers, and
the card says so rather than inventing a second config store.

## Farmer device settings: the physical button dose (#658)

Device settings → **Feeding** (dashboard → Settings → Hardware) carries
**Button feed amount** beside the daily ceiling. It writes
`EnergyDevice.buttonFeedGrams` through `updateDeviceButtonFeed` (the existing
settings server action; no new route or table), with the revocable
`control_feeder` permission, a `button_feed_changed` `DeviceStateEvent` in the
same transaction as the update, and a page revalidation so the reported block
re-reads immediately.

The input is bound to the firmware's own `button_feed_grams` envelope
(`firmware/firmware-main/config.h`: 1-500 g). `BUTTON_FEED_GRAMS_MIN/MAX` in
`lib/limits.ts` carry the same numbers, `buttonFeedGramsSchema` refuses outside
it, and a unit test parses the header so the two cannot drift.

A saved value is not proof the unit took it: the device keeps its last-good
config when it refuses a config object and an offline unit never polls. The
firmware reports one `config_rev`, never per-key values, so the only device-side
evidence of the dose actually used is the `feed_dispensed` event a button press
produces. The card compares the newest button-sourced `FeedEvent` with the newest
`button_feed_changed` row: a later press that dispensed the stored dose is
**confirmed**; a press before the change or one that dispensed another weight is
**not confirmed**; no press at all is reported as no press rather than success. A
failed read is shown as unavailable, not as "no press".

## Farmer device settings: the hopper filter and the raw distance (#659)

The seven ultrasonic filter keys (`hopper_refill_margin_pct`,
`hopper_reject_below_cm`, `hopper_reject_above_margin_cm`, `hopper_ema_alpha`,
`hopper_jump_pct`, `hopper_persist_cycles`, `hopper_state_hold_s`) were
firmware-only constants: `editable: false` and never overlaid onto the poll
response, so a bouncing or noisy sensor could only be adapted with a new build.

They now live on the device row (`EnergyDevice.hopper*`, one nullable column
each, migration `20261103120000_add_hopper_filter`) and are edited in Device
settings -> Calibration -> **Hopper sensor filter**. `saveHopperFilterSettings`
is the only writer: write access plus the revocable `manage_schedule`
permission, the device resolved through the caller's own pond, the update and a
`hopper_filter_changed` `DeviceStateEvent` in one transaction, and a page
revalidation. The bounds and defaults are not restated anywhere: the form, the
zod schema and the poll overlay all read the same `FIRMWARE_FIELDS` entry, which
`firmware-config.test.ts` pins to `FW_CONFIG_FIELDS` in
`firmware/firmware-main/config.h`. A null column sends nothing, so a unit that
was never tuned keeps the compile-time value and the card says how many values
still run on the default.

Because a write is only a promise, the card also shows what the unit reports:
its echoed `config_rev` / `config_source` from `diag`, and whether the newest
`config_applied` row is newer than the last recorded filter change. The firmware
never sends per-key values, so the echo is the only device-side evidence.

The same section renders the **raw** distance the operator calibrates against.
`feedLevelCm` was ingested and stored but no screen showed it, so setting the
full/empty references meant measuring the tank externally with no feedback. The
form renders the stored value, its farm-time timestamp and two capture buttons
(full / empty) that write the reading on screen into the reference field. The
value is polled every 4 s from the existing authenticated live endpoint
(`GET /api/devices/{id}/state`, which now also carries `feedLevelCm`), only while
the tab is visible; a failed poll keeps the last reading. No new table, no new
route and no new dependency.

The hopper **capacity** stays derived on purpose. It is computed from the tank
diameter, the full/empty distances and the feed bulk density
(`hopperCapacityFromGeometry`), and the card states that derivation next to the
inputs. A device calibrated before #415, which has no diameter, keeps its stored
`hopperCapacityG` and the card says so ("Saved capacity ... Enter the tank
diameter to compute it from the tank"). There is deliberately no free-text
capacity override: the stored number feeds the daily feed ceiling and the
days-of-feed estimate, so typing an arbitrary value would silently raise the
usable cap. An operator who needs a different capacity changes the geometry,
which recomputes it and records both in the `hopper_calibrated` event.


## E38: the daily ceiling is the only gram cap

`MAX_GRAMS_PER_DISPENSE` (1,000 g) is gone. The firmware derives

```
max_grams_per_dose = min(max_grams_per_day, max_dispense_ms / 1000 × grams_per_second)
```

so a dose up to the remaining daily ceiling is accepted, still bounded by the
relay-time envelope. A dose that would run past the envelope is refused with
`dose_time_exceeds_cap`; `grams_out_of_range` now only covers a non-positive
dose or one above the derived ceiling. The server keeps its own relay-time check
when queueing a manual feed, so a request that cannot physically run is never
queued.

## Motor minimum pulse: the floor half of #661

A dose is one continuous relay on-time: `grams / grams_per_second × 1000`.
Under a certain pulse the auger does not start from rest, so the relay closes,
the unit logs and reports a dose, and nothing leaves the hopper. `#661` adds
`motor_min_pulse_ms`, the shortest on-time the auger reliably turns, and the
firmware refuses a dose below it.

| | |
|---|---|
| Key | `motor_min_pulse_ms` |
| Envelope | 50–2,000 ms, whole milliseconds |
| Default | 250 ms |
| Applied from | `PlatformSetting` `firmware.gates`, edited in Superadmin → Settings → Firmware safety gates |
| Enforced in | `fw::DispenseGate::evaluate` (`firmware/firmware-main/safety.h`), limits filled by `applyConfigToRuntime()` |
| Refusal | `feed_refused` with `reason: "dose_below_min_pulse"` (distinct from `dose_time_exceeds_cap` and from `safe_mode`) |
| Serial | `[FEED] 0.50g needs 125ms of relay, below the 250ms motor floor`, then `[FEED] REFUSED dose_below_min_pulse: 0g from dashboard` |

**Why 250 ms.** At the shipped 4 g/s it is exactly 1 g, the smallest dose any
feeding field allows (`grams_per_feeding` and `button_feed_grams` both start at
1 g), so the default refuses nothing the console can request today. It only
refuses a dose that is already below that range.

**The floor is a time; doses are grams.** The smallest feedable dose is
`motor_min_pulse_ms / 1000 × grams_per_second`: 1 g at the default 4 g/s, 2 g
at 8 g/s. A unit calibrated faster than 4 g/s that must keep feeding 1 g doses
should lower the floor to the value measured on that unit; the default is a
conservative starting point, not a platform-wide measurement. A sub-floor
manual request is not pre-blocked by the app - the device refuses it with
`dose_below_min_pulse` and the existing refusal handling closes the request.

**Why not 0.** 0 would disable the floor, so the envelope starts at 50 ms and an
out-of-range value rejects the whole object (and the whole NVS blob) while the
last-good/default value stays. A missing value resolves to the default, never to
"no floor". Nothing is clamped on the device.

**Why 2,000 ms.** A calibration test dose is a whole number of seconds and at
least 3 s (`CALIBRATION_TEST_SECONDS_MIN`), so the floor always sits below the
calibration window and can never refuse a calibration. The floor never stretches
a dose *up*: rounding a dose to the floor would dispense more than the operator
asked for, and a calibration weight would then disagree with the brief.

**Calibration guidance.** The floor is a property of one auger, not of the
pellet. Feed one small weighed dose, lower the floor until the auger stops
turning reliably, then raise it one step and record that value. The
`grams_per_second` rate calibration is unchanged: the floor decides whether a
pulse is allowed, never how much a gram weighs.

**Wire change.** One field inside the existing object; no contract-version bump
and no schema change:

```json
"config": {
  "version": 1,
  "rev": 1543210987,
  "min_dispense_gap_s": 10,
  "max_dispenses_per_hour": 6,
  "motor_min_pulse_ms": 250,
  "...": "the other 44 fields"
}
```

**Older units.** A unit on firmware without this key ignores it (the contract is
additive) and keeps the old behaviour: no floor. The heartbeat echoes one
`config_rev` for the whole object, so it does not prove the floor was applied;
a unit that has not been flashed cannot enforce it.

## Values that are deliberately fixed (#662)

The calibration-coverage audit (`docs/audits/2026-11-03-calibration-coverage.md`,
gap 6) asked for four values that existed but were neither visible nor
adjustable. The calibration caps and the heartbeat cadence are now mirrored to
one place and pinned by a parity test; the RTC correction and the probe's
plausibility window are recorded as deliberately fixed, with the clock drift
reported instead of tuned.

| Value | Where it lives | Decision |
|---|---|---|
| RTC drift | `diag.rtc_drift_s` (signed seconds) | **Reported, not tunable.** The server clock corrects the RTC automatically once the drift passes 60 s (`applyIsoTime`), so a manual offset would fight the correction. The signed drift observed at the last correction now rides the heartbeat and the device page renders it: positive means the clock was behind the server, negative ahead, `0` means no correction has been needed this boot. |
| Water-probe plausibility | `fw::temperaturePlausible()` in `filters.h`: 0..50 °C, exclusive | **Deliberately fixed (class A).** It rejects the DS18B20 `-127` / `85` sentinels and values no pond here reaches; it answers "is this a real reading", not "is this reading accurate". Accuracy is corrected with `temp_offset_c`, which is already calibratable, and a probe that stops reporting is visible as `water_temp_ok: false` on the device row plus `diag.sensor_invalid_count`. There is no second threshold because the app has no reference measurement to compare against; inventing one would only add a number nobody can calibrate. |
| `heartbeat_interval_s` | `config.h` field, `editable: false` | **Firmware-only, mirrored.** No dashboard surface, but the connectivity rollup needs the expected beat to size its gap threshold. The app reads one exported constant (`FIRMWARE_HEARTBEAT_INTERVAL_S`, derived from the field default) instead of restating `5`; the parity test pins it to the header. |
| `calibration_max_grams` / `calibration_max_dispense_ms` | `config.h` field table | **Mirrored, not restated.** The app's calibration caps (`CALIBRATION_MAX_GRAMS`, `CALIBRATION_MAX_DISPENSE_MS`, and the derived `CALIBRATION_TEST_GRAMS_MAX`, `CALIBRATION_ACTUAL_GRAMS_MAX`, `CALIBRATION_TEST_SECONDS_MAX`) live in `apps/web/lib/limits-core.ts` and are asserted against the header by `firmware-config.test.ts`, so the two can no longer agree by luck. |

## Verification

| Check | Command |
|---|---|
| Native contract tests | `pio test -d firmware -e native` (config parse, envelope, last-good, malformed, NVS roundtrip, E38, motor floor #661) |
| Board builds | `pio run -d firmware -e esp32dev-gpio5` (CICT unit) and `-e esp32dev-gpio25` (reference board); the `-lan` variants add the bench updater |
| Server config + action + poll | `pnpm exec vitest run lib/__tests__/firmware-config.test.ts lib/__tests__/config-centre.test.ts lib/__tests__/feed-command.test.ts lib/__tests__/ingest-ota.test.ts` (from `apps/web`) |
| Repository gates | `pnpm lint`, `pnpm typecheck`, `pnpm api:check`, `pnpm build`, `node scripts/perf/bundle-budget.mjs` |

## Still needs a human

- **Reflash** (USB bootstrap or signed OTA) after Jeff's yes. This branch does
  not flash and does not bump the app version.
- **#661 bench run.** The native tests prove the gate's logic, not the auger:
  confirm on the field unit that the auger actually turns at the configured
  floor and stops turning reliably one step below it, and that the serial log
  shows `[FEED] … below the … motor floor` and `[FEED] REFUSED
  dose_below_min_pulse`. No ESP32 is connected to this build host.
- Hiligaynon strings are drafts.
- Firmware `MAX_GRAMS_PER_DISPENSE` removal (E38) ships with this reflash; the
  installed 1.6.2 units keep the 1,000 g per-dose refusal until then.

## Device health (faults and safe mode)

The firmware has reported `safe_mode`, `last_reset_reasons` and `diag.faults_*` on every heartbeat since
1.6.0/1.8.0, but the ingest schema used to strip them, so a feeder whose relay was locked off after
repeated brownouts looked online and healthy.

- **Why safe mode starts.** Only repeated abnormal resets (brownout, panic, watchdog; 3 inside 10 minutes
  by default). A missing sensor raises a different fault (`hopper_sensor`, `rtc`), never safe mode.
- **How it clears.** After `safe_mode_quiet_s` (30 minutes) without another abnormal reset, or a 5 s hold
  on the Wi-Fi reset button (GPIO 17), or a 10 s hold on the factory reset button (GPIO 16). If it keeps
  coming back, the resets are continuing: look at the 5 V supply, not the wiring.
- **What the server stores.** One `device_health` row in `DeviceStateEvent` per change of
  (`safe_mode`, `faults_present`, `faults_latched`), with the fault names, `last_fault`,
  `reset_abnormal_count` and `last_reset_reasons` (text capped at 64 characters). No schema change. The
  newest row is the current state; a row that clears the state is written too. A unit on older firmware
  reports nothing and writes nothing, which is not "all clear". `lib/device-health-model.ts` is the pure
  model; `lib/device-health.ts` holds the reads. The safe-mode *entry* is additionally stored once per trip
  as a `safety_trip` row (see the last bullet in this section), which is what History lists.
- **Where it shows.** The feeder hero (dashboard and admin pond page) shows a safe-mode alert, the active
  faults with what to check, and the last refused dose with its reason (24 hours). A new safe mode raises a
  CRITICAL in-app notification, a new fault a WARNING; both follow the pond's *device offline* switches.
- **Manual feeds.** `createManualFeedRequest` refuses with code `safe_mode` while the newest health row says
  the unit is in safe mode, instead of queueing a dose the unit will refuse. A dashboard dose the unit
  refuses closes its request as `refused` (the refusal carries no request id, and at most one feed request
  is dispatched per device), so it no longer blocks the next attempt as "a feed is already in progress".
- **The trip itself is an audit event (#455, server side).** `POST /api/ingest` accepts
  `event_type: "safety_trip"` with `trip_id` (1–64 chars) plus optional `abnormal_resets` (0–255),
  `reset_reasons`, `reset_reason`, `entry` (`boot`/`runtime`), `quiet_s` and `uptime_s`, and stores one
  `safety_trip` row in `DeviceStateEvent` per trip (`metadata.tripId`, `metadata.eventId =
  "trip-<trip_id>"`, and the reported evidence). `DeviceStateEvent` has no unique event id, so ingest reads
  the newest `safety_trip` row for that device and treats a matching `tripId` as a retry: 204, no new row.
  A different `trip_id` is a new incident. The row writes **no notification and no `FeedEvent`**: the
  `device_health` state row above already raised the CRITICAL safe-mode alert, and a second one would
  double-alert one lockout. History shows it as **Safety Trip (safe mode)** under the Feeding filter.
  `lib/device-safety-trip.ts` is the pure model. Firmware **1.9.0** emits it once per trip: the id is
  created in `enterSafeMode()` and persisted in NVS (`safe_trip_id`, `safe_trip_sent`, `safe_trip_at`),
  then `serviceSafetyTripReport()` sends it from `loop()` once identity and Wi-Fi exist, because the
  lockout runs during `setup()` before the radio. A 2xx marks it sent; a 422 from an older server is
  permanent; 429, 5xx and transport failures retry with the existing 5 s→5 min backoff, so a trip that
  happens offline lands exactly once after reconnect. The relay path is unchanged.
- **Not covered.** The remaining `diag` keys (#454) and a request id on the refusal payload (firmware).
  Calibration requests that are refused keep their own handling.

Bit order of `faults_present` (`firmware/firmware-main/status.h`): 1 `hopper_sensor`, 2 `rtc`,
3 `relay_overrun`, 4 `safe_mode`.
