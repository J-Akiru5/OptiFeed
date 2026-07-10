# OptiFeed ESP32 Firmware — `firmware-main.ino`

> PZEM-stripped, audited firmware for the **ESP32-WROOM-32U** acting as the unified
> OptiFeed controller (relay = feeding trigger + relay/energy telemetry pipeline).
>
> Copy-paste this into the Arduino IDE as `firmware-main.ino`.

## Hardware Pinout (Post-Audit)

| Pin | Usage |
|-----|-------|
| GPIO 21 | DS3231 SDA (I²C) — RTC |
| GPIO 22 | DS3231 SCL (I²C) — RTC |
| GPIO 25 | Relay OUT (Active HIGH — CLOSED when HIGH) |
| GPIO 1 | TX0 (USB debug) |
| GPIO 3 | RX0 (USB debug) |
| GPIO 0 | Must float during boot (boot mode) |

> GPIO 16/17/5/4/18/19 are **freed** (PZEM removed). GPIO 25 relay init must be `HIGH`
> (CLOSED) at boot to maintain the default feeding state.

## Required Libraries

Install via Arduino Library Manager:

- `RTClib` (Adafruit) — DS3231 RTC
- `ArduinoJson` (Benoit Blanchon) — payload building
- `WiFi` (built-in with ESP32 core)
- `HTTPClient` / `WiFiClientSecure` (built-in with ESP32 core)
- `WebSocketsClient` (Links2004) — optional real-time relay commands

## Config Constants

Fill these in before flashing:

```cpp
// ====== OptiFeed ESP32 Config ======
#define WIFI_SSID     "YOUR_WIFI_SSID"
#define WIFI_PASS     "YOUR_WIFI_PASSWORD"
#define INGEST_URL    "https://optifeed.example.com/api/ingest"
#define RELAY_POLL_URL "https://optifeed.example.com/api/relay-state?device_id=A4:CF:12:7E:3B:09"
#define WS_HOST       "optifeed.example.com"  // optional; leave blank to use polling only
#define WS_PORT       443
#define WS_PATH       "/ws"
#define DEVICE_TOKEN  "esp32-tok-cict-001"
#define DEVICE_MAC    "A4:CF:12:7E:3B:09"
#define RELAY_PIN     25
#define RTC_SDA       21
#define RTC_SCL       22
#define POST_INTERVAL_MS 5000
// ===================================
```

## Firmware

```cpp
#include <WiFi.h>
#include <Wire.h>
#include <RTClib.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <WebSocketsClient.h>

RTC_DS3231 rtc;
WebSocketsClient wsClient;
WiFiClientSecure secureClient;

unsigned long lastPost = 0;
bool relayState = true;            // local mirror of GPIO 25

void setup() {
  Serial.begin(115200);
  Wire.begin(RTC_SDA, RTC_SCL);
  if (!rtc.begin()) {
    Serial.println("[HALT] RTC not found");
    while (true) delay(1000);
  }
  if (rtc.lostPower()) {
    Serial.println("[RTC] lost power, time will sync from NTP");
  }

  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, HIGH);   // relay CLOSED at boot (active HIGH)
  relayState = true;

  connectWiFi();
  syncNTP();
  if (String(WS_HOST).length() > 0) {
    connectWebSocket();
  }
}

void loop() {
  if (millis() - lastPost >= POST_INTERVAL_MS) {
    String payload = buildPayload();
    sendTelemetry(payload);
    pollRelayState();              // fallback command path
    lastPost = millis();
  }
  if (String(WS_HOST).length() > 0) {
    wsClient.loop();               // process real-time relay commands
  }
}

// ---------- WiFi ----------
void connectWiFi() {
  Serial.printf("[WiFi] connecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" connected");
}

// ---------- NTP -> RTC ----------
void syncNTP() {
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  struct tm timeinfo;
  if (getLocalTime(&timeinfo)) {
    rtc.adjust(DateTime(timeinfo.tm_year + 1900, timeinfo.tm_mon + 1,
                        timeinfo.tm_mday, timeinfo.tm_hour,
                        timeinfo.tm_min, timeinfo.tm_sec));
    Serial.println("[NTP] RTC synced");
  } else {
    Serial.println("[NTP] sync failed, using RTC time");
  }
}

// ---------- WebSocket ----------
void connectWebSocket() {
  wsClient.beginSsl(WS_HOST, WS_PORT, WS_PATH, "", "");
  wsClient.enableHeartbeat(15000, 3000, 2);
  wsClient.onEvent(onWsEvent);
  Serial.println("[WS] connected");
}

void onWsEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println("[WS] disconnected");
      break;
    case WStype_CONNECTED:
      Serial.println("[WS] connected to server");
      break;
    case WStype_TEXT: {
      String msg((char *)payload);
      if (msg == "CMD_RELAY_ON")      setRelay(true);
      else if (msg == "CMD_RELAY_OFF") setRelay(false);
      break;
    }
    default:
      break;
  }
}

// ---------- Relay ----------
void setRelay(bool closed) {
  relayState = closed;
  digitalWrite(RELAY_PIN, closed ? HIGH : LOW);
  Serial.printf("[RELAY] %s\n", closed ? "CLOSED" : "OPEN");
}

// ---------- Telemetry ----------
String getRTCiso8601() {
  DateTime now = rtc.now();
  char buf[32];
  now.toString(buf);
  // RTClib format: YYYY-MM-DDTHH:MM:SS -> append +00:00 offset
  return String(buf) + "+00:00";
}

String buildPayload() {
  StaticJsonDocument<128> doc;
  doc["device_id"]   = DEVICE_MAC;
  doc["timestamp"]   = getRTCiso8601();
  doc["relay_state"] = relayState;
  String out;
  serializeJson(doc, out);
  return out;
}

void sendTelemetry(String payload) {
  HTTPClient https;
  if (https.begin(secureClient, INGEST_URL)) {
    https.addHeader("Content-Type", "application/json");
    https.addHeader("X-Device-Token", DEVICE_TOKEN);
    int code = https.POST(payload);
    Serial.printf("[POST] %d\n", code);
    https.end();
  }
}

// ---------- Relay Polling Fallback ----------
void pollRelayState() {
  HTTPClient https;
  if (https.begin(secureClient, RELAY_POLL_URL)) {
    https.addHeader("X-Device-Token", DEVICE_TOKEN);
    int code = https.GET();
    if (code == 200) {
      String body = https.getString();
      StaticJsonDocument<64> doc;
      DeserializationError err = deserializeJson(doc, body);
      if (!err) {
        bool commanded = doc["relay_state"] | true;
        if (commanded != relayState) setRelay(commanded);
      }
    }
    https.end();
  }
}
```

## Verification

After flashing, confirm end-to-end with the OptiFeed API:

```bash
curl -X POST https://optifeed.example.com/api/ingest \
  -H "Content-Type: application/json" \
  -H "X-Device-Token: esp32-tok-cict-001" \
  -d '{"device_id":"A4:CF:12:7E:3B:09","timestamp":"2026-07-10T15:00:00Z","relay_state":true}'
# expect 204 No Content

curl https://optifeed.example.com/api/relay-state?device_id=A4:CF:12:7E:3B:09 \
  -H "X-Device-Token: esp32-tok-cict-001"
# expect {"relay_state":true}
```
