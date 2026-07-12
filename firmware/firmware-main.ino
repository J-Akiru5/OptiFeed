/*
  OptiFeed — ESP32 Feeder Controller (3-Way Fallback)
  -----------------------------------------------------
  Trigger tiers, all routed through one shared dispenseFeed() function:

    1. SCHEDULED  — RTC-driven, works with NO WiFi/backend connectivity.
       Schedule dynamically set via pollScheduleCommand() from backend.
    2. DASHBOARD  — polled every POST_INTERVAL_MS from the backend, for
       manual/extra feeds or malfunction workarounds triggered remotely.
    3. PHYSICAL BUTTON — local override, works even with WiFi fully down.
       Dose amount is set via backend poll response (button_feed_grams),
       not a compile-time constant.

  RELAY LOGIC:
    - Relay is NORMALLY OPEN (NO).
    - Driving the control pin HIGH energizes the coil, closing NO contacts.
    - RELAY_ON = HIGH (dispensing), RELAY_OFF = LOW (resting/open).
    - Boot always forces RELAY_OFF before anything else runs.
    - Mutex rule: first-acquire-wins. No source preempts another.
      If the relay is busy, incoming triggers are silently ignored.
      The event queue captures everything that actually dispensed.

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
#define SCHEDULE_SYNC_URL "https://optifeed.example.com/api/schedule-sync?device_id=A4:CF:12:7E:3B:09"
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
#define DEFAULT_BUTTON_FEED_GRAMS 80.0 // overridden by backend poll response
#define DEFAULT_MANUAL_GRAMS    100.0  // used if dashboard omits a grams value

// ---- Max feed times (schedule supports up to 24 feeds per day) ----
#define MAX_FEED_TIMES 24

// ---- Daily schedule (dynamically set from backend poll) ----
struct ScheduledFeed {
  uint8_t hour;
  uint8_t minute;
  bool firedToday;
};
ScheduledFeed feedTimes[MAX_FEED_TIMES];
int feedTimesCount = 0;

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
float cachedButtonFeedGrams = DEFAULT_BUTTON_FEED_GRAMS;  // mutable — set from backend poll
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

  // Seed default schedule: 06:00 and 19:00
  buildDefaultSchedule();

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
    pollScheduleCommand();
    flushQueuedEvents();
    lastPoll = millis();
  }

  if (feederActive && (millis() - feedStartTime >= feedDurationMs)) {
    stopFeedCycle();
  }
}

// ==================== Default schedule ====================

void buildDefaultSchedule() {
  feedTimes[0] = { 6, 0, false };   // 06:00
  feedTimes[1] = { 19, 0, false };  // 19:00
  feedTimesCount = 2;
  Serial.println("[SCHEDULE] default schedule loaded (06:00, 19:00)");
}

// ==================== Shared dispense logic ====================

void dispenseFeed(float grams, const char* source, const String &requestId = "") {
  if (feederActive) {
    Serial.printf("[FEED] busy — ignoring %s trigger (mutex held)\n", source);
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
    for (int i = 0; i < feedTimesCount; i++) feedTimes[i].firedToday = false;
    lastCheckedDay = now.day();
  }

  for (int i = 0; i < feedTimesCount; i++) {
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
    StaticJsonDocument<256> doc;
    if (!deserializeJson(doc, https.getString())) {
      if (doc.containsKey("grams_per_feeding")) {
        cachedScheduledGrams = doc["grams_per_feeding"] | cachedScheduledGrams;
      }
      // Dynamic button dose — overrides compile-time default.
      // The backend returns button_feed_grams from EnergyDevice.buttonFeedGrams.
      if (doc.containsKey("button_feed_grams")) {
        float bfg = doc["button_feed_grams"];
        if (bfg > 0) {
          cachedButtonFeedGrams = bfg;
        }
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

// ==================== Schedule sync from backend ====================

void pollScheduleCommand() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient https;
  if (!https.begin(secureClient, SCHEDULE_SYNC_URL)) return;
  https.addHeader("X-Device-Token", DEVICE_TOKEN);
  int code = https.GET();
  if (code == 200) {
    // Need a larger buffer for schedule data (times, counts, rates)
    StaticJsonDocument<384> doc;
    if (!deserializeJson(doc, https.getString())) {
      bool changed = doc["schedule_changed"] | false;
      if (changed) {
        const char* startStr = doc["schedule_start"] | "";
        const char* endStr = doc["schedule_end"] | "";
        int feedsPerDay = doc["feeds_per_day"] | 2;
        float ratePct = doc["feeding_rate_pct"] | cachedScheduledGrams;

        if (strlen(startStr) > 0 && strlen(endStr) > 0 && feedsPerDay > 0 && feedsPerDay <= MAX_FEED_TIMES) {
          // Parse schedule_start and schedule_end into hour/minute
          uint8_t startH, startM, endH, endM;
          sscanf(startStr, "%hhu:%hhu", &startH, &startM);
          sscanf(endStr, "%hhu:%hhu", &endH, &endM);

          // Distribute feeds_per_day evenly between start and end
          int totalMinutes = (endH * 60 + endM) - (startH * 60 + startM);
          if (totalMinutes < 0) totalMinutes += 1440; // wrap past midnight
          int intervalMinutes = (feedsPerDay > 1) ? totalMinutes / (feedsPerDay - 1) : 0;

          for (int i = 0; i < feedsPerDay && i < MAX_FEED_TIMES; i++) {
            int offset = i * intervalMinutes;
            int m = (startH * 60 + startM + offset) % 1440;
            feedTimes[i].hour = m / 60;
            feedTimes[i].minute = m % 60;
            feedTimes[i].firedToday = false;
          }
          feedTimesCount = feedsPerDay;

          Serial.printf("[SCHEDULE] updated from backend: %d feeds from %s to %s\n",
                        feedsPerDay, startStr, endStr);

          // Also update scheduled grams if feeding_rate_pct provided
          if (doc.containsKey("grams_per_feeding")) {
            cachedScheduledGrams = doc["grams_per_feeding"] | cachedScheduledGrams;
          }
          if (doc.containsKey("button_feed_grams")) {
            float bfg = doc["button_feed_grams"];
            if (bfg > 0) cachedButtonFeedGrams = bfg;
          }

          // Ack the schedule change
          String commandId = doc["command_id"] | "";
          if (commandId.length() > 0) {
            postScheduleAck(commandId);
          }
        }
      }
    }
  }
  https.end();
}

void postScheduleAck(const String &commandId) {
  HTTPClient https;
  if (!https.begin(secureClient, INGEST_URL)) return;
  https.addHeader("Content-Type", "application/json");
  https.addHeader("X-Device-Token", DEVICE_TOKEN);

  String eventId = generateEventId();
  StaticJsonDocument<192> doc;
  doc["device_id"]   = DEVICE_MAC;
  doc["event_type"]  = "schedule_acked";
  doc["event_id"]    = eventId;
  doc["command_id"]  = commandId;
  doc["timestamp"]   = rtcAvailable ? getRTCiso8601() : "unknown";
  String out;
  serializeJson(doc, out);

  int code = https.POST(out);
  https.end();
  Serial.printf("[SCHEDULE ACK] command %s -> %d\n", commandId.c_str(), code);
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
      dispenseFeed(cachedButtonFeedGrams, "button");
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
