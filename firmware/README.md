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
| GPIO 27 | Physical button (INPUT_PULLUP, press = LOW) |
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

## Configuration

Open `firmware-main.ino` and fill in the `Config` section before flashing:

```cpp
#define WIFI_SSID      "YOUR_WIFI_SSID"
#define WIFI_PASS      "YOUR_WIFI_PASSWORD"
#define INGEST_URL     "https://your-deployed-url.com/api/ingest"
#define FEED_POLL_URL  "https://your-deployed-url.com/api/feed-command?device_id=A4:CF:12:7E:3B:09"
#define DEVICE_TOKEN   "esp32-tok-cict-001"
#define DEVICE_MAC     "A4:CF:12:7E:3B:09"
```

> The default `DEVICE_TOKEN` and `DEVICE_MAC` match the Prisma seed data so the device is recognized out of the box.

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
