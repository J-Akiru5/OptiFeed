/*
  OptiFeed — ESP32 Feeder Controller (3-Way Fallback)
  -----------------------------------------------------
  Trigger tiers, all routed through one shared dispenseFeed() function:

    1. SCHEDULED  — RTC-driven, fires at FEED_TIMES below (default 06:00
       and 19:00). Works with NO WiFi/backend connectivity at all — this
       is the whole point of this tier. Uses the last successfully
       cached grams-per-feeding amount if the backend is unreachable.
    2. DASHBOARD  — polled every POST_INTERVAL_MS from the backend, for
       manual/extra feeds or malfunction workarounds triggered remotely.
    3. PHYSICAL BUTTON — local override, works even with WiFi fully down.
       Debounced by polling in loop(), not an ISR (kept simple on
       purpose — loop() has no blocking calls after setup()).

  RELAY LOGIC — confirmed hardware behavior (not an assumption):
    - Relay is NORMALLY OPEN (NO). At rest, with no signal, the contacts
      are open and the feeder circuit is broken — this is the correct
      "not dispensing" state and matches the required boot default.
    - Driving the control pin HIGH energizes the coil, closing the NO
      contacts, which dispenses feed.
    - So: RELAY_ON = HIGH (dispensing), RELAY_OFF = LOW (resting/open).
      Boot always forces RELAY_OFF before anything else runs.

  Libraries required (Arduino Library Manager):
    - "RTClib" by Adafruit
    - "ArduinoJson" by Benoit Blanchon
    - WiFi / HTTPClient / WiFiClientSecure (built-in, ESP32 core)
*/

#include <WiFi.h>
#include <Wire.h>
#include <RTClib.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

// ==================== Config — fill in before flashing ====================
#define WIFI_SSID       "YOUR_WIFI_SSID"
#define WIFI_PASS       "YOUR_WIFI_PASSWORD"
#define INGEST_URL      "https://optifeed.example.com/api/ingest"
#define FEED_POLL_URL   "https://optifeed.example.com/api/feed-command?device_id=A4:CF:12:7E:3B:09"
#define DEVICE_TOKEN    "esp32-tok-cict-001"
#define DEVICE_MAC      "A4:CF:12:7E:3B:09"

#define RELAY_PIN       25
#define BUTTON_PIN      27          // pick any free GPIO; wired to GND via INPUT_PULLUP
#define RTC_SDA         21
#define RTC_SCL         22

#define RELAY_ON        HIGH        // energizes coil, closes NO contacts -> dispensing
#define RELAY_OFF       LOW         // rest state, contacts open -> not dispensing

#define POST_INTERVAL_MS    5000    // telemetry + dashboard feed-command poll interval
#define BUTTON_DEBOUNCE_MS  250
#define WIFI_RETRY_INTERVAL_MS 10000

// ---- Calibration: how fast the feeder dispenses ----
// Measure by running the feeder for a fixed time and weighing the output:
// GRAMS_PER_SECOND = grams_dispensed / seconds_run.
// TODO: replace with AI-driven auto-calibration later — this constant is
// the manual placeholder that auto-calibration will eventually tune.
#define GRAMS_PER_SECOND   4.0

// ---- Default dispense amounts per trigger source ----
#define DEFAULT_SCHEDULED_GRAMS 150.0  // used until backend gives us a real value
#define BUTTON_FEED_GRAMS       80.0   // fixed — no dashboard input possible offline
#define DEFAULT_MANUAL_GRAMS    100.0  // used if dashboard omits a grams value

// ---- Fixed daily schedule (24h time) ----
struct ScheduledFeed {
  uint8_t hour;
  uint8_t minute;
  bool firedToday;
};
ScheduledFeed feedTimes[] = {
  { 6, 0, false },   // 06:00
  { 19, 0, false },  // 19:00
};
const int FEED_TIMES_COUNT = sizeof(feedTimes) / sizeof(feedTimes[0]);

// ---- Offline event queue (so button/manual feeds during a WiFi outage
//      still make it into Feeding History once connectivity returns) ----
struct QueuedEvent {
  bool used;
  bool synced;
  float grams;
  char source[12];       // "scheduled" | "dashboard" | "button"
  String requestId;      // non-empty only for dashboard-sourced feeds
  String isoTimestamp;   // best-effort; may be "unknown" if RTC unavailable
};
#define EVENT_QUEUE_SIZE 10
QueuedEvent eventQueue[EVENT_QUEUE_SIZE];

// ==================== State ====================
RTC_DS3231 rtc;
WiFiClientSecure secureClient;

bool rtcAvailable = false;
bool feederActive = false;
unsigned long feedStartTime = 0;
unsigned long feedDurationMs = 0;
float currentFeedGrams = 0;
const char* currentFeedSource = "";
String currentFeedRequestId = "";

float cachedScheduledGrams = DEFAULT_SCHEDULED_GRAMS;
unsigned long lastPoll = 0;

// WiFi maintenance
bool wifiWasConnected = false;
unsigned long lastWifiRetry = 0;

// button debounce
int lastButtonReading = HIGH;
unsigned long lastButtonChangeMs = 0;
unsigned long lastHandledButtonChangeMs = 0;

// Event ID counter — combined with esp_random() for uniqueness across reboots
static uint32_t eventCounter = 0;

String generateEventId() {
  eventCounter++;
  uint32_t r = esp_random();
  char buf[24];
  snprintf(buf, sizeof(buf), "evt-%08lx-%04lx", r, eventCounter & 0xFFFF);
  return String(buf);
}

void setup() {
  Serial.begin(115200);

  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, RELAY_OFF);   // feeder must NEVER default to dispensing at boot
  feederActive = false;

  pinMode(BUTTON_PIN, INPUT_PULLUP);    // press pulls LOW

  for (int i = 0; i < EVENT_QUEUE_SIZE; i++) eventQueue[i].used = false;

  Wire.begin(RTC_SDA, RTC_SCL);
  if (!rtc.begin()) {
    Serial.println("[WARN] RTC not found — scheduled feeding disabled until wired. Continuing.");
    rtcAvailable = false;
  } else {
    rtcAvailable = true;
    if (rtc.lostPower()) {
      Serial.println("[RTC] lost power, time will sync from NTP");
    }
  }

  connectWiFi();
  if (WiFi.status() == WL_CONNECTED) {
    wifiWasConnected = true;
    if (rtcAvailable) syncNTP();
  }

  Serial.println("[READY] OptiFeed controller online.");
}

void loop() {
  maintainWiFi();

  handleButton();

  if (rtcAvailable) handleSchedule();

  if (millis() - lastPoll >= POST_INTERVAL_MS) {
    sendTelemetry();
    pollDashboardFeedCommand();
    flushQueuedEvents();
    lastPoll = millis();
  }

  if (feederActive && (millis() - feedStartTime >= feedDurationMs)) {
    stopFeedCycle();
  }
}

// ==================== Shared dispense logic ====================

void dispenseFeed(float grams, const char* source, const String &requestId = "") {
  if (feederActive) {
    Serial.printf("[FEED] busy — ignoring %s trigger\n", source);
    return;
  }
  feedDurationMs = (unsigned long)((grams / GRAMS_PER_SECOND) * 1000.0);
  Serial.printf("[FEED] dispensing %.0fg (~%lums) — source: %s\n", grams, feedDurationMs, source);

  digitalWrite(RELAY_PIN, RELAY_ON);
  feederActive = true;
  feedStartTime = millis();
  currentFeedGrams = grams;
  currentFeedSource = source;
  currentFeedRequestId = requestId;
}

void stopFeedCycle() {
  digitalWrite(RELAY_PIN, RELAY_OFF);
  feederActive = false;
  Serial.printf("[FEED] complete — %.0fg via %s\n", currentFeedGrams, currentFeedSource);
  enqueueEvent(currentFeedGrams, currentFeedSource, currentFeedRequestId);
  currentFeedRequestId = "";
}

// ==================== Tier 1 — RTC Schedule ====================

void handleSchedule() {
  DateTime now = rtc.now();

  static int lastCheckedDay = -1;
  if (now.day() != lastCheckedDay) {
    for (int i = 0; i < FEED_TIMES_COUNT; i++) feedTimes[i].firedToday = false;
    lastCheckedDay = now.day();
  }

  for (int i = 0; i < FEED_TIMES_COUNT; i++) {
    if (!feedTimes[i].firedToday &&
        now.hour() == feedTimes[i].hour &&
        now.minute() == feedTimes[i].minute) {
      feedTimes[i].firedToday = true;
      dispenseFeed(cachedScheduledGrams, "scheduled");
    }
  }
}

// ==================== Tier 2 — Dashboard poll ====================

void pollDashboardFeedCommand() {
  HTTPClient https;
  if (!https.begin(secureClient, FEED_POLL_URL)) return;
  https.addHeader("X-Device-Token", DEVICE_TOKEN);
  int code = https.GET();
  if (code == 200) {
    StaticJsonDocument<192> doc;
    if (!deserializeJson(doc, https.getString())) {
      if (doc.containsKey("grams_per_feeding")) {
        cachedScheduledGrams = doc["grams_per_feeding"] | cachedScheduledGrams;
      }
      bool requested = doc["feed_requested"] | false;
      if (requested) {
        float grams = doc["grams"] | DEFAULT_MANUAL_GRAMS;
        String requestId = doc["feed_request_id"] | "";
        dispenseFeed(grams, "dashboard", requestId);
      }
    }
  }
  https.end();
}

// ==================== Tier 3 — Physical button ====================

void handleButton() {
  int reading = digitalRead(BUTTON_PIN);
  if (reading != lastButtonReading) {
    lastButtonChangeMs = millis();
    lastButtonReading = reading;
  }
  if ((millis() - lastButtonChangeMs) > BUTTON_DEBOUNCE_MS && reading == LOW) {
    if (lastButtonChangeMs != lastHandledButtonChangeMs) {
      lastHandledButtonChangeMs = lastButtonChangeMs;
      dispenseFeed(BUTTON_FEED_GRAMS, "button");
    }
  }
}

// ==================== Telemetry + offline event queue ====================

void enqueueEvent(float grams, const char* source, const String &requestId) {
  for (int i = 0; i < EVENT_QUEUE_SIZE; i++) {
    if (!eventQueue[i].used) {
      eventQueue[i].used = true;
      eventQueue[i].synced = false;
      eventQueue[i].grams = grams;
      strncpy(eventQueue[i].source, source, sizeof(eventQueue[i].source) - 1);
      eventQueue[i].requestId = requestId;
      eventQueue[i].isoTimestamp = rtcAvailable ? getRTCiso8601() : "unknown";
      return;
    }
  }
  Serial.println("[WARN] event queue full — oldest unsynced event may be lost");
}

void flushQueuedEvents() {
  if (WiFi.status() != WL_CONNECTED) return;
  for (int i = 0; i < EVENT_QUEUE_SIZE; i++) {
    if (eventQueue[i].used && !eventQueue[i].synced) {
      if (postFeedEvent(eventQueue[i])) {
        eventQueue[i].synced = true;
        eventQueue[i].used = false;
      }
    }
  }
}

bool postFeedEvent(QueuedEvent &ev) {
  HTTPClient https;
  if (!https.begin(secureClient, INGEST_URL)) return false;
  https.addHeader("Content-Type", "application/json");
  https.addHeader("X-Device-Token", DEVICE_TOKEN);

  String eventId = generateEventId();
  StaticJsonDocument<256> doc;
  doc["device_id"]       = DEVICE_MAC;
  doc["event_type"]      = "feed_dispensed";
  doc["event_id"]        = eventId;
  doc["grams"]           = ev.grams;
  doc["source"]          = ev.source;
  doc["feed_request_id"] = ev.requestId.length() ? ev.requestId : (char*)nullptr;
  doc["timestamp"]       = ev.isoTimestamp;
  String out;
  serializeJson(doc, out);

  int code = https.POST(out);
  https.end();
  Serial.printf("[EVENT POST] %s %.0fg -> %d\n", ev.source, ev.grams, code);
  return code == 200 || code == 201 || code == 204;
}

void sendTelemetry() {
  HTTPClient https;
  if (!https.begin(secureClient, INGEST_URL)) return;
  https.addHeader("Content-Type", "application/json");
  https.addHeader("X-Device-Token", DEVICE_TOKEN);

  String eventId = generateEventId();
  StaticJsonDocument<192> doc;
  doc["device_id"]     = DEVICE_MAC;
  doc["event_type"]    = "heartbeat";
  doc["event_id"]      = eventId;
  doc["timestamp"]     = rtcAvailable ? getRTCiso8601() : "unknown";
  doc["rtc_ok"]        = rtcAvailable;
  doc["feeder_active"] = feederActive;
  String out;
  serializeJson(doc, out);

  int code = https.POST(out);
  Serial.printf("[POST] %d\n", code);
  https.end();
}

// ==================== WiFi / NTP / RTC helpers ====================

void connectWiFi() {
  Serial.printf("[WiFi] connecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(WiFi.status() == WL_CONNECTED ? " connected" : " not connected yet — will retry in loop()");
}

void maintainWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiWasConnected) {
      Serial.println("[WiFi] reconnected");
      if (rtcAvailable) syncNTP();
    }
    wifiWasConnected = true;
    return;
  }

  wifiWasConnected = false;
  if (millis() - lastWifiRetry >= WIFI_RETRY_INTERVAL_MS) {
    Serial.println("[WiFi] disconnected — attempting reconnect");
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    lastWifiRetry = millis();
  }
}

void syncNTP() {
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  struct tm timeinfo;
  if (getLocalTime(&timeinfo)) {
    rtc.adjust(DateTime(timeinfo.tm_year + 1900, timeinfo.tm_mon + 1,
                        timeinfo.tm_mday, timeinfo.tm_hour,
                        timeinfo.tm_min, timeinfo.tm_sec));
    Serial.println("[NTP] RTC synced");
  } else {
    Serial.println("[NTP] sync failed, using RTC's existing time");
  }
}

String getRTCiso8601() {
  DateTime now = rtc.now();
  char buf[32];
  now.toString(buf);
  return String(buf) + "+00:00";
}
