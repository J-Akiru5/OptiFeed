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
    - "ArduinoOTA" (built-in, ESP32 core)
    - WiFi / HTTPClient / WiFiClientSecure (built-in, ESP32 core)
    - WebServer / DNSServer (built-in, ESP32 core) — device-hosted WiFi setup
*/

#include <WiFi.h>
#include <Wire.h>
#include <RTClib.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Preferences.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <ArduinoOTA.h>
#include <esp_task_wdt.h>
#include <ctype.h>

// ==================== Config — fill in before flashing ====================
#define INGEST_URL      "https://optifeed.example.com/api/ingest"
#define FEED_POLL_URL   "https://optifeed.example.com/api/feed-command?device_id=A4:CF:12:7E:3B:09"
#define SCHEDULE_SYNC_URL "https://optifeed.example.com/api/schedule-sync?device_id=A4:CF:12:7E:3B:09"
#define DEVICE_TOKEN    "esp32-tok-cict-001"
#define DEVICE_MAC      "A4:CF:12:7E:3B:09"

// OTA password — SEPARATE from DEVICE_TOKEN. Change per device at flash time;
// the device token authenticates API calls, this one gates firmware uploads.
#ifndef OTA_PASSWORD
#define OTA_PASSWORD "change-me-ota"
#endif

// Root CA for TLS (ISRG Root X1 — Let's Encrypt, Vercel's default CA).
// REPLACE with your hosting provider's chain once the final domain is set,
// then bench-test that a wrong CA is refused (plan H6).
static const char* ROOT_CA = R"CERT(
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
)CERT";

// Default WiFi credentials (overridden by stored values in NVS)
#define DEFAULT_WIFI_SSID "YOUR_WIFI_SSID"
#define DEFAULT_WIFI_PASS "YOUR_WIFI_PASSWORD"

#define RELAY_PIN       25
#define BUTTON_PIN      27          // pick any free GPIO; wired to GND via INPUT_PULLUP
#define RTC_SDA         21
#define RTC_SCL         22
#define TRIG_PIN        32          // HC-SR04 ultrasonic trigger
#define ECHO_PIN        33          // HC-SR04 ultrasonic echo
#define DS18B20_PIN     26          // DS18B20 water temperature probe

#define RELAY_ON        HIGH        // energizes coil, closes NO contacts -> dispensing
#define RELAY_OFF       LOW         // rest state, contacts open -> not dispensing

#define POST_INTERVAL_MS    5000    // telemetry + dashboard feed-command poll interval
#define BUTTON_DEBOUNCE_MS  250
#define WIFI_RETRY_INTERVAL_MS 10000

// ---- WiFi provisioning portal ----
#define WIFI_JOIN_WINDOW_MS          15000  // time allowed for each join attempt
#define WIFI_FAILURES_BEFORE_PORTAL  5      // consecutive failed joins before the setup AP starts
#define WIFI_RESET_HOLD_MS           5000   // button hold at boot clears stored credentials
#define PROVISIONING_REBOOT_DELAY_MS 2000   // let the success page flush before restarting

// ---- Calibration: how fast the feeder dispenses ----
// Measure by running the feeder for a fixed time and weighing the output:
// gramsPerSecond = grams_dispensed / seconds_run.
// Mutable — overridden by backend poll response (grams_per_second).
float gramsPerSecond = 4.0;

// ---- Default dispense amounts per trigger source ----
#define DEFAULT_SCHEDULED_GRAMS 150.0  // used until backend gives us a real value
#define DEFAULT_BUTTON_FEED_GRAMS 80.0 // overridden by backend poll response
#define DEFAULT_MANUAL_GRAMS    100.0  // used if dashboard omits a grams value

// ---- Safety caps — MUST equal server apps/web/lib/limits.ts ----
#define MAX_DISPENSE_MS        300000UL  // = limits.ts MAX_DISPENSE_MS (5 min)
#define MAX_GRAMS_PER_DISPENSE 1000.0    // = limits.ts MAX_FEED_GRAMS_PER_REQUEST
#define MAX_GRAMS_PER_DAY      5000.0    // = limits.ts MAX_FEED_GRAMS_PER_DAY_PER_DEVICE

// ---- Validation ranges for server-pushed values (match limits.ts) ----
#define GRAMS_PER_FEEDING_MIN  1.0
#define GRAMS_PER_FEEDING_MAX  MAX_GRAMS_PER_DISPENSE
#define BUTTON_FEED_GRAMS_MIN  1.0
#define BUTTON_FEED_GRAMS_MAX  500.0
#define GRAMS_PER_SECOND_MIN   0.5
#define GRAMS_PER_SECOND_MAX   50.0
#define TEMP_OFFSET_C_MIN     -20.0
#define TEMP_OFFSET_C_MAX      20.0
#define HOPPER_CM_MAX          500.0    // HC-SR04 practical max (~5 m)

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
  String eventId;        // generated ONCE at enqueue; retries resend the same id
};
#define EVENT_QUEUE_SIZE 50
QueuedEvent eventQueue[EVENT_QUEUE_SIZE];

// ==================== State ====================
RTC_DS3231 rtc;
WiFiClientSecure secureClient;
Preferences prefs;  // NVS storage for WiFi credentials and device state

bool rtcAvailable = false;
bool feederActive = false;
unsigned long feedStartTime = 0;
unsigned long feedDurationMs = 0;
float currentFeedGrams = 0;
const char* currentFeedSource = "";
String currentFeedRequestId = "";

float cachedScheduledGrams = DEFAULT_SCHEDULED_GRAMS;
float cachedButtonFeedGrams = DEFAULT_BUTTON_FEED_GRAMS;  // mutable — set from backend poll

// Feed hopper calibration (linear conversion for cylindrical 10L bottle)
float hopperEmptyCm = 30.0;   // sensor distance when hopper is empty — overridden by backend
float hopperFullCm  = 5.0;    // sensor distance when hopper is full — overridden by backend

// Temperature calibration offset (°C) — overridden by backend
float tempOffsetC = 0.0;

// ---- Daily dispense budget (RAM; reset at local midnight from the RTC) ----
float dailyGramsDispensed = 0.0;
int lastDailyResetDay = -1;
unsigned long lastDailyResetMs = 0;

void maybeResetDailyBudget() {
  if (rtcAvailable) {
    DateTime now = rtc.now();
    if ((int)now.day() != lastDailyResetDay) {
      lastDailyResetDay = now.day();
      dailyGramsDispensed = 0.0;
      lastDailyResetMs = millis();
    }
  } else if (millis() - lastDailyResetMs >= 24UL * 3600UL * 1000UL) {
    dailyGramsDispensed = 0.0;   // RTC unavailable: 24h window from boot
    lastDailyResetMs = millis();
  }
}

// DS18B20 water temperature probe
OneWire oneWire(DS18B20_PIN);
DallasTemperature tempSensor(&oneWire);

unsigned long lastPoll = 0;

// WiFi maintenance with exponential backoff
bool wifiWasConnected = false;
unsigned long lastWifiRetry = 0;
int wifiRetryCount = 0;
#define WIFI_INITIAL_RETRY_MS 10000
#define WIFI_MAX_RETRY_MS     60000

// Consecutive join failures (reset on success) drive the setup portal.
bool wifiJoinPending = false;
unsigned long wifiJoinStartedMs = 0;
int wifiJoinFailures = 0;

// Device-hosted WiFi provisioning portal (SoftAP + setup page).
WebServer provisioningServer(80);
DNSServer provisioningDns;
bool provisioningActive = false;
bool provisioningRoutesRegistered = false;
String provisioningApName;

// button debounce
int lastButtonReading = HIGH;
unsigned long lastButtonChangeMs = 0;
unsigned long lastHandledButtonChangeMs = 0;

// Event ID counter — combined with esp_random() for uniqueness across reboots
static uint32_t eventCounter = 0;

// Device health tracking
uint32_t rebootCount = 0;
unsigned long bootTime = 0;

String generateEventId() {
  eventCounter++;
  uint32_t r = esp_random();
  char buf[24];
  snprintf(buf, sizeof(buf), "evt-%08lx-%04lx", r, eventCounter & 0xFFFF);
  return String(buf);
}

// ==================== OTA Setup ====================

void setupOTA() {
  ArduinoOTA.setHostname("optifeed-feeder");
  ArduinoOTA.setPassword(OTA_PASSWORD);

  ArduinoOTA.onStart([]() {
    String type = (ArduinoOTA.getCommand() == U_FLASH) ? "sketch" : "filesystem";
    Serial.println("[OTA] Start updating " + type);
  });

  ArduinoOTA.onEnd([]() {
    Serial.println("\n[OTA] Update complete");
  });

  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    Serial.printf("[OTA] Progress: %u%%\r", (progress / (total / 100)));
  });

  ArduinoOTA.onError([](ota_error_t error) {
    Serial.printf("[OTA] Error[%u]: ", error);
  });

  ArduinoOTA.begin();
  Serial.println("[OTA] Ready for over-the-air updates");
}

// ==================== WiFi Credential Storage ====================

void loadWiFiCredentials(String &ssid, String &pass) {
  ssid = prefs.getString("wifi_ssid", DEFAULT_WIFI_SSID);
  pass = prefs.getString("wifi_pass", DEFAULT_WIFI_PASS);
}

void saveWiFiCredentials(const String &ssid, const String &pass) {
  prefs.putString("wifi_ssid", ssid);
  prefs.putString("wifi_pass", pass);
  Serial.println("[WiFi] Credentials saved to NVS");
}

// True only when NVS holds a usable SSID. A missing, empty or placeholder
// SSID means the device has never been provisioned.
bool wifiCredentialsProvisioned() {
  if (!prefs.isKey("wifi_ssid")) return false;
  String ssid = prefs.getString("wifi_ssid", "");
  if (ssid.length() == 0) return false;
  if (ssid == DEFAULT_WIFI_SSID) return false;
  return true;
}

void clearWiFiCredentials() {
  prefs.remove("wifi_ssid");
  prefs.remove("wifi_pass");
  Serial.println("[WiFi] Stored credentials cleared");
}

// Holding the feed button during boot for WIFI_RESET_HOLD_MS requests a
// credential reset. Returns after the button is released or the hold is met;
// the normal short-press feed path is untouched.
bool bootButtonResetHeld() {
  if (digitalRead(BUTTON_PIN) != LOW) return false;

  Serial.printf("[WiFi] Button held at boot - keep holding %d s to reset WiFi credentials\n",
                WIFI_RESET_HOLD_MS / 1000);
  unsigned long start = millis();
  while (digitalRead(BUTTON_PIN) == LOW) {
    if (millis() - start >= WIFI_RESET_HOLD_MS) return true;
    delay(50);
  }
  Serial.println("[WiFi] Button released early - normal boot continues");
  return false;
}

// ==================== WiFi provisioning portal ====================

// "OptiFeed-XXXX", where XXXX is the last four hex characters of DEVICE_MAC.
String provisioningApSsid() {
  String hex;
  hex.reserve(strlen(DEVICE_MAC));
  for (size_t i = 0; i < strlen(DEVICE_MAC); i++) {
    char c = DEVICE_MAC[i];
    if (isxdigit((unsigned char)c)) hex += (char)toupper((unsigned char)c);
  }
  while (hex.length() < 4) hex = String("0") + hex;
  return String("OptiFeed-") + hex.substring(hex.length() - 4);
}

String htmlEscape(const String &value) {
  String out;
  out.reserve(value.length() + 16);
  for (size_t i = 0; i < value.length(); i++) {
    char c = value[i];
    switch (c) {
      case '&':  out += F("&amp;");  break;
      case '<':  out += F("&lt;");   break;
      case '>':  out += F("&gt;");   break;
      case '"':  out += F("&quot;"); break;
      case '\'': out += F("&#39;");  break;
      default:   out += c;           break;
    }
  }
  return out;
}

String buildProvisioningPage(const String &ssid, const String &error) {
  String page = F(
    "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">"
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
    "<title>OptiFeed WiFi setup</title><style>"
    "body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;margin:0;padding:24px;background:#f3f5f7;color:#1b2430}"
    "main{max-width:420px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;box-shadow:0 2px 12px rgba(0,0,0,.08)}"
    "h1{font-size:1.35rem;margin:0 0 8px}p{line-height:1.45}"
    "label{display:block;font-weight:600;margin:18px 0 6px}"
    "input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #b9c2cc;border-radius:8px;font-size:1rem}"
    "button{margin-top:20px;width:100%;padding:12px;border:0;border-radius:8px;background:#166534;color:#fff;font-size:1rem;font-weight:600}"
    ".note{font-size:.9rem;color:#4a5563}.err{background:#fdecec;border:1px solid #f5b5b5;border-radius:8px;padding:10px;color:#8a1c1c}"
    "code{background:#eef1f4;padding:2px 6px;border-radius:4px}"
    "footer{margin-top:20px;font-size:.8rem;color:#6b7684}"
    "</style></head><body><main>"
    "<h1>OptiFeed WiFi setup</h1>"
    "<p class=\"note\">Connect the feeder to a 2.4 GHz WiFi network. The device restarts after saving and joins automatically.</p>"
    "{{ERROR}}"
    "<form method=\"POST\" action=\"/save\">"
    "<label for=\"ssid\">WiFi name (SSID)</label>"
    "<input id=\"ssid\" name=\"ssid\" type=\"text\" maxlength=\"32\" required autocomplete=\"off\" value=\"{{SSID}}\">"
    "<label for=\"pass\">Password</label>"
    "<input id=\"pass\" name=\"pass\" type=\"password\" maxlength=\"63\" autocomplete=\"new-password\">"
    "<p class=\"note\">Leave the password empty for an open network, otherwise use 8-63 characters.</p>"
    "<button type=\"submit\">Save and restart</button>"
    "</form>"
    "<footer>Setup address: <code>192.168.4.1</code> &middot; AP: {{AP}}</footer>"
    "</main></body></html>");

  String errorBlock;
  if (error.length() > 0) {
    errorBlock = F("<p class=\"err\">");
    errorBlock += htmlEscape(error);
    errorBlock += F("</p>");
  }

  // AP/ERROR first, SSID last: a user-supplied SSID must never be re-scanned
  // for another placeholder.
  page.replace("{{AP}}", htmlEscape(provisioningApName));
  page.replace("{{ERROR}}", errorBlock);
  page.replace("{{SSID}}", htmlEscape(ssid));
  return page;
}

String buildProvisioningSuccessPage() {
  return String(F(
    "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">"
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
    "<title>OptiFeed saved</title></head>"
    "<body style=\"font-family:system-ui,sans-serif;padding:32px;max-width:420px;margin:0 auto\">"
    "<h1>Settings saved</h1>"
    "<p>The feeder is restarting and will join your WiFi network. You can close this page.</p>"
    "</body></html>"));
}

void handleProvisioningRoot() {
  String currentSsid;
  if (wifiCredentialsProvisioned()) currentSsid = prefs.getString("wifi_ssid", "");
  provisioningServer.send(200, "text/html", buildProvisioningPage(currentSsid, ""));
}

void handleProvisioningSave() {
  const String ssid = provisioningServer.arg("ssid");
  const String pass = provisioningServer.arg("pass");

  if (ssid.length() < 1 || ssid.length() > 32) {
    provisioningServer.send(400, "text/html",
      buildProvisioningPage(ssid, "SSID must be 1-32 characters."));
    return;
  }
  if (pass.length() != 0 && (pass.length() < 8 || pass.length() > 63)) {
    provisioningServer.send(400, "text/html",
      buildProvisioningPage(ssid, "Password must be empty (open network) or 8-63 characters."));
    return;
  }

  saveWiFiCredentials(ssid, pass);   // same NVS keys: wifi_ssid / wifi_pass
  Serial.println("[PROV] WiFi credentials saved - restarting");

  provisioningServer.send(200, "text/html", buildProvisioningSuccessPage());
  provisioningServer.client().flush();
  provisioningServer.client().stop();

  delay(PROVISIONING_REBOOT_DELAY_MS);
  ESP.restart();
}

// Captive-portal behaviour: anything else resolves to the setup page.
void handleProvisioningNotFound() {
  String target = String(F("http://")) + WiFi.softAPIP().toString() + "/";
  provisioningServer.sendHeader("Location", target, true);
  provisioningServer.send(302, "text/plain", "");
}

void startProvisioningPortal() {
  if (provisioningActive) return;

  provisioningApName = provisioningApSsid();
  // AP+STA keeps the station side alive, so a network that comes back can
  // close the portal on its own.
  WiFi.mode(WIFI_AP_STA);
  if (!WiFi.softAP(provisioningApName.c_str())) {
    Serial.println("[PROV] Could not start the setup access point");
    return;
  }

  provisioningDns.setErrorReplyCode(DNSReplyCode::NoError);
  provisioningDns.start(53, "*", WiFi.softAPIP());

  if (!provisioningRoutesRegistered) {
    provisioningServer.on("/", HTTP_GET, handleProvisioningRoot);
    provisioningServer.on("/save", HTTP_POST, handleProvisioningSave);
    provisioningServer.onNotFound(handleProvisioningNotFound);
    provisioningRoutesRegistered = true;
  }
  provisioningServer.begin();

  provisioningActive = true;
  wifiJoinPending = false;
  Serial.println("[PROV] Setup portal active");
  Serial.printf("[PROV] Join \"%s\" and open http://%s\n",
                provisioningApName.c_str(), WiFi.softAPIP().toString().c_str());
}

void stopProvisioningPortal() {
  if (!provisioningActive) return;
  provisioningDns.stop();
  provisioningServer.stop();
  WiFi.softAPdisconnect(true);   // drops the AP interface, keeps STA credentials
  provisioningActive = false;
  Serial.println("[PROV] Setup portal stopped");
}

// Runs from loop() while provisioning is active. Never blocks long enough to
// trip the task watchdog, and never enters deep sleep.
void serviceProvisioningPortal() {
  provisioningDns.processNextRequest();  // compatibility no-op on ESP32 core 3.x
  provisioningServer.handleClient();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("[WiFi] Joined a network while the portal was active - closing portal");
    stopProvisioningPortal();
    wifiJoinFailures = 0;
    wifiJoinPending = false;
    // The mode switch can briefly drop the station; maintainWiFi() will
    // reconnect and resync NTP if that happens.
    if (WiFi.status() == WL_CONNECTED) {
      wifiWasConnected = true;
      if (rtcAvailable) syncNTP();
    }
  }
}

void setup() {
  Serial.begin(115200);
  bootTime = millis();

  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, RELAY_OFF);   // feeder must NEVER default to dispensing at boot
  feederActive = false;

  pinMode(BUTTON_PIN, INPUT_PULLUP);    // press pulls LOW

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(TRIG_PIN, LOW);

  // DS18B20 temperature probe
  tempSensor.begin();
  Serial.println("[INIT] DS18B20 temperature probe initialized");

  for (int i = 0; i < EVENT_QUEUE_SIZE; i++) eventQueue[i].used = false;

  // Load stored WiFi credentials from NVS, fallback to defaults
  prefs.begin("optifeed", false);
  rebootCount = prefs.getUInt("rebootCount", 0) + 1;
  prefs.putUInt("rebootCount", rebootCount);
  Serial.printf("[INIT] Boot #%lu\n", rebootCount);

  // Button held through boot clears WiFi credentials and reopens the portal.
  bool credentialsResetAtBoot = false;
  if (bootButtonResetHeld()) {
    clearWiFiCredentials();
    credentialsResetAtBoot = true;
    // Consume the hold that triggered the reset so it cannot also dispense.
    lastButtonReading = LOW;
    lastButtonChangeMs = millis();
    lastHandledButtonChangeMs = lastButtonChangeMs;
  }

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

  // TLS: verify the server against ROOT_CA (never setInsecure).
  secureClient.setCACert(ROOT_CA);

  // No usable credentials (or a boot reset) -> device-hosted setup portal.
  // Otherwise use the normal station path, unchanged.
  if (credentialsResetAtBoot || !wifiCredentialsProvisioned()) {
    Serial.println("[WiFi] No usable stored credentials - starting setup portal");
    startProvisioningPortal();
  } else {
    connectWiFi();
    if (WiFi.status() == WL_CONNECTED) {
      wifiWasConnected = true;
      if (rtcAvailable) syncNTP();
    }
  }

  // Setup OTA updates
  setupOTA();

  Serial.print("[DEVICE MAC] ");
  Serial.println(WiFi.macAddress());

  // Task watchdog — a hung loop() reboots the board; boot already forced RELAY_OFF.
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_config_t wdtConfig = {
    .timeout_ms = 30000,
    .idle_core_mask = 0,
    .trigger_panic = true,
  };
  esp_task_wdt_init(&wdtConfig);
#else
  esp_task_wdt_init(30, true);
#endif
  esp_task_wdt_add(NULL);  // subscribe the Arduino loop task

  Serial.println("[READY] OptiFeed controller online.");
}

void loop() {
  ArduinoOTA.handle();  // Handle OTA updates

  if (provisioningActive) {
    serviceProvisioningPortal();  // captive DNS + setup page; never deep-sleeps
  } else {
    maintainWiFi();
  }

  handleButton();

  if (rtcAvailable) handleSchedule();

  // Local feeding keeps running while provisioning; backend calls do not.
  if (!provisioningActive && millis() - lastPoll >= POST_INTERVAL_MS) {
    sendTelemetry();
    pollDashboardFeedCommand();
    esp_task_wdt_reset();
    pollScheduleCommand();
    flushQueuedEvents();
    lastPoll = millis();
  }

  if (feederActive && (millis() - feedStartTime >= feedDurationMs)) {
    stopFeedCycle();
  }
  // Safety hard stop — never leave the relay energized past MAX_DISPENSE_MS.
  if (feederActive && (millis() - feedStartTime >= MAX_DISPENSE_MS)) {
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

// ==================== Safety caps + config validation ====================

// Opens a TLS session with ROOT_CA verification. Logs a clear hint when the
// handshake cannot start (wrong CA for the host, DNS down, etc.).
bool beginHttps(HTTPClient& https, const char* url) {
  if (https.begin(secureClient, url)) return true;
  Serial.println("[TLS] Connection failed — check ROOT_CA matches the server CA and the URL is correct");
  return false;
}

// Best-effort report when a safety cap refuses a dose (audited server-side).
void reportFeedError(const char* reason, float grams, const char* source) {
  Serial.printf("[FEED] REFUSED %s: %.0fg from %s\n", reason, grams, source);
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient https;
  if (!beginHttps(https, INGEST_URL)) return;
  https.addHeader("Content-Type", "application/json");
  https.addHeader("X-Device-Token", DEVICE_TOKEN);
  StaticJsonDocument<256> doc;
  doc["device_id"]  = DEVICE_MAC;
  doc["event_type"] = "feed_refused";
  doc["event_id"]   = generateEventId();
  doc["grams"]      = grams;
  doc["source"]     = source;
  doc["reason"]     = reason;
  doc["timestamp"]  = rtcAvailable ? getRTCiso8601() : "unknown";
  String out;
  serializeJson(doc, out);
  int code = https.POST(out);
  https.end();
  Serial.printf("[FEED] refusal report -> %d\n", code);
}

// Validates every server-pushed value BEFORE anything is stored.
// Returns false if any present value is out of range — callers must then
// ignore the whole response (no stores, no dispense, no schedule update).
bool validateServerConfig(const JsonDocument &doc) {
  float v;
  if (doc.containsKey("grams_per_feeding")) {
    v = doc["grams_per_feeding"];
    if (!(v >= GRAMS_PER_FEEDING_MIN && v <= GRAMS_PER_FEEDING_MAX)) return false;
  }
  if (doc.containsKey("button_feed_grams")) {
    v = doc["button_feed_grams"];
    if (!(v >= BUTTON_FEED_GRAMS_MIN && v <= BUTTON_FEED_GRAMS_MAX)) return false;
  }
  if (doc.containsKey("grams_per_second")) {
    v = doc["grams_per_second"];
    if (!(v >= GRAMS_PER_SECOND_MIN && v <= GRAMS_PER_SECOND_MAX)) return false;
  }
  if (doc.containsKey("temp_offset_c")) {
    v = doc["temp_offset_c"];
    if (!(v >= TEMP_OFFSET_C_MIN && v <= TEMP_OFFSET_C_MAX)) return false;
  }
  if (doc.containsKey("hopper_full_cm")) {
    v = doc["hopper_full_cm"];
    if (!(v > 0 && v <= HOPPER_CM_MAX)) return false;
  }
  if (doc.containsKey("hopper_empty_cm")) {
    v = doc["hopper_empty_cm"];
    if (!(v > 0 && v <= HOPPER_CM_MAX)) return false;
  }
  // Cross-field: hopper full distance must be nearer than the empty distance.
  float fullCm = doc.containsKey("hopper_full_cm") ? (float)doc["hopper_full_cm"] : hopperFullCm;
  float emptyCm = doc.containsKey("hopper_empty_cm") ? (float)doc["hopper_empty_cm"] : hopperEmptyCm;
  if (fullCm >= emptyCm) return false;
  return true;
}

// ==================== Shared dispense logic ====================

void dispenseFeed(float grams, const char* source, const String &requestId = "") {
  if (feederActive) {
    Serial.printf("[FEED] busy — ignoring %s trigger (mutex held)\n", source);
    return;
  }

  maybeResetDailyBudget();

  if (grams <= 0 || grams > MAX_GRAMS_PER_DISPENSE) {
    reportFeedError("grams_out_of_range", grams, source);
    return;
  }

  unsigned long durationMs = (unsigned long)((grams / gramsPerSecond) * 1000.0);
  if (durationMs > MAX_DISPENSE_MS) {
    // REFUSE, never truncate: a slow calibration must not silently halve a
    // valid dose (e.g. 1000 g at 2 g/s = 500 s, over the 300 s cap).
    reportFeedError("dose_time_exceeds_cap", grams, source);
    return;
  }

  if (dailyGramsDispensed + grams > MAX_GRAMS_PER_DAY) {
    reportFeedError("daily_gram_cap_exceeded", grams, source);
    return;
  }

  // Backstop clamp only — unreachable while the refusals above hold.
  feedDurationMs = (durationMs < MAX_DISPENSE_MS) ? durationMs : MAX_DISPENSE_MS;

  Serial.printf("[FEED] dispensing %.0fg (~%lums) — source: %s\n", grams, feedDurationMs, source);

  digitalWrite(RELAY_PIN, RELAY_ON);
  feederActive = true;
  feedStartTime = millis();
  currentFeedGrams = grams;
  currentFeedSource = source;
  currentFeedRequestId = requestId;
  dailyGramsDispensed += grams;
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
  if (!beginHttps(https, FEED_POLL_URL)) return;
  https.addHeader("X-Device-Token", DEVICE_TOKEN);
  int code = https.GET();
  if (code == 200) {
    StaticJsonDocument<256> doc;
    if (!deserializeJson(doc, https.getString())) {
      if (!validateServerConfig(doc)) {
        // N9: ignore the whole config when any pushed value is out of range.
        Serial.println("[POLL] invalid config from server — ignoring whole response");
      } else {
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
        // Hopper calibration — overrides compile-time defaults
        if (doc.containsKey("hopper_full_cm")) {
          float hf = doc["hopper_full_cm"];
          if (hf > 0) hopperFullCm = hf;
        }
        if (doc.containsKey("hopper_empty_cm")) {
          float he = doc["hopper_empty_cm"];
          if (he > 0) hopperEmptyCm = he;
        }
        // Duration calibration — motor dispense rate
        if (doc.containsKey("grams_per_second")) {
          float gps = doc["grams_per_second"];
          if (gps > 0) gramsPerSecond = gps;
        }
        // Temperature calibration offset
        if (doc.containsKey("temp_offset_c")) {
          tempOffsetC = doc["temp_offset_c"];
        }
        bool requested = doc["feed_requested"] | false;
        if (requested) {
          float grams = doc["grams"] | DEFAULT_MANUAL_GRAMS;
          String requestId = doc["feed_request_id"] | "";
          dispenseFeed(grams, "dashboard", requestId);
        }
      }
    }
  }
  https.end();
}

// ==================== Schedule sync from backend ====================

void pollScheduleCommand() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient https;
  if (!beginHttps(https, SCHEDULE_SYNC_URL)) return;
  https.addHeader("X-Device-Token", DEVICE_TOKEN);
  int code = https.GET();
  if (code == 200) {
    // Need a larger buffer for schedule data (times, counts, rates)
    StaticJsonDocument<384> doc;
    if (!deserializeJson(doc, https.getString())) {
      bool changed = doc["schedule_changed"] | false;
      if (changed && !validateServerConfig(doc)) {
        // N9: ignore the whole command when any pushed value is out of range.
        Serial.println("[SCHEDULE] invalid config from server — ignoring whole command");
        changed = false;
      }
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
          // Duration calibration — motor dispense rate
          if (doc.containsKey("grams_per_second")) {
            float gps = doc["grams_per_second"];
            if (gps > 0) gramsPerSecond = gps;
          }
          // Temperature calibration offset
          if (doc.containsKey("temp_offset_c")) {
            tempOffsetC = doc["temp_offset_c"];
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
  if (!beginHttps(https, INGEST_URL)) return;
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

// ==================== Feed level monitoring (HC-SR04) ====================

float readFeedLevelPercent() {
  // Take 3 readings, return median, then linear convert to percent
  float readings[3];
  for (int i = 0; i < 3; i++) {
    digitalWrite(TRIG_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);
    long duration = pulseIn(ECHO_PIN, HIGH, 30000); // 30ms timeout ~5m max range
    readings[i] = (duration == 0) ? -1 : duration * 0.034 / 2;
    delay(10);
  }

  // Bubble-sort 3 elements for median
  for (int i = 0; i < 2; i++) {
    for (int j = 0; j < 2 - i; j++) {
      if (readings[j] > readings[j + 1]) {
        float tmp = readings[j];
        readings[j] = readings[j + 1];
        readings[j + 1] = tmp;
      }
    }
  }

  float distance = readings[1]; // median
  if (distance < 0 || distance >= hopperEmptyCm) return 0;
  if (distance <= hopperFullCm) return 100;
  // Linear interpolation for cylindrical bottle
  return ((hopperEmptyCm - distance) / (hopperEmptyCm - hopperFullCm)) * 100.0;
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
      eventQueue[i].eventId = generateEventId();  // id fixed at creation (Gap #2)
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
      esp_task_wdt_reset();  // progress between network posts — not a hang
    }
  }
}

bool postFeedEvent(QueuedEvent &ev) {
  HTTPClient https;
  if (!beginHttps(https, INGEST_URL)) return false;
  https.addHeader("Content-Type", "application/json");
  https.addHeader("X-Device-Token", DEVICE_TOKEN);

  // eventId was generated once when this event was enqueued; retries of the
  // same queued event must resend the same id so the server can dedupe.
  StaticJsonDocument<256> doc;
  doc["device_id"]       = DEVICE_MAC;
  doc["event_type"]      = "feed_dispensed";
  doc["event_id"]        = ev.eventId;
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
  if (!beginHttps(https, INGEST_URL)) return;
  https.addHeader("Content-Type", "application/json");
  https.addHeader("X-Device-Token", DEVICE_TOKEN);

  String eventId = generateEventId();
  StaticJsonDocument<512> doc;
  doc["device_id"]         = DEVICE_MAC;
  doc["event_type"]        = "heartbeat";
  doc["event_id"]          = eventId;
  doc["timestamp"]         = rtcAvailable ? getRTCiso8601() : "unknown";
  doc["rtc_ok"]            = rtcAvailable;
  doc["feeder_active"]     = feederActive;
  doc["feed_level_percent"] = readFeedLevelPercent();
  doc["feed_level_cm"]     = 0; // filled below with actual median distance

  // Re-read for the cm value (minimal overhead — 3 reads already cached by readFeedLevelPercent)
  float readings[3];
  for (int i = 0; i < 3; i++) {
    digitalWrite(TRIG_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);
    long duration = pulseIn(ECHO_PIN, HIGH, 30000);
    readings[i] = (duration == 0) ? -1 : duration * 0.034 / 2;
    delay(10);
  }
  for (int i = 0; i < 2; i++) {
    for (int j = 0; j < 2 - i; j++) {
      if (readings[j] > readings[j + 1]) {
        float tmp = readings[j];
        readings[j] = readings[j + 1];
        readings[j + 1] = tmp;
      }
    }
  }
  doc["feed_level_cm"] = readings[1] >= 0 ? readings[1] : 0;

  // Water temperature (DS18B20)
  tempSensor.requestTemperatures();
  float rawTempC = tempSensor.getTempCByIndex(0);
  bool tempOk = (rawTempC != DEVICE_DISCONNECTED_C && rawTempC > -10 && rawTempC < 80);
  if (tempOk) {
    doc["water_temp_c"] = rawTempC + tempOffsetC;
    doc["water_temp_ok"] = true;
  } else {
    doc["water_temp_ok"] = false;
  }

  // Device health metrics
  doc["free_heap"] = ESP.getFreeHeap();
  doc["uptime_ms"] = millis() - bootTime;
  doc["reboot_count"] = rebootCount;
  doc["wifi_rssi"] = WiFi.RSSI();

  String out;
  serializeJson(doc, out);

  int code = https.POST(out);
  Serial.printf("[POST] %d\n", code);
  https.end();
}

// ==================== WiFi / NTP / RTC helpers ====================

void connectWiFi() {
  String ssid, pass;
  loadWiFiCredentials(ssid, pass);

  Serial.printf("[WiFi] connecting to %s", ssid.c_str());
  WiFi.begin(ssid.c_str(), pass.c_str());
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_JOIN_WINDOW_MS) {
    delay(500);
    Serial.print(".");
  }
  bool connected = (WiFi.status() == WL_CONNECTED);
  Serial.println(connected ? " connected" : " not connected yet — will retry in loop()");

  wifiJoinPending = false;
  if (connected) {
    wifiJoinFailures = 0;
  } else {
    wifiJoinFailures++;
    Serial.printf("[WiFi] join attempt failed (%d/%d)\n", wifiJoinFailures, WIFI_FAILURES_BEFORE_PORTAL);
  }
}

void maintainWiFi() {
  if (provisioningActive) return;  // the portal owns the radio and suppresses deep sleep

  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiWasConnected) {
      Serial.println("[WiFi] reconnected");
      if (rtcAvailable) syncNTP();
    }
    wifiWasConnected = true;
    wifiRetryCount = 0;  // Reset backoff on successful connection
    wifiJoinFailures = 0;
    wifiJoinPending = false;
    return;
  }

  wifiWasConnected = false;

  // A join attempt gets WIFI_JOIN_WINDOW_MS to succeed; if it is still not
  // connected afterwards, it counts as one consecutive failure.
  if (wifiJoinPending && millis() - wifiJoinStartedMs >= WIFI_JOIN_WINDOW_MS) {
    wifiJoinPending = false;
    wifiJoinFailures++;
    Serial.printf("[WiFi] join attempt failed (%d/%d)\n", wifiJoinFailures, WIFI_FAILURES_BEFORE_PORTAL);
    if (wifiJoinFailures >= WIFI_FAILURES_BEFORE_PORTAL) {
      Serial.println("[WiFi] Repeated join failures - starting setup portal");
      startProvisioningPortal();
      return;
    }
  }
  if (wifiJoinPending) return;

  // Exponential backoff: 10s, 20s, 40s, 60s max
  unsigned long retryInterval = WIFI_INITIAL_RETRY_MS * (1UL << min(wifiRetryCount, 3));
  if (retryInterval > WIFI_MAX_RETRY_MS) retryInterval = WIFI_MAX_RETRY_MS;

  if (millis() - lastWifiRetry >= retryInterval) {
    Serial.printf("[WiFi] disconnected — attempting reconnect (attempt %d, interval %lums)\n",
                  wifiRetryCount + 1, retryInterval);
    WiFi.disconnect();
    String ssid, pass;
    loadWiFiCredentials(ssid, pass);
    WiFi.begin(ssid.c_str(), pass.c_str());
    lastWifiRetry = millis();
    wifiRetryCount++;
    wifiJoinPending = true;
    wifiJoinStartedMs = millis();

    // Deep sleep after prolonged failure (>5 min of retries). The portal
    // starts long before this, so the device never sleeps while provisioning.
    if (!provisioningActive && wifiRetryCount > 30) {
      Serial.println("[WiFi] prolonged failure — entering deep sleep for 5 minutes");
      esp_sleep_enable_timer_wakeup(5 * 60 * 1000000ULL);  // 5 minutes in microseconds
      esp_deep_sleep_start();
    }
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
