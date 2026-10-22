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
| GPIO 27 | Physical button (INPUT_PULLUP, press = LOW). Hold >= 5 s at boot to reset WiFi credentials |
| GPIO 21 | DS3231 SDA (I²C) — RTC                 |
| GPIO 22 | DS3231 SCL (I²C) — RTC                 |
| GPIO 1  | TX0 (USB debug serial)                  |
| GPIO 3  | RX0 (USB debug serial)                  |
| GPIO 0  | Must float during boot (boot mode)      |

## Required Libraries

Install via Arduino Library Manager:

- **RTClib** (Adafruit) — DS3231 RTC
- **ArduinoJson** (Benoit Blanchon) — payload building
- **WiFi** / **HTTPClient** / **WiFiClientSecure** (built-in with ESP32 core)
- **WebServer** / **DNSServer** (built-in with ESP32 core) — WiFi setup portal

## Configuration

Open `firmware-main.ino` and fill in the `Config` section before flashing:

```cpp
#define DEFAULT_WIFI_SSID  "YOUR_WIFI_SSID"
#define DEFAULT_WIFI_PASS  "YOUR_WIFI_PASSWORD"
#define INGEST_URL         "https://your-deployed-url.com/api/ingest"
#define FEED_POLL_URL      "https://your-deployed-url.com/api/feed-command?device_id=A4:CF:12:7E:3B:09"
#define DEVICE_TOKEN       "esp32-tok-cict-001"
#define DEVICE_MAC         "A4:CF:12:7E:3B:09"
```

> The `DEFAULT_WIFI_*` values are only fallback placeholders. A device with no stored
> credentials, or with the placeholder SSID, starts the WiFi setup portal instead of
> trying to join a network. Use the portal (below) to provision it.

> The default `DEVICE_TOKEN` and `DEVICE_MAC` match the Prisma seed data so the device is recognized out of the box.

## WiFi Setup Portal

The feeder provisions its own WiFi connection; no serial commands or reflash are needed.

### When it starts

The setup access point starts when:

- NVS has no usable `wifi_ssid` (first boot, erased NVS, or the SSID still equals
  `DEFAULT_WIFI_SSID`), or
- five consecutive station join attempts fail (for example, the router is off or the
  saved password changed).

### Connecting

1. On a phone or laptop, join the open access point **`OptiFeed-XXXX`**, where `XXXX`
   is the last four hex characters of `DEVICE_MAC` in uppercase with separators
   removed. For `A4:CF:12:7E:3B:09` the AP is `OptiFeed-3B09`.
2. Open **http://192.168.4.1** (captive-portal redirects also land here).
3. Enter the **SSID** (1-32 characters) and **password** (empty for an open network,
   otherwise 8-63 characters), then press **Save and restart**.
4. The device acknowledges the save, reboots after about 2 seconds, and joins the
   network through the normal station path. The portal stops as soon as a join
   succeeds and does not run during normal operation.

### Button-hold credential reset

Hold the physical feed button (**GPIO 27**, wired to GND) during boot for at least
5 seconds. The serial log confirms the reset, the two NVS keys `wifi_ssid` and
`wifi_pass` (namespace `optifeed`) are removed, and the `OptiFeed-XXXX` portal starts.

- A normal short press still dispenses the configured button dose.
- The hold is consumed by the reset, so it does not also trigger a feed.
- Releasing before 5 seconds cancels the reset and boots normally.

### Notes

- While the portal is active, local scheduled feeds, the physical button and the
  relay keep working; backend polling and telemetry are paused until WiFi returns.
- The portal AP is open (no password) and exists only for provisioning. Provision
  the device somewhere you trust, and do not leave it in setup mode in public.
- The WiFi password is written only to NVS key `wifi_pass` and is never printed to
  serial, included in telemetry, or sent in API requests.

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

Auth: `X-Device-Token` header on all requests.

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
   `http://192.168.4.1` serves the setup form.
2. Submit a valid SSID/password: success page, reboot after ~2 s, then a normal join.
3. Hold GPIO 27 for 5 s at boot: serial reports the reset and the portal returns.
4. Submit an SSID outside 1-32 characters or a password of 1-7 characters: the form
   redisplays with an error and the device does not reboot.
5. Confirm the serial log never prints the WiFi password.

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
