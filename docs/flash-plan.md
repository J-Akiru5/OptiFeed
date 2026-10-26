# ESP32 Flash Plan

**Status:** Blocked on hardware (physical buttons to be soldered) · **Branch:** `Karl` ·
**Updated:** 2026-10-24

This plan records how the ESP32 will be brought online against the real backend, after
programmatic flashing was proven impossible on this hardware.

## 1. Goal and definition of done

The device must appear **Online** on the OptiFeed dashboard, sending heartbeats to
`https://optifeed.syntaxure.dev`.

Done when all of the following are verified:

- [ ] New firmware (with corrected backend URL) is flashed onto the ESP32.
- [ ] Serial log shows `[READY] OptiFeed controller online.` and heartbeats return HTTP 200.
- [ ] Device appears with an **Online** badge (`lastSeenAt` within `OFFLINE_THRESHOLD_MS`,
      15 min — `apps/web/lib/constants.ts`).
- [ ] `x-device-token` + `device_id === device.mac` accepted by the ingest route
      (`apps/web/app/api/ingest/route.ts`).

## 2. Root cause (verified 2026-10-24)

The board is **already running an old OptiFeed build and is online** on Wi-Fi `JEM…`
(NTP synced, sensors reading), but it posts to the dead placeholder host
`optifeed.example.com` (`firmware/firmware-main/firmware-main.ino` lines 48/51/52) — which is
why the dashboard never sees it. The corrected firmware has been built:

- Binary: `firmware/.pio/build/esp32dev/firmware.bin` (1,087,296 bytes, 10/24/2026 5:23 PM)
- Link: RAM 17.0 %, Flash 82.4 % (`esp32dev`)
- API verified live: `GET /api/health` → 200; TLS chain matches the CA baked into the firmware.

## 3. Why programmatic flashing is impossible (do not retry)

| Attempt | Method | Result |
|---|---|---|
| 1–4 | Four sequential DTR/RTS reset/boot sequences (pyserial `setDTR`/`setRTS`) | always `boot:0x12` (flash boot, **not** download mode) |
| 5 | Single atomic `SetCommState(DCB)` flipping both lines at once | `boot:0x12` |

The board has a **cross-coupled auto-reset circuit**; DTR asserted blocks the RTS reset path.
IO0 can only go low during EN low by a truly simultaneous transition, which the CP210x driver
cannot produce. Without a physical BOOT (IO0) button, the chip can never enter the serial
download port.

**OTA is also unavailable:** the running build predates `setupOTA()` (its boot log has no
`[OTA] Ready` line), port 3232 is closed across `192.168.1.0/24`, and the device answers
neither mDNS nor ARP from this PC.

## 4. Hardware work (owner: Karl)

Solder push buttons (all firmwares use `INPUT_PULLUP` → wire one side to GND, no external
resistor):

| Button | GPIO | Purpose | Firmware state |
|---|---|---|---|
| BOOT / IO0 | **IO0** | **Mandatory** — hold low during reset to enter USB download mode. The only remaining path to flash. | n/a (bootloader strap) |
| Feed / Wi-Fi reset | **27** | Hold ~5 s at boot (`WIFI_RESET_HOLD_MS`) to clear Wi-Fi and re-enter provisioning. | `BUTTON_PIN 27`, already active |
| Wi-Fi reset | **16** | Hold 5 s at any time after boot to clear Wi-Fi only; the device identity is kept. | `WIFI_RESET_BUTTON_PIN 16`, active |
| Factory reset | **17** | Hold 10 s to clear Wi-Fi plus the device identity. While it is held the Wi-Fi reset is suppressed. | `FACTORY_RESET_BUTTON_PIN 17`, active |

Pins 16/17 are confirmed free against the full pin assignment table in
`firmware-main.ino`: neither is a strapping pin, both support the internal
pull-up, and the sketch uses neither.

## 5. Flash procedure (once buttons exist)

1. Rebuild the firmware (the reset-button pins are already set to 16/17) —
   `pio run` (PlatformIO is **not** on PATH: `%LOCALAPPDATA%\Programs\Python\Python312\Scripts\pio.exe`).
2. Connect USB (CP2102 → **COM3**).
3. Hold **BOOT (IO0)**, tap **RESET** (or re-plug USB) → serial monitor must show
   `waiting for download`.
4. Release BOOT and flash: `pio run -t upload --upload-port COM3`
   (esptool 5.6 via `python -m esptool`; Python at
   `%LOCALAPPDATA%\Programs\Python\Python312\python.exe`).
5. Let the board reset into the new firmware; watch the serial log through `[READY]`.

## 6. Identity and token

- Firmware default identity: token `esp32-tok-cict-001`, MAC `A4:CF:12:7E:3B:09`.
- Seed expects `demo-device-token-001` — **these do not match**; the ingest route rejects a
  mismatched token. Reveal the real token from **Admin → Devices** and provision it (portal
  or identity flow) before expecting heartbeats to count.
- Provisioning/portal details: `docs/wifi-provisioning-plan.md`, `firmware/README.md`.

## 7. Environment notes

- Diagnostic scripts (evidence for §3) in `%TEMP%`: `esp32_watch.py`, `esp32_atomic_download.py`,
  `esp32_seq_probe.py`, `esp32_diag.py`, `esp32_scan.py`, `esp32_mdns.py`, `esp32_ota_scan.py`.
- pyserial API is `setDTR`/`setRTS`; `byref` comes from `ctypes`.
- The corrected URL change in `firmware-main.ino` currently lives as uncommitted work on
  `audit/phase-1-critical`; commit it before/with the flash work so the binary and source agree.
