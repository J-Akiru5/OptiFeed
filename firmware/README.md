# OptiFeed ESP32 Firmware

3-way fallback firmware for the **ESP32-WROOM-32U** acting as the unified OptiFeed controller. Three independent trigger paths, all routed through one shared `dispenseFeed()` function.

## Trigger Tiers

1. **SCHEDULED** — RTC-driven, fires at 06:00 and 19:00. Works with NO WiFi/backend connectivity.
2. **DASHBOARD** — polled every 5s from the backend. Manual/extra feeds triggered remotely.
3. **PHYSICAL BUTTON** — local override on GPIO 23, captured by a falling-edge interrupt so a short press is never lost while the loop is busy with HTTPS. Works even with WiFi fully down.

> **Firmware 1.5.0.** There is no compile-time device identity any more: a unit with no
> provisioned Device ID/token makes **no API calls** and only runs the setup portal while
> continuing to feed on its RTC schedule. The setup AP name follows the stored Device ID when
> it is a MAC (otherwise the chip eFuse MAC), the setup page lists nearby 2.4 GHz networks,
> the feed button is interrupt-driven, and the relay polarity is a build flag. See
> **Firmware 1.5.0 hardening** below.
>
> **Firmware 1.5.2 (issue #252).** The setup portal is branded (PakaonAI fish mark, wordmark
> and tagline), the network list is filled by an **asynchronous** scan with a **Rescan**
> button, and a submitted network is **tested before it is saved**: the portal shows
> `Connecting…`, then either `Connected to <SSID> · IP · signal` (save, restart in 5 s) or a
> reason (`Not connected: wrong password / network not found / no IP`) with the form kept for
> a retry. Nothing is written to NVS until the join works. The 1.5.2 changes are described
> under **Setup Portal** below.
>
> **Firmware 1.5.3 (phantom button feeds).** A falling edge is no longer a press: the
> interrupt only records a candidate, `loop()` samples GPIO 23 for 50 ms and accepts it only
> when the line stays LOW. Button edges are ignored from relay ON until 2 s after relay OFF,
> and a button dose is limited to one per 30 s. See **Firmware 1.5.3 button guard** below.
>
> **Firmware 1.6.0 (fail-safe).** One dispense gate for every source (10 s minimum gap,
> six doses per rolling hour, daily cap), a relay overrun trip, a shutdown handler that
> opens the relay on every reset, **safe mode** after three abnormal resets in ten minutes,
> plausibility filtering for the hopper and the water probe, source-side event rate limits,
> a bounded queue that drops its oldest entry, and jittered HTTP backoff capped at five
> minutes. Pure logic is in `safety.h` / `filters.h` and covered by
> `pio test -d firmware -e native`. See **Firmware 1.6.0 fail-safe model** below.

## Hardware Pinout

| Pin   | Usage                                    |
|-------|------------------------------------------|
| GPIO 25 | Relay OUT (active HIGH by default; `-DRELAY_ACTIVE_LOW=1` for an active-LOW module). GPIO 5 also works via `-DRELAY_PIN=5` (see Relay pin) |
| GPIO 23 | Physical button (INPUT_PULLUP, press = LOW). A press must stay LOW for 50 ms before it dispenses the button dose (1.5.3); edges during and 2 s after a dispense are ignored, and button doses are limited to one per 30 s. Hold >= 5 s at boot to reset WiFi credentials (device identity is kept) |
| GPIO 32 | DS18B20 water temperature probe (1-Wire; 4.7 kOhm pull-up to 3.3 V) |
| GPIO 12 | HC-SR04 TRIG (output). Strapping pin: a 10 kOhm pull-down to GND holds it LOW at boot |
| GPIO 14 | HC-SR04 ECHO (input, 5 V logic — level-shift or divide before the pin) |
| GPIO 16 | Factory reset button (INPUT_PULLUP, press = LOW). Hold >= 10 s to clear WiFi, Device ID, Device Token and the `provisioned` marker |
| GPIO 17 | Wi-Fi reset button (INPUT_PULLUP, press = LOW). Hold >= 5 s to clear WiFi only — the Device ID/Token are kept. A tap (< 5 s) acknowledges latched faults (1.8.0) |
| GPIO 18 | FAULT lamp, yellow (LED + 200 Ω to GND; HIGH = on). Solid while a fault is latched (1.8.0) |
| GPIO 26 | WI-FI lamp, blue (LED + 100 Ω to GND). Solid once joined to the saved network; 1 Hz blink in the setup portal; off otherwise (1.8.0) |
| — | POWER lamp, white: 5 V rail + 330 Ω in hardware, no GPIO. FEEDING lamp, green: parallel tap on the relay control line (GPIO 25, or 5 on `esp32dev-relay5`), no GPIO |
| GPIO 21 | DS3231 SDA (I²C) — RTC                 |
| GPIO 22 | DS3231 SCL (I²C) — RTC                 |
| GPIO 1  | TX0 (USB debug serial)                  |
| GPIO 3  | RX0 (USB debug serial)                  |
| GPIO 0  | Must float during boot (boot mode)      |

### Machine status interface (firmware 1.8.0)

Four LEDs form one status panel. Logic lives in `status.h` (`fw::FaultManager`,
`fw::indicatorLevels`) and is covered by the native tests. The wiring below is the
amended bench wiring (`firmware/bench/led-bench-test`, Jeff 2026-10-31): only the blue
and yellow LEDs are firmware outputs.

| Lamp | Wiring | Solid | Blinking | Off |
|---|---|---|---|---|
| POWER (white) | 5 V rail → 330 Ω → LED → GND; hardware, no GPIO | Control power available | — | No control power |
| FEEDING (green) | Relay control line (GPIO 25, or 5 on `esp32dev-relay5`) → 200 Ω → LED → GND; a parallel tap, no GPIO | Relay energized (actual feeding) | — | Idle |
| WI-FI (blue) | GPIO 26 → 100 Ω → LED → GND | Joined the configured network | Setup portal (provisioning) | Not connected (not a fault) |
| FAULT (yellow) | GPIO 18 → 200 Ω → LED → GND | A fault is latched | — | No active fault |

Polarity: longer leg (anode) toward the resistor and GPIO, shorter leg (cathode) to
GND. Tap the relay line at the ESP32 pin or module input, not at a point pulled up
to 5 V. The green LED reflects *relay energized*, so it also blips with the GPIO 5
boot glitch and stays lit if the relay sticks on; label it FEED or RELAY on the
enclosure, not "FEEDING OK". Blue sits close to the 3.3 V rail and is dim even at
100 Ω; a brighter blue needs a 5 V supply and a small low-side switch.

A panel of 12 V DC pilot lamps instead (each switched by an NPN, never directly by
a GPIO) builds with `-DPOWER_LED_PIN=13 -DFEEDING_LED_PIN=18 -DWIFI_LED_PIN=19
-DFAULT_LED_PIN=33`:

| Connection | Wiring |
|---|---|
| Lamp + | +12 V |
| Lamp − | NPN collector |
| NPN emitter | GND |
| ESP32 GPIO | 1 kΩ → NPN base |
| NPN base | 10 kΩ pull-down → GND (lamp stays dark while the pin floats at reset) |
| ESP32 GND | Common with the 12 V supply GND (non-isolated supplies only) |

A lamp that is not fitted builds with `-D<NAME>_LED_PIN=-1` (`POWER_LED_PIN`,
`FEEDING_LED_PIN`, `WIFI_LED_PIN`, `FAULT_LED_PIN`).

**Faults the current hardware can detect**

| Fault | Detection | Raised | Clears when |
|---|---|---|---|
| `hopper_sensor` | HC-SR04 returns no echo on any sample, 3 checks in a row (each heartbeat, or a single ping every 60 s when offline) | ~15 s online, ~3 min offline | An echo returns, then the operator acknowledges |
| `rtc` | DS3231 not found at boot, or no I2C ACK at 0x68 (probed every 60 s) | At boot / within 60 s | It answers again, then acknowledgement |
| `relay_overrun` | A dose ran past its expected end + 2 s (timing trip; the relay is already forced off) | At the trip | Acknowledgement |
| `safe_mode` | Repeated abnormal resets locked the relay off | On entry | Safe mode ends, then acknowledgement |

Faults latch: the yellow lamp stays on until the cause is gone **and** the
operator taps the Wi-Fi reset button (GPIO 17, released before 5 s). A tap while
the cause is still present is refused and logged. Acknowledging never resumes an
interrupted dose. Each fault is logged as `[FAULT] <code> raised (epoch <n>)`
(epoch 0 without a trusted clock) and the heartbeat carries
`diag.faults_latched`, `diag.faults_present` (bit n = `fw::Fault` n) and
`diag.last_fault`. Ingest strips these today, as with the other `diag` keys.

Not faults: Wi-Fi loss (the unit feeds offline from the RTC; blue just goes
off) and a low hopper (a server-side pellet alert). Not detectable without new
parts: a jammed auger or motor overload (needs a current sensor) and a relay
that fails to switch (needs relay feedback). The FAULT lamp is an operator
notice, not a safety interlock: the relay gates and safe mode remain the only
interlock, and no fault adds a new feeding refusal.

### Dedicated reset buttons

Two active-low momentary buttons are wired between their GPIO and GND; the
internal pull-up is enabled. Both are enabled in this build, so no pin edit is
needed.

| Button | Define | GPIO | Hold | Effect |
|--------|--------|------|------|--------|
| Wi-Fi reset | `WIFI_RESET_BUTTON_PIN` | `17` | 5 s (`WIFI_RESET_HOLD_MS`) | Clears WiFi SSID/password **and the WiFi stack cache**, keeps Device ID/Token, reboots into the setup portal |
| Factory reset | `FACTORY_RESET_BUTTON_PIN` | `16` | 10 s (`FACTORY_RESET_HOLD_MS`) | Clears WiFi, Device ID, Device Token and the `provisioned` marker, reboots into the setup portal |

Safety rules: buttons are ignored for the first 5 s after boot and must be
released once before they arm, so a stuck button cannot wipe a unit. While the
factory-reset button is held the Wi-Fi reset is suppressed, so a two-button hold
cannot reboot into the portal at 5 s: the factory reset wins at 10 s. The
existing feed-button hold (GPIO 23, 5 s at boot) remains a WiFi-only reset.

GPIO 16 and 17 are free on the ESP32-WROOM-32U, are not strapping pins, and
support the internal pull-up. They are held by these two buttons. GPIO 18 and 26
are the FAULT and WI-FI lamps since 1.8.0 (see *Machine status interface*). GPIO 27 is
still free; so are 13, 19 and 33 unless a 12 V lamp panel is built (see that section).

Do **not** use: 25 (relay), 23 (feed button), 32 (DS18B20), 12/14 (HC-SR04),
21/22 (RTC I2C), 0/2/15 (strapping), 34-39 (input-only, no internal pull-up),
1/3 (USB serial), 6-11 (flash). GPIO 12 is a strapping pin that selects the
flash voltage at boot; the HC-SR04 echo idles LOW and the 10 kOhm pull-down
keeps it there. GPIO 5 stays usable for the relay: strapping only selects SDIO
slave timing, which this sketch never configures, and it is sampled at reset
only. Just confirm the weak reset pull-up does not click the module at power-up.

## Build & flash (PlatformIO)

The firmware is a PlatformIO project (`firmware/platformio.ini`) using the same
toolchain as the energy-monitoring project: `espressif32@7.1.2`, board
`esp32dev` (ESP32-WROOM-32U), Arduino framework **2.0.17**. Dependencies are
declared and resolved by PlatformIO — no Arduino Library Manager step.

```bash
pip install platformio        # or use the PlatformIO IDE extension
pio run -d firmware            # compile (field build)
pio run -d firmware -t upload  # flash over USB
pio device monitor -b 115200   # serial log
```

CI runs `pio run -d firmware` for every firmware change; it never flashes or
deploys.

### Relay pin (build flag)

`RELAY_PIN` defaults to GPIO 25. The CICT Building A feeder is wired to
**GPIO 5**, so it is built and flashed with its own environment:

```sh
pio run -d firmware -e esp32dev-relay5 -t upload
```

GPIO 5 is a strapping pin, but only for SDIO slave timing, which this firmware
never configures; strapping is sampled at reset and the pin is an ordinary GPIO
afterwards. Its reset state is a weak internal pull-up, so it sits weakly HIGH
until `setup()` drives it LOW. That is normally far too little current to trip
an opto-isolated relay input, but confirm it on the bench: power-cycle a few
times and watch the module LED. If it blips, add a 10 kΩ resistor from the relay
IN pin to GND, or move the wire to GPIO 25. Boot prints `[INIT] Relay on GPIO <n>`.

### Relay polarity (build flag)

`RELAY_ACTIVE_LOW` defaults to `0`, the field board's active-HIGH wiring: the
relay coil energizes when GPIO 25 is HIGH. For an active-LOW relay module, add
the flag to `build_flags` in `firmware/platformio.ini` and rebuild — no logic
edit is needed:

```ini
[env:esp32dev]
build_flags = -std=gnu++17 -DRELAY_ACTIVE_LOW=1
```

Boot always forces `RELAY_OFF` in both modes, and every safety cap is unchanged.
The 2026-10-27 bench unit did not click, so both polarities still need a
hardware check.

### Dispense calibration (dashboard is the source of truth)

The dashboard writes `EnergyDevice.gramsPerSecond`; both poll endpoints push it
as `grams_per_second`, and the sketch applies it on the next poll:

```
[CAL] grams_per_second=2.00 applied from feed-command (saved to NVS)
```

The value is mirrored into NVS (`cal_gps`), so a reboot continues on the
calibrated rate instead of the `4.0` compile-time default. NVS is written only
when the value actually changes, so a poll every few seconds cannot wear the
flash. At boot the sketch prints where the value came from:

```
[CAL] grams_per_second=2.00 (from NVS)      // restored after reboot
[CAL] grams_per_second=4.00 (compile-time default)   // never calibrated
```

An out-of-range value is refused and logged rather than applied:

```
[CAL] refused grams_per_second 0.10 from feed-command (out of range)
```

The relay duration is `grams / gramsPerSecond`, confirmed at fire time:

```
[FEED] dispensing 150g (~75000ms) - source: scheduled
```

The build must stay warning-free for our own sketch (`firmware-main.ino`), including zero
ArduinoJson deprecation warnings. The only warnings tolerated are two
`extra tokens at end of #undef directive` lines emitted by OneWire 2.3.8, which is third-party
library code this repository does not patch. Any other warning is a regression.

### Partition table (OTA bootstrap)

`firmware/platformio.ini` sets **`board_build.partitions = min_spiffs.csv`**:

| Partition | Offset | Size |
|---|---|---|
| `nvs` | `0x9000` | 20 KB — unchanged, so identities survive |
| `otadata` | `0xe000` | 8 KB |
| `app0` (OTA) | `0x10000` | 1,966,080 B (1.875 MB) |
| `app1` (OTA) | `0x1F0000` | 1,966,080 B (1.875 MB) |
| `spiffs` | — | unused (the firmware stores nothing in SPIFFS) |

The image that ships with this build uses **54.7 %** of a slot (1,075,653 B),
leaving room for future signed updates. A partition table can never be changed
over the air, which is why T-12a needs one last USB flash (decision OTA-1,
`docs/firmware-ota-plan.md` §6).

### Bootstrap USB flash (one per unit, the last manual flash)

1. Back up nothing on the device; the flash below preserves NVS.
2. Connect the unit over USB and run:

   ```bash
   pio run -d firmware -t upload
   ```

   This writes the bootloader, the **new partition table** and the app, and
   records the chip identity. Read the `[DEVICE MAC]` line in the serial log (it
   is also what Superadmin → Devices registers).
3. **Do not run `pio run -t erase` / `esptool erase_flash`.** A normal upload
   keeps the NVS partition at `0x9000`, so `wifi_ssid`, `wifi_pass`,
   `device_id`, `device_token` and `provisioned` keep working and the unit comes
   back online without reopening the setup portal. An erase wipes them and
   forces provisioning again. (Bench-verify: flash 1.5.0 over an existing unit
   and confirm the heartbeat arrives with the same device id and no portal.)
4. Optional while the unit is on the bench:

   ```bash
   pio run -d firmware -t upload --upload-port COM5
   pio device monitor -b 115200
   ```

   Serial should show the reset reason, `[FIRMWARE] v1.5.0`, the OTA state
   (`valid`) and `[READY] OptiFeed controller online.`

`pio run -d firmware` builds the **field** image, with the LAN updater compiled
out. For bench work that needs LAN ArduinoOTA:

```bash
pio run -d firmware -e esp32dev-lan -t upload
```

### Arduino IDE fallback

If you must use the Arduino IDE, install these libraries manually:
RTClib, Adafruit BusIO, ArduinoJson, OneWire, DallasTemperature. Select the
**Minimal SPIFFS (1.9 MB APP / 190 KB SPIFFS)** partition scheme; the default
1.25 MB scheme will not fit updates.

## Firmware 1.5.0 hardening

Field fixes found on hardware on 2026-10-27. None of them changes a GPIO
assignment, the relay-off boot state, `MAX_DISPENSE_MS`, the `optifeed` NVS
namespace or the feeding/safety logic.

| Change | Behaviour |
|---|---|
| No placeholder identity | The compile-time `DEVICE_MAC` / `DEVICE_TOKEN` fallbacks are gone. Only NVS `device_id` + `device_token` enable the API. An unprovisioned unit logs `[IDENTITY] not provisioned - API disabled`, broadcasts its setup AP and keeps feeding on the RTC schedule. It sends **no** ingest, feed-command, schedule-sync or OTA request. |
| Setup AP name | `provisioningApSsid()` now uses the last four hex digits of the stored Device ID when it parses as a MAC (`AA:BB:CC:DD:EE:FF`, `AA-BB-…` or 12 bare hex digits). Otherwise it uses the chip eFuse MAC, as before. Both IDs are logged at boot: `[DEVICE MAC]` (chip) and `[IDENTITY] Device ID` / `[IDENTITY] Setup AP name`. |
| Watchdog-safe poll cycle | API calls use an 8 s connect + 8 s read timeout and the TLS handshake is capped at 8 s. `esp_task_wdt_reset()` runs between every network call in the 5 s cycle and around each dispense, so a slow link cannot trip the 30 s task watchdog. The OTA check (6/10 s) and download (6/12 s plus its own 60 s no-data bound) keep their separate limits. |
| Feed button never missed | GPIO 23 is read by a falling-edge interrupt with the same 250 ms debounce, at most one pending press, and presses in the first 5 s after boot ignored. A press during a blocking HTTPS call dispenses on the next loop pass. The OTA download aborts on a confirmed button press and dispenses once. **1.5.3** adds the 50 ms confirmation, the post-dispense quiet window and the 30 s cooldown described below. |
| Wi-Fi picker in the setup portal | 1.5.2 (issue #252): the portal fills the picker with an **asynchronous** 2.4 GHz scan after the AP is up and the station is idle, sorts the result by signal, deduplicates by SSID, and offers a **Rescan** button. A scan that returns nothing retries once after 2 s; the real `scanNetworks`/`scanComplete` value is logged instead of being shown as "0 networks". Networks render as rows with signal bars and a lock icon (open networks are marked), plus "Type it manually". See **Setup Portal**. |
| Relay polarity flag | `-DRELAY_ACTIVE_LOW=0` or `1` (default `0`, active HIGH) derives `RELAY_ON` / `RELAY_OFF`; boot still forces OFF. |

## Firmware 1.5.3 button guard

Field issue on the CICT Building A unit (2026-10-28): 22 feeds with
`source = button`, 80 g each, with no server feed request, in pairs or triples
~20 s apart, plus one 25 minutes after the last dispense. That is relay/motor
switching noise coupling into the GPIO 23 line (internal ~45 kOhm pull-up only,
long wire), not a person pressing the button.

| Rule | Behaviour |
|---|---|
| A press must be real | The falling-edge interrupt only records a *candidate*. `loop()` samples GPIO 23 ten times over 50 ms; the press is accepted only when every sample reads LOW (or at least 90 %, tolerating one missed sample at release). Otherwise it is dropped and logged `[BUTTON] rejected glitch (<n> ms low)`, at most one log per 10 s. |
| Quiet window | Every button edge is ignored and cleared from relay ON until 2 s after relay OFF, whatever started the dispense (button, schedule or dashboard). Log: `[BUTTON] ignored during/after dispense`, at most one per 10 s. |
| Cooldown | At most one *button* dispense per 30 s (`BUTTON_COOLDOWN_MS`). A confirmed second press is refused with `[BUTTON] cooldown`; scheduled and dashboard feeds are unaffected. |
| Telemetry | Rejected edges are counted and sent as the optional `button_glitches` heartbeat field. The ingest schema strips unknown heartbeat keys, so this is diagnostic only until a server change stores it; each rejection is also on the Serial line. |
| Unchanged | 250 ms debounce, 5 s boot grace, one pending press, the GPIO 23 hold-at-boot WiFi reset, the relay-OFF boot state, `MAX_DISPENSE_MS`, the daily cap, the NVS namespace `optifeed`, device auth and OTA signing. |

A real press holds the line LOW for tens to hundreds of milliseconds; a switching
spike lasts microseconds. The firmware guard removes the symptom, but the wiring
should still be fixed:

- 10 kOhm pull-up from GPIO 23 to 3V3: the internal pull-up alone is too weak for
  a long run next to the motor.
- 100 nF from GPIO 23 to GND at the pin, so RF and switching noise is shunted.
- Flyback diode across the motor (stripe/cathode to motor +), so the collapsing
  coil current does not couple into the button wiring.
- Twist the button pair and keep it away from the motor and relay wiring.
- Recommended nearby: 100 nF on GPIO 16 and 17, and 470-1000 uF on the 5 V rail.

Bench check: a normal press (>= 100 ms) dispenses exactly once; a tap shorter than
50 ms is rejected; a press during a dispense is ignored; a second press inside 30 s
logs `[BUTTON] cooldown` and does not dispense.

## Firmware 1.6.0 fail-safe model

Firmware 1.6.0 makes the unit behave safely **without** the wiring fixes listed
above (pull-up, 100 nF, flyback diode, bulk capacitor). It was driven by the CICT
Building A field evidence in `docs/hardware/2026-10-28-cict-pin-map-and-health.md`:
phantom button feeds, a hopper reading flapping 0 % <-> 47 % in under a minute,
brownout reset loops with the motor on the same supply, and one task-watchdog
reset during a slow network cycle.

The pure logic lives in two header-only modules and is covered on the host:

- `firmware/firmware-main/safety.h` — dispense gate, reset history, safe mode,
  button noise guard, token buckets, HTTP backoff.
- `firmware/firmware-main/filters.h` — hopper plausibility, median/EMA,
  persistence, hysteresis, DS18B20 plausibility.

### Safety model

| Rule | Constant | Default | Behaviour |
|---|---|---|---|
| Relay OFF at boot | `RELAY_OFF` | active HIGH board | The pin is driven OFF before `pinMode`, again after it, and once more in a shutdown handler registered with `esp_register_shutdown_handler`, so every software reset, panic reboot, OTA install reboot and `ESP.restart()` opens the contacts first. |
| Dose hard stop | `MAX_DISPENSE_MS` | 300 000 ms (600 000 ms for a calibration-flagged dose) | A dose longer than the cap is **refused**, never truncated (a slow calibration must not halve a valid dose). |
| Relay overrun | `RELAY_OVERRUN_GRACE_MS` | 2 000 ms | If the relay is still on `expected duration + 2 s`, `kickWatchdog()` forces it OFF at the next network boundary (a blocking HTTPS call can delay `loop()`), logs `[SAFETY] relay overrun` and reports `feed_refused` with reason `relay_overrun`. |
| Minimum gap, any source | `MIN_DISPENSE_GAP_MS` | 10 000 ms | A second dose from button, schedule or dashboard inside 10 s is refused with reason `too_soon`. |
| Hourly ceiling, any source | `MAX_DISPENSES_PER_HOUR` | 6 | The seventh dose in a rolling hour is refused with reason `hourly_limit`. |
| Daily gram cap | `MAX_GRAMS_PER_DAY` | 5 000 g | Unchanged, now enforced inside the same gate as the two limits above. |
| Post-brownout hold | `BROWNOUT_HOLD_MS` | 60 000 ms | After a brownout reset every trigger is refused with reason `brownout_hold` for the first 60 s. The hardware brownout detector stays enabled. |
| Button noise | `BUTTON_NOISE_WINDOW_MS` / `BUTTON_NOISE_MAX` / `BUTTON_DISABLE_MS` | 60 s / 5 / 10 min | 1.5.3's 50 ms confirmation is kept. More than five rejected glitches in a minute disable the button for ten minutes (`[BUTTON] disabled: noisy line`); the heartbeat reports `button_disabled`. |
| Hopper samples | `HOPPER_SAMPLE_COUNT` | 5 | Median, with samples outside `2 cm .. empty + 10 cm` rejected. Fewer than three plausible samples is an **unknown** cycle, never 0 %. |
| Hopper smoothing | `HOPPER_EMA_ALPHA` | 0.35 | EMA on the distance, so one plausible-but-wrong echo moves the level by a third at most. |
| Hopper persistence | `HOPPER_JUMP_PCT` / `HOPPER_PERSIST_CYCLES` | 15 points / 3 | A change larger than 15 points is believed only after three consecutive cycles agree. |
| Pellet hysteresis | `HOPPER_LOW_PCT` / `HOPPER_REFILL_MARGIN_PCT` | 20 % / 10 points | Low at or below 20 %; leaves low only above 30 %. While low the reported value is capped at 20 %, so the server cannot see a refill or a warning from a value inside the band. |
| Pellet hold | `HOPPER_STATE_HOLD_MS` | 10 min | A low/refilled transition needs ten minutes since the previous one. Under-reporting the level is the safe direction. |
| Water probe | `temperaturePlausible()` | 0..50 C | The DS18B20 `-127 C` (disconnected) and `85 C` (power-on) sentinels are rejected, as is anything outside 0..50 C. The heartbeat sends `water_temp_ok: false` and omits `water_temp_c`. |
| Event rate limit | `FEED_EVENT_*`, `REFUSAL_*`, `ACK_*` | 12 / 5 min, 6 / 10 min, 6 / 60 s | One token bucket per event type at the source. The dispense bucket is sized above the hourly ceiling, so a real feeding record is never dropped by the limiter. |
| Offline queue | `EVENT_QUEUE_SIZE` | 50 | Bounded; when full it drops the **oldest** unsynced entry (never the newest) and counts the loss in `diag.queue_drops`. |
| HTTP retry | `HTTP_RETRY_BASE_MS` / `HTTP_RETRY_CAP_MS` | 5 s / 5 min | Every non-OTA call (heartbeat, feed poll, schedule sync, event flush, refusal report, schedule ack) backs off exponentially with +-20 % jitter, capped at five minutes. Retries are non-blocking: `loop()` keeps running. OTA keeps its own 1 h -> 6 h -> 24 h update ladder. |

The pure protections are checked by `pio test -d firmware -e native`
(27 tests): range rejection, median, persistence, hysteresis/hold, the 10 s gap,
the hourly ceiling, the daily cap, safe-mode entry/exit, the button disable, the
token buckets and the retry backoff.

### Safe mode

Three abnormal resets (`brownout`, `panic`, `interrupt_wdt`, `task_wdt`, `wdt`)
inside ten minutes put the unit into **safe mode**:

- The relay is locked OFF and every trigger (button, schedule, dashboard) is
  refused with reason `safe_mode`.
- The heartbeat still goes out and reports `safe_mode: true`,
  `last_reset_reasons` (for example `"task_wdt,brownout"`) and the same values
  inside `diag`.
- Serial logs exactly one `[SAFETY] SAFE MODE: <reasons>` line.
- OTA checks are postponed with reason `safe_mode` while it is active.

It leaves safe mode after **30 quiet minutes** (RTC-anchored, so a reboot does
not restart the clock; uptime-based when no clock is available) or immediately
on a Wi-Fi/factory reset hold. A **normal power-on** clears the reset counter;
a power cycle does **not** clear safe mode by itself. The counter is also
cleared after ten healthy minutes, so a later fault starts from zero.

NVS keys (namespace `optifeed`, new keys only):
`rst_abn_cnt`, `rst_abn_mask`, `rst_first_ep`, `rst_last_ep`, `safe_mode`,
`safe_until_ep`. The history is written at most once per boot (and once more
when safe mode is entered or left); never in a loop.

### Native tests (host)

```bash
pio test -d firmware -e native
```

The `[env:native]` environment excludes the sketch (it needs the ESP32 core) and
compiles `firmware-main/filters.h` and `firmware-main/safety.h` against Unity.
On Windows, `scripts/native_toolchain.py` falls back to the MinGW that
PlatformIO keeps in `~/.platformio/packages/toolchain-gccmingw32` when no `gcc`
is on `PATH`, and `scripts/native_runtime.py` copies its runtime DLLs beside the
test binary. On Linux/macOS both scripts are no-ops and the host compiler is
used directly.

## Firmware 1.7.0 — dashboard-driven configuration (I-100)

Jeff's 2026-10-31 instruction: *"make sure that all the code on the firmware is
variable based on the dashboard, do that on our next reflash."* Firmware 1.7.0
moves every **operational** value out of compile-time constants and into a
versioned `config` object that rides the existing 5-second feed-command poll
response, validated against an absolute safety envelope that a dashboard value
can never leave.

> **Do not flash from this branch.** 1.7.0 needs Jeff's explicit yes and a
> reflash (USB bootstrap or signed OTA). The contract, the native tests and the
> three board builds are the deliverable of I-100.

### Three classes

| Class | Meaning | Where it lives |
|---|---|---|
| **A — absolute safety envelope** | Outer bounds the dashboard can never exceed, and guards that are never configurable: relay on-time envelope (300 s), calibration envelope (600 s / 5,000 g), the 5,000 g/day hard guard, the 2 s relay overrun trip, GPIO pins, NVS namespace `optifeed`, TLS roots, device auth | `config.h` (`min`/`max` per field) and `firmware-main.ino` |
| **B — operational** | Every feeding, safe-mode, hopper, button, poll, OTA and calibration value; server-driven within (A) | `deviceConfig` (this header), sent by `GET /api/feed-command` |
| **C — transport / implementation** | HTTP timeouts, WiFi retry ladder, event token buckets, offline queue size, scan limits, OTA response size, provisioning timeouts | compile-time in `firmware-main.ino` (no dashboard home, no feeding effect) |

The daily ceiling is the **only** gram cap (decision E38). The firmware no
longer refuses a dose above 1,000 g: `max_grams_per_dose` is derived as
`min(max_grams_per_day, max_dispense_ms / 1000 × grams_per_second)`. The
relay-time guard and the firmware gate still apply, so a dose that would run
past the relay envelope is refused with `dose_time_exceeds_cap`.

### Inventory (firmware 1.6.2 → 1.7.0)

`Value` is the 1.6.2 compile-time value, which is also the 1.7.0 default, so an
old server (no `config` object) changes nothing.

| 1.6.2 constant | 1.7.0 JSON key | Value | Class |
|---|---|---|---|
| `MIN_DISPENSE_GAP_MS` | `min_dispense_gap_s` | 10 s (envelope 10–3,600) | B |
| `MAX_DISPENSES_PER_HOUR` | `max_dispenses_per_hour` | 6 (envelope 1–6) | B |
| `MAX_GRAMS_PER_DAY` | `max_grams_per_day` | 5,000 g (envelope 0–5,000) | B |
| `MAX_DISPENSE_MS` | `max_dispense_ms` | 300,000 ms (envelope 5,000–300,000) | B |
| `MAX_CALIBRATION_GRAMS` | `calibration_max_grams` | 5,000 g (envelope 100–5,000) | B |
| `MAX_CALIBRATION_DISPENSE_MS` | `calibration_max_dispense_ms` | 600,000 ms (envelope 10,000–600,000) | B |
| `BROWNOUT_HOLD_MS` | `brownout_hold_s` | 60 s (envelope 10–3,600) | B |
| `SAFE_MODE_ABNORMAL_WINDOW_MS` | `safe_mode_abnormal_window_s` | 600 s (envelope 60–86,400) | B |
| `SAFE_MODE_ABNORMAL_THRESHOLD` | `safe_mode_abnormal_threshold` | 3 (envelope 2–10) | B |
| `SAFE_MODE_QUIET_MS` | `safe_mode_quiet_s` | 1,800 s (envelope 60–86,400) | B |
| `SAFE_MODE_HEALTHY_CLEAR_MS` | `safe_mode_healthy_clear_s` | 600 s (envelope 60–86,400) | B |
| `DEFAULT_SCHEDULED_GRAMS` (via `grams_per_feeding`) | `grams_per_feeding` | 150 g (envelope 1–5,000) | B |
| `DEFAULT_BUTTON_FEED_GRAMS` | `button_feed_grams` | 80 g (envelope 1–500) | B |
| `DEFAULT_GRAMS_PER_SECOND` | `grams_per_second` | 4 g/s (envelope 0.5–50) | B |
| `TEMP_OFFSET_C` (backend) | `temp_offset_c` | 0 °C (envelope -20–20) | B |
| `HOPPER_FULL_CM` (backend) | `hopper_full_cm` | 5 cm (envelope 0.1–200) | B |
| `HOPPER_EMPTY_CM` (backend) | `hopper_empty_cm` | 30 cm (envelope 0.1–500) | B |
| `HOPPER_LOW_PCT` | `hopper_low_pct` | 20 % (envelope 1–90) | B |
| `HOPPER_REFILL_MARGIN_PCT` | `hopper_refill_margin_pct` | 10 % (envelope 0–50) | B |
| `HOPPER_REJECT_BELOW_CM` | `hopper_reject_below_cm` | 2 cm (envelope 0–50) | B |
| `HOPPER_REJECT_ABOVE_MARGIN_CM` | `hopper_reject_above_margin_cm` | 10 cm (envelope 0–100) | B |
| `HOPPER_EMA_ALPHA` | `hopper_ema_alpha` | 0.35 (envelope 0.05–1) | B |
| `HOPPER_JUMP_PCT` | `hopper_jump_pct` | 15 % (envelope 1–100) | B |
| `HOPPER_PERSIST_CYCLES` | `hopper_persist_cycles` | 3 (envelope 1–20) | B |
| `HOPPER_STATE_HOLD_MS` | `hopper_state_hold_s` | 600 s (envelope 0–86,400) | B |
| `BUTTON_DEBOUNCE_MS` | `button_debounce_ms` | 250 ms (envelope 10–2,000) | B |
| `BUTTON_STARTUP_GRACE_MS` | `button_startup_grace_ms` | 5,000 ms (envelope 0–60,000) | B |
| `BUTTON_QUIET_AFTER_DISPENSE_MS` | `button_quiet_after_dispense_ms` | 2,000 ms (envelope 0–60,000) | B |
| `BUTTON_COOLDOWN_MS` | `button_cooldown_ms` | 30,000 ms (envelope 0–3,600,000) | B |
| `BUTTON_LOG_INTERVAL_MS` | `button_log_interval_ms` | 10,000 ms (envelope 1,000–600,000) | B |
| `BUTTON_NOISE_WINDOW_MS` | `button_noise_window_ms` | 60,000 ms (envelope 1,000–3,600,000) | B |
| `BUTTON_NOISE_MAX` | `button_noise_max` | 5 (envelope 1–50) | B |
| `BUTTON_DISABLE_MS` | `button_disable_ms` | 600,000 ms (envelope 1,000–86,400,000) | B |
| `POST_INTERVAL_MS` | `heartbeat_interval_s` | 5 s (envelope 2–300) | B |
| `OTA_CHECK_INTERVAL_MS` | `ota_check_interval_s` | 1,800 s (envelope 300–86,400) | B |
| `OTA_MIN_UPTIME_MS` | `ota_min_uptime_s` | 600 s (envelope 60–86,400) | B |
| `OTA_MIN_RSSI_DBM` | `ota_min_rssi_dbm` | -75 dBm (envelope -100 to -30) | B |
| `OTA_FEED_GUARD_MINUTES` | `ota_feed_guard_min` | 20 min (envelope 5–240) | B |
| `OTA_WINDOW_START_MINUTE` | `ota_window_start_min` | 600 min (envelope 0–1,440) | B |
| `OTA_WINDOW_END_MINUTE` | `ota_window_end_min` | 900 min (envelope 0–1,440) | B |
| `OTA_MIN_FREE_HEAP_BYTES` | `ota_min_free_heap_bytes` | 60,000 B (envelope 20,000–200,000) | B |
| `OTA_NO_DATA_TIMEOUT_MS` | `ota_no_data_timeout_ms` | 60,000 ms (envelope 10,000–600,000) | B |
| `OTA_DOWNLOAD_TIMEOUT_MS` | `ota_download_timeout_ms` | 900,000 ms (envelope 60,000–3,600,000) | B |
| `OTA_HEALTH_CHECK_TIMEOUT_MS` | `ota_health_check_timeout_ms` | 300,000 ms (envelope 60,000–1,800,000) | B |
| `OrgSetting.offlineAfterMin` / I-95 policy | `weak_after_min`, `offline_after_min` | 5 / 15 min (envelope 1–60 / 5–180) | B (diagnostic) |
| `RELAY_OVERRUN_GRACE_MS` | — | 2,000 ms | A |
| `MAX_GRAMS_PER_DAY` (hard guard) / `MAX_DISPENSE_MS` (envelope) | envelope rows above | 5,000 g / 300,000 ms | A |
| `RELAY_PIN`, `BUTTON_PIN`, reset pins, RTC/ultrasonic/DS18B20 pins | — | build flag / compile-time | A |
| NVS namespace `optifeed` and existing keys | — | never renamed | A |
| `BUTTON_CONFIRM_SAMPLES` / `_SAMPLE_MS` / `_MIN_LOW_SAMPLES` | — | 10 / 5 ms / 9 | A (anti-spike guard) |
| `FEED_EVENT_*`, `REFUSAL_*`, `ACK_*` token buckets | — | 12/5 min, 6/10 min, 6/1 min | C |
| `HTTP_RETRY_BASE_MS` / `HTTP_RETRY_CAP_MS` | — | 5 s / 300 s | C |
| `HTTP_CONNECT_TIMEOUT_MS` / `HTTP_READ_TIMEOUT_MS` | — | 8 s / 8 s | C |
| `WIFI_RETRY_INTERVAL_MS`, `WIFI_INITIAL_RETRY_MS`, `WIFI_MAX_RETRY_MS` | — | 10 s / 10 s / 60 s | C |
| `WIFI_JOIN_WINDOW_MS`, `WIFI_FAILURES_BEFORE_PORTAL` | — | 15 s / 5 | C |
| `PROVISIONING_*` (scan, join, restart) | — | 20 networks, 300 ms/channel, 12 s scan, 2 s retry, 20 s join, 6 s quick fail, 5 s restart | C |
| `EVENT_QUEUE_SIZE` | — | 50 | C |
| `MAX_FEED_TIMES` | — | 24 | C |
| `OTA_MAX_CHECK_RESPONSE_BYTES`, `OTA_LOCAL_UTC_OFFSET_MINUTES` | — | 8,192 B / 480 min | C (time zone is a fleet constant) |
| `OTA_CHECK_URL`, `INGEST_URL`, `FEED_POLL_URL_BASE`, `SCHEDULE_SYNC_URL_BASE` | — | production URLs | C |
| TLS roots, OTA public keys, `PROVISIONING_AP_PREFIX` | — | compile-time | A |

Values with no dashboard home stay class B **defaults** on the server and are
still sent (so a later UI or a future setting can move them without a reflash):
the OTA guards, calibration ceiling, hopper filter tuning, button guard and
heartbeat interval.

### The `config` contract

```json
"config": {
  "version": 1,
  "rev": 1543210987,
  "min_dispense_gap_s": 10,
  "max_dispenses_per_hour": 6,
  "...": "every field in the table above"
}
```

Rules, all covered by `pio test -d firmware -e native`:

1. `version` must equal `1`; any other value is ignored (`unsupported`) so a
   future contract never half-applies on an old unit.
2. `rev` is required. The server hashes the whole object (FNV-1a over the fixed
   field order) and the firmware echoes it as `config_rev` in the heartbeat. A
   change therefore has a verifiable acknowledgement.
3. Missing object → keep the last-good copy (an old server never breaks a
   device). A present field that is absent keeps the last-good value.
4. Wrong type, NaN/Infinity, a fractional value in a whole-number field, any
   value outside its envelope, or an impossible pair (`hopper_full_cm >=
   hopper_empty_cm`, `ota_window_start_min >= ota_window_end_min`) → the **whole**
   object is ignored and the last-good copy stays. Nothing is clamped on the
   device: a bad config can never half-apply.
5. Last-good storage: NVS namespace `optifeed`, keys `cfg_json` (the operational
   fields only) and `cfg_rev`. New keys only; `cal_gps` and every existing key
   are untouched. A corrupt or hand-edited blob falls back to the compile-time
   defaults (a bad field rejects the whole blob).
6. Old firmware ignores the unknown `config` key; the server keeps the flat
   1.6.x fields, so a mixed fleet keeps working.
7. A refused feed still reports the existing `feed_refused` reasons with no
   contract change (`grams_out_of_range`, `dose_time_exceeds_cap`,
   `daily_gram_cap_exceeded`, `too_soon`, `hourly_limit`, ...).

### Server side

- `apps/web/lib/firmware/config.ts` — the field table, envelope, defaults,
  normalization and `buildFirmwareConfig()` (pure; also imported by the form).
- `apps/web/lib/settings/firmware-gates.ts` — reads `PlatformSetting`
  `firmware.gates` (no schema change).
- `apps/web/app/api/feed-command/route.ts` — overlays the device row
  (`gramsPerFeeding`, `buttonFeedGrams`, `gramsPerSecond`, `tempOffsetC`, hopper
  geometry), the resolved daily ceiling (`resolveDailyCapG`, which already
  applies the platform daily factor and the hopper capacity) and the platform
  relay cap (`feeding.limits`), plus the I-95 connectivity policy as
  diagnostics.
- Superadmin → Settings → **Firmware safety gates** edits the seven gate values
  (min gap, doses/hour, brownout hold, safe-mode window/threshold/quiet/
  healthy-clear) with min/max validation, a required reason and one audit row
  (`platform.settings.firmware_gates`) per save.
- `apps/web/lib/__tests__/firmware-config.test.ts` parses `config.h` and fails
  if the server table and the firmware table drift.

## Configuration

Open `firmware-main.ino` and fill in the `Config` section before flashing:

```cpp
#define DEFAULT_WIFI_SSID      "YOUR_WIFI_SSID"
#define DEFAULT_WIFI_PASS      "YOUR_WIFI_PASSWORD"
#define INGEST_URL             "https://pakaonai.syntaxure.dev/api/ingest"
#define FEED_POLL_URL_BASE     "https://pakaonai.syntaxure.dev/api/feed-command"
#define SCHEDULE_SYNC_URL_BASE "https://pakaonai.syntaxure.dev/api/schedule-sync"
#define OTA_CHECK_URL          "https://pakaonai.syntaxure.dev/api/firmware/check"
#define FW_VERSION             "1.8.0"
#define FW_BOARD               "wroom32u"
```

> The three API URLs and `OTA_CHECK_URL` are baked to the production host
> `https://pakaonai.syntaxure.dev`. The previous hosts (`optifeed.example.com`,
> then `optifeed.syntaxure.dev`) are dead: a unit flashed with an old build
> cannot reach the backend until it is reflashed, because the URL is
> compile-time, not NVS.

> **TLS trust store.** `ROOT_CA` is now a concatenated bundle: ISRG Root X1
> (Let's Encrypt RSA), ISRG Root X2 (Let's Encrypt ECDSA), ISRG Root YR
> (Let's Encrypt Gen-Y, RSA), GTS Root R1 (Google Trust Services) and
> GlobalSign Root CA. Each PEM was copied verbatim on 2026-10-26 from the
> issuer's own page, and the source URL plus the SHA-256 fingerprint sit in a
> comment above each certificate. The live chain on that date was
> leaf ← YR1 ← Root YR ← cross-signed by X1, so the self-signed Root YR in the
> bundle removes the dependency on that cross-sign.
>
> Bench verification required (cannot be proven without a radio):
> 1. Confirm the unit still reaches `/api/feed-command` over TLS with the
>    bundle (production chain validates).
> 2. Build a throwaway image whose `ROOT_CA` is an unrelated public root and
>    confirm every HTTPS call fails at the handshake and **no** request body or
>    token is sent. Never ship that image.
> 3. For each root, verify it can anchor its own chain: X1 via a cross-signed
>    Let's Encrypt endpoint, X2 via an ECDSA-issued Let's Encrypt host, YR via
>    `pakaonai.syntaxure.dev` today, GTS R1 via a `*.vercel.app` host and
>    GlobalSign via a GlobalSign-issued host. `openssl s_client -showcerts`
>    shows which chain is served before you test the unit.
> 4. Confirm the five embedded certificates match the fingerprints in the
>    source comment (`openssl x509 -fingerprint -sha256 -in <pem>`).

> `FW_VERSION` is printed at boot (`[FIRMWARE] v1.8.0`, under the
> `[DEVICE MAC]` line) and sent as `firmware_version` in every heartbeat. It is
> also the version the OTA check reports and compares against the signed
> manifest.

> The `?device_id=...` query on the poll and schedule endpoints is appended at runtime from the
> provisioned identity, so one binary works for every unit.

> The `DEFAULT_WIFI_*` values are only fallback placeholders. A device with no stored
> credentials, or with the placeholder SSID, starts the setup portal instead of trying to join
> a network.

> **No compile-time identity.** `DEVICE_MAC` and `DEVICE_TOKEN` no longer exist. The only
> identity is the NVS pair `device_id` / `device_token` (namespace `optifeed`), written by the
> setup portal. Until both exist the unit logs `[IDENTITY] not provisioned - API disabled`,
> runs only the setup portal and keeps feeding locally: it sends no ingest, feed-command,
> schedule-sync or OTA request, and a feed refusal is not reported either.

> **Naming:** the setup AP prefix is `PROVISIONING_AP_PREFIX` (`PakaonAI-`) in
> `firmware-main.ino`, mirrored by `AP_PREFIX` in `apps/web/lib/provisioning-ap.ts` (a web test
> compares the two). The four hex digits are the last four of the stored Device ID when it is a
> MAC, otherwise of the chip eFuse MAC. Units flashed with an older build still broadcast
> `OptiFeed-XXXX` until they are reflashed. The NVS namespace stays `optifeed` on purpose:
> renaming it would orphan the stored WiFi credentials and device identity on every flashed unit.


## Setup Portal

The feeder provisions its own WiFi connection **and** its backend identity (Device ID + Device
Token); no serial commands or reflash are needed.

### When it starts

The setup access point starts when:

- NVS has no usable `wifi_ssid` (first boot, erased NVS, or the SSID still equals
  `DEFAULT_WIFI_SSID`), or
- NVS has no usable `device_id` **and** `device_token` (first-time setup or a factory reset), or
- five consecutive station join attempts fail (for example, the router is off or the
  saved password changed).

### Registering a new unit (platform admin)

Do this once per unit, before it ships, in this order:

1. Flash the firmware and read the **`[DEVICE MAC]`** line from the boot log. That is the
   chip's eFuse MAC: the setup AP name and the sticker are both built from it.
2. In **Superadmin → Devices → Register device**, enter that MAC, a label, the organization and
   the pond, and a reason. The device token is shown **once**: copy it straight into the next step.
3. Power the unit with no WiFi saved, join `PakaonAI-XXXX`, open `http://192.168.4.1`, and enter
   the farm WiFi plus **Device ID** = the MAC and **Device Token** = the token from step 2.
4. Print the sticker (**Print sticker** in the same row) and stick it on the box.
5. Check that the AP name the unit broadcasts matches the SSID on the sticker, and that the unit
   shows as online in the tenant's Admin → Devices.

The sticker never carries the token. If the token is lost, use **Rotate token**: the old one stops
working at once, so re-enter the new one in the setup portal.

### Connecting

1. On a phone or laptop, join the open access point **`PakaonAI-XXXX`**, where `XXXX`
   is four uppercase hex characters. Before provisioning it is the last four of the **chip's
   eFuse MAC** (the `[DEVICE MAC]` line in the boot log); after provisioning it follows the
   stored Device ID when that is a MAC, so it matches the registered device and the sticker.
   The boot log prints `[IDENTITY] Setup AP name` either way.
2. Open **http://192.168.4.1** (captive-portal redirects also land here).
3. Pick your network from the list (2.4 GHz, strongest first; a lock icon means the network
   is secured, "Open" means it is not) or type the name. Wi-Fi names are **case-sensitive**.
   **Rescan** repeats the scan without blocking the feeder. Then enter:
   - **SSID** (1-32 characters) and **password** (empty for an open network, otherwise
     8-63 characters),
   - **Device ID** (1-64 characters) and **Device Token** (8-128 characters), both from
     **Admin → Devices** in the PakaonAI dashboard.
4. Press **Connect and save**. The unit **tests the network before saving it**: the setup AP
   stays up, the status page shows `Connecting…` for up to 20 s, and then either
   - **`Connected to <SSID> · IP x.x.x.x · signal -NN dBm`** — the credentials and identity
     are written to NVS together, the page says it will restart in 5 s, and the unit
     restarts into normal operation, or
   - **`Not connected`** with the reason (wrong password / network not found / no IP) —
     **nothing is written to NVS**, the old credentials keep working, and the form returns
     with the error so the network can be corrected and retried.

The identity fields are always rendered blank — the stored token is never sent back to the
browser. Leave them blank to keep the identity already stored in NVS (or the one from the
previous attempt in the same portal session). If the device has no usable identity yet, both
fields are required.

### Scan that actually finds networks (1.5.2, issue #252)

The field failure on 2026-10-28 (`WiFi scan found 0 network(s)` with five networks in range)
had a code cause, not an antenna cause: the portal starts immediately after a failed join, and
the old synchronous scan ran while the station side was still connecting.
`esp_wifi_scan_start()` refuses to start in that state (`ESP_ERR_WIFI_STATE`) and the Arduino
wrapper reports it as `WIFI_SCAN_FAILED` (-2), which the firmware printed as "0 networks".

The 1.5.2 behaviour:

- the station is settled first (`WiFi.setAutoReconnect(false)` + `WiFi.disconnect(false,
  false)` when it is not connected) and the mode is set to `WIFI_AP_STA` **before** the scan;
- the scan is **asynchronous** (`WiFi.scanNetworks(true, …)`, polled with `scanComplete()` from
  `serviceProvisioningScan()`), so `loop()`, the feed button and the 30 s task watchdog are
  never blocked;
- the AP and the portal server are already up before the scan starts, so the page loads while
  the scan runs;
- an empty or failed scan retries **once after 2 s**; a stuck scan is abandoned after 12 s;
- the serial log prints the raw value (`WiFi scan started (rc=…)`, `WiFi scan finished: N raw,
  M shown`, the first five SSIDs/RSSI, or the failure), never a password;
- a submit stops a running scan before it starts testing the new network.

If a unit still shows no networks: check that the u.FL antenna is attached (the 32U has no PCB
antenna), move closer to a 2.4 GHz router, then tap **Rescan**. 5 GHz networks are invisible to
the radio; type the 2.4 GHz SSID by hand if the router hides it.

### Portal endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Setup form; while a join is being tested, the live status page |
| POST | `/save` | Validate the form and start the test-before-save join (303 to `/`) |
| GET | `/status` | JSON: `state` (`connecting`/`connected`/`failed`), `ssid`, `ip`, `rssi`, `restartInMs`, `detail` and `message` on failure. Never contains a password or token |
| GET | `/scan` | JSON: `scanning`, `networks[]` (`ssid`, `rssi`, `secure`), `count`, `rawCount`, `error` |
| POST | `/scan` | Start an asynchronous rescan (409 while a join is being tested) |
| any other | — | Captive-portal 302 to `/` |

### Dependencies

Firmware 1.5.2 adds **no library**. The asynchronous scan uses the `WiFi` class that ships with
the Arduino-ESP32 core (`scanNetworks(async)`, `scanComplete()`, `scanDelete()`), and the JSON
endpoints use the `ArduinoJson` already listed in `platformio.ini`. `lib_deps` is unchanged, so
`pio pkg install -d firmware` and all three build environments work from a clean checkout.

### Button-hold WiFi reset

Hold the physical feed button (**GPIO 23**, wired to GND) during boot for at least
5 seconds. The serial log confirms the reset, the two NVS keys `wifi_ssid` and
`wifi_pass` (namespace `optifeed`) are removed, and the `PakaonAI-XXXX` portal starts.

- This is a **WiFi-only reset**: the identity keys `device_id` and `device_token` are kept.
  Re-enter just the new WiFi credentials and leave the identity fields blank.
- The dedicated **Wi-Fi reset button (GPIO 17)** does the same at any time after boot
  (5 s hold). The **factory reset button (GPIO 16)** wipes the identity as well
  (10 s hold), so the unit must be provisioned again.
- A normal short press still dispenses the configured button dose. Presses are captured by a
  falling-edge interrupt (250 ms debounce) and queued, so a short press during a blocking
  HTTPS call is not lost; presses in the first 5 s after boot are ignored.
- The hold is consumed by the reset, so it does not also trigger a feed.
- Releasing before 5 seconds cancels the reset and boots normally.

### Notes

- While the portal is active, local scheduled feeds, the physical button and the
  relay keep working; backend polling and telemetry are paused, and an unprovisioned unit
  makes no API calls at all.
- The portal AP is open (no password), local-only (`192.168.4.1`, no internet uplink),
  and exists only for provisioning. Provision the device somewhere you trust, and do not
  leave it in setup mode in public.
- The WiFi password is written only to NVS key `wifi_pass` and is never printed to
  serial, included in telemetry, or sent in API requests.
- The Device Token is written only to NVS key `device_token` and is never printed to
  serial or included in telemetry. It is sent to the backend only as the
  `X-Device-Token` header, and is never rendered back into the setup page.
- The `provisioned` NVS flag is set after a successful full save (WiFi + identity).

## Remote updates over the air (OTA)

Firmware 1.4.0 introduced the **bootstrap** build: the A/B partition table,
the multi-root trust store, two embedded signing public keys and the signed
update path. 1.5.0 keeps all of it and fixes the field behaviour described
above. The server half is T-12b (`GET /api/firmware/check`); this section
is the contract it must satisfy. Design: `docs/firmware-ota-plan.md` §4–§6,
decisions OTA-1…OTA-7.

### Safety contract

- The relay is initialized **OFF** and never energized while an update is
  downloading or while a freshly installed image is still unverified.
- The download writes only the **inactive** slot. `otadata` changes only in
  `Update.end(true)`, after the SHA-256 matches, so pulling power mid-download
  boots the old image again.
- Every image must be signed (ECDSA P-256 over the exact manifest) and
  checksummed (SHA-256 of the binary). `HTTPUpdate`/MD5 is not used.
- A single partition table can never be changed over the air; T-12a is the last
  USB flash (OTA-1).

### First boot after an install: pending verify

`verifyRollbackLater()` returns `true`, so the Arduino core leaves a freshly
installed image in `ESP_OTA_IMG_PENDING_VERIFY` instead of trusting it
immediately. The new image then has **5 minutes** (`OTA_HEALTH_CHECK_TIMEOUT_MS`)
to satisfy all three conditions:

1. Wi-Fi connected,
2. a valid clock (NTP system time or a plausible RTC date), and
3. one authenticated `200` from `GET /api/feed-command` (`X-Device-Token`).

When all three hold it calls `esp_ota_mark_app_valid_cancel_rollback()` and
reports `ota_state=valid`. If the deadline passes first it calls
`esp_ota_mark_app_invalid_rollback_and_reboot()`; the bootloader returns to the
previous slot. A crash or watchdog reset before validation is also handled by
the bootloader (bench-verify). While the check is active, every feed trigger is
refused and the thermostat-free relay stays OFF.

> A unit that has lost its stored Wi-Fi/identity cannot pass the check, so an
> OTA image installed on an unprovisioned unit rolls back. Updated units must
> still hold their NVS credentials (which a normal `pio run -t upload` keeps).

### Check request

Every `OTA_CHECK_INTERVAL_MS` (default 30 minutes) the unit sends:

```http
GET /api/firmware/check?device_id=<device_id>&version=1.5.0
X-Device-Token: <provisioned token>
```

Response, no update:

```json
{ "update": false }
```

Response with an update:

```json
{
  "update": true,
  "version": "1.5.1",
  "url": "https://<storage-host>/firmware/1.5.1.bin?<signed>",
  "size": 1070200,
  "sha256": "0123...cdef",
  "manifest": "{\"board\":\"wroom32u\",\"key_id\":\"primary\",\"min_from_version\":\"1.5.0\",\"sha256\":\"0123...cdef\",\"size\":1070200,\"version\":\"1.5.1\"}",
  "signature": "MEUCIQ...",
  "key_id": "primary"
}
```

Server requirements (implemented by T-12b in `apps/web/lib/firmware/ota.ts` and
`apps/web/app/api/firmware/check/route.ts`):

- All values are JSON strings except `update` (bool) and `size` (number).
- `sha256` is 64 lowercase or uppercase hex characters.
- `manifest` is a **string** containing JSON. The signature is over the exact
  UTF-8 bytes of that unescaped string — sign exactly what you send after JSON
  encoding, not a re-serialized copy.
- `signature` is base64 of the DER-encoded ECDSA P-256 signature (SHA-256).
- `key_id` is `primary` or `spare`, matching
  `firmware/keys/pakaonai-ota-*-public.pem`.
- `url` must be HTTPS, serve `Content-Length`, and point at the exact bytes.
  A short-lived signed Storage URL is expected; the device deliberately does
  **not** send its device token to that host.
- The response must declare `Content-Length` (the firmware refuses an unknown
  length) and be at most 8 KB.
- `manifest` must contain `board` (`wroom32u`), `version`, `size`, `sha256`,
  `key_id` and optionally `min_from_version`. The device refuses the whole
  update if any value disagrees with the envelope.

The device refuses, and postpones, when: the signature is invalid, the
`key_id` is unknown, the board is not `wroom32u`, the manifest and envelope
disagree, the version is not newer (semantic compare), the current version is
below the signed `min_from_version`, the image does not fit the OTA slot, the
URL is not HTTPS, or the SHA-256 of the downloaded bytes does not match. There
is **no downgrade path**.

### Pre-flight gate

The check and the download only happen while **all** of these hold
(`otaPreflightFailure()`); otherwise the unit postpones:

| Condition | Constant / source |
|---|---|
| Not feeding | `feederActive == false` |
| Not in safe mode | `safeModeActive == false` |
| No scheduled feed within ±20 min | `OTA_FEED_GUARD_MINUTES` |
| Not provisioning | setup portal inactive |
| Not in a pending-verify boot | `ota_state != pending_verify` |
| Wi-Fi connected, RSSI > −75 dBm | `OTA_MIN_RSSI_DBM` |
| Uptime > 10 minutes | `OTA_MIN_UPTIME_MS` |
| Last reset was not a brownout | `esp_reset_reason()` |
| Local time 10:00–15:00 | `OTA_WINDOW_START_MINUTE` / `OTA_WINDOW_END_MINUTE` |
| Enough free heap | `OTA_MIN_FREE_HEAP_BYTES` (60 KB) |

`OTA_LOCAL_UTC_OFFSET_MINUTES` (480 = UTC+8, Philippines) converts the
UTC RTC to local time **for the maintenance window only**. The schedule guard
uses the same RTC clock `handleSchedule()` fires on, so it reflects when this
unit would really dispense. A brownout reset postpones updates until the next
clean reboot (power safety, by decision).

Backoff after any postponement or failure: **1 h → 6 h → 24 h**, then held at
24 h. A check that answers `{update:false}` resets the ladder and the next check
is 30 minutes later. Every decision is logged on serial as `[OTA] ...`.

### Download, abort and state checkpoint

- Streams `HTTPClient` bytes into `Update.write()` in 1 KB chunks, feeding the
  task watchdog and computing SHA-256 incrementally. It aborts on no data for
  60 s, on 15 minutes total, on a content-length mismatch, or on a short read.
- **The physical feed button aborts the download** (decision OTA-2: feeding
  wins). The press is consumed and dispensed immediately after the abort.
- A scheduled feed that becomes due during a download also aborts it.
- The dashboard feed path is refused while `otaInProgress` and reports
  `feed_refused` with `reason: "ota_in_progress"`.
- On success: `Update.end(true)`, then a small checkpoint is written to NVS
  (namespace `optifeed`, new keys) and the unit reboots:

  | Key | Contents |
  |---|---|
  | `ota_day` | `YYYYMMDD` the checkpoint belongs to |
  | `ota_daily_grams` | `dailyGramsDispensed` |
  | `ota_fired_mask` | bit per schedule slot, bit 0 = slot 0 |
  | `ota_feed_count` | number of active schedule slots |
  | `ota_feed_times` | 48 bytes, hour/minute pairs for all 24 slots |

  At boot the schedule is restored every time; `dailyGramsDispensed` and the
  `firedToday` flags are restored only when `ota_day` matches the RTC date. The
  checkpoint is then consumed, so a later power cycle cannot resurrect stale
  numbers. If the RTC is missing, the schedule is restored and the daily
  counters are not.

### LAN OTA (bench only)

Decision OTA-7: **field builds contain no LAN updater**. `ArduinoOTA` (shared
static password, no signature) is compiled only with `-DENABLE_LAN_OTA`, which
the `esp32dev-lan` environment in `platformio.ini` adds:

```bash
pio run -d firmware -e esp32dev-lan -t upload
```

Never flash that build in the field.

### Release procedure (signed OTA, T-12b)

The server half is implemented in
`apps/web/app/api/firmware/check/route.ts` and `apps/web/lib/firmware/ota.ts`.
A release is described by **one JSON channel file** in the private Supabase
Storage bucket `firmware`; there is no database row yet (the Releases/Rollouts
UI is T-12c). One channel can target every unit or a MAC allowlist (canary).

`channels/stable.json`:

```json
{
  "version": "1.5.1",
  "storage_path": "releases/1.5.1/firmware.bin",
  "size": 1070200,
  "sha256": "0123...cdef",
  "manifest": "{\"board\":\"wroom32u\",\"key_id\":\"primary\",\"min_from_version\":\"1.5.0\",\"sha256\":\"0123...cdef\",\"size\":1070200,\"version\":\"1.5.1\"}",
  "signature": "MEUCIQ...",
  "key_id": "primary",
  "targets": "*"
}
```

`targets` is `"*"` or an array of MACs. Every value except `size` is a string;
`manifest` is the exact signed string (the signature is over those bytes, not a
re-serialized copy). The check endpoint answers `{update:false}` for a missing
channel, an unparseable/inconsistent channel, an untargeted device, a device
version at or above the release, a device below the signed
`min_from_version`, or unavailable Storage — the unit simply retries on its
next 30-minute check.

**Steps** (Jeff's machine, never CI or Vercel):

1. Bump `FW_VERSION` in `firmware-main.ino`, then build the field image:

   ```bash
   pio run -d firmware
   ```

2. Sign it with the offline private key. The public PEM must be the matching
   committed file in `firmware/keys/`; the script verifies the signature
   against it before writing anything.

   ```bash
   node scripts/ota/sign-release.mjs \
     --bin firmware/.pio/build/esp32dev/firmware.bin \
     --version 1.5.1 \
     --key ../ota-signing-keys/pakaonai-ota-primary-private.pem \
     --key-id primary \
     --min-from 1.5.0 \
     --targets all \
     --out ota-out
   ```

   `--targets all` covers every unit; use a comma-separated MAC list for a
   canary. `--key-id spare` uses the pre-positioned rotation key. The private
   key is never printed, and `ota-out/` is not committed.

3. Upload the two objects to the **private** `firmware` bucket with the
   service-role credentials (Supabase dashboard, or a trusted machine's CLI —
   never from CI and never from the app):

   | Local file | Storage object |
   |---|---|
   | `firmware/.pio/build/esp32dev/firmware.bin` | `releases/1.5.1/firmware.bin` |
   | `ota-out/channels/stable.json` | `channels/stable.json` |

4. Devices pick the release up on their next check (30 minutes by default)
   inside the 10:00–15:00 window, and only after every pre-flight condition
   above holds. The heartbeat then reports `ota_state=installed`, `valid` or
   `rolled_back` with `firmware_version`; the server records those as
   `DeviceStateEvent` rows (`ota_installed`, `ota_valid`, `ota_rolled_back`).

**Holding or widening a rollout:** replace `channels/stable.json` with a channel
whose `targets` includes or excludes the intended MACs. To pause everything,
delete the object or point it at the version already installed — a device never
accepts an equal or older version. There is no force flag and no downgrade path
in 1.5.0; a bad image rolls back on its own (bench plan step B).

**Signing keys:** the private keys stay offline in
`C:/Users/Lenovo/Documents/PakaonAI/ota-signing-keys` (decision OTA-4) and are
never generated, committed, logged or uploaded by this repository. Only
`firmware/keys/pakaonai-ota-primary-public.pem` and
`firmware/keys/pakaonai-ota-spare-public.pem` are committed, and a test keeps
them identical to the PEMs embedded in `firmware-main.ino`.

## Backend Contract


### `POST /api/ingest` — Telemetry & Events

**Heartbeat** (every 5s):
```json
{
  "device_id": "A4:CF:12:7E:3B:09",
  "event_type": "heartbeat",
  "timestamp": "2026-07-11T12:00:00+00:00",
  "rtc_ok": true,
  "feeder_active": false,
  "firmware_version": "1.8.0",
  "wifi_rssi": -58,
  "ota_state": "valid",
  "reset_reason": "poweron",
  "safe_mode": false,
  "last_reset_reasons": "none",
  "diag": {
    "fw": "1.6.0",
    "safe_mode": false,
    "reset_abnormal_count": 0,
    "reset_reason_mask": 0,
    "button_glitches": 0,
    "button_disabled": false,
    "relay_overruns": 0,
    "sensor_invalid_count": 0,
    "queue_drops": 0,
    "uptime_s": 3500,
    "min_dispense_gap_s": 10,
    "max_dispenses_per_hour": 6,
    "refusals_by_reason": { "too_soon": 1 }
  }
}
```

> `firmware_version`, `ota_state` and `reset_reason` are optional and additive. The ingest
> route parses the body with a Zod object schema (`apps/web/app/api/ingest/route.ts`), which
> strips keys it does not declare, so older and newer units both keep working. T-12b adds the
> three fields to the schema and persists them. `ota_state` is one of `idle`, `checking`,
> `pending_verify`, `valid`, `downloading`, `installed`, `aborted`, `failed`, `rolled_back`;
> `reset_reason` is one of `poweron`, `external`, `software`, `panic`, `interrupt_wdt`,
> `task_wdt`, `wdt`, `deepsleep`, `brownout`, `sdio`, `unknown`.
>
> **Wi-Fi signal (1.6.2, I-97).** `wifi_rssi` is `WiFi.RSSI()` in dBm. The heartbeat has
> carried it since 1.6.0, but the server only started accepting and storing it in 1.6.2:
> a value outside -127..0 (or a non-integer) is dropped without failing the heartbeat, and
> a heartbeat without the field leaves the last stored reading untouched. The app uses it
> for the "weak signal" state and the dBm text; units without it keep the timing-only rule.
>
> **1.6.0 diagnostics.** `safe_mode`, `last_reset_reasons` and the nested `diag` object are
> additive and currently **stripped** by the ingest schema (verified by
> `apps/web/lib/__tests__/ingest-route.test.ts`, which posts a heartbeat with all of them and
> asserts the stored row keeps its shape). They are therefore visible on the serial log and
> in the heartbeat body, not yet in the database. No server change is required for 1.6.0;
> storing them is a separate, additive follow-up. The analog fields the server does persist
> (`feed_level_percent`, `feed_level_cm`, `water_temp_c`, `water_temp_ok`) keep exactly the
> old contract; an implausible hopper cycle now **omits** the level instead of sending 0 %,
> and an implausible probe sends `water_temp_ok: false` with no `water_temp_c`.


**Feed dispensed**:
```json
{
  "device_id": "A4:CF:12:7E:3B:09",
  "event_type": "feed_dispensed",
  "timestamp": "2026-07-11T12:05:00+00:00",
  "grams": 150,
  "source": "scheduled",
  "feed_request_id": null
}
```

**Feed refused** (`event_type: "feed_refused"`, unchanged contract, `reason` is the only
extension point). Firmware 1.6.0 adds these reasons; the server stores the string verbatim
in the `feed_refused` device-state event and uses a scheduled refusal for the missed-feeding
alert:

| Reason | Meaning |
|---|---|
| `safe_mode` | the unit is in safe mode after repeated abnormal resets |
| `brownout_hold` | inside the 60 s hold after a brownout reset |
| `too_soon` | another dose started less than the configured minimum gap ago (any source) |
| `hourly_limit` | the configured doses-per-rolling-hour ceiling is reached |
| `relay_overrun` | the relay ran past its expected end + 2 s and was force-opened |
| `ota_in_progress` | a signed update is downloading (existing) |
| `grams_out_of_range`, `dose_time_exceeds_cap`, `daily_gram_cap_exceeded` | existing caps |
| `ota_pending_verify`, `busy` | counted in `diag.refusals_by_reason`, not posted |

> The ingest enum has no `safety_trip` event type, so a relay overrun is reported as the
> existing `feed_refused` with reason `relay_overrun` rather than by changing the server.

### `GET /api/feed-command?device_id=...` — Dashboard Feed Request

Response when no pending request (1.7.0; the `config` object is new and flat
fields remain for firmware <= 1.6.x):
```json
{
  "feed_requested": false,
  "feed_request_id": null,
  "grams": 0,
  "grams_per_feeding": 150,
  "button_feed_grams": 80,
  "hopper_full_cm": 5,
  "hopper_empty_cm": 30,
  "grams_per_second": 4,
  "temp_offset_c": 0,
  "server_time_utc": "2026-10-31T02:00:00.000Z",
  "farm_offset_minutes": 480,
  "config": {
    "version": 1,
    "rev": 1543210987,
    "min_dispense_gap_s": 10,
    "max_dispenses_per_hour": 6,
    "brownout_hold_s": 60,
    "safe_mode_abnormal_threshold": 3,
    "max_grams_per_day": 2000,
    "max_dispense_ms": 300000,
    "grams_per_feeding": 150,
    "heartbeat_interval_s": 5
  }
}
```

The full field list, the envelope and the fallback rules are in
[`docs/firmware-dashboard-config.md`](../docs/firmware-dashboard-config.md) and
`firmware-main/config.h`.

Response when farmer taps "Feed Now":
```json
{
  "feed_requested": true,
  "feed_request_id": "b3f1...uuid",
  "grams": 100,
  "calibration": false,
  "grams_per_feeding": 150,
  "config": { "version": 1, "rev": 1543210987 }
}
```

Auth: `X-Device-Token` header on all requests; the token is the provisioned identity
(`X-Device-Token` from NVS `device_token`). The `device_id` query and payload field come from
the provisioned Device ID (NVS `device_id`). An unprovisioned unit sends no request at all.

## Data Flow

```
ESP32 (every 5s)
  ├── POST /api/ingest          → heartbeat or feed_dispensed event
  └── GET  /api/feed-command    → check for dashboard feed requests

Dashboard
  └── "Feed Now" button → requestFeed() → FeedRequest (pending)
       → ESP32 polls /api/feed-command → dispenses → POST /api/ingest (feed_dispensed)
       → backend auto-clears FeedRequest to "completed"
```

## Calibration

The `GRAMS_PER_SECOND` constant (default 4.0) determines how long the relay stays closed. Measure by running the feeder for a fixed time and weighing the output:

```
GRAMS_PER_SECOND = grams_dispensed / seconds_run
```

A dashboard calibration test may run up to **600 s** and dispense up to **5,000 g**. That exception applies only when the server's feed command carries `calibration: true`; every other source keeps the 300 s / 1,000 g ceiling. The 10 s gap, six-per-hour ceiling and 5,000 g daily cap still apply, so a long test can consume the day's allowance.

## Verification

Portal checks (no backend needed):

1. Boot with erased NVS (or the placeholder SSID): the `PakaonAI-XXXX` AP appears and
   `http://192.168.4.1` serves the branded setup page (fish mark + PakaonAI wordmark, tagline
   "Sakto nga pakaon, sakto nga oras.", Device ID and AP name in the footer) with a network
   list, **SSID**, **Password**, **Device ID** and **Device Token** fields, and the
   case-sensitivity note.
2. Confirm the network list shows nearby 2.4 GHz networks after the scan: signal bars, a lock
   icon on secured networks, strongest first, no duplicate SSID. Serial prints
   `WiFi scan started (rc=-1)`, then `WiFi scan finished: N raw, M shown` and the first five
   SSIDs/RSSI. **Rescan** refreshes the list without a page reload or a feeder pause. Put the
   unit next to a 5 GHz-only router: no network is expected, and the page says
   "No Wi-Fi networks found. Check that the antenna is attached…".
3. Submit a valid SSID/password and a Device ID/Token: the status page shows `Connecting…`,
   then `Connected!` with the SSID, IP and signal, and the unit restarts ~5 s later. The next
   heartbeat uses the submitted identity.
4. Submit a **wrong password**: the status page shows `Not connected` with the wrong-password
   message, the form returns with the error, and the serial log says
   `[PROV] Join failed (wrong_password) - credentials NOT saved`. Confirm the unit still uses
   its previous credentials (or stays unprovisioned if this was the first setup) — the NVS
   keys must be unchanged.
5. Submit an SSID that does not exist: `Not connected` with `network not found`, nothing saved.
6. Hold GPIO 23 for 5 s at boot: serial reports the WiFi reset and the portal returns.
   The identity fields are blank with the "leave blank to keep existing" placeholder;
   submit only a new SSID/password and confirm the same Device ID is still used.
7. Let the unit run for more than 5 s, then hold the **Wi-Fi reset button (GPIO 17)**
   for 5 s: serial reports `[RESET] WiFi reset button held`, the unit reboots and the
   portal returns with the identity kept (both identity fields say "leave blank to
   keep existing").
8. Provision the unit, let it run past the 5 s grace, then hold the **factory reset
   button (GPIO 16)** for 10 s: serial reports `[RESET] Factory reset button held`,
   and the portal returns with no usable identity (both identity fields are required).
9. Hold **both** buttons: no reset happens at 5 s, and the factory reset completes at
   10 s — the factory reset wins.
10. Submit an SSID outside 1-32 characters, a password of 1-7 characters, a Device ID
    longer than 64 characters, or a token outside 8-128 characters: the form redisplays
    with an error and no join is started.
11. Boot a unit with a stored SSID and a stored identity: the portal does not start.
    Boot one with **no** identity (or after a factory reset): the portal starts and the
    serial log prints `[IDENTITY] not provisioned - API disabled`, and the backend sees
    no ingest, feed-command, schedule-sync or OTA request while local scheduled feeding
    still fires.
12. Confirm the serial log never prints the WiFi password or the Device Token, and that
    the setup page never renders a stored token. `/status` and `/scan` must not contain
    either.
13. Confirm the boot log prints `[FIRMWARE] v1.8.0` under the `[DEVICE MAC]` line and
    `[IDENTITY] Setup AP name`, and that a heartbeat carries the same version in
    `firmware_version`.
14. Confirm the boot log prints `[INIT] Reset reason: ...`, `[OTA] state -> valid` and
    `[OTA] LAN ArduinoOTA disabled (field build; -DENABLE_LAN_OTA for bench)`.
15. With a stored MAC Device ID, confirm the AP name uses its last four hex digits; with
    a non-MAC Device ID, confirm it uses the chip eFuse MAC.
16. Press the feed button for >= 100 ms while a 5 s network cycle is running: exactly one
    button dose dispenses, and the serial log shows no missed press.
17. Build with `-DRELAY_ACTIVE_LOW=1` and confirm the relay rests OFF at boot and only
    energizes for a dose.
18. Tap the button for < 50 ms: nothing dispenses and the serial prints
    `[BUTTON] rejected glitch (<n> ms low)`. Repeat within 10 s: the log line is
    rate-limited to one per 10 s.
19. Press the button while a dose is running (and again within 2 s of it ending):
    `[BUTTON] ignored during/after dispense`, and no extra dose.
20. Press twice, 5 s apart: the first dispenses, the second prints `[BUTTON] cooldown`
    and does not. Press again after 30 s: it dispenses.

### Fail-safe checks (1.6.0, bench)

21. Boot and confirm one `[BOOT] summary:` line (fw, reset reason, safe mode, relay GPIO,
    identity, Wi-Fi, feed count, limits) and `[INIT] Relay shutdown handler registered`.
22. Trigger two doses inside 10 s (button, then a dashboard feed): the second is refused
    with `[FEED] REFUSED too_soon` and reports `feed_refused` with reason `too_soon`.
23. Trigger seven doses in one hour: the seventh is refused with `hourly_limit`.
24. Hold the feed button during a long blocking network cycle with a *short* stored dose
    (for example 1 g): the relay opens at the expected end, and if the loop was delayed
    past 2 s the log shows `[SAFETY] relay overrun` and the server records `relay_overrun`.
25. Disconnect the HC-SR04 (or point it at nothing) for one heartbeat: the log increments
    `sensor_invalid_count`, no `feed_level_percent` is sent for that beat, and the dashboard
    keeps the last known level instead of showing 0 %.
26. Short the DS18B20 data line or unplug the probe: `water_temp_ok: false`, no
    `water_temp_c`, `sensor_invalid_count` increments. Reconnect: values resume.
27. Cover/uncover the hopper repeatedly for a minute: the reported level must not alternate
    `0 %`/`47 %` on every heartbeat. A real refill (above threshold + 10 points for 10
    minutes) prints one `[HOPPER] refilled` line.
28. Pull power three times in a row while the motor is on (bench, with the motor on the same
    supply): the fourth boot prints exactly one `[SAFETY] SAFE MODE: <reasons>` line, the
    heartbeat reports `safe_mode: true`, a button press is refused with `safe_mode`, and the
    relay stays open. Leave it powered for 30 minutes: `[SAFETY] safe mode cleared`.
29. While in safe mode, hold the Wi-Fi reset button for 5 s: the unit reboots with safe mode
    cleared (`[SAFETY] safe mode and reset history cleared by a reset hold`).
30. Noise the button line (tap a wire on GPIO 23 briefly, six times within a minute): after
    the sixth rejection the log prints `[BUTTON] disabled for 600 s: noisy line`, the
    heartbeat reports `button_disabled: true`, and a real press does nothing until the
    window ends.
31. Watch a Wi-Fi outage: heartbeat/feed-poll retries space out (5 s, 10 s, 20 s …) and stop
    at five minutes instead of hammering every 5 s.

Run the host tests before flashing:

```bash
pio test -d firmware -e native     # 27 tests, no board required
```

After flashing, test the API endpoints against the production backend:

```bash
# Test heartbeat ingest (expect 204 No Content)
curl -X POST https://pakaonai.syntaxure.dev/api/ingest \
  -H "Content-Type: application/json" \
  -H "X-Device-Token: <device-token>" \
  -d '{"device_id":"A4:CF:12:7E:3B:09","event_type":"heartbeat","timestamp":"2026-07-11T12:00:00Z","rtc_ok":true,"feeder_active":false,"firmware_version":"1.6.0","ota_state":"valid","reset_reason":"poweron","safe_mode":false,"diag":{"fw":"1.6.0"}}'

# Test feed command polling (expect feed_requested: false)
curl https://pakaonai.syntaxure.dev/api/feed-command?device_id=A4:CF:12:7E:3B:09 \
  -H "X-Device-Token: <device-token>"
```

## OTA bench test plan (hardware only)

Everything below needs a real ESP32-WROOM-32U on a bench with a controllable
power switch. None of it can be proven by the compiler, `pnpm test` or CI.
Record the serial log for every step.

### Preparation

1. Flash 1.5.0 over USB (`pio run -d firmware -t upload`) and confirm NVS
   survived: same `[DEVICE MAC]`, no setup portal, heartbeats arrive.
2. Build 1.5.1 by changing only `FW_VERSION` to `"1.5.1"`. Build a deliberately
   broken 1.5.2: keep `FW_VERSION` `"1.5.2"` and make `setup()` hang before the
   health check can pass (for example an infinite loop after 10 s, or a boot
   that never joins Wi-Fi). **Never** sign 1.5.2 for anything but the bench.
3. Sign both manifests offline with Jeff's primary key (never in CI, never in
   the repository): `{version, sha256, size, board:"wroom32u",
   min_from_version:"1.5.0", key_id:"primary"}`. Base64 the DER signature.
4. Point the check endpoint at the two manifests; the signed Storage URLs must
   serve the exact bytes with `Content-Length`.

### A. Happy path 1.5.0 → 1.5.1

- Wait for a check inside 10:00–15:00 local with no feed within ±20 min.
- Serial: `[OTA] update 1.5.1 available`, `download 10%…100%`,
  `state checkpointed`, `image verified and installed`, reboot.
- After reboot: `[OTA] first boot of a new image`, then Wi-Fi + authenticated
  poll set `state -> valid` within 5 minutes. `[FIRMWARE] v1.5.1`.
- The heartbeat reports `firmware_version=1.5.1`, `ota_state=valid`.
- Daily grams, `firedToday` and the server schedule survive the reboot (compare
  before/after; `ota_day` must match the RTC date).

### B. Deliberately bad 1.5.1 → 1.5.2 (must roll back)

- Serial: install starts and completes, then the new image boots and fails the
  health check. After 5 minutes: `health check FAILED`, `state -> rolled_back`,
  `esp_ota_mark_app_invalid_rollback_and_reboot()`.
- The unit must come back as **1.5.1** and resume feeding on its schedule. The
  server sees 1.5.1 with `ota_state` reset by the reboot (the failed image
  cannot report after rollback).

### C. Power pulled during the download

- Start the 1.4.2 download and pull power at roughly 50 %.
- Re-apply power: the unit boots the **old** 1.5.1 slot (the boot partition was
  never switched), rejoins Wi-Fi, and keeps feeding. No `pending_verify`.

### D. Power pulled during pending verify

- Install the bad 1.4.2 and pull power **before** the 5-minute window ends (for
  example 60 s after the install reboot).
- Re-apply power: the bootloader must treat the image as unverified and boot
  the previous 1.5.1 slot. This is the load-bearing rollback proof.

### E. Watchdog reset during pending verify

- Install the bad 1.4.2 and let it hang so the 30 s task watchdog resets it
  during the pending-verify window.
- After the reset the bootloader must roll back to 1.5.1, not re-enter the same
  bad image forever.

### F. Safety and gate checks

- Press the physical feed button mid-download: the download aborts
  (`state -> aborted`), nothing is installed, and a button feed dispenses.
- While `ota_state=pending_verify`, no scheduled, button or dashboard feed
  energizes the relay.
- Ask for a dashboard feed during a download: it is refused with
  `feed_refused` / `reason=ota_in_progress`.
- Set RSSI below −75 dBm, a feed within 20 minutes, a brownout reset, a
  time outside 10:00–15:00, or < 60 KB free heap: the check must postpone with
  `[OTA] postponed (<reason>)` and back off 1 h → 6 h → 24 h.
- Send a manifest signed with the **spare** key and `key_id:"spare"`: accepted.
  Change one byte of the manifest, or name an unknown `key_id`: refused before
  any download.
- Send a manifest for `board:"other"`, a version equal to/older than the
  current one, a size larger than 1,966,080 B, or a SHA-256 that does not match
  the bytes: all refused.
- Start a check with the wrong root pinned: the TLS handshake fails and
  `feed_refused`/telemetry is not sent in the clear (see the TLS bench points
  in **Configuration**).

### G. Field-build check

- Flash `pio run -d firmware` (default env) and confirm `ArduinoOTA` is absent:
  no OTA port answers on the LAN, and boot prints
  `[OTA] LAN ArduinoOTA disabled`.
- Flash `-e esp32dev-lan` and confirm LAN ArduinoOTA works only there.
