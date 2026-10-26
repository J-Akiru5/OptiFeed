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

  REMOTE UPDATES (OTA, T-12a):
    - A/B app slots from min_spiffs.csv; the bootloader only switches slots in
      Update.end(true), so power loss mid-download is harmless.
    - verifyRollbackLater() deliberately leaves a freshly installed image in
      the ESP_OTA_IMG_PENDING_VERIFY state. The health check in loop() owns the
      decision: five minutes to reach WiFi, a valid clock and one authenticated
      200 from the feed-command poll, otherwise roll back to the previous slot.
    - The relay is forced OFF and every feed trigger is refused until the image
      is marked valid.

  Libraries required (Arduino Library Manager):
    - "RTClib" by Adafruit
    - "ArduinoJson" by Benoit Blanchon
    - "ArduinoOTA" (built-in, ESP32 core) — bench builds only, -DENABLE_LAN_OTA
    - WiFi / HTTPClient / WiFiClientSecure (built-in, ESP32 core)
    - WebServer / DNSServer (built-in, ESP32 core) — device-hosted WiFi + identity setup
    - Update / esp_ota_ops / mbedtls (built-in, ESP32 core) — signed remote updates
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
#include <Update.h>
#include <esp_task_wdt.h>
#include <esp_wifi.h>
#include <esp_system.h>
#include <esp_ota_ops.h>
#include <mbedtls/base64.h>
#include <mbedtls/pk.h>
#include <mbedtls/sha256.h>
#include <ctype.h>
#ifdef ENABLE_LAN_OTA
#include <ArduinoOTA.h>
#endif

// Prefix of the setup access point ("PakaonAI-XXXX"). Must equal AP_PREFIX in
// apps/web/lib/provisioning-ap.ts: the admin sticker QR and the hardware
// settings page build the network name from that constant, and a unit only
// broadcasts the prefix it was flashed with. apps/web/lib/__tests__/
// provisioning-ap-firmware.test.ts fails if the two differ.
#define PROVISIONING_AP_PREFIX "PakaonAI-"

// ==================== Config — fill in before flashing ====================
// Production backend. The old host (optifeed.example.com, then
// optifeed.syntaxure.dev) now returns 404, so a unit flashed with this build is
// the only way an existing feeder gets back online; NVS identity is untouched.
#define INGEST_URL      "https://pakaonai.syntaxure.dev/api/ingest"
// The ?device_id=... query is appended at runtime from the active identity,
// so one binary works for every unit.
#define FEED_POLL_URL_BASE     "https://pakaonai.syntaxure.dev/api/feed-command"
#define SCHEDULE_SYNC_URL_BASE "https://pakaonai.syntaxure.dev/api/schedule-sync"

// Reported at boot and in the heartbeat body so the fleet and the OTA rollout
// can tell builds apart. Bump on every firmware change.
#define FW_VERSION "1.4.0"
// Board string the signed manifest must carry. One value for every unit this
// firmware runs on (ESP32-WROOM-32U); a manifest for another board is refused.
#define FW_BOARD "wroom32u"

// ---- Remote updates (OTA, T-12a) ----
// GET with X-Device-Token and the current version. T-12b implements the route.
// The response is {update:false} or
// {update:true, version, url, size, sha256, manifest, signature, key_id}.
#define OTA_CHECK_URL "https://pakaonai.syntaxure.dev/api/firmware/check"
// How often an idle, online unit asks for an update (30 minutes).
#define OTA_CHECK_INTERVAL_MS (30UL * 60UL * 1000UL)
// First boot of a new image: this long to prove itself before rolling back.
#define OTA_HEALTH_CHECK_TIMEOUT_MS (5UL * 60UL * 1000UL)
// Pre-flight gate (docs/firmware-ota-plan.md §4.4, decisions OTA-2/OTA-3).
#define OTA_MIN_UPTIME_MS (10UL * 60UL * 1000UL)   // strictly longer than 10 min
#define OTA_MIN_RSSI_DBM (-75)                     // require RSSI > -75 dBm
#define OTA_FEED_GUARD_MINUTES 20                  // +/- 20 min around a feed
#define OTA_WINDOW_START_MINUTE (10 * 60)          // 10:00 local
#define OTA_WINDOW_END_MINUTE (15 * 60)            // 15:00 local (exclusive)
// The RTC runs UTC (NTP and the server clock are UTC). Local time for the
// maintenance window is UTC + this offset; the Philippines is UTC+8 with no
// daylight saving. Change it when the fleet moves time zone.
#define OTA_LOCAL_UTC_OFFSET_MINUTES 480
// Heap needed for the TLS session, the 1 KB stream buffer and Update. Every
// extra root costs roughly 2 KB while a connection is open.
#define OTA_MIN_FREE_HEAP_BYTES 60000
// One check response is a few hundred bytes; anything large is a bug or abuse.
#define OTA_MAX_CHECK_RESPONSE_BYTES 8192
// Give a 1.1 MB image a fair chance on a slow farm link, but never hang.
#define OTA_NO_DATA_TIMEOUT_MS (60UL * 1000UL)
#define OTA_DOWNLOAD_TIMEOUT_MS (15UL * 60UL * 1000UL)


// Fallback device identity. Once the setup portal saves an identity these
// compile-time values are superseded by NVS keys device_id / device_token.
// They remain the defaults so units flashed before identity provisioning, and
// units that never open the portal, keep working unchanged.
#define DEVICE_TOKEN    "esp32-tok-cict-001"
#define DEVICE_MAC      "A4:CF:12:7E:3B:09"

// LAN ArduinoOTA password — SEPARATE from DEVICE_TOKEN, and only compiled into
// bench builds (-DENABLE_LAN_OTA, decision OTA-7). Field builds have no LAN
// updater at all, so this shared static password can never be a field risk.
#ifdef ENABLE_LAN_OTA
#ifndef OTA_PASSWORD
#define OTA_PASSWORD "change-me-ota"
#endif
#endif

// Multi-root TLS trust store for both the API and the signed download URL.
// setCACert() accepts several PEM certificates in one string; mbedtls tries
// each of them. One root is a single point of failure for a device that can
// only be fixed remotely, so the bundle carries the current Let's Encrypt
// roots (X1, X2, Gen-Y Root YR), Google Trust Services R1 (*.vercel.app and
// other GTS hosts) and GlobalSign Root CA.
//
// Copied verbatim on 2026-10-26 from the issuers' own pages:
//   ISRG Root X1        https://letsencrypt.org/certs/isrgrootx1.pem
//   ISRG Root X2        https://letsencrypt.org/certs/isrg-root-x2.pem
//   ISRG Root YR        https://letsencrypt.org/certs/gen-y/root-yr.pem
//                       (published PEM; index: letsencrypt.org/certificates/)
//   GTS Root R1         https://pki.goog/repo/certs/gtsr1.pem
//   GlobalSign Root CA  https://secure.globalsign.com/cacert/root-r1.crt
//                       (published as DER; wrapped as PEM, bytes unchanged)
//
// SHA-256 fingerprints, to prove the embedded copies are the real ones:
//   X1 96:BC:EC:06:26:49:76:F3:74:60:77:9A:CF:28:C5:A7:CF:E8:A3:C0:AA:E1:1A:8F:FC:EE:05:C0:BD:DF:08:C6
//   X2 69:72:9B:8E:15:A8:6E:FC:17:7A:57:AF:B7:17:1D:FC:64:AD:D2:8C:2F:CA:8C:F1:50:7E:34:45:3C:CB:14:70
//   YR E5:7B:7E:6F:15:0C:41:91:02:E8:D5:C0:55:72:9F:F9:67:B9:D1:A8:29:BF:00:CE:C8:9C:A6:04:EB:F4:A8:6F
//   R1 D9:47:43:2A:BD:E7:B7:FA:90:FC:2E:6B:59:10:1B:12:80:E0:E1:C7:E4:E4:0F:A3:C6:88:7F:FF:57:A7:F4:CF
//  GS EB:D4:10:40:E4:BB:3E:C7:42:C9:E3:81:D3:1E:F2:A4:1A:48:B6:68:5C:96:E7:CE:F3:C1:DF:6C:D4:33:1C:99
//
// The production chain on 2026-10-26 is leaf <- YR1 <- Root YR <- (cross-signed
// by) ISRG Root X1. Root YR is embedded self-signed, so the unit keeps working
// if that cross-sign disappears (docs/firmware-ota-plan.md §3.3). Bench-test
// that a wrong CA is refused and that each root validates its own chain; see
// firmware/README.md. Never call setInsecure().
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
-----BEGIN CERTIFICATE-----
MIICGzCCAaGgAwIBAgIQQdKd0XLq7qeAwSxs6S+HUjAKBggqhkjOPQQDAzBPMQsw
CQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJuZXQgU2VjdXJpdHkgUmVzZWFyY2gg
R3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBYMjAeFw0yMDA5MDQwMDAwMDBaFw00
MDA5MTcxNjAwMDBaME8xCzAJBgNVBAYTAlVTMSkwJwYDVQQKEyBJbnRlcm5ldCBT
ZWN1cml0eSBSZXNlYXJjaCBHcm91cDEVMBMGA1UEAxMMSVNSRyBSb290IFgyMHYw
EAYHKoZIzj0CAQYFK4EEACIDYgAEzZvVn4CDCuwJSvMWSj5cz3es3mcFDR0HttwW
+1qLFNvicWDEukWVEYmO6gbf9yoWHKS5xcUy4APgHoIYOIvXRdgKam7mAHf7AlF9
ItgKbppbd9/w+kHsOdx1ymgHDB/qo0IwQDAOBgNVHQ8BAf8EBAMCAQYwDwYDVR0T
AQH/BAUwAwEB/zAdBgNVHQ4EFgQUfEKWrt5LSDv6kviejM9ti6lyN5UwCgYIKoZI
zj0EAwMDaAAwZQIwe3lORlCEwkSHRhtFcP9Ymd70/aTSVaYgLXTWNLxBo1BfASdW
tL4ndQavEi51mI38AjEAi/V3bNTIZargCyzuFJ0nN6T5U6VR5CmD1/iQMVtCnwr1
/q4AaOeMSQ+2b1tbFfLn
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIFKTCCAxGgAwIBAgIRAOxGNJNgz0sP+KmC2Tqpyj0wDQYJKoZIhvcNAQELBQAw
LjELMAkGA1UEBhMCVVMxDTALBgNVBAoTBElTUkcxEDAOBgNVBAMTB1Jvb3QgWVIw
HhcNMjUwOTAzMDAwMDAwWhcNNDUwOTAyMjM1OTU5WjAuMQswCQYDVQQGEwJVUzEN
MAsGA1UEChMESVNSRzEQMA4GA1UEAxMHUm9vdCBZUjCCAiIwDQYJKoZIhvcNAQEB
BQADggIPADCCAgoCggIBANvGJnN78CTJdWL3+eGfsLN5TrNBJs+VH9hRXqRbwxu9
sGNiB0BD1fcOxbSUQCJIM1xE13Db+5Cw1w0s0EBYsvuIP/6joF0w8cuImbgR1OGg
YbSQ4OpzI+DG8SGuTlcE873OCS+kh3srlo6vl43M5OJg4Aeo1sfHp6kTJDoIiFBN
JAY+OKfX/FUvYKuhjT+no49lmqmupSBI5PkBQiqrEGtWU5uxU/cQWHGu8jSjFBzn
ZqvbNPLMXMLFxCb3WTfrJBXXjqvWG+v4bjzxjjeAtOlU7qarRDvNOyAuQYLln904
M+faKx8hnLCpJ15ZqaEgcNlY+9MMWcC5yvL2A2j3l9+2buggZX+dOE91zYmIdawT
vSZuVvlbRrAlLxIB6pwMBjneXCjYQ8+3BCCjssbSNpZU3hTcBDdhfAlEDlYr6pEa
tnMdmDT5BqnKC92bd0EhM1fbLHioLccLCuievT8ZkPhZrq7Mii7gNXAcUEAR8+lz
Yal+9zTg7C5DALyVOeG/CqfRAMn1KSHCR0NSA6P8tn/mGRlnCct5rtVCLnVySVpU
6H1qGg3DgTOuskf8eahTMiYbI5ezPJmO5ertalskQ1utp74+eDy92PI4ftHKTbq9
IWhH4YZKh3WnJEIt+oQvlYZbY8tpEroKrFB6PFGzrJIDRyts4HqvuH52RFj2zv/B
AgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNVHRMBAf8EBTADAQH/MB0GA1Ud
DgQWBBTe51tg0CJtQCh9Pw0B/qS1UrRRlDANBgkqhkiG9w0BAQsFAAOCAgEAWHnf
713Bdkq7t5yN2dNIgQakUb94X9WuyhMEHHkgx4oDpSUlnG0w4g94MoqaEUE31ZjR
LU7L5LD1g9ujFHTQu8AD215AHMVQFbm6j8hQxdXHAzDajFNQnOlDJrLjzIx176oy
AjvUtejZx2NNmdb5fd0WGVGsCdoAJ3N8ozo7ajE8t6vfxStZb4BQ9WYJGHUDrv2N
i5tJF6CNiPnlzs3BUfECRbE4JSk+jvy8+VoGiFE8qsH/j78x2fjgQhAQFV7P7Zxy
dBTZ1wEkNpZNW2qnaK1SKBLa+xf6E06YRIq5uaI+HWH8SY1y5VbRgzq40EKg3yxP
06fz+uYAUIFJoLNfhwRCc3Q6pQVuMX3yAjHAes4gk4moGcLQ5p7HAh39yeylZc1J
41sx/jKwLIkPE6Rr1Nf4pxdsxf9SA4yOEiAkDgq04DVxn8hgYFdUtBCuiuVC2heA
EiqVEa+8QZjuw8Gj0EbHXcRd1nInvGqRS1o9Is7YBdQN57X1AYveGBNNqjICSb7c
awuw1EawTDrs13VUlJVEsbQ0/O/1aaV73mCdOQ8azqL2KTv1Ewu1xbquE2S+kdQU
To9TUwat3wUA6cwXh1EfpS/3fJ0aGah5hdpRyoCLDlsSn8tkrjMfFFX0viC+GxHc
sI1ANRYvqSFC2X1VRZfDg+wD6E21BccmifG4yWc=
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIFVzCCAz+gAwIBAgINAgPlk28xsBNJiGuiFzANBgkqhkiG9w0BAQwFADBHMQsw
CQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEU
MBIGA1UEAxMLR1RTIFJvb3QgUjEwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAw
MDAwWjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZp
Y2VzIExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjEwggIiMA0GCSqGSIb3DQEBAQUA
A4ICDwAwggIKAoICAQC2EQKLHuOhd5s73L+UPreVp0A8of2C+X0yBoJx9vaMf/vo
27xqLpeXo4xL+Sv2sfnOhB2x+cWX3u+58qPpvBKJXqeqUqv4IyfLpLGcY9vXmX7w
Cl7raKb0xlpHDU0QM+NOsROjyBhsS+z8CZDfnWQpJSMHobTSPS5g4M/SCYe7zUjw
TcLCeoiKu7rPWRnWr4+wB7CeMfGCwcDfLqZtbBkOtdh+JhpFAz2weaSUKK0Pfybl
qAj+lug8aJRT7oM6iCsVlgmy4HqMLnXWnOunVmSPlk9orj2XwoSPwLxAwAtcvfaH
szVsrBhQf4TgTM2S0yDpM7xSma8ytSmzJSq0SPly4cpk9+aCEI3oncKKiPo4Zor8
Y/kB+Xj9e1x3+naH+uzfsQ55lVe0vSbv1gHR6xYKu44LtcXFilWr06zqkUspzBmk
MiVOKvFlRNACzqrOSbTqn3yDsEB750Orp2yjj32JgfpMpf/VjsPOS+C12LOORc92
wO1AK/1TD7Cn1TsNsYqiA94xrcx36m97PtbfkSIS5r762DL8EGMUUXLeXdYWk70p
aDPvOmbsB4om3xPXV2V4J95eSRQAogB/mqghtqmxlbCluQ0WEdrHbEg8QOB+DVrN
VjzRlwW5y0vtOUucxD/SVRNuJLDWcfr0wbrM7Rv1/oFB2ACYPTrIrnqYNxgFlQID
AQABo0IwQDAOBgNVHQ8BAf8EBAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4E
FgQU5K8rJnEaK0gnhS9SZizv8IkTcT4wDQYJKoZIhvcNAQEMBQADggIBAJ+qQibb
C5u+/x6Wki4+omVKapi6Ist9wTrYggoGxval3sBOh2Z5ofmmWJyq+bXmYOfg6LEe
QkEzCzc9zolwFcq1JKjPa7XSQCGYzyI0zzvFIoTgxQ6KfF2I5DUkzps+GlQebtuy
h6f88/qBVRRiClmpIgUxPoLW7ttXNLwzldMXG+gnoot7TiYaelpkttGsN/H9oPM4
7HLwEXWdyzRSjeZ2axfG34arJ45JK3VmgRAhpuo+9K4l/3wV3s6MJT/KYnAK9y8J
ZgfIPxz88NtFMN9iiMG1D53Dn0reWVlHxYciNuaCp+0KueIHoI17eko8cdLiA6Ef
MgfdG+RCzgwARWGAtQsgWSl4vflVy2PFPEz0tv/bal8xa5meLMFrUKTX5hgUvYU/
Z6tGn6D/Qqc6f1zLXbBwHSs09dR2CQzreExZBfMzQsNhFRAbd03OIozUhfJFfbdT
6u9AWpQKXCBfTkBdYiJ23//OYb2MI3jSNwLgjt7RETeJ9r/tSQdirpLsQBqvFAnZ
0E6yove+7u7Y/9waLd64NnHi/Hm3lCXRSHNboTXns5lndcEZOitHTtNCjv0xyBZm
2tIMPNuzjsmhDYAPexZ3FL//2wmUspO8IFgV6dtxQ/PeEMMA3KgqlbbC1j+Qa3bb
bP6MvPJwNQzcmRk13NfIRmPVNnGuV/u3gm3c
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIDdTCCAl2gAwIBAgILBAAAAAABFUtaw5QwDQYJKoZIhvcNAQEFBQAwVzELMAkG
A1UEBhMCQkUxGTAXBgNVBAoTEEdsb2JhbFNpZ24gbnYtc2ExEDAOBgNVBAsTB1Jv
b3QgQ0ExGzAZBgNVBAMTEkdsb2JhbFNpZ24gUm9vdCBDQTAeFw05ODA5MDExMjAw
MDBaFw0yODAxMjgxMjAwMDBaMFcxCzAJBgNVBAYTAkJFMRkwFwYDVQQKExBHbG9i
YWxTaWduIG52LXNhMRAwDgYDVQQLEwdSb290IENBMRswGQYDVQQDExJHbG9iYWxT
aWduIFJvb3QgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDaDuaZ
jc6j40+Kfvvxi4Mla+pIH/EqsLmVEQS98GPR4mdmzxzdzxtIK+6NiY6arymAZavp
xy0Sy6scTHAHoT0KMM0VjU/43dSMUBUc71DuxC73/OlS8pF94G3VNTCOXkNz8kHp
1Wrjsok6Vjk4bwY8iGlbKk3Fp1S4bInMm/k8yuX9ifUSPJJ4ltbcdG6TRGHRjcdG
snUOhugZitVtbNV4FpWi6cgKOOvyJBNPc1STE4U6G7weNLWLBYy5d4ux2x8gkasJ
U26Qzns3dLlwR5EiUWMWea6xrkEmCMgZK9FGqkjWZCrXgzT/LCrBbBlDSgeF59N8
9iFo7+ryUp9/k5DPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNVHRMBAf8E
BTADAQH/MB0GA1UdDgQWBBRge2YaRQ2XyolQL30EzTSo//z9SzANBgkqhkiG9w0B
AQUFAAOCAQEA1nPnfE920I2/7LqivjTFKDK1fPxsnCwrvQmeU79rXqoRSLblCKOz
yj1hTdNGCbM+w6DjY1Ub8rrvrTnhQ7k4o+YviiY776BQVvnGCv04zcQLcFGUl5gE
38NflNUVyRRBnMRddWQVDf9VMOyGj/8N7yy5Y0b2qvzfvGn9LhJIZJrglfCm7ymP
AbEVtQwdpf5pLGkkeB6zpxxxYu7KyJesF12KwvhHhm4qxFYxldBniYUr+WymXUad
DKqC5JlR3XC321Y9YeRq4VzW9v493kHMB65jUr9TU/Qr6cf9tveCX4XSQRjbgbME
HMUfpIBvFSDJ3gyICh3WZlXi/EjJKSZp4A==
-----END CERTIFICATE-----
)CERT";

// ---- Embedded OTA signing keys (PUBLIC keys only, T-12a) ----
// An ECDSA P-256 signature over the exact manifest string is checked with
// mbedtls against the key named by the response's key_id. "primary" signs
// releases today; "spare" is the pre-positioned rotation key. The private keys
// are Jeff's, are held offline outside this repository (decision OTA-4), and
// must never be generated, requested or committed here. These two files are
// firmware/keys/pakaonai-ota-primary-public.pem and
// firmware/keys/pakaonai-ota-spare-public.pem, copied verbatim.
static const char* OTA_KEY_PRIMARY_PEM = R"KEY(
-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEwN3zcoQBsC0n8BhL7U1PPGKy2jpE
AOBOij0tH3mgohLVhXFKHZlML3vnn9CphPjAIPvIys9CGIgwCkyehwe1QA==
-----END PUBLIC KEY-----
)KEY";

static const char* OTA_KEY_SPARE_PEM = R"KEY(
-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAExa0TU1zTWwLvPciDrDUIZ+gSjXBV
VC2U+UkjnsS9bS7guFXvY41PNeEVH4lp5iEcgtjQc6E+IgFO8QHwfPoRgg==
-----END PUBLIC KEY-----
)KEY";

// Default WiFi credentials (overridden by stored values in NVS)
#define DEFAULT_WIFI_SSID "YOUR_WIFI_SSID"
#define DEFAULT_WIFI_PASS "YOUR_WIFI_PASSWORD"

#define RELAY_PIN       25
#define BUTTON_PIN      27          // pick any free GPIO; wired to GND via INPUT_PULLUP

// ---- Dedicated reset buttons (both active-low) --------------------------
// Wire each button between its GPIO and GND; the internal pull-up is enabled.
// GPIO 17 is the Wi-Fi reset (5 s, device identity kept), GPIO 16 the factory
// reset (10 s, WiFi and identity wiped). Both are free on the ESP32-WROOM-32U
// used here (not used by this sketch) and neither is a strapping pin. Still
// free: 13, 14, 18, 19, 23. Do NOT use 32/33 (HC-SR04), 25/26/27 (relay,
// DS18B20, feed button), 21/22 (RTC I2C), 0/2/12/15 (strapping), 34-39
// (input-only, no internal pull-up) or 1/3 (USB serial).
#define WIFI_RESET_BUTTON_PIN       17   // hold to clear WiFi only
#define FACTORY_RESET_BUTTON_PIN    16   // hold to clear WiFi + identity
#define WIFI_RESET_HOLD_MS        5000   // continuous hold: WiFi reset
#define FACTORY_RESET_HOLD_MS    10000   // continuous hold: factory reset
// WIFI_RESET_HOLD_MS also governs the GPIO 27 feed-button hold at boot.
#define RESET_BUTTON_DEBOUNCE_MS         50
#define RESET_BUTTON_STARTUP_GRACE_MS  5000  // ignore presses during boot

// Reset button state. Declared before the first function so Arduino's
// auto-generated prototypes can see the type.
struct ResetButtonState {
  bool stableDown;
  unsigned long lastChangeMs;
  unsigned long pressStartMs;
};

ResetButtonState wifiResetButton = { false, 0, 0 };
ResetButtonState factoryResetButton = { false, 0, 0 };
bool resetButtonsArmed = false;
#define RTC_SDA         21
#define RTC_SCL         22
#define TRIG_PIN        32          // HC-SR04 ultrasonic trigger
#define ECHO_PIN        33          // HC-SR04 ultrasonic echo
#define DS18B20_PIN     26          // DS18B20 water temperature probe

#define RELAY_ON        HIGH        // energizes coil, closes NO contacts -> dispensing
#define RELAY_OFF       LOW         // rest state, contacts open -> not dispensing

#define POST_INTERVAL_MS    5000    // telemetry + feed-command + schedule-sync poll interval
#define BUTTON_DEBOUNCE_MS  250
#define WIFI_RETRY_INTERVAL_MS 10000

// ---- WiFi provisioning portal ----
#define WIFI_JOIN_WINDOW_MS          15000  // time allowed for each join attempt
#define WIFI_FAILURES_BEFORE_PORTAL  5      // consecutive failed joins before the setup AP starts
// The GPIO 27 boot-button hold uses WIFI_RESET_HOLD_MS (with the reset buttons).
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

// Active device identity: NVS device_id / device_token once provisioned,
// otherwise the compile-time DEVICE_MAC / DEVICE_TOKEN fallbacks. All URLs,
// headers, payloads and the setup AP name read these globals.
String provisionedDeviceId;
String provisionedDeviceToken;
bool provisionedFlag = false;  // NVS "provisioned" marker written on a full save

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
// Calendar day the schedule flags belong to. -1 means "first run" so
// handleSchedule clears firedToday once, exactly as the old function-static
// did. An OTA checkpoint restore sets it so the flags survive the reboot.
int lastScheduleDay = -1;

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

// ==================== Remote OTA state (T-12a) ====================

// ECDSA public keys a signed manifest may name in key_id.
struct OtaPublicKey {
  const char *id;
  const char *pem;
};
static const OtaPublicKey OTA_PUBLIC_KEYS[] = {
  { "primary", OTA_KEY_PRIMARY_PEM },
  { "spare",   OTA_KEY_SPARE_PEM },
};
static const size_t OTA_PUBLIC_KEY_COUNT = sizeof(OTA_PUBLIC_KEYS) / sizeof(OTA_PUBLIC_KEYS[0]);

// Reported in every heartbeat. One of: idle, checking, pending_verify, valid,
// downloading, installed, aborted, failed, rolled_back.
const char *otaState = "idle";

// True from the moment the download starts until it ends. dispenseFeed()
// refuses every trigger while it is set and reports feed_refused with reason
// ota_in_progress (dashboard feeds) as decided in OTA-2.
bool otaInProgress = false;

// First-boot probation of a freshly installed image (see verifyRollbackLater).
bool otaVerifyPending = false;
bool otaHealthCheckActive = false;
bool otaHealthSawWifi = false;
bool otaHealthSawTime = false;
bool otaHealthSawPoll = false;

// Next scheduled check and the 1 h -> 6 h -> 24 h deferral ladder.
unsigned long nextOtaCheckMs = OTA_CHECK_INTERVAL_MS;
uint8_t otaBackoffLevel = 0;

// Boot diagnostics, filled at the top of setup().
const char *resetReasonName = "unknown";
bool lastResetWasBrownout = false;

String generateEventId() {
  eventCounter++;
  uint32_t r = esp_random();
  char buf[24];
  snprintf(buf, sizeof(buf), "evt-%08lx-%04lx", r, eventCounter & 0xFFFF);
  return String(buf);
}

// ==================== LAN OTA (bench builds only) ====================

// Decision OTA-7: field builds carry no LAN updater. ArduinoOTA uses a shared
// static password and bypasses the signed OTA path entirely, so it is compiled
// in only for bench builds with -DENABLE_LAN_OTA (see platformio.ini).
#ifdef ENABLE_LAN_OTA
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
  Serial.println("[OTA] LAN ArduinoOTA ready (bench build)");
}
#endif

// ==================== WiFi / device identity storage ====================

void loadWiFiCredentials(String &ssid, String &pass) {
  ssid = prefs.getString("wifi_ssid", DEFAULT_WIFI_SSID);
  pass = prefs.getString("wifi_pass", DEFAULT_WIFI_PASS);
}

void saveWiFiCredentials(const String &ssid, const String &pass) {
  prefs.putString("wifi_ssid", ssid);
  prefs.putString("wifi_pass", pass);
  Serial.println("[WiFi] Credentials saved to NVS");
}

// Compile-time identity values are placeholders until edited at flash time.
// A unit still carrying one must be provisioned before it can reach the API.
bool identityValueIsPlaceholder(const String &value) {
  if (value.length() == 0) return true;
  if (value == "YOUR_DEVICE_ID" || value == "YOUR_DEVICE_TOKEN") return true;
  if (value == "CHANGE_ME" || value == "change-me") return true;
  if (value == "00:00:00:00:00:00") return true;
  return false;
}

// Load the active identity once, right after prefs.begin(). A missing or empty
// NVS value falls back to the compile-time default so units flashed before
// identity provisioning keep working without opening the portal.
void loadDeviceIdentity() {
  provisionedDeviceId = prefs.getString("device_id", DEVICE_MAC);
  provisionedDeviceToken = prefs.getString("device_token", DEVICE_TOKEN);
  provisionedDeviceId.trim();
  provisionedDeviceToken.trim();
  if (provisionedDeviceId.length() == 0) provisionedDeviceId = DEVICE_MAC;
  if (provisionedDeviceToken.length() == 0) provisionedDeviceToken = DEVICE_TOKEN;
  provisionedFlag = prefs.getBool("provisioned", false);

  Serial.printf("[IDENTITY] Device ID: %s\n", provisionedDeviceId.c_str());
  // Never print the token itself: it authenticates every API call.
  Serial.printf("[IDENTITY] Device token: %s\n",
                identityValueIsPlaceholder(provisionedDeviceToken) ? "missing" : "configured");
  Serial.printf("[IDENTITY] Provisioned marker: %s\n", provisionedFlag ? "yes" : "no");
}

void saveDeviceIdentity(const String &deviceId, const String &deviceToken) {
  prefs.putString("device_id", deviceId);
  prefs.putString("device_token", deviceToken);
  prefs.putBool("provisioned", true);
  provisionedDeviceId = deviceId;
  provisionedDeviceToken = deviceToken;
  provisionedFlag = true;
  Serial.println("[IDENTITY] Device identity saved to NVS");
}

// True only when NVS holds a usable SSID. A missing, empty or placeholder
// SSID means the WiFi side has never been provisioned.
bool storedSsidAvailable() {
  if (!prefs.isKey("wifi_ssid")) return false;
  String ssid = prefs.getString("wifi_ssid", "");
  return ssid.length() > 0 && ssid != DEFAULT_WIFI_SSID;
}

// Full provisioning gate: a usable SSID AND a usable device identity. The
// identity may come from NVS or from non-placeholder compile-time defaults, so
// already-flashed units continue to boot straight into normal operation.
bool wifiCredentialsProvisioned() {
  return storedSsidAvailable() &&
         !identityValueIsPlaceholder(provisionedDeviceId) &&
         !identityValueIsPlaceholder(provisionedDeviceToken);
}

// WiFi-only reset: the device identity is deliberately kept in NVS, so the
// portal can be reopened and saved with the identity fields left blank.
void clearWiFiCredentials() {
  prefs.remove("wifi_ssid");
  prefs.remove("wifi_pass");
  Serial.println("[WiFi] Stored WiFi credentials cleared (device identity kept)");
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

// ==================== Dedicated reset buttons ====================

// Erase the ESP-IDF WiFi stack's own stored station config, not just our NVS
// keys. Without this a reachable old AP can be rejoined from the stack cache.
void clearWiFiStackCredentials() {
  if (WiFi.getMode() != WIFI_MODE_NULL) {
    esp_wifi_restore();
  }
}

void clearDeviceIdentity() {
  prefs.remove("device_id");
  prefs.remove("device_token");
  prefs.remove("provisioned");
  provisionedDeviceId = "";
  provisionedDeviceToken = "";
  provisionedFlag = false;
  Serial.println("[RESET] Stored device identity cleared");
}

void initResetButtons() {
  if (WIFI_RESET_BUTTON_PIN >= 0) pinMode(WIFI_RESET_BUTTON_PIN, INPUT_PULLUP);
  if (FACTORY_RESET_BUTTON_PIN >= 0) pinMode(FACTORY_RESET_BUTTON_PIN, INPUT_PULLUP);

  if (WIFI_RESET_BUTTON_PIN >= 0 || FACTORY_RESET_BUTTON_PIN >= 0) {
    Serial.printf("[RESET] Buttons ready - WiFi reset: GPIO%d (%lus), factory reset: GPIO%d (%lus)\n",
                  WIFI_RESET_BUTTON_PIN, (unsigned long)(WIFI_RESET_HOLD_MS / 1000),
                  FACTORY_RESET_BUTTON_PIN, (unsigned long)(FACTORY_RESET_HOLD_MS / 1000));
  } else {
    Serial.println("[RESET] Dedicated reset buttons disabled (pins are -1)");
  }
}

// Active-low with the internal pull-up. Returns true while stably pressed.
bool readResetButton(int pin, ResetButtonState &state, unsigned long now) {
  if (pin < 0) return false;
  bool raw = (digitalRead(pin) == LOW);

  if (raw != state.stableDown && (now - state.lastChangeMs) >= RESET_BUTTON_DEBOUNCE_MS) {
    state.stableDown = raw;
    state.lastChangeMs = now;
    if (raw) state.pressStartMs = now;
  }
  return state.stableDown;
}

// Requires a clean release after boot; a stuck button can never trigger a
// reset. Factory reset wins: while its button is held the Wi-Fi reset is
// suppressed, so a two-button hold cannot reboot at 5 s and skip it.
void handleResetButtons() {
  if (WIFI_RESET_BUTTON_PIN < 0 && FACTORY_RESET_BUTTON_PIN < 0) return;

  unsigned long now = millis();
  if (!resetButtonsArmed) {
    bool wifiIdle = WIFI_RESET_BUTTON_PIN < 0 || digitalRead(WIFI_RESET_BUTTON_PIN) == HIGH;
    bool factoryIdle = FACTORY_RESET_BUTTON_PIN < 0 || digitalRead(FACTORY_RESET_BUTTON_PIN) == HIGH;
    if (now >= RESET_BUTTON_STARTUP_GRACE_MS && wifiIdle && factoryIdle) {
      resetButtonsArmed = true;
      wifiResetButton.lastChangeMs = now;
      factoryResetButton.lastChangeMs = now;
    }
    return;
  }

  bool factoryDown = readResetButton(FACTORY_RESET_BUTTON_PIN, factoryResetButton, now);
  if (factoryDown && (now - factoryResetButton.pressStartMs) >= FACTORY_RESET_HOLD_MS) {
    Serial.println("[RESET] Factory reset button held - clearing WiFi and device identity");
    clearWiFiStackCredentials();
    clearWiFiCredentials();
    clearDeviceIdentity();
    delay(300);
    ESP.restart();
  }

  bool wifiDown = readResetButton(WIFI_RESET_BUTTON_PIN, wifiResetButton, now);
  if (wifiDown && !factoryDown && (now - wifiResetButton.pressStartMs) >= WIFI_RESET_HOLD_MS) {
    Serial.println("[RESET] WiFi reset button held - clearing WiFi, keeping device identity");
    clearWiFiStackCredentials();
    clearWiFiCredentials();
    delay(300);
    ESP.restart();
  }
}

// ==================== WiFi provisioning portal ====================

// The chip's factory (eFuse) Wi-Fi station MAC, "AA:BB:CC:DD:EE:FF". Read from
// eFuse, so it is valid before WiFi starts and never changes with NVS state.
// This is the MAC to register in the dashboard: it is printed at boot.
String chipMacString() {
  uint8_t mac[6] = {0};
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  char buf[18];
  snprintf(buf, sizeof(buf), "%02X:%02X:%02X:%02X:%02X:%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  return String(buf);
}

// "PakaonAI-XXXX", where XXXX is the last four hex characters of the chip's
// eFuse MAC. Deliberately not the saved device_id: that falls back to the
// compile-time DEVICE_MAC, which would give every unprovisioned unit the same
// name, and the printed sticker QR is built from the registered chip MAC.
String provisioningApSsid() {
  const String source = chipMacString();
  String hex;
  hex.reserve(source.length());
  for (size_t i = 0; i < source.length(); i++) {
    char c = source[i];
    if (isxdigit((unsigned char)c)) hex += (char)toupper((unsigned char)c);
  }
  while (hex.length() < 4) hex = String("0") + hex;
  return String(PROVISIONING_AP_PREFIX) + hex.substring(hex.length() - 4);
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
  // Identity values are never rendered back into the form: the stored token
  // must not be readable by anyone who joins the open setup AP.
  const bool identityAvailable = !identityValueIsPlaceholder(provisionedDeviceId) &&
                                 !identityValueIsPlaceholder(provisionedDeviceToken);

  String page = F(
    "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">"
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
    "<title>PakaonAI device setup</title><style>"
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
    "<h1>PakaonAI device setup</h1>"
    "<p class=\"note\">Connect the feeder to a 2.4 GHz WiFi network and enter its device identity. The device restarts after saving and joins automatically.</p>"
    "{{ERROR}}"
    "<form method=\"POST\" action=\"/save\">"
    "<label for=\"ssid\">WiFi name (SSID)</label>"
    "<input id=\"ssid\" name=\"ssid\" type=\"text\" maxlength=\"32\" required autocomplete=\"off\" value=\"{{SSID}}\">"
    "<label for=\"pass\">Password</label>"
    "<input id=\"pass\" name=\"pass\" type=\"password\" maxlength=\"63\" autocomplete=\"new-password\">"
    "<p class=\"note\">Leave the password empty for an open network, otherwise use 8-63 characters.</p>"
    "<label for=\"device_id\">Device ID</label>"
    "<input id=\"device_id\" name=\"device_id\" type=\"text\" maxlength=\"64\" autocomplete=\"off\" value=\"\" placeholder=\"{{ID_PLACEHOLDER}}\">"
    "<label for=\"device_token\">Device Token</label>"
    "<input id=\"device_token\" name=\"device_token\" type=\"password\" maxlength=\"128\" autocomplete=\"new-password\" value=\"\" placeholder=\"{{TOKEN_PLACEHOLDER}}\">"
    "<p class=\"note\">Find both under Admin &rarr; Devices in the PakaonAI dashboard. Leave them blank to keep the identity already stored on this device.</p>"
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

  const String identityPlaceholder = identityAvailable
    ? String(F("leave blank to keep existing"))
    : String(F("required for first-time setup"));

  // AP/ERROR/identity placeholders first, SSID last: a user-supplied SSID must
  // never be re-scanned for another placeholder.
  page.replace("{{AP}}", htmlEscape(provisioningApName));
  page.replace("{{ERROR}}", errorBlock);
  page.replace("{{ID_PLACEHOLDER}}", identityPlaceholder);
  page.replace("{{TOKEN_PLACEHOLDER}}", identityPlaceholder);
  page.replace("{{SSID}}", htmlEscape(ssid));
  return page;
}

String buildProvisioningSuccessPage() {
  return String(F(
    "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">"
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
    "<title>PakaonAI saved</title></head>"
    "<body style=\"font-family:system-ui,sans-serif;padding:32px;max-width:420px;margin:0 auto\">"
    "<h1>Settings saved</h1>"
    "<p>The feeder is restarting and will join your WiFi network. You can close this page.</p>"
    "</body></html>"));
}

void handleProvisioningRoot() {
  String currentSsid;
  if (storedSsidAvailable()) currentSsid = prefs.getString("wifi_ssid", "");
  provisioningServer.send(200, "text/html", buildProvisioningPage(currentSsid, ""));
}

void handleProvisioningSave() {
  const String ssid = provisioningServer.arg("ssid");
  const String pass = provisioningServer.arg("pass");
  String deviceId = provisioningServer.arg("device_id");
  String deviceToken = provisioningServer.arg("device_token");
  deviceId.trim();
  deviceToken.trim();

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

  // Blank identity fields keep the active identity (NVS, or the compile-time
  // fallback). This is what lets the WiFi-only reset flow save a new network
  // without re-typing the Device ID / token.
  if (deviceId.length() == 0) deviceId = provisionedDeviceId;
  if (deviceToken.length() == 0) deviceToken = provisionedDeviceToken;

  if (deviceId.length() < 1 || deviceId.length() > 64) {
    provisioningServer.send(400, "text/html",
      buildProvisioningPage(ssid, "Device ID must be 1-64 characters."));
    return;
  }
  if (deviceToken.length() < 8 || deviceToken.length() > 128) {
    provisioningServer.send(400, "text/html",
      buildProvisioningPage(ssid, "Device Token must be 8-128 characters."));
    return;
  }
  if (identityValueIsPlaceholder(deviceId) || identityValueIsPlaceholder(deviceToken)) {
    provisioningServer.send(400, "text/html",
      buildProvisioningPage(ssid,
        "Device ID and Device Token are required. Find them under Admin - Devices in the dashboard."));
    return;
  }

  // Persist WiFi and identity together; a reboot must never land on a partial
  // configuration that has a new network but the wrong device identity.
  saveWiFiCredentials(ssid, pass);       // NVS keys: wifi_ssid / wifi_pass
  saveDeviceIdentity(deviceId, deviceToken);  // NVS keys: device_id / device_token / provisioned
  Serial.printf("[PROV] Provisioning saved for device %s - restarting\n", deviceId.c_str());

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

// ==================== Remote OTA (T-12a) ====================

// The core's initArduino() marks a PENDING_VERIFY image valid immediately
// unless this weak C symbol is overridden (cores/esp32/esp32-hal-misc.c).
// Returning true defers that decision to the health-check state machine below:
// the image must earn "valid" within OTA_HEALTH_CHECK_TIMEOUT_MS, otherwise
// the bootloader returns to the previous slot. It must stay extern "C" to
// match the core's unmangled symbol; a C++ definition would be ignored.
extern "C" bool verifyRollbackLater() {
  return true;
}

const char *resetReasonLabel(esp_reset_reason_t reason) {
  switch (reason) {
    case ESP_RST_POWERON:   return "poweron";
    case ESP_RST_EXT:       return "external";
    case ESP_RST_SW:        return "software";
    case ESP_RST_PANIC:     return "panic";
    case ESP_RST_INT_WDT:   return "interrupt_wdt";
    case ESP_RST_TASK_WDT:  return "task_wdt";
    case ESP_RST_WDT:       return "wdt";
    case ESP_RST_DEEPSLEEP: return "deepsleep";
    case ESP_RST_BROWNOUT:  return "brownout";
    case ESP_RST_SDIO:      return "sdio";
    default:                return "unknown";
  }
}

void otaSetState(const char *state) {
  if (strcmp(otaState, state) == 0) return;
  otaState = state;
  Serial.printf("[OTA] state -> %s\n", state);
}

// A usable wall clock: either NTP set the system time (what TLS checks) or the
// RTC already holds a plausible date.
bool validTimeAvailable() {
  if ((long)time(nullptr) >= 1700000000L) return true;
  if (rtcAvailable && rtc.now().year() >= 2024) return true;
  return false;
}

// ---- Semantic versions ("1.4.0", optional -rc1 suffix) ----
bool parseSemver(const char *text, int out[3]) {
  if (text == nullptr || *text == '\0') return false;
  out[0] = out[1] = out[2] = 0;
  int part = 0;
  const char *p = text;
  while (part < 3) {
    if (*p < '0' || *p > '9') return false;
    long value = 0;
    while (*p >= '0' && *p <= '9') {
      value = value * 10 + (*p - '0');
      if (value > 999999) return false;
      ++p;
    }
    out[part++] = (int)value;
    if (*p != '.') break;
    ++p;
    if (part == 3) return false;
  }
  if (*p != '\0' && *p != '-' && *p != '+') return false;
  return true;
}

// >0 when a is newer than b, 0 when equal, <0 when older or unparsable.
int compareSemver(const char *a, const char *b) {
  int va[3];
  int vb[3];
  if (!parseSemver(a, va) || !parseSemver(b, vb)) return 0;
  for (int i = 0; i < 3; i++) {
    if (va[i] != vb[i]) return va[i] > vb[i] ? 1 : -1;
  }
  return 0;
}

// ---- Small binary helpers (no String hex, no Arduino base64) ----
String sha256Hex(const uint8_t digest[32]) {
  static const char *hexDigits = "0123456789abcdef";
  char out[65];
  for (int i = 0; i < 32; i++) {
    out[i * 2] = hexDigits[(digest[i] >> 4) & 0x0F];
    out[i * 2 + 1] = hexDigits[digest[i] & 0x0F];
  }
  out[64] = '\0';
  return String(out);
}

bool equalsIgnoreCase(const String &a, const String &b) {
  if (a.length() != b.length()) return false;
  for (size_t i = 0; i < a.length(); i++) {
    if (tolower((unsigned char)a[i]) != tolower((unsigned char)b[i])) return false;
  }
  return true;
}

bool base64Decode(const String &encoded, uint8_t *out, size_t outCapacity, size_t &outLength) {
  outLength = 0;
  if (encoded.length() == 0) return false;
  size_t decoded = 0;
  const int rc = mbedtls_base64_decode(out, outCapacity, &decoded,
                                       (const unsigned char *)encoded.c_str(), encoded.length());
  if (rc != 0 || decoded == 0) return false;
  outLength = decoded;
  return true;
}

// ECDSA P-256 / SHA-256 over the exact manifest string, using the embedded
// public key named by key_id. Never trusts a key shipped in the response.
bool verifyManifestSignature(const String &manifest, const String &signatureBase64,
                             const String &keyId) {
  const char *pem = nullptr;
  for (size_t i = 0; i < OTA_PUBLIC_KEY_COUNT; i++) {
    if (keyId == OTA_PUBLIC_KEYS[i].id) {
      pem = OTA_PUBLIC_KEYS[i].pem;
      break;
    }
  }
  if (pem == nullptr) {
    Serial.printf("[OTA] unknown key_id '%s' - refusing\n", keyId.c_str());
    return false;
  }

  uint8_t signature[128];   // DER-encoded P-256 signatures are ~70-72 bytes
  size_t signatureLength = 0;
  if (!base64Decode(signatureBase64, signature, sizeof(signature), signatureLength)) {
    Serial.println("[OTA] signature is not valid base64");
    return false;
  }

  uint8_t digest[32];
  mbedtls_sha256_context sha;
  mbedtls_sha256_init(&sha);
  int rc = mbedtls_sha256_starts_ret(&sha, 0);
  if (rc == 0) {
    rc = mbedtls_sha256_update_ret(&sha, (const unsigned char *)manifest.c_str(),
                                   manifest.length());
  }
  if (rc == 0) rc = mbedtls_sha256_finish_ret(&sha, digest);
  mbedtls_sha256_free(&sha);
  if (rc != 0) {
    Serial.printf("[OTA] SHA-256 of the manifest failed (%d)\n", rc);
    return false;
  }

  mbedtls_pk_context key;
  mbedtls_pk_init(&key);
  rc = mbedtls_pk_parse_public_key(&key, (const unsigned char *)pem, strlen(pem) + 1);
  if (rc == 0) {
    rc = mbedtls_pk_verify(&key, MBEDTLS_MD_SHA256, digest, sizeof(digest),
                           signature, signatureLength);
  }
  mbedtls_pk_free(&key);

  if (rc != 0) Serial.printf("[OTA] manifest signature REJECTED (mbedtls %d)\n", rc);
  return rc == 0;
}

// ---- Pre-flight gate (docs/firmware-ota-plan.md §4.4) ----
// Local wall-clock minute of day. The RTC runs UTC, so this applies the fixed
// fleet offset (Philippines, UTC+8, no DST) for the maintenance window only.
bool otaLocalMinuteOfDay(int &minuteOfDay) {
  int hour = 0;
  int minute = 0;
  if (rtcAvailable) {
    DateTime now = rtc.now();
    hour = now.hour();
    minute = now.minute();
  } else {
    const time_t epoch = time(nullptr);
    if ((long)epoch < 1700000000L) return false;
    struct tm utc;
    gmtime_r(&epoch, &utc);
    hour = utc.tm_hour;
    minute = utc.tm_min;
  }
  int local = hour * 60 + minute + OTA_LOCAL_UTC_OFFSET_MINUTES;
  local %= 1440;
  if (local < 0) local += 1440;
  minuteOfDay = local;
  return true;
}

bool otaWithinWindow() {
  int localMinute = 0;
  if (!otaLocalMinuteOfDay(localMinute)) return false;
  return localMinute >= OTA_WINDOW_START_MINUTE && localMinute < OTA_WINDOW_END_MINUTE;
}

// Uses the same RTC clock handleSchedule() fires on, so the guard matches when
// this unit would actually dispense.
bool otaScheduledFeedNearby() {
  if (!rtcAvailable) return false;   // no RTC means the scheduler is off
  DateTime now = rtc.now();
  const int nowMinute = now.hour() * 60 + now.minute();
  for (int i = 0; i < feedTimesCount; i++) {
    const int feedMinute = feedTimes[i].hour * 60 + feedTimes[i].minute;
    int delta = feedMinute - nowMinute;
    if (delta < -720) delta += 1440;
    if (delta > 720) delta -= 1440;
    const int distance = delta < 0 ? -delta : delta;
    if (distance <= OTA_FEED_GUARD_MINUTES) return true;
  }
  return false;
}

bool scheduledFeedDueNow() {
  if (!rtcAvailable) return false;
  DateTime now = rtc.now();
  for (int i = 0; i < feedTimesCount; i++) {
    if (!feedTimes[i].firedToday &&
        feedTimes[i].hour == now.hour() && feedTimes[i].minute == now.minute()) {
      return true;
    }
  }
  return false;
}

// nullptr when it is safe to update, otherwise the refusal reason (logged and
// used as the backoff trigger).
const char *otaPreflightFailure() {
  if (otaInProgress) return "update_in_progress";
  if (otaHealthCheckActive || otaVerifyPending) return "pending_verify";
  if (feederActive) return "feeding";
  if (provisioningActive) return "provisioning";
  if (WiFi.status() != WL_CONNECTED) return "wifi_down";
  if (!validTimeAvailable()) return "time_invalid";
  if (WiFi.RSSI() <= OTA_MIN_RSSI_DBM) return "rssi_weak";
  if (millis() - bootTime <= OTA_MIN_UPTIME_MS) return "uptime_too_short";
  if (lastResetWasBrownout) return "brownout_reset";
  if (!otaWithinWindow()) return "outside_window";
  if (otaScheduledFeedNearby()) return "scheduled_feed_nearby";
  if (ESP.getFreeHeap() < OTA_MIN_FREE_HEAP_BYTES) return "low_heap";
  return nullptr;
}

void otaScheduleNextCheck(unsigned long delayMs) {
  nextOtaCheckMs = millis() + delayMs;
}

// 1 h -> 6 h -> 24 h, then stay at 24 h. Reset by a successful check.
void otaPostpone(const char *reason) {
  static const unsigned long kDelays[] = {
    60UL * 60UL * 1000UL,
    6UL * 60UL * 60UL * 1000UL,
    24UL * 60UL * 60UL * 1000UL,
  };
  const uint8_t level = otaBackoffLevel > 2 ? 2 : otaBackoffLevel;
  const unsigned long delayMs = kDelays[level];
  if (otaBackoffLevel < 2) otaBackoffLevel++;
  otaScheduleNextCheck(delayMs);
  Serial.printf("[OTA] postponed (%s) - next check in %lu min\n", reason, delayMs / 60000UL);
}

// ---- First-boot health check (pending verify) ----
void otaBeginHealthCheck() {
  const esp_partition_t *running = esp_ota_get_running_partition();
  esp_ota_img_states_t imageState;
  const esp_err_t err = running ? esp_ota_get_state_partition(running, &imageState) : ESP_FAIL;
  if (err != ESP_OK) {
    Serial.printf("[OTA] image state unavailable (%d) - treating as valid\n", (int)err);
    otaSetState("valid");
    return;
  }
  if (imageState != ESP_OTA_IMG_PENDING_VERIFY) {
    Serial.println("[OTA] running image is already validated");
    otaSetState("valid");
    return;
  }

  otaVerifyPending = true;
  otaHealthCheckActive = true;
  otaHealthSawWifi = false;
  otaHealthSawTime = false;
  otaHealthSawPoll = false;
  otaSetState("pending_verify");
  Serial.printf("[OTA] first boot of a new image - %lu s to pass the health check\n",
                OTA_HEALTH_CHECK_TIMEOUT_MS / 1000UL);
}

void serviceOtaHealthCheck() {
  if (!otaHealthCheckActive) return;

  if (WiFi.status() == WL_CONNECTED) otaHealthSawWifi = true;
  if (validTimeAvailable()) otaHealthSawTime = true;

  if (otaHealthSawWifi && otaHealthSawTime && otaHealthSawPoll) {
    otaHealthCheckActive = false;
    otaVerifyPending = false;
    const esp_err_t err = esp_ota_mark_app_valid_cancel_rollback();
    if (err == ESP_OK) {
      otaSetState("valid");
      Serial.println("[OTA] health check passed - image marked valid");
    } else {
      otaSetState("failed");
      Serial.printf("[OTA] could not mark the image valid (%d)\n", (int)err);
    }
    return;
  }

  if (millis() - bootTime >= OTA_HEALTH_CHECK_TIMEOUT_MS) {
    Serial.printf("[OTA] health check FAILED (wifi=%d time=%d poll=%d) - rolling back\n",
                  otaHealthSawWifi, otaHealthSawTime, otaHealthSawPoll);
    otaHealthCheckActive = false;
    otaSetState("rolled_back");
    Serial.flush();
    const esp_err_t err = esp_ota_mark_app_invalid_rollback_and_reboot();
    // Reached only when no other slot can take over (for example the very
    // first USB flash): keep running rather than stopping dead.
    Serial.printf("[OTA] rollback unavailable (%d) - continuing on this image\n", (int)err);
    otaSetState("failed");
  }
}

// ---- Feeding-state checkpoint across the install reboot ----
// New, additive keys in the existing "optifeed" namespace (15-char NVS limit).
#define OTA_NVS_DAY_KEY        "ota_day"
#define OTA_NVS_GRAMS_KEY      "ota_daily_grams"
#define OTA_NVS_FIRED_KEY      "ota_fired_mask"
#define OTA_NVS_FEED_COUNT_KEY "ota_feed_count"
#define OTA_NVS_FEED_TIMES_KEY "ota_feed_times"

uint32_t dateKeyFromDateTime(const DateTime &value) {
  return (uint32_t)value.year() * 10000UL + (uint32_t)value.month() * 100UL +
         (uint32_t)value.day();
}

void persistFeedingStateForOta() {
  if (!rtcAvailable) {
    Serial.println("[OTA] no RTC - feeding state not checkpointed");
    return;
  }
  DateTime now = rtc.now();
  int count = feedTimesCount;
  if (count < 0) count = 0;
  if (count > MAX_FEED_TIMES) count = MAX_FEED_TIMES;

  uint8_t times[MAX_FEED_TIMES * 2];
  uint32_t firedMask = 0;
  for (int i = 0; i < MAX_FEED_TIMES; i++) {
    times[i * 2] = (i < count) ? feedTimes[i].hour : 0;
    times[i * 2 + 1] = (i < count) ? feedTimes[i].minute : 0;
  }
  for (int i = 0; i < count && i < 32; i++) {
    if (feedTimes[i].firedToday) firedMask |= (1UL << i);
  }

  prefs.putUInt(OTA_NVS_DAY_KEY, dateKeyFromDateTime(now));
  prefs.putFloat(OTA_NVS_GRAMS_KEY, dailyGramsDispensed);
  prefs.putUInt(OTA_NVS_FIRED_KEY, firedMask);
  prefs.putUChar(OTA_NVS_FEED_COUNT_KEY, (uint8_t)count);
  prefs.putBytes(OTA_NVS_FEED_TIMES_KEY, times, sizeof(times));

  Serial.printf("[OTA] state checkpointed: %.0f g, %d feed time(s), day %lu\n",
                dailyGramsDispensed, count, (unsigned long)dateKeyFromDateTime(now));
}

// Restores the schedule every boot (it is date-independent) and the daily
// grams plus firedToday flags only when the checkpoint is from today. Consumes
// the checkpoint so a later power cycle cannot resurrect stale numbers.
void restoreFeedingStateAfterOta() {
  if (!prefs.isKey(OTA_NVS_DAY_KEY)) return;

  const uint32_t storedDay = prefs.getUInt(OTA_NVS_DAY_KEY, 0);
  const int storedCount = (int)prefs.getUChar(OTA_NVS_FEED_COUNT_KEY, 0);
  uint8_t times[MAX_FEED_TIMES * 2];
  const size_t copied = prefs.getBytes(OTA_NVS_FEED_TIMES_KEY, times, sizeof(times));

  if (storedCount >= 1 && storedCount <= MAX_FEED_TIMES && copied == sizeof(times)) {
    for (int i = 0; i < storedCount; i++) {
      feedTimes[i].hour = times[i * 2];
      feedTimes[i].minute = times[i * 2 + 1];
      feedTimes[i].firedToday = false;
    }
    feedTimesCount = storedCount;
    Serial.printf("[OTA] schedule restored from NVS (%d feed(s))\n", storedCount);
  }

  if (rtcAvailable) {
    DateTime now = rtc.now();
    if (dateKeyFromDateTime(now) == storedDay) {
      dailyGramsDispensed = prefs.getFloat(OTA_NVS_GRAMS_KEY, 0.0f);
      lastDailyResetDay = now.day();
      lastDailyResetMs = millis();
      const uint32_t firedMask = prefs.getUInt(OTA_NVS_FIRED_KEY, 0);
      for (int i = 0; i < feedTimesCount && i < 32; i++) {
        feedTimes[i].firedToday = (firedMask & (1UL << i)) != 0;
      }
      lastScheduleDay = now.day();
      Serial.printf("[OTA] daily state restored: %.0f g dispensed today\n",
                    dailyGramsDispensed);
    } else {
      Serial.println("[OTA] checkpoint is from another day - daily grams start at 0");
    }
  }

  prefs.remove(OTA_NVS_DAY_KEY);
  prefs.remove(OTA_NVS_GRAMS_KEY);
  prefs.remove(OTA_NVS_FIRED_KEY);
  prefs.remove(OTA_NVS_FEED_COUNT_KEY);
  prefs.remove(OTA_NVS_FEED_TIMES_KEY);
}

// ---- Download + install ----
// Forward declaration: PlatformIO's prototype generator skips functions with a
// default argument, and the button-abort path below calls dispenseFeed() before
// its definition.
void dispenseFeed(float grams, const char* source, const String &requestId);

bool performFirmwareUpdate(const String &url, size_t expectedSize, const String &expectedSha256) {
  if (!url.startsWith("https://")) {
    Serial.println("[OTA] refusing a non-HTTPS download URL");
    return false;
  }

  const esp_partition_t *slot = esp_ota_get_next_update_partition(nullptr);
  if (slot == nullptr) {
    Serial.println("[OTA] no spare OTA slot");
    return false;
  }
  if (expectedSize == 0 || expectedSize > slot->size) {
    Serial.printf("[OTA] image size %lu does not fit the %lu-byte OTA slot\n",
                  (unsigned long)expectedSize, (unsigned long)slot->size);
    return false;
  }
  if (ESP.getFreeHeap() < OTA_MIN_FREE_HEAP_BYTES) {
    Serial.printf("[OTA] not enough heap (%u free)\n", (unsigned)ESP.getFreeHeap());
    return false;
  }

  otaInProgress = true;
  otaSetState("downloading");
  bool installed = false;
  bool abortedByButton = false;
  bool abortedForFeed = false;

  mbedtls_sha256_context sha;
  mbedtls_sha256_init(&sha);

  HTTPClient https;
  do {
    https.setConnectTimeout(6000);
    https.setTimeout(12000);
    https.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    if (!beginHttps(https, url.c_str())) break;

    // Deliberately no X-Device-Token: the URL is already short-lived and
    // signed, and the device token must never go to a storage host.
    const int code = https.GET();
    esp_task_wdt_reset();
    if (code != 200) {
      Serial.printf("[OTA] download HTTP %d\n", code);
      https.end();
      break;
    }

    const int contentLength = https.getSize();
    if (contentLength <= 0 || (size_t)contentLength != expectedSize) {
      Serial.printf("[OTA] content-length %d != signed size %lu - refusing\n",
                    contentLength, (unsigned long)expectedSize);
      https.end();
      break;
    }
    if (!Update.begin(expectedSize, U_FLASH)) {
      Serial.printf("[OTA] Update.begin failed: %s\n", Update.errorString());
      https.end();
      break;
    }
    if (mbedtls_sha256_starts_ret(&sha, 0) != 0) {
      Serial.println("[OTA] SHA-256 init failed");
      Update.abort();
      https.end();
      break;
    }

    WiFiClient *stream = https.getStreamPtr();
    uint8_t buffer[1024];
    size_t written = 0;
    unsigned long lastDataMs = millis();
    unsigned long lastFeedCheckMs = millis();
    const unsigned long startedMs = millis();
    bool transferFailed = false;
    int lastPercent = -1;

    while (written < expectedSize) {
      esp_task_wdt_reset();

      // Decision OTA-2: feeding wins over updating. A debounced press aborts
      // the download; the press is consumed and dispensed below.
      if (digitalRead(BUTTON_PIN) == LOW) {
        delay(30);
        if (digitalRead(BUTTON_PIN) == LOW) {
          abortedByButton = true;
          break;
        }
      }
      // Safety net: never keep bytes flowing past a due feed. Once a second is
      // enough; the RTC read is an I2C transaction.
      if (millis() - lastFeedCheckMs >= 1000) {
        lastFeedCheckMs = millis();
        if (scheduledFeedDueNow()) {
          abortedForFeed = true;
          break;
        }
      }

      const size_t available = stream->available();
      if (available == 0) {
        if (!https.connected()) {
          transferFailed = true;
          break;
        }
        if (millis() - lastDataMs > OTA_NO_DATA_TIMEOUT_MS) {
          Serial.println("[OTA] download stalled - aborting");
          transferFailed = true;
          break;
        }
        if (millis() - startedMs > OTA_DOWNLOAD_TIMEOUT_MS) {
          Serial.println("[OTA] download took too long - aborting");
          transferFailed = true;
          break;
        }
        delay(10);
        continue;
      }

      const size_t chunk = available > sizeof(buffer) ? sizeof(buffer) : available;
      const size_t read = stream->readBytes(buffer, chunk);
      if (read == 0 || read > expectedSize - written) {
        transferFailed = true;
        break;
      }
      if (Update.write(buffer, read) != read) {
        Serial.printf("[OTA] Update.write failed: %s\n", Update.errorString());
        transferFailed = true;
        break;
      }
      if (mbedtls_sha256_update_ret(&sha, buffer, read) != 0) {
        Serial.println("[OTA] SHA-256 update failed");
        transferFailed = true;
        break;
      }
      written += read;
      lastDataMs = millis();

      const int percent = (int)((written * 100ULL) / expectedSize);
      if (percent >= lastPercent + 10) {
        lastPercent = percent;
        Serial.printf("[OTA] download %d%% (%lu/%lu bytes)\n", percent,
                      (unsigned long)written, (unsigned long)expectedSize);
      }
    }

    if (abortedByButton || abortedForFeed || transferFailed) {
      Update.abort();
      https.end();
      break;
    }
    if (written != expectedSize) {
      Serial.println("[OTA] short download - aborting");
      Update.abort();
      https.end();
      break;
    }

    uint8_t digest[32];
    if (mbedtls_sha256_finish_ret(&sha, digest) != 0) {
      Serial.println("[OTA] SHA-256 finalize failed");
      Update.abort();
      https.end();
      break;
    }

    const String actualSha = sha256Hex(digest);
    if (!equalsIgnoreCase(actualSha, expectedSha256)) {
      Serial.printf("[OTA] SHA-256 mismatch: got %s, signed %s - refusing\n",
                    actualSha.c_str(), expectedSha256.c_str());
      Update.abort();
      https.end();
      break;
    }

    if (!Update.end(true)) {
      Serial.printf("[OTA] Update.end failed: %s\n", Update.errorString());
      https.end();
      break;
    }
    https.end();
    installed = true;
  } while (false);

  mbedtls_sha256_free(&sha);
  otaInProgress = false;

  if (installed) {
    otaSetState("installed");
    Serial.println("[OTA] image verified and installed - checkpointing state and rebooting");
    persistFeedingStateForOta();
    Serial.flush();
    delay(500);
    ESP.restart();
    return true;
  }

  if (abortedByButton) {
    otaSetState("aborted");
    Serial.println("[OTA] aborted by the physical feed button - feeding wins");
    // Consume the press so handleButton() does not fire it twice.
    lastButtonReading = LOW;
    lastButtonChangeMs = millis();
    lastHandledButtonChangeMs = lastButtonChangeMs;
    dispenseFeed(cachedButtonFeedGrams, "button", String());
    otaPostpone("button_abort");
  } else if (abortedForFeed) {
    otaSetState("aborted");
    Serial.println("[OTA] aborted because a scheduled feed is due");
    otaPostpone("scheduled_feed");
  } else {
    otaSetState("failed");
    otaPostpone("download_failed");
  }
  return false;
}

// ---- Signed update check ----
bool checkForUpdate() {
  otaSetState("checking");
  const String url = String(OTA_CHECK_URL) + "?device_id=" +
                     urlEncodeValue(provisionedDeviceId) + "&version=" +
                     urlEncodeValue(FW_VERSION);

  HTTPClient https;
  https.setConnectTimeout(6000);
  https.setTimeout(10000);
  esp_task_wdt_reset();
  if (!beginHttps(https, url.c_str())) {
    otaSetState("failed");
    otaPostpone("check_connect_failed");
    return false;
  }
  https.addHeader("X-Device-Token", provisionedDeviceToken);
  const int code = https.GET();
  esp_task_wdt_reset();
  if (code != 200) {
    Serial.printf("[OTA] check HTTP %d\n", code);
    https.end();
    otaSetState("failed");
    otaPostpone("check_http_error");
    return false;
  }
  const int responseLength = https.getSize();
  if (responseLength < 0 || responseLength > OTA_MAX_CHECK_RESPONSE_BYTES) {
    // A signed check answer is a few hundred bytes. Require a declared,
    // bounded length instead of reading an unbounded stream into RAM.
    Serial.printf("[OTA] check response length %d is not usable - refusing\n", responseLength);
    https.end();
    otaSetState("failed");
    otaPostpone("check_response_too_large");
    return false;
  }
  const String payload = https.getString();
  https.end();
  esp_task_wdt_reset();

  JsonDocument doc;
  if (deserializeJson(doc, payload)) {
    Serial.println("[OTA] check response is not JSON");
    otaSetState("failed");
    otaPostpone("check_bad_json");
    return false;
  }

  if (!(doc["update"] | false)) {
    otaBackoffLevel = 0;
    otaScheduleNextCheck(OTA_CHECK_INTERVAL_MS);
    otaSetState("idle");
    Serial.println("[OTA] no update");
    return true;
  }

  const String version = doc["version"] | "";
  const String downloadUrl = doc["url"] | "";
  const size_t size = (size_t)(doc["size"] | 0);
  const String sha256 = doc["sha256"] | "";
  const String manifest = doc["manifest"] | "";
  const String signature = doc["signature"] | "";
  const String keyId = doc["key_id"] | "";

  if (version.length() == 0 || downloadUrl.length() == 0 || size == 0 ||
      sha256.length() != 64 || manifest.length() == 0 || signature.length() == 0 ||
      keyId.length() == 0) {
    Serial.println("[OTA] check response is missing a required field - refusing");
    otaSetState("failed");
    otaPostpone("check_missing_field");
    return false;
  }

  // The signature is over the exact manifest string, before trusting any of it.
  if (!verifyManifestSignature(manifest, signature, keyId)) {
    otaSetState("failed");
    otaPostpone("signature_invalid");
    return false;
  }

  JsonDocument manifestDoc;
  if (deserializeJson(manifestDoc, manifest)) {
    Serial.println("[OTA] signed manifest is not JSON");
    otaSetState("failed");
    otaPostpone("manifest_bad_json");
    return false;
  }
  const String manifestBoard = manifestDoc["board"] | "";
  const String manifestVersion = manifestDoc["version"] | "";
  const size_t manifestSize = (size_t)(manifestDoc["size"] | 0);
  const String manifestSha = manifestDoc["sha256"] | "";
  const String manifestKeyId = manifestDoc["key_id"] | "";

  if (manifestBoard != FW_BOARD) {
    Serial.printf("[OTA] manifest is for board '%s', not '%s' - refusing\n",
                  manifestBoard.c_str(), FW_BOARD);
    otaSetState("failed");
    otaPostpone("board_mismatch");
    return false;
  }
  if (manifestVersion != version || manifestSize != size ||
      !equalsIgnoreCase(manifestSha, sha256) || manifestKeyId != keyId) {
    Serial.println("[OTA] check response does not match its signed manifest - refusing");
    otaSetState("failed");
    otaPostpone("manifest_mismatch");
    return false;
  }
  if (compareSemver(version.c_str(), FW_VERSION) <= 0) {
    Serial.printf("[OTA] signed version %s is not newer than %s - refusing\n",
                  version.c_str(), FW_VERSION);
    otaSetState("failed");
    otaPostpone("not_newer");
    return false;
  }
  const String minFrom = manifestDoc["min_from_version"] | "";
  if (minFrom.length() > 0) {
    int minParts[3];
    if (!parseSemver(minFrom.c_str(), minParts)) {
      Serial.printf("[OTA] signed min_from_version '%s' is invalid - refusing\n",
                    minFrom.c_str());
      otaSetState("failed");
      otaPostpone("min_from_invalid");
      return false;
    }
    if (compareSemver(FW_VERSION, minFrom.c_str()) < 0) {
      Serial.printf("[OTA] this unit (%s) is older than the signed minimum %s - refusing\n",
                    FW_VERSION, minFrom.c_str());
      otaSetState("failed");
      otaPostpone("below_min_from");
      return false;
    }
  }
  const esp_partition_t *slot = esp_ota_get_next_update_partition(nullptr);
  if (slot == nullptr || size > slot->size) {
    Serial.println("[OTA] signed image does not fit the OTA slot - refusing");
    otaSetState("failed");
    otaPostpone("image_too_large");
    return false;
  }

  // Re-run the gate: seconds have passed and a feed could have started.
  const char *gate = otaPreflightFailure();
  if (gate != nullptr) {
    otaSetState("deferred");
    Serial.printf("[OTA] download postponed: %s\n", gate);
    otaPostpone(gate);
    return false;
  }

  Serial.printf("[OTA] update %s available (%lu bytes, key %s)\n", version.c_str(),
                (unsigned long)size, keyId.c_str());
  return performFirmwareUpdate(downloadUrl, size, sha256);
}

void maybeCheckForUpdate() {
  if (provisioningActive || otaInProgress) return;
  if ((long)(millis() - nextOtaCheckMs) < 0) return;

  const char *gate = otaPreflightFailure();
  if (gate != nullptr) {
    otaSetState("deferred");
    Serial.printf("[OTA] check postponed: %s\n", gate);
    otaPostpone(gate);
    return;
  }
  checkForUpdate();
}

void setup() {
  Serial.begin(115200);
  bootTime = millis();

  // Why the board restarted: reported in the heartbeat and used by the OTA
  // pre-flight gate (a brownout reset postpones updates).
  const esp_reset_reason_t resetReason = esp_reset_reason();
  resetReasonName = resetReasonLabel(resetReason);
  lastResetWasBrownout = (resetReason == ESP_RST_BROWNOUT);
  Serial.printf("[INIT] Reset reason: %s\n", resetReasonName);

  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, RELAY_OFF);   // feeder must NEVER default to dispensing at boot
  feederActive = false;

  pinMode(BUTTON_PIN, INPUT_PULLUP);    // press pulls LOW
  initResetButtons();

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(TRIG_PIN, LOW);

  // DS18B20 temperature probe
  tempSensor.begin();
  Serial.println("[INIT] DS18B20 temperature probe initialized");

  for (int i = 0; i < EVENT_QUEUE_SIZE; i++) eventQueue[i].used = false;

  // Load stored WiFi credentials + device identity from NVS, fallback to the
  // compile-time defaults. This must run before any URL, header or AP name is
  // built from the identity.
  // The NVS namespace stays "optifeed" on purpose, even though the product is
  // now PakaonAI. NVS keys are looked up by namespace, so renaming it would
  // orphan the WiFi credentials and device identity already stored on every
  // flashed unit and force each one back through the setup portal.
  prefs.begin("optifeed", false);
  rebootCount = prefs.getUInt("rebootCount", 0) + 1;
  prefs.putUInt("rebootCount", rebootCount);
  Serial.printf("[INIT] Boot #%lu\n", rebootCount);
  loadDeviceIdentity();

  // Button held through boot resets WiFi only; the device identity stays.
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

  // Restore the feeding-state checkpoint a just-installed OTA image wrote
  // before its reboot (schedule every boot; daily grams and firedToday only
  // when the checkpoint is from today). After a plain power cycle there is
  // nothing to restore.
  restoreFeedingStateAfterOta();

  // TLS: verify the server against ROOT_CA, the multi-root bundle in the config
  // section (never setInsecure). Cap the handshake so a dead TLS peer cannot
  // sit through the 30 s task watchdog.
  secureClient.setHandshakeTimeout(15);
  secureClient.setCACert(ROOT_CA);

  // Missing WiFi credentials, missing identity, or a boot reset -> setup
  // portal. Units with a stored SSID and a usable compile-time identity keep
  // using the normal station path and never see the portal.
  if (credentialsResetAtBoot || !wifiCredentialsProvisioned()) {
    Serial.println("[PROV] Provisioning needed - starting setup portal");
    startProvisioningPortal();
  } else {
    connectWiFi();
    if (WiFi.status() == WL_CONNECTED) {
      wifiWasConnected = true;
      if (rtcAvailable) syncNTP();
    }
  }

#ifdef ENABLE_LAN_OTA
  setupOTA();
#else
  Serial.println("[OTA] LAN ArduinoOTA disabled (field build; -DENABLE_LAN_OTA for bench)");
#endif

  Serial.print("[DEVICE MAC] ");
  Serial.println(chipMacString());
  Serial.printf("[FIRMWARE] v%s\n", FW_VERSION);

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

  // If this boot is the first boot of an OTA image, start the 5-minute
  // probation. A normal boot just reports "valid" and does nothing else.
  otaBeginHealthCheck();

  Serial.println("[READY] OptiFeed controller online.");
}

void loop() {
#ifdef ENABLE_LAN_OTA
  ArduinoOTA.handle();  // bench builds only
#endif
  handleResetButtons(); // Dedicated WiFi / factory reset buttons, if wired
  serviceOtaHealthCheck();  // pending-verify deadline; relay stays OFF until valid

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

  // Signed update check every OTA_CHECK_INTERVAL_MS, behind the pre-flight
  // gate. It blocks only while it is actually due (or downloading).
  maybeCheckForUpdate();

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

// ==================== Device-scoped URLs ====================

// Percent-encodes a query-string value. Device IDs are usually a MAC (colons)
// or a UUID; encoding keeps either form safe inside the URL.
String urlEncodeValue(const String &value) {
  static const char *hexDigits = "0123456789ABCDEF";
  String out;
  out.reserve(value.length() * 3);
  for (size_t i = 0; i < value.length(); i++) {
    const uint8_t c = (uint8_t)value[i];
    if (isalnum(c) || c == '-' || c == '.' || c == '_' || c == '~') {
      out += (char)c;
    } else {
      out += '%';
      out += hexDigits[(c >> 4) & 0x0F];
      out += hexDigits[c & 0x0F];
    }
  }
  return out;
}

// Appends the active device identity to a base endpoint. Built at runtime so
// two units running the same binary report under their own Device ID.
String buildDeviceUrl(const char *baseUrl) {
  return String(baseUrl) + "?device_id=" + urlEncodeValue(provisionedDeviceId);
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
  https.addHeader("X-Device-Token", provisionedDeviceToken);
  JsonDocument doc;
  doc["device_id"]  = provisionedDeviceId;
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
  if (doc["grams_per_feeding"].is<float>()) {
    v = doc["grams_per_feeding"];
    if (!(v >= GRAMS_PER_FEEDING_MIN && v <= GRAMS_PER_FEEDING_MAX)) return false;
  }
  if (doc["button_feed_grams"].is<float>()) {
    v = doc["button_feed_grams"];
    if (!(v >= BUTTON_FEED_GRAMS_MIN && v <= BUTTON_FEED_GRAMS_MAX)) return false;
  }
  if (doc["grams_per_second"].is<float>()) {
    v = doc["grams_per_second"];
    if (!(v >= GRAMS_PER_SECOND_MIN && v <= GRAMS_PER_SECOND_MAX)) return false;
  }
  if (doc["temp_offset_c"].is<float>()) {
    v = doc["temp_offset_c"];
    if (!(v >= TEMP_OFFSET_C_MIN && v <= TEMP_OFFSET_C_MAX)) return false;
  }
  if (doc["hopper_full_cm"].is<float>()) {
    v = doc["hopper_full_cm"];
    if (!(v > 0 && v <= HOPPER_CM_MAX)) return false;
  }
  if (doc["hopper_empty_cm"].is<float>()) {
    v = doc["hopper_empty_cm"];
    if (!(v > 0 && v <= HOPPER_CM_MAX)) return false;
  }
  // Cross-field: hopper full distance must be nearer than the empty distance.
  float fullCm = doc["hopper_full_cm"].is<float>() ? (float)doc["hopper_full_cm"] : hopperFullCm;
  float emptyCm = doc["hopper_empty_cm"].is<float>() ? (float)doc["hopper_empty_cm"] : hopperEmptyCm;
  if (fullCm >= emptyCm) return false;
  return true;
}

// ==================== Shared dispense logic ====================

void dispenseFeed(float grams, const char* source, const String &requestId = "") {
  // T-12a: never feed while a signed image is downloading. Dashboard requests
  // must be told why, so the refusal is reported as ota_in_progress.
  if (otaInProgress) {
    reportFeedError("ota_in_progress", grams, source);
    return;
  }

  // A freshly installed image is on probation: the relay stays OFF until the
  // health check marks it valid (at most five minutes). The heartbeat already
  // reports ota_state=pending_verify, so this does not report a refusal.
  if (otaHealthCheckActive) {
    Serial.printf("[FEED] refused - OTA image pending verification (%s)\n", source);
    return;
  }

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
  // Relay stays OFF until a pending-verify OTA image proves itself. The window
  // is seconds to minutes and the exact-minute match still fires afterwards if
  // the image becomes valid within the same minute.
  if (otaHealthCheckActive) return;

  DateTime now = rtc.now();

  if (now.day() != lastScheduleDay) {
    for (int i = 0; i < feedTimesCount; i++) feedTimes[i].firedToday = false;
    lastScheduleDay = now.day();
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
  const String url = buildDeviceUrl(FEED_POLL_URL_BASE);
  if (!beginHttps(https, url.c_str())) return;
  https.addHeader("X-Device-Token", provisionedDeviceToken);
  int code = https.GET();
  if (code == 200) {
    // A freshly installed OTA image proves itself with one authenticated 200
    // from this poll (the health check also needs WiFi and a valid clock).
    otaHealthSawPoll = true;
    JsonDocument doc;
    if (!deserializeJson(doc, https.getString())) {
      if (!validateServerConfig(doc)) {
        // N9: ignore the whole config when any pushed value is out of range.
        Serial.println("[POLL] invalid config from server — ignoring whole response");
      } else {
        if (doc["grams_per_feeding"].is<float>()) {
          cachedScheduledGrams = doc["grams_per_feeding"] | cachedScheduledGrams;
        }
        // Dynamic button dose — overrides compile-time default.
        // The backend returns button_feed_grams from EnergyDevice.buttonFeedGrams.
        if (doc["button_feed_grams"].is<float>()) {
          float bfg = doc["button_feed_grams"];
          if (bfg > 0) {
            cachedButtonFeedGrams = bfg;
          }
        }
        // Hopper calibration — overrides compile-time defaults
        if (doc["hopper_full_cm"].is<float>()) {
          float hf = doc["hopper_full_cm"];
          if (hf > 0) hopperFullCm = hf;
        }
        if (doc["hopper_empty_cm"].is<float>()) {
          float he = doc["hopper_empty_cm"];
          if (he > 0) hopperEmptyCm = he;
        }
        // Duration calibration — motor dispense rate
        if (doc["grams_per_second"].is<float>()) {
          float gps = doc["grams_per_second"];
          if (gps > 0) gramsPerSecond = gps;
        }
        // Temperature calibration offset
        if (doc["temp_offset_c"].is<float>()) {
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

// Parse an ISO-8601 UTC instant (e.g. 2026-10-25T08:25:00.000Z).
bool parseIsoUtc(const char* iso, DateTime &out) {
  int year, month, day, hour, minute, second;
  if (!iso || strlen(iso) < 19) return false;
  if (sscanf(iso, "%4d-%2d-%2dT%2d:%2d:%2d", &year, &month, &day, &hour, &minute, &second) != 6) {
    return false;
  }
  if (year < 2020 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31 ||
      hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return false;
  }
  out = DateTime(year, month, day, hour, minute, second);
  return true;
}

// A manual dashboard calibration is applied verbatim; server_time only
// corrects real drift so every 5 s poll does not adjust the RTC.
void applyIsoTime(const char* iso, bool force) {
  if (!rtcAvailable) return;

  DateTime target;
  if (!parseIsoUtc(iso, target)) return;

  DateTime current = rtc.now();
  long drift = (long)target.unixtime() - (long)current.unixtime();
  if (drift < 0) drift = -drift;
  if (!force && drift <= 60) return;

  rtc.adjust(target);
  Serial.printf("[TIME] RTC %s from server (%lds drift)\n", force ? "set" : "corrected", drift);
}

void pollScheduleCommand() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient https;
  const String url = buildDeviceUrl(SCHEDULE_SYNC_URL_BASE);
  if (!beginHttps(https, url.c_str())) return;
  https.addHeader("X-Device-Token", provisionedDeviceToken);
  int code = https.GET();
  if (code == 200) {
    // Schedule payloads are larger than the feed-command ones (times, counts,
    // rates); JsonDocument grows on demand, so no capacity constant is needed.
    JsonDocument doc;
    if (!deserializeJson(doc, https.getString())) {
      // Clock sync (#149): a manual calibration wins for 10 minutes; otherwise
      // correct RTC drift from the server clock. Both are UTC instants.
      const char* manualTime = doc["time_sync"] | "";
      const char* serverTime = doc["server_time"] | "";
      if (strlen(manualTime) > 0) {
        applyIsoTime(manualTime, true);
      } else if (strlen(serverTime) > 0) {
        applyIsoTime(serverTime, false);
      }

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
          if (doc["grams_per_feeding"].is<float>()) {
            cachedScheduledGrams = doc["grams_per_feeding"] | cachedScheduledGrams;
          }
          if (doc["button_feed_grams"].is<float>()) {
            float bfg = doc["button_feed_grams"];
            if (bfg > 0) cachedButtonFeedGrams = bfg;
          }
          // Duration calibration — motor dispense rate
          if (doc["grams_per_second"].is<float>()) {
            float gps = doc["grams_per_second"];
            if (gps > 0) gramsPerSecond = gps;
          }
          // Temperature calibration offset
          if (doc["temp_offset_c"].is<float>()) {
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
  https.addHeader("X-Device-Token", provisionedDeviceToken);

  String eventId = generateEventId();
  JsonDocument doc;
  doc["device_id"]   = provisionedDeviceId;
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
  https.addHeader("X-Device-Token", provisionedDeviceToken);

  // eventId was generated once when this event was enqueued; retries of the
  // same queued event must resend the same id so the server can dedupe.
  JsonDocument doc;
  doc["device_id"]       = provisionedDeviceId;
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
  https.addHeader("X-Device-Token", provisionedDeviceToken);

  String eventId = generateEventId();
  JsonDocument doc;
  doc["device_id"]         = provisionedDeviceId;
  doc["event_type"]        = "heartbeat";
  doc["firmware_version"]  = FW_VERSION;
  // Additive OTA diagnostics (T-12b stores them; older servers strip them).
  doc["ota_state"]         = otaState;
  doc["reset_reason"]      = resetReasonName;
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
    // A pending-verify image must stay awake to honour its 5-minute deadline;
    // sleeping would leave it pending until the next reset.
    if (!provisioningActive && !otaHealthCheckActive && wifiRetryCount > 30) {
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
