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
object, so the two sides agree on the same envelope.

### Last-good storage

Namespace `optifeed`, **new keys only**:

| Key | Content |
|---|---|
| `cfg_json` | the 46 operational fields as JSON (no `version`/`rev`) |
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
| `min_dispense_gap_s`, `max_dispenses_per_hour`, `brownout_hold_s`, `safe_mode_*` | `PlatformSetting` `firmware.gates`, edited in Superadmin → Settings → Firmware safety gates |
| `weak_after_min`, `offline_after_min` | `PlatformSetting` `device.status` (I-95), diagnostics only: the server still classifies connectivity and E36 keeps alerts on the platform policy |
| OTA guards, calibration ceiling, hopper filter tuning, button guard, heartbeat interval | `firmware.gates` defaults (server-driven; stored and sent so a future UI or setting can move them without a reflash) |

No schema change is required: `PlatformSetting` is the existing key/value JSON
store. **No item needed an additive migration**, so nothing was stopped for
schema reasons.

## Superadmin UI

Superadmin → Settings → **Firmware safety gates** (en + hil, hil is a draft for
native review): seven number inputs generated from the field table, inline
min/max validation, a required reason of at least 10 characters, and one
`PlatformAuditLog` row (`platform.settings.firmware_gates`) in the same
transaction as the `PlatformSetting` upsert, carrying the before/after values.
Non-gate values already stored (OTA, calibration, button guard, heartbeat) are
preserved on save.

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

## Verification

| Check | Command |
|---|---|
| Native contract tests | `pio test -d firmware -e native` (config parse, envelope, last-good, malformed, NVS roundtrip, E38) |
| Board builds | `pio run -d firmware -e esp32dev`, `-e esp32dev-lan`, `-e esp32dev-relay5` |
| Server config + action + poll | `pnpm exec vitest run lib/__tests__/firmware-config.test.ts lib/__tests__/config-centre.test.ts lib/__tests__/feed-command.test.ts lib/__tests__/ingest-ota.test.ts` (from `apps/web`) |
| Repository gates | `pnpm lint`, `pnpm typecheck`, `pnpm api:check`, `pnpm build`, `node scripts/perf/bundle-budget.mjs` |

## Still needs a human

- **Reflash** (USB bootstrap or signed OTA) after Jeff's yes. This branch does
  not flash and does not bump the app version.
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
  model; `lib/device-health.ts` holds the reads.
- **Where it shows.** The feeder hero (dashboard and admin pond page) shows a safe-mode alert, the active
  faults with what to check, and the last refused dose with its reason (24 hours). A new safe mode raises a
  CRITICAL in-app notification, a new fault a WARNING; both follow the pond's *device offline* switches.
- **Manual feeds.** `createManualFeedRequest` refuses with code `safe_mode` while the newest health row says
  the unit is in safe mode, instead of queueing a dose the unit will refuse. A dashboard dose the unit
  refuses closes its request as `refused` (the refusal carries no request id, and at most one feed request
  is dispatched per device), so it no longer blocks the next attempt as "a feed is already in progress".
- **Not covered.** The remaining `diag` keys (#454), a firmware `safety_trip` event (#455, needs a flash),
  and a request id on the refusal payload (firmware). Calibration requests that are refused keep their own
  handling.

Bit order of `faults_present` (`firmware/firmware-main/status.h`): 1 `hopper_sensor`, 2 `rtc`,
3 `relay_overrun`, 4 `safe_mode`.
