# Remote firmware updates (OTA) for PakaonAI feeders

> Status: **design, not built.** Written 2026-10-26 from a read-only research benchmark plus checks by the integrator. It belongs to plan decision T21 (`docs/SUPERADMIN-MULTITENANCY-PLAN.md`), phase M4F. Mission task T-12.
> Evidence labels: **(verified)** checked in the repo or live; **(source)** cited documentation; **(unverified)** must be bench-tested before relying on it.

## 1. Why

Feeders sit on farms with no IT help. Today any firmware change means someone reflashes each unit over USB or from a laptop on the farm Wi-Fi (LAN ArduinoOTA). The target is a signed, staged, self-healing update over the internet, using the stack we already have.

## 2. Decision: build it ourselves

| Option | Free tier | Self-host | ESP32 Arduino | Rollback | Signing | Fit |
|---|---|---|---|---|---|---|
| **Our stack** (Supabase Storage + Vercel API + Arduino `Update`) | Supabase Free 1 GB storage / 5 GB egress a month ([pricing](https://supabase.com/pricing)) | yes | yes (core 2.0.17) | device A/B + server pause | app-level ECDSA P-256 | **chosen** |
| ThingsBoard CE | free, open source | we run it | MQTT OTA via SDK | none documented | checksum only | second IoT stack |
| Golioth | usage-based ($0.25/device-month, $0.0095/MB OTA) | no | ESP-IDF, Arduino unverified | cloud rollback | unverified | IDF port needed |
| Blynk.Air | 5 devices, 2 OTA shipments | no | yes | unverified | unverified | too limited |
| AWS IoT Jobs / Azure Device Update | pay per action / unverified | no | hand-rolled | yes | yes | overkill |
| Mender MCU / hawkBit | open source | we run it | not Arduino / community client | yes | MCUboot / ours | heavy |
| OTAdrive | 10 devices, 10 MB | no | yes | unverified | unverified | pilot only |
| ESP RainMaker | small free public instance | private on our AWS | yes | 90 s rollback window | unverified | lock-in |
| Memfault | Nordic-only free plan; Growth $3,495/mo | no | ESP-IDF | yes | unverified | too expensive |
| ElegantOTA / ArduinoOTA | free | n/a | LAN only | no | no | what we have now |

Sources for every row are in the research report. The prices are as published on 2026-10-26.

## 3. Facts that shape the design

1. **Partitions.**
   - **Today:** `firmware/platformio.ini` sets no partition scheme, so Arduino `default.csv` applies: `otadata` plus two 1.25 MB app slots **(verified)**.
   - **Headroom:** the app uses 82.6 % of a slot (1,082,285 B) **(verified, pio 2026-10-26)**, about 230 KB.
   - **Target:** `min_spiffs.csv` gives two ~1.875 MB slots and keeps NVS at 0x9000 ([source](https://github.com/espressif/arduino-esp32/blob/2.0.17/tools/partitions/min_spiffs.csv)). The firmware uses no SPIFFS.
   - **Limit:** a partition table cannot be changed over the air.
2. **Rollback exists in our core, but is off by default in the app.**
   - Arduino 2.0.17 has `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y`. `initArduino()` marks a pending image valid immediately unless the sketch overrides `verifyRollbackLater()` to return true ([source](https://github.com/espressif/arduino-esp32/blob/2.0.17/cores/esp32/esp32-hal-misc.c)).
   - Bootloader rollback after a reset on the precompiled bootloader is **(unverified)**. It must be bench-proven.
3. **TLS roots.**
   - **Today:** the firmware trusts one root, ISRG Root X1 (`ROOT_CA`, `firmware-main.ino:78`) **(verified)**.
   - **Production chain on 2026-10-26:** `optifeed.syntaxure.dev` serves leaf ← Let's Encrypt YR1 ← ISRG Root YR ← cross-signed by ISRG Root X1 **(verified with openssl)**. Today's units validate only because that cross-sign is served.
   - **Time bomb:** Let's Encrypt's "Gen Y" transition ([source](https://letsencrypt.org/2025/11/24/gen-y-hierarchy)) can drop the cross-sign. A unit that cannot connect cannot be fixed remotely.
   - **`*.vercel.app` hosts** chain to Google Trust Services, not ISRG **(source: research live check)**.
4. **Reboots lose feeding state.**
   - `dailyGramsDispensed`, the `firedToday` flags, the synced schedule and the offline event queue live only in RAM.
   - Scheduled feeds match an exact hour:minute, so a long blocking download across a feed minute skips that feed **(source: research read of `handleSchedule`)**.
5. **LAN ArduinoOTA uses a static password** (`OTA_PASSWORD "change-me-ota"`) and would bypass any signing.

## 4. Update flow

1. **Release.**
   - CI builds `firmware.bin` with `FW_VERSION` baked in.
   - On Jeff's machine (never CI or Vercel), a manifest `{version, sha256, size, board:"wroom32u", min_from_version, key_id}` is signed with an offline ECDSA P-256 key.
   - The bin goes to a **private** Supabase Storage bucket `firmware/`.
2. **Rollout.**
   - A platform admin creates a rollout (with step-up, reason and audit): canary devices first, then 5 % → 25 % → 50 % → 100 % with about 2-day gaps ([Memfault practice](https://docs.memfault.com/docs/best-practices/ota-deploy-process)).
   - It has a maintenance window and an automatic pause on a failure threshold ([Azure ADU](https://learn.microsoft.com/en-us/azure/iot-hub-device-update/device-update-deployments), [hawkBit](https://eclipse.dev/hawkbit/concepts/rollout-management)).
3. **Check.**
   - The heartbeat reports `firmware_version`, `ota_state` and `reset_reason`.
   - Every 15–60 minutes the device calls `GET /api/firmware/check` with its device token. The server answers `{update:false}`, or `{update:true, version, url, size, sha256, manifest, signature}`, where `url` is a ~10-minute signed Storage URL.
4. **Pre-flight gate on the device.** Every condition must hold, otherwise it postpones with backoff of 1 h → 6 h → 24 h:
   - not feeding, and no scheduled feed within ±20 minutes;
   - not provisioning;
   - RSSI > −75 dBm;
   - uptime > 10 minutes;
   - last reset not a brownout;
   - inside the window;
   - enough free heap.
5. **Verify, then download.**
   - Check the manifest signature against the embedded public keys (current + next).
   - Refuse a downgrade unless the signed manifest allows it, and refuse a board or size mismatch.
   - Stream into `Update.write()` while hashing SHA-256. Keep the watchdog fed and the schedule serviced.
   - `otaInProgress` blocks dashboard feeds, reporting `feed_refused` with reason `ota_in_progress`.
   - Power loss mid-download is harmless: the boot slot switches only in `Update.end()`.
6. **Install.** If the SHA-256 matches, call `Update.end(true)`, persist the feeding state to NVS, report `ota_installed`, and reboot.
7. **First boot, pending verify.**
   - The relay is forced OFF (as today).
   - Within 5 minutes the unit must get Wi-Fi, a valid time, and one authenticated `200` from `/api/feed-command`. Then it marks itself valid and reports `ota_valid`.
   - Otherwise it calls `esp_ota_mark_app_invalid_rollback_and_reboot()`. A crash or watchdog reset before that point lets the bootloader return to the old image **(bench-verify)**.
8. **Server watch.** A device back on the old version with `rolled_back`, or silent for 30 minutes after install, counts as a failure, and the threshold pauses the rollout.

Use `Update` + `HTTPClient` + mbedtls SHA-256/ECDSA, not `HTTPUpdate`. `HTTPUpdate` checks only MD5, does not verify signatures and does not follow redirects ([source](https://github.com/espressif/arduino-esp32/blob/2.0.17/libraries/HTTPUpdate/src/HTTPUpdate.cpp)). No delta updates for now: a full ~1.1 MB image is cheap.

## 5. Changes

**Firmware: one bootstrap build** (needs human OK + one last manual flash):
- `board_build.partitions = min_spiffs.csv`
- `FW_VERSION` reported in the heartbeat
- the `verifyRollbackLater()` override + a health-check state machine
- several CA roots (ISRG X1 + X2, Root YR, GTS R1, GlobalSign) and a way to receive new roots in a signed manifest
- two embedded public keys
- the `checkForUpdate()` task with the pre-flight gate
- the `otaInProgress` feed guard
- NVS persistence of the daily grams, `firedToday`, schedule and event queue
- LAN ArduinoOTA behind `-DENABLE_LAN_OTA`, off in field builds
- a remotely configurable check interval and window

**Server, no schema change:**
- an optional `firmware_version` in the heartbeat schema (unknown keys are stripped today, so old units keep working)
- OTA lifecycle `DeviceStateEvent` types
- `GET /api/firmware/check` reusing `verifyDeviceToken`
- for a pilot, releases described by a signed JSON manifest in Storage

**Server, needs a migration** (separate PR, dev project first):
- `EnergyDevice.firmwareVersion`, `firmwareReportedAt`, `otaState`, `otaTargetReleaseId`, `otaAttempts`, `lastResetReason`
- `FirmwareRelease`
- `FirmwareRollout`
- `FirmwareUpdateAttempt`
- every rollout action written to `PlatformAuditLog`

**Superadmin UI:**
- a firmware column in Devices
- Releases (upload + signature)
- Rollouts (canary, advance, pause, abort; per-device hold/retry)
- an adoption and failure chart

## 6. Bootstrap: making the next manual flash the last one

- **Path A, recommended:** one USB flash per unit with `pio run -t upload`. It writes the bootloader, the new partition table and the app. NVS (Wi-Fi, device ID, token) at 0x9000 survives unless someone runs `erase_flash` **(bench-verify)**. Record `esptool chip_id` while there.
- **Path B:** keep the default table and push over LAN ArduinoOTA. That works today with ~230 KB headroom, but any future repartition needs USB again.
- **Bench test before the fleet:** 1.4.0 → 1.4.1 → a deliberately bad 1.4.2 must roll back automatically, including power pulled and a watchdog reset during pending-verify.

## 7. Risks

- **Bricking:** mitigated by A/B slots + rollback + staged rollout. Bootloader rollback is unverified until the bench test.
- **CA change:** see §3.3. Carry several roots.
- **Signing key:** keep it offline with a backup; a second embedded key allows rotation.
- **No hardware root of trust:** Secure Boot v2 needs ESP32 rev 3 and a custom bootloader ([source](https://docs.espressif.com/projects/esp-idf/en/v4.4.7/esp32/security/secure-boot-v2.html)). Built-in signed OTA arrives only in Arduino core 3.3+ ([PR #11968](https://github.com/espressif/arduino-esp32/pull/11968)).
- **Missed or double feeds** around updates: covered by the gate and the NVS persistence.
- **Supabase Free:** pauses after a week of inactivity, and 5 GB egress is about 4,500 full downloads a month.

## 8. Open decisions for Jeff (block T-12a)

| ID | Decision | Recommendation |
|---|---|---|
| OTA-1 | Bootstrap path | **Decided (Jeff, 2026-10-26): Path A**, one last USB flash with `min_spiffs` |
| OTA-2 | Does the physical feed button abort an OTA in progress? | **Decided: yes**, feeding wins over updating |
| OTA-3 | Maintenance window and gap from scheduled feeds | **Decided: 10:00–15:00 local, at least 20 min from any scheduled feed** |
| OTA-4 | Who holds the signing key, and where | Jeff, offline + encrypted backup |
| OTA-5 | Production domain and CA for devices | `optifeed.syntaxure.dev` today (domain move to `pakaonai.syntaxure.dev` planned) |
| OTA-6 | Stay on Arduino 2.0.17 or move to 3.3+ for built-in signed OTA | Stay on 2.0.17 for the bootstrap; revisit after the fleet is OTA-capable |
| OTA-7 | Keep LAN OTA in field builds? | **Decided: no** (LAN ArduinoOTA only behind `-DENABLE_LAN_OTA` for bench builds) |

## 9. Tasks

| ID | Task | Blocked by |
|---|---|---|
| T-12a | Firmware bootstrap build (§5 firmware) + bench test plan | OTA-1…OTA-7; human OK + reflash |
| T-12b | Server, no schema: heartbeat `firmware_version`, OTA event types, `/api/firmware/check` with a signed JSON manifest | OTA-4 (key format) |
| T-12c | Migration + superadmin Releases/Rollouts UI | the Supabase dev project (T-08), OTA-4 |
