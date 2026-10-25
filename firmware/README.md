# OptiFeed ESP32 Firmware

3-way fallback firmware for the **ESP32-WROOM-32U** acting as the unified OptiFeed controller. Three independent trigger paths, all routed through one shared `dispenseFeed()` function.

## Trigger Tiers

1. **SCHEDULED** — RTC-driven, fires at 06:00 and 19:00. Works with NO WiFi/backend connectivity.
2. **DASHBOARD** — polled every 5s from the backend. Manual/extra feeds triggered remotely.
3. **PHYSICAL BUTTON** — local override on GPIO 27. Works even with WiFi fully down.

## Hardware Pinout

| Pin   | Usage                                    |
|-------|------------------------------------------|
| GPIO 25 | Relay OUT (Active HIGH — dispensing when HIGH) |
| GPIO 27 | Physical button (INPUT_PULLUP, press = LOW). Hold >= 5 s at boot to reset WiFi credentials (device identity is kept) |
| GPIO 21 | DS3231 SDA (I²C) — RTC                 |
| GPIO 22 | DS3231 SCL (I²C) — RTC                 |
| GPIO 1  | TX0 (USB debug serial)                  |
| GPIO 3  | RX0 (USB debug serial)                  |
| GPIO 0  | Must float during boot (boot mode)      |

### Dedicated reset buttons (optional)

Two active-low momentary buttons can be wired between a free GPIO and GND. They
are **not assigned yet**; the firmware skips them while the pins are `-1`.

| Button | Define | Default | Hold | Effect |
|--------|--------|---------|------|--------|
| WiFi reset | `WIFI_RESET_BUTTON_PIN` | `-1` (disabled) | 10 s | Clears WiFi SSID/password **and the WiFi stack cache**, keeps Device ID/Token, reboots into the setup portal |
| Factory reset | `FACTORY_RESET_BUTTON_PIN` | `-1` (disabled) | 10 s | Clears WiFi, Device ID, Device Token and the `provisioned` marker, reboots into the setup portal |

Safety rules: buttons are ignored for the first 5 s after boot and must be
released once before they arm, so a stuck button cannot wipe a unit. If both
reach 10 s, factory reset wins. The existing feed-button hold (GPIO 27, 5 s at
boot) remains a WiFi-only reset.

**Free, safe GPIO candidates on the ESP32-WROOM-32U for these two buttons:**

```
13, 14, 16, 17, 18, 19, 23
```

Recommended pair once the enclosure is measured: **18 (WiFi reset)** and
**19 (factory reset)** — neither is a strapping pin, both support the internal
pull-up, and neither is used by this sketch.

Do **not** use: 32/33 (HC-SR04 trigger/echo), 25 (relay), 26 (DS18B20),
27 (feed button), 21/22 (RTC I2C), 0/2/12/15 (strapping), 34–39 (input-only, no
internal pull-up), 1/3 (USB serial), 6–11 (flash).

## Build & flash (PlatformIO)

The firmware is a PlatformIO project (`firmware/platformio.ini`) using the same
toolchain as the energy-monitoring project: `espressif32@7.1.2`, board
`esp32dev` (ESP32-WROOM-32U), Arduino framework. Dependencies are declared and
resolved by PlatformIO — no Arduino Library Manager step.

```bash
pip install platformio        # or use the PlatformIO IDE extension
pio run -d firmware            # compile
pio run -d firmware -t upload  # flash over USB
pio device monitor -b 115200   # serial log
```

CI runs `pio run -d firmware` for every firmware change; it never flashes or
deploys.

### Arduino IDE fallback

If you must use the Arduino IDE, install these libraries manually:
RTClib, Adafruit BusIO, ArduinoJson, OneWire, DallasTemperature.

## Configuration

Open `firmware-main.ino` and fill in the `Config` section before flashing:

```cpp
#define DEFAULT_WIFI_SSID      "YOUR_WIFI_SSID"
#define DEFAULT_WIFI_PASS      "YOUR_WIFI_PASSWORD"
#define INGEST_URL             "https://your-deployed-url.com/api/ingest"
#define FEED_POLL_URL_BASE     "https://your-deployed-url.com/api/feed-command"
#define SCHEDULE_SYNC_URL_BASE "https://your-deployed-url.com/api/schedule-sync"
#define DEVICE_TOKEN           "esp32-tok-cict-001"
#define DEVICE_MAC             "A4:CF:12:7E:3B:09"
```

> The `?device_id=...` query on the poll and schedule endpoints is appended at runtime from the
> provisioned identity, so one binary works for every unit.

> The `DEFAULT_WIFI_*` values are only fallback placeholders. A device with no stored
> credentials, or with the placeholder SSID, starts the setup portal instead of trying to join
> a network.

> `DEVICE_MAC` (the Device ID) and `DEVICE_TOKEN` are only the **fallback identity**. Once a device
> is provisioned through the setup portal, the NVS keys `device_id` and `device_token` (namespace
> `optifeed`) take over. Units flashed with the seeded values keep working without ever opening the
> portal; units left with placeholder values such as `YOUR_DEVICE_ID` must be provisioned.

> The default `DEVICE_TOKEN` and `DEVICE_MAC` match the Prisma seed data so the device is recognized out of the box.

## Setup Portal

The feeder provisions its own WiFi connection **and** its backend identity (Device ID + Device
Token); no serial commands or reflash are needed.

### When it starts

The setup access point starts when:

- NVS has no usable `wifi_ssid` (first boot, erased NVS, or the SSID still equals
  `DEFAULT_WIFI_SSID`), or
- no usable device identity is available from NVS or from the non-placeholder compile-time
  defaults, or
- five consecutive station join attempts fail (for example, the router is off or the
  saved password changed).

### Connecting

1. On a phone or laptop, join the open access point **`OptiFeed-XXXX`**, where `XXXX`
   is the last four hex characters of the active Device ID in uppercase with separators
   removed. For the default `A4:CF:12:7E:3B:09` the AP is `OptiFeed-3B09`.
2. Open **http://192.168.4.1** (captive-portal redirects also land here).
3. Enter:
   - **SSID** (1-32 characters) and **password** (empty for an open network, otherwise
     8-63 characters),
   - **Device ID** (1-64 characters) and **Device Token** (8-128 characters), both from
     **Admin → Devices** in the OptiFeed dashboard.
4. Press **Save and restart**. The device acknowledges the save, reboots after about
   2 seconds, and joins the network through the normal station path. The portal stops as
   soon as a join succeeds and does not run during normal operation.

The identity fields are always rendered blank — the stored token is never sent back to the
browser. Leave them blank to keep the identity already in use (the NVS identity, or a
non-placeholder compile-time default). If the device has no usable identity yet, both fields
are required.

### Button-hold WiFi reset

Hold the physical feed button (**GPIO 27**, wired to GND) during boot for at least
5 seconds. The serial log confirms the reset, the two NVS keys `wifi_ssid` and
`wifi_pass` (namespace `optifeed`) are removed, and the `OptiFeed-XXXX` portal starts.

- This is a **WiFi-only reset**: the identity keys `device_id` and `device_token` are kept.
  Re-enter just the new WiFi credentials and leave the identity fields blank.
- A normal short press still dispenses the configured button dose.
- The hold is consumed by the reset, so it does not also trigger a feed.
- Releasing before 5 seconds cancels the reset and boots normally.

### Notes

- While the portal is active, local scheduled feeds, the physical button and the
  relay keep working; backend polling and telemetry are paused until WiFi returns.
- The portal AP is open (no password), local-only (`192.168.4.1`, no internet uplink),
  and exists only for provisioning. Provision the device somewhere you trust, and do not
  leave it in setup mode in public.
- The WiFi password is written only to NVS key `wifi_pass` and is never printed to
  serial, included in telemetry, or sent in API requests.
- The Device Token is written only to NVS key `device_token` and is never printed to
  serial or included in telemetry. It is sent to the backend only as the
  `X-Device-Token` header, and is never rendered back into the setup page.
- The `provisioned` NVS flag is set after a successful full save (WiFi + identity).

## Backend Contract

### `POST /api/ingest` — Telemetry & Events

**Heartbeat** (every 5s):
```json
{
  "device_id": "A4:CF:12:7E:3B:09",
  "event_type": "heartbeat",
  "timestamp": "2026-07-11T12:00:00+00:00",
  "rtc_ok": true,
  "feeder_active": false
}
```

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

### `GET /api/feed-command?device_id=...` — Dashboard Feed Request

Response when no pending request:
```json
{
  "feed_requested": false,
  "feed_request_id": null,
  "grams": 0,
  "grams_per_feeding": 150
}
```

Response when farmer taps "Feed Now":
```json
{
  "feed_requested": true,
  "feed_request_id": "b3f1...uuid",
  "grams": 100,
  "grams_per_feeding": 150
}
```

Auth: `X-Device-Token` header on all requests; the token is the provisioned identity
(NVS `device_token`, or the compile-time `DEVICE_TOKEN` fallback). The `device_id` query and
payload field come from the provisioned Device ID (NVS `device_id`, or `DEVICE_MAC`).

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

## Verification

Portal checks (no backend needed):

1. Boot with erased NVS (or the placeholder SSID): the `OptiFeed-XXXX` AP appears and
   `http://192.168.4.1` serves the setup form with **SSID**, **Password**, **Device ID** and
   **Device Token** fields.
2. Submit a valid SSID/password and a Device ID/Token: success page, reboot after ~2 s,
   then a normal join. The next heartbeat uses the submitted identity.
3. Hold GPIO 27 for 5 s at boot: serial reports the WiFi reset and the portal returns.
   The identity fields are blank with the "leave blank to keep existing" placeholder;
   submit only a new SSID/password and confirm the same Device ID is still used.
4. Submit an SSID outside 1-32 characters, a password of 1-7 characters, a Device ID
   longer than 64 characters, or a token outside 8-128 characters: the form redisplays
   with an error and the device does not reboot.
5. Boot a unit with a stored SSID and a non-placeholder compile-time `DEVICE_MAC` /
   `DEVICE_TOKEN`: the portal does not start.
6. Confirm the serial log never prints the WiFi password or the Device Token, and that
   the setup page never renders a stored token.

After flashing, test the API endpoints against your deployed backend:

```bash
# Test heartbeat ingest (expect 204 No Content)
curl -X POST https://your-deployed-url.com/api/ingest \
  -H "Content-Type: application/json" \
  -H "X-Device-Token: esp32-tok-cict-001" \
  -d '{"device_id":"A4:CF:12:7E:3B:09","event_type":"heartbeat","timestamp":"2026-07-11T12:00:00Z","rtc_ok":true,"feeder_active":false}'

# Test feed command polling (expect feed_requested: false)
curl https://your-deployed-url.com/api/feed-command?device_id=A4:CF:12:7E:3B:09 \
  -H "X-Device-Token: esp32-tok-cict-001"
```
