# Calibration coverage: every component setting, and the gaps (#617)

**Status:** audit, read-only. No firmware or schema change is proposed here.
**Scope:** every setting a technician may need to adjust on a deployed PakaonAI feeder — firmware config, device columns, and the guided flows that exist today.
**Sources:** `apps/web/lib/firmware/config.ts` (46 keys), `apps/web/prisma/schema.prisma` `EnergyDevice`, `apps/web/lib/actions/**`, `apps/web/components/**`, `firmware/firmware-main/**`.

## TL;DR

| Question | Answer |
| --- | --- |
| Firmware config keys | **46** |
| Editable in the console (safety gates form) | **7** |
| Settable through a device/org/platform surface | **10** |
| Overlaid from a column but with **no UI** | **1** (`button_feed_grams`) |
| Firmware-only (defaults only, no app path) | **28** |
| Guided, measured calibration flows | **1** (auger rate) plus a target-check variant |
| Typed calibration surfaces | **3** (temperature offset, hopper geometry, manual rate) |
| Named gaps filed from this audit | **5** issues (#658, #659, #660, #661, #662) |

## How to read this

- **Guided calibration** — the app measures a reference (a weighed dose) and computes the setting.
- **Typed calibration** — an operator measures or knows the value and types it; the app previews the result but does not measure.
- **Typed configuration (indirect)** — the value reaches the device through a derived setting (daily cap, platform feeding caps, org threshold), not by editing the firmware key.
- **Firmware-only** — the firmware ships a compile-time default and the dashboard cannot change it. The value is still sent in the config envelope, so the default is explicit, not accidental.
- **NONE** — no app surface and no config overlay: the column exists but nothing writes it.

## 1. Firmware config keys (46)

The only writer of `PlatformSetting["firmware.gates"]` is `setFirmwareGates` (`lib/actions/platform/settings.ts:236`), and it rejects any id outside `FIRMWARE_GATE_FIELDS` (`:246-251`). Everything else reaches the device through `buildFirmwareConfig` overlays (`lib/firmware/config.ts:630-671`) or stays at its default.

### Editable in the console (7)

| Setting | Where | Action |
| --- | --- | --- |
| `min_dispense_gap_s` | Superadmin → Settings → Feed safety gates (`components/superadmin/firmware-gates-settings.tsx:80-104`) | `lib/actions/platform/settings.ts:236-314` |
| `max_dispenses_per_hour` | same | same |
| `brownout_hold_s` | same | same |
| `safe_mode_abnormal_window_s` | same | same |
| `safe_mode_abnormal_threshold` | same | same |
| `safe_mode_quiet_s` | same | same |
| `safe_mode_healthy_clear_s` | same | same |

### Settable through another surface (10)

| Setting | Surface | Action | Notes |
| --- | --- | --- | --- |
| `grams_per_second` | `components/DurationCalibrationForm.tsx:431-691` | `lib/actions/calibration.ts:535`, `:692`; `lib/actions/energy.ts:159` | Guided rate test, target check, or typed |
| `temp_offset_c` | `components/TemperatureCalibrationForm.tsx:119-140` | `lib/actions/energy.ts:220` | Typed offset + preview; applied on-device |
| `hopper_full_cm` | `components/HopperCalibrationForm.tsx:185-194` | `lib/actions/energy.ts:55` | Typed distance |
| `hopper_empty_cm` | `components/HopperCalibrationForm.tsx:195-205` | `lib/actions/energy.ts:55` | Typed distance |
| `max_grams_per_day` | `components/DeviceDailyCapForm.tsx:66-110` | `lib/actions/settings.ts:388` / `lib/actions/admin.ts:1599` | Derived through `resolveDailyCapG` |
| `max_dispense_ms` | Superadmin → Feeding caps (`components/superadmin/config-forms.tsx:88-197`) | `lib/actions/platform/config.ts:82` | Platform-wide relay ceiling |
| `weak_after_min` | Superadmin → Device status (`components/superadmin/device-status-settings.tsx:32`) | `lib/actions/platform/settings.ts:153` | |
| `offline_after_min` | same | same | |
| `grams_per_feeding` | Pond feeding settings (derived) | `lib/feeding/derive.ts:166` | No direct device editor |
| `hopper_low_pct` | Tenant admin → Org settings (`components/admin/org-settings-forms.tsx:198`) | `lib/actions/org-settings.ts:79` | Org threshold |

### No app path (29)

These are delivered from the stored gates/defaults but nothing can change them. Grouped by what a technician would touch:

| Area | Keys |
| --- | --- |
| Calibration runtime caps | `calibration_max_grams`, `calibration_max_dispense_ms` |
| Hopper filter | `hopper_refill_margin_pct`, `hopper_reject_below_cm`, `hopper_reject_above_margin_cm`, `hopper_ema_alpha`, `hopper_jump_pct`, `hopper_persist_cycles`, `hopper_state_hold_s` |
| Physical button | `button_feed_grams`, `button_debounce_ms`, `button_startup_grace_ms`, `button_quiet_after_dispense_ms`, `button_cooldown_ms`, `button_log_interval_ms`, `button_noise_window_ms`, `button_noise_max`, `button_disable_ms` |
| Heartbeat | `heartbeat_interval_s` |
| OTA policy | `ota_check_interval_s`, `ota_min_uptime_s`, `ota_min_rssi_dbm`, `ota_feed_guard_min`, `ota_window_start_min`, `ota_window_end_min`, `ota_min_free_heap_bytes`, `ota_no_data_timeout_ms`, `ota_download_timeout_ms`, `ota_health_check_timeout_ms` |

## 2. Device columns a technician tunes

| Column (`prisma/schema.prisma`) | Where edited | Action | Kind |
| --- | --- | --- | --- |
| `gramsPerSecond` (`:428`) | `DurationCalibrationForm` guided/manual | `lib/actions/calibration.ts:618`, `:805`; `lib/actions/energy.ts:184` | guided + typed |
| `lastCalibratedAt` (`:431`) | — | `lib/actions/calibration.ts:620`, `:809` | set by a rate test / accepted target check |
| `tempOffsetC` (`:429`) | `TemperatureCalibrationForm` | `lib/actions/energy.ts:255` | typed |
| `minFeedTempC` (`:430`) | `TemperatureCalibrationForm` | `lib/actions/energy.ts:257` | typed (tri-state) |
| `hopperFullCm` (`:419`) | `HopperCalibrationForm` | `lib/actions/energy.ts:115` | typed, blind |
| `hopperEmptyCm` (`:418`) | `HopperCalibrationForm` | `lib/actions/energy.ts:116` | typed, blind |
| `hopperCapacityG` (`:420`) | **No input** — preview only (`HopperCalibrationForm.tsx:231-261`) | Derived server-side from geometry | typed (derived) |
| `hopperDiameterCm` (`:425`) | `HopperCalibrationForm` | `lib/actions/energy.ts:121` | typed |
| `hopperBulkDensityGCm3` (`:426`) | `HopperCalibrationForm` | `lib/actions/energy.ts:122` | typed |
| `dailyCapG` (`:427`) | `DeviceDailyCapForm` | `lib/actions/settings.ts:408` / `admin.ts:1620` | typed |
| `recalibrationIntervalDays` (`:432`) | `RecalibrationIntervalForm` | `lib/actions/calibration.ts:899` | typed, app-only (never sent to the device) |
| `gramsPerFeeding` (`:391`) | **No direct editor** | `lib/feeding/derive.ts:166` and friends | derived |
| `buttonFeedGrams` (`:392`) | **NONE** | — | no `.tsx` reference; the column is overlaid but never written |
| `rtcOk` (`:388`) | Display only | Written by heartbeat ingest | device-reported |

## 3. Guided flows: what each measures

| Flow | Measures | Writes | Evidence |
| --- | --- | --- | --- |
| Rate test | Timed dose, then the **weighed** output; `actual / testSeconds` | `gramsPerSecond`, `lastCalibratedAt`, `CalibrationRun(RATE_TEST)` | `DurationCalibrationForm.tsx:431-458`; `lib/actions/calibration.ts:535-672` |
| Target check | Dispenses an exact target, then the **weighed** output; corrects the rate | `gramsPerSecond` (+ `lastCalibratedAt` on accept), `CalibrationRun(TARGET_CHECK)` | `DurationCalibrationForm.tsx:460-526`; `lib/actions/calibration.ts:692-868` |
| Manual rate | Nothing | `gramsPerSecond` + event, no `lastCalibratedAt` | `DurationCalibrationForm.tsx:1257-1316`; `lib/actions/energy.ts:159` |
| Hopper | Nothing — geometry math only | full/empty cm, diameter, density, capacity | `HopperCalibrationForm.tsx:100-230`; `lib/actions/energy.ts:55-157` |
| Temperature | Nothing — offset typed, preview re-offsets the last reading | `tempOffsetC`, `minFeedTempC` | `TemperatureCalibrationForm.tsx:82-140`; `lib/actions/energy.ts:220` |
| Recalibration interval | Nothing | `recalibrationIntervalDays` + event | `lib/actions/calibration.ts:874` |
| Device clock | Nothing | `DeviceStateEvent(set_time)` only | `lib/actions/time.ts:24` |

The calibration **history** (`CalibrationHistory`) and the drift **detector** (`lib/calibration/drift.ts`) are display-only; they do not calibrate.

## 4. Resolved unknowns

### RTC drift — corrected automatically; no offset to calibrate

- The firmware sets the RTC on a manual dashboard time sync (force) and otherwise corrects it from the server clock **only when the drift exceeds 60 s** (`firmware/firmware-main/firmware-main.ino:4412-4427`, `applyIsoTime`; called at `:4454-4462`). Manual set: `components/TimeCalibrationForm.tsx:26-53` → `lib/actions/time.ts:24-35`, surfaced as `time_sync` for 10 minutes (`app/api/schedule-sync/route.ts:66,80-96`).
- `rtcOk` is hardware presence only (`prisma/schema.prisma:388`; ingest `app/api/ingest/route.ts:396`; firmware `:3638-3643`, `:4859`).
- **Conclusion:** there is nothing for a technician to calibrate — a manual offset would fight the server correction. What is missing is **observability**: the drift value is logged to serial (`:4426`) but never sent, so the app cannot show "clock is 12 s fast". Filed as observability, not calibration.

### Ultrasonic reference points — settable, but blind

- `hopper_full_cm` / `hopper_empty_cm` are typed in `HopperCalibrationForm.tsx:185-205` and stored through `lib/actions/energy.ts:55-157`; capacity is derived from the geometry (#415).
- The app never renders the **raw distance**: `feedLevelCm` exists on the model (`prisma/schema.prisma:398`) and is ingested (`app/api/ingest/route.ts:549`), but no `.tsx` references it. The device converts cm → %; the server passes the percentage through (`lib/device-hopper.ts:120-154`).
- **Conclusion:** the references are calibratable in the "typed configuration" sense, but the technician must measure the tank externally and cannot watch the live cm value while doing it. Filed as a P2 usability gap, not a missing setting.

## 5. Gaps and severities

| # | Severity | Gap | Why it matters |
| --- | --- | --- | --- |
| 1 | **P2** | `button_feed_grams` has no UI, and the whole physical-button block (debounce, cooldown, noise window/max, disable) is firmware-only | Every unit dispenses a hard-coded 80 g on the button regardless of the pond's per-feeding amount, and a false-triggering button cannot be tuned remotely |
| 2 | **P2** | Hopper filter constants (EMA, jump, persist, hold, rejects, refill margin) are firmware-only | A bouncing or noisy ultrasonic sensor cannot be adapted per site without a firmware build |
| 3 | **P2** | OTA policy (window, min RSSI, min uptime, feed guard, heap, timeouts) is firmware-only | A rollout cannot be confined to a site's quiet hours or a weak-link unit |
| 4 | **P2** | Ultrasonic calibration is blind: no live cm reading, no "capture current distance", capacity only via geometry | A technician cannot verify empty/full while standing at the unit |
| 5 | **P2** | No motor minimum-pulse / endpoint calibration | Below some pulse the auger does not turn; the app has no calibrated floor to refuse or report |
| 6 | **P3** | Calibration runtime caps duplicated between firmware config and app constants; heartbeat interval and probe-health thresholds are firmware-only | The two cap pairs currently agree but can silently diverge; probe plausibility is not tunable though the offset is |

## 6. What was not audited

- Firmware behaviour beyond the config envelope (no board, no flashing).
- Field installation tolerances (the physical measurement a technician would take).
- The superadmin shell / navigation (Lane H) and the data-contract layer (Lane J).
- Whether the seven editable gates are *sufficient*; this audit only says what exists.

## 7. Follow-ups

Filed from this audit:

| Issue | Severity | Covers |
| --- | --- | --- |
| [#658](https://github.com/J-Akiru5/OptiFeed/issues/658) | P2 | Physical button: feed amount + tuning have no UI (gap 1) |
| [#659](https://github.com/J-Akiru5/OptiFeed/issues/659) | P2 | Hopper filter tuning + blind ultrasonic references (gaps 2 and 4) |
| [#660](https://github.com/J-Akiru5/OptiFeed/issues/660) | P2 | OTA policy has no UI (gap 3) |
| [#661](https://github.com/J-Akiru5/OptiFeed/issues/661) | P2 | No motor minimum-pulse calibration (gap 5) |
| [#662](https://github.com/J-Akiru5/OptiFeed/issues/662) | P3 | Firmware-only observability/tuning bundle: RTC drift, probe thresholds, duplicated caps, heartbeat (gap 6) |
