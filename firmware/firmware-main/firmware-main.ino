/*
  OptiFeed — ESP32 Feeder Controller (3-Way Fallback)
  -----------------------------------------------------
  Trigger tiers, all routed through one shared dispenseFeed() function:

    1. SCHEDULED  — RTC-driven, works with NO WiFi/backend connectivity.
       Schedule dynamically set via pollScheduleCommand() from backend.
    2. DASHBOARD  — polled every deviceConfig.heartbeatIntervalS from the
       backend, for manual/extra feeds or malfunction workarounds triggered
       remotely.
    3. PHYSICAL BUTTON — local override, works even with WiFi fully down.
       Dose amount is set via backend poll response (button_feed_grams),
       not a compile-time constant.

  RELAY LOGIC:
    - Relay is NORMALLY OPEN (NO).
    - The field relay board is active HIGH: the control pin HIGH energizes the
      coil, closing NO contacts. RELAY_ON = HIGH, RELAY_OFF = LOW.
    - An active-LOW module is supported with -DRELAY_ACTIVE_LOW=1, which swaps
      RELAY_ON/RELAY_OFF. Boot always forces RELAY_OFF in both modes.
    - Mutex rule: first-acquire-wins. No source preempts another.
      If the relay is busy, incoming triggers are silently ignored.
      The event queue captures everything that actually dispensed.

  FAIL-SAFE MODEL (1.6.0):
    - The relay is OFF at boot, in a shutdown handler before any software
      reset, and is force-opened if a dose overruns its expected end + 2 s.
    - One gate for every source: the configured minimum gap between doses, the
      configured doses per rolling hour, the daily gram cap and the configured
      relay-time envelope. Each refusal is reported with a reason.
    - Three abnormal resets (brownout/panic/watchdog) within 10 minutes boot
      the unit into SAFE MODE: the relay is locked OFF, every trigger is
      refused with reason safe_mode, and the heartbeat says so. A clean
      power-on clears the history; 30 quiet minutes (or a reset-button hold)
      leave it.
    - The hopper takes 5 samples, rejects impossible echoes, uses the median
      and an EMA, and only believes a change that persists. Hysteresis plus a
      10-minute hold stop the pellet alerts flapping. An invalid cycle reports
      "unknown" (omitted), never 0 %.
    - The DS18B20 rejects its -127 C / 85 C sentinels.
    - Events are rate-limited per type, the offline queue drops its oldest
      entry and counts the loss, and HTTP calls retry with exponential backoff
      and jitter, capped at 5 minutes. Pure logic lives in safety.h/filters.h
      and is covered by `pio test -d firmware -e native`.

  MACHINE STATUS INTERFACE (1.8.0, status.h):
    - Four panel lamps, each switched by an NPN transistor from its GPIO:
      POWER white (solid once control power is up), FEEDING green (solid while
      the relay is energized), WI-FI blue (solid only once joined to the saved
      network, blinking while the setup portal runs), FAULT yellow (solid while
      any fault is latched).
    - One FaultManager owns every fault: HC-SR04 no echo (3 checks in a row),
      DS3231 missing or silent on I2C, a relay overrun trip, and safe mode. A
      fault stays latched until its cause is gone AND the operator taps the
      Wi-Fi reset button (GPIO 17, under 5 s). No fault ever resumes a dose.
    - Wi-Fi loss and a low hopper are not faults. The lamp is a notice, not an
      interlock: the relay gates above remain the only interlock.

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

// Pure, host-testable modules (firmware 1.6.0). No Arduino calls inside.
#include "filters.h"
#include "safety.h"
// Dashboard-driven configuration and its absolute safety envelope (1.7.0).
#include "config.h"
#include "status.h"
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
#define FW_VERSION "1.8.1"
// Board string the signed manifest must carry. One value for every unit this
// firmware runs on (ESP32-WROOM-32U); a manifest for another board is refused.
#define FW_BOARD "wroom32u"

// ---- Remote updates (OTA, T-12a) ----
// GET with X-Device-Token and the current version. T-12b implements the route.
// The response is {update:false} or
// {update:true, version, url, size, sha256, manifest, signature, key_id}.
#define OTA_CHECK_URL "https://pakaonai.syntaxure.dev/api/firmware/check"
// Operational OTA values (check interval, health-check timeout, minimum
// uptime/RSSI/heap, feed guard, maintenance window and download timeouts) are
// dashboard-driven since 1.7.0: see deviceConfig.ota* in config.h. The values
// there equal the 1.6.x constants, so behaviour is unchanged until a server
// sends a different (still envelope-bounded) value.
// The RTC runs UTC (NTP and the server clock are UTC). Local time for the
// maintenance window is UTC + this offset; the Philippines is UTC+8 with no
// daylight saving. Change it when the fleet moves time zone.
#define OTA_LOCAL_UTC_OFFSET_MINUTES 480
// One check response is a few hundred bytes; anything large is a bug or abuse.
// Transport constant: never configurable.
#define OTA_MAX_CHECK_RESPONSE_BYTES 8192


// Device identity. There is deliberately NO compile-time fallback: this
// repository is public, so a baked-in MAC or token would give every
// unprovisioned unit the same public credentials. The setup portal writes
// device_id / device_token to NVS and only then does the API become available.
// Until then the unit broadcasts its setup AP and keeps feeding from the RTC
// schedule; it makes no API calls at all.

// Explicit HTTP timeouts for a 5 s poll cycle on a slow farm link. One call
// can never sit for more than connect + read (16 s), and the watchdog is fed
// between calls.
#define HTTP_CONNECT_TIMEOUT_MS 8000
#define HTTP_READ_TIMEOUT_MS    8000

// LAN ArduinoOTA password — separate from the device token and only compiled
// into bench builds (-DENABLE_LAN_OTA, decision OTA-7). Field builds have no
// LAN updater at all, so this shared static password can never be a field risk.
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

// Relay signal pin. 25 is the reference wiring; a unit wired to another GPIO is
// built with -DRELAY_PIN=<n> (see [env:esp32dev-relay5] in platformio.ini).
// GPIO 25 is the reference wiring. GPIO 5 also works and is what the CICT unit
// uses (-DRELAY_PIN=5, env esp32dev-relay5): it is a strapping pin, but only for
// SDIO slave timing, which this sketch never configures, and strapping is only
// sampled at reset. Its reset state is a weak internal pull-up, so it sits
// weakly HIGH until setup() drives it LOW; confirm on the bench that this does
// not click the relay at power-up.
#ifndef RELAY_PIN
#define RELAY_PIN       25
#endif
#define BUTTON_PIN      23          // hardwired feed button; wired to GND via INPUT_PULLUP

// ---- Dedicated reset buttons (both active-low) --------------------------
// Wire each button between its GPIO and GND; the internal pull-up is enabled.
// GPIO 17 is the Wi-Fi reset (5 s, device identity kept), GPIO 16 the factory
// reset (10 s, WiFi and identity wiped). Both are free on the ESP32-WROOM-32U
// used here (not used by this sketch) and neither is a strapping pin. Still
// free: 13, 18, 19, 33. Do NOT use 25 (relay), 23 (feed button), 32 (DS18B20),
// 27/14 (HC-SR04), 21/22 (RTC I2C), 0/2/12/15 (strapping), 34-39 (input-only,
// no internal pull-up), 1/3 (USB serial) or 6-11 (flash). GPIO 12 is a
// strapping pin that selects the flash voltage at boot and must sit LOW then,
// so leave it unconnected (the HC-SR04 TRIG used to sit there; it moved to 27).
#define WIFI_RESET_BUTTON_PIN       17   // hold to clear WiFi only
#define FACTORY_RESET_BUTTON_PIN    16   // hold to clear WiFi + identity
#define WIFI_RESET_HOLD_MS        5000   // continuous hold: WiFi reset
#define FACTORY_RESET_HOLD_MS    10000   // continuous hold: factory reset
// WIFI_RESET_HOLD_MS also governs the GPIO 23 feed-button hold at boot.
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
// ---- Machine status lamps (1.8.0) ---------------------------------------
// Panel as wired on the bench (firmware/bench/led-bench-test, Jeff 2026-10-31):
// 5 mm LEDs, each with a series resistor from the GPIO to GND, HIGH = on.
//   POWER   white  5 V rail + 330 ohm, always on in hardware: no GPIO (-1)
//   FEEDING green  parallel tap on the relay control line, so it follows the
//                  relay without firmware: no GPIO (-1)
//   WI-FI   blue   GPIO 26 (100 ohm)
//   FAULT   yellow GPIO 18 (200 ohm)
// A panel of NPN-driven 12 V lamps with firmware-driven POWER and FEEDING builds
// with -DPOWER_LED_PIN=13 -DFEEDING_LED_PIN=18 -DWIFI_LED_PIN=19 -DFAULT_LED_PIN=33
// (1 kOhm to the base, 10 kOhm base pull-down); never wire a 12 V lamp to a pin
// directly. Any lamp can be dropped with -D<NAME>_LED_PIN=-1.
#ifndef POWER_LED_PIN
#define POWER_LED_PIN    -1   // white: 5 V rail in hardware
#endif
#ifndef FEEDING_LED_PIN
#define FEEDING_LED_PIN  -1   // green: tap on the relay control line
#endif
#ifndef WIFI_LED_PIN
#define WIFI_LED_PIN     26   // blue
#endif
#ifndef FAULT_LED_PIN
#define FAULT_LED_PIN    18   // yellow
#endif
#define WIFI_LED_BLINK_PERIOD_MS      1000UL   // provisioning: 0.5 s on, 0.5 s off
#define FAULT_CHECK_INTERVAL_MS      60000UL   // RTC I2C probe + offline echo check
#define HOPPER_SENSOR_FAULT_CHECKS        3    // consecutive no-echo checks
#define DS3231_I2C_ADDRESS             0x68
#define RTC_SDA         21
#define RTC_SCL         22
// TRIG sits on GPIO 27 and ECHO on GPIO 14 deliberately: GPIO 14 emits a PWM
// glitch at boot, which as an input is harmless but as a trigger would fire a
// spurious ping. TRIG was on GPIO 12 until 2026-10-31, but that is the
// flash-voltage strapping pin and a driven or pulled-up level there can stop
// the board booting; GPIO 27 is neither a strapping pin nor glitchy at boot.
// Swapping TRIG and ECHO is not safe for the GPIO 14 reason above.
#define TRIG_PIN        27          // HC-SR04 ultrasonic trigger (a 10k pull-down is optional)
#define ECHO_PIN        14          // HC-SR04 ultrasonic echo (5 V - use a divider)
#define DS18B20_PIN     32          // DS18B20 water temperature probe (4.7k pull-up)

// ---- Relay driver polarity (build flag, default active HIGH) -------------
// The field board energizes the coil when the pin is HIGH. An active-LOW relay
// module is supported without editing logic: build with -DRELAY_ACTIVE_LOW=1
// (see firmware/README.md). Boot still forces RELAY_OFF in both modes.
// One unconditional definition per macro: PlatformIO's .ino converter keeps
// both arms of an #if/#else in its intermediate file and would warn about a
// redefinition.
#ifndef RELAY_ACTIVE_LOW
#define RELAY_ACTIVE_LOW 0
#endif
#define RELAY_ON        ((RELAY_ACTIVE_LOW) ? LOW : HIGH)   // closes NO contacts
#define RELAY_OFF       ((RELAY_ACTIVE_LOW) ? HIGH : LOW)   // rest, contacts open

// Poll cadence and button-guard values are server-driven (1.7.0): see
// deviceConfig.heartbeatIntervalS / button* in config.h. Only the anti-spike
// confirmation window stays compile-time: it is the guard itself, not a
// preference, and 10 samples x 5 ms with a 90 % threshold was tuned on the
// CICT unit (I-41).
#define BUTTON_CONFIRM_SAMPLES            10    // samples in the confirmation window
#define BUTTON_CONFIRM_SAMPLE_MS           5    // 10 x 5 ms = 50 ms total
#define BUTTON_CONFIRM_MIN_LOW_SAMPLES     9    // >= 90 % of the samples must be LOW

// ---- Fail-safe relay guard (firmware 1.6.0) -------------------------------
// The 2 s overrun trip is safety logic, not an operational value: it is never
// configurable, so no dashboard write can let a stuck relay keep running.
// The dispense gap, doses per hour, daily cap, safe-mode thresholds and hopper
// filter values are operational and live in config.h / deviceConfig.

// Event rate limits (a token bucket per event type). The dispense bucket is
// sized above the maximum doses per hour, so a real feeding record is never
// lost. Transport/implementation constants: no dashboard home.
#define FEED_EVENT_BUCKET_CAPACITY     12
#define FEED_EVENT_REFILL_MS           (5UL * 60UL * 1000UL)
#define REFUSAL_BUCKET_CAPACITY        6
#define REFUSAL_REFILL_MS              (10UL * 60UL * 1000UL)
#define ACK_BUCKET_CAPACITY            6
#define ACK_REFILL_MS                  (60UL * 1000UL)

// HTTP retry backoff (safety.h NetRetry): 5 s, 10 s, 20 s ... capped at 5 min,
// +-20 % jitter. OTA keeps its own 1 h -> 6 h -> 24 h update ladder.
#define HTTP_RETRY_BASE_MS             5000UL
#define HTTP_RETRY_CAP_MS              (5UL * 60UL * 1000UL)

// NVS keys for the reset history and safe mode (namespace "optifeed", 15-char
// NVS limit). New keys only; the existing ones are untouched.
#define NVS_RESET_COUNT_KEY   "rst_abn_cnt"
#define NVS_RESET_MASK_KEY    "rst_abn_mask"
#define NVS_RESET_FIRST_KEY   "rst_first_ep"
#define NVS_RESET_LAST_KEY    "rst_last_ep"
#define NVS_SAFE_MODE_KEY     "safe_mode"
#define NVS_SAFE_UNTIL_KEY    "safe_until_ep"

#define WIFI_RETRY_INTERVAL_MS 10000

// ---- WiFi provisioning portal ----
#define WIFI_JOIN_WINDOW_MS          15000  // time allowed for each join attempt
#define WIFI_FAILURES_BEFORE_PORTAL  5      // consecutive failed joins before the setup AP starts
// The GPIO 23 boot-button hold uses WIFI_RESET_HOLD_MS (with the reset buttons).
// After the form is submitted the unit tests the new network before saving it:
// the setup AP stays up for the whole test, and only a proven link is written
// to NVS. A definitive failure (network absent, password refused) ends the test
// early once a full station attempt has had time to run.
#define PROVISIONING_SETUP_JOIN_TIMEOUT_MS 20000UL
#define PROVISIONING_JOIN_QUICK_FAIL_MS     6000UL
// Connected -> restart. Long enough for the status page to show the result.
#define PROVISIONING_SUCCESS_RESTART_MS     5000UL
// Nearby-network picker. The ESP32 radio is 2.4 GHz only, so every scan result
// is a usable network. Scans are asynchronous (never block loop()); one
// automatic retry covers a radio that was still settling.
#define PROVISIONING_SCAN_MAX 20
#define PROVISIONING_SCAN_CHANNEL_MS 300      // max ms per channel for an active scan
#define PROVISIONING_SCAN_TIMEOUT_MS 12000UL  // give up waiting on a stuck async scan
#define PROVISIONING_SCAN_RETRY_MS   2000UL   // one retry after an empty or failed scan

// ---- Calibration: how fast the feeder dispenses ----
// Measure by running the feeder for a fixed time and weighing the output:
// gramsPerSecond = grams_dispensed / seconds_run.
// Mutable — overridden by the dashboard `config` object (and the legacy
// `grams_per_second` field) and persisted to NVS, so a reboot keeps the
// dashboard calibration instead of running on the compile-time default until
// the next successful poll.
#define DEFAULT_GRAMS_PER_SECOND 4.0f
#define NVS_KEY_CAL_GPS "cal_gps"
// Runtime calibration value, always kept equal to deviceConfig.gramsPerSecond.
float gramsPerSecond = DEFAULT_GRAMS_PER_SECOND;

// ---- Default dispense amounts per trigger source ----
#define DEFAULT_SCHEDULED_GRAMS 150.0  // used until backend gives us a real value
#define DEFAULT_BUTTON_FEED_GRAMS 80.0 // overridden by backend poll response
#define DEFAULT_MANUAL_GRAMS    100.0  // used if dashboard omits a grams value

// ---- Dashboard-driven configuration (1.7.0, I-100) ----
// Every operational value lives in `deviceConfig` and is bounded by the
// absolute safety envelope in config.h. These globals are only the boot
// defaults until the first valid `config` object (or the NVS last-good copy)
// is applied.
#define NVS_CONFIG_REV_KEY  "cfg_rev"
#define NVS_CONFIG_JSON_KEY "cfg_json"

fw::DeviceConfig deviceConfig = fw::defaultDeviceConfig();
uint32_t appliedConfigRev = 0;         // echoed as `config_rev` in the heartbeat
bool configLoadedFromNvs = false;      // a persisted last-good copy is in force
bool configFromServer = false;         // a server object has been applied this boot

// The fixed safety envelope that is never configurable (class A/C). Pins, the
// NVS namespace, URLs, TLS and the relay overrun guard stay compile-time.
#define RELAY_OVERRUN_GRACE_MS         2000UL    // expected end + this = trip

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

// ---- Farm-local time (I-109) ----
// The RTC runs UTC (NTP and the server clock are UTC) and the schedule stores
// the farmer's wall-clock slot times, so every comparison converts first.
// `farm_offset_minutes` from every feed-command and schedule-sync response
// replaces this value, which is persisted in NVS. The compile-time fallback is
// the existing maintenance-window constant (Philippines, UTC+8), so behaviour
// is unchanged until the server sends a value.
int farmOffsetMinutes = OTA_LOCAL_UTC_OFFSET_MINUTES;

// ---- Offline event queue (so button/manual feeds during a WiFi outage
//      still make it into Feeding History once connectivity returns) ----
struct QueuedEvent {
  bool used;
  bool synced;
  uint32_t seq;          // enqueue order; the oldest unsynced entry is dropped first
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

// Active device identity, loaded from NVS only (device_id / device_token).
// Empty until the setup portal saves both. All URLs, headers, payloads and the
// setup AP name read these globals, and apiIdentityAvailable() gates every
// API call.
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

// Hopper geometry and the temperature offset live in deviceConfig (1.7.0);
// these two caches are only kept in step for the schedule/feeding paths.

// ---- Daily dispense budget (RAM; reset at farm-local midnight from the RTC) ----
float dailyGramsDispensed = 0.0;
// Farm-local date key (YYYYMMDD) the counter and the firedToday flags belong to.
// 0 means "not evaluated yet this boot"; restoreScheduleState() sets it before
// the first dispense or schedule pass.
uint32_t lastFarmDateKey = 0;
unsigned long lastDailyResetMs = 0;

// Forward declarations: these live with the OTA checkpoint helpers below, but
// the day rollover and setup() call them earlier.
void persistScheduleState();
void restoreScheduleState();

// Farm-local date key for an RTC instant. The RTC holds UTC, so the offset (and
// its midnight rollover) is applied here, never at the comparison sites.
uint32_t farmDateKeyFor(const DateTime &now) {
  const fw::FarmLocalTime local =
      fw::farmLocalTime(now.year(), now.month(), now.day(),
                        now.hour() * 60 + now.minute(), farmOffsetMinutes);
  return fw::farmDateKey(local);
}

// Today's farm-local date key, or 0 when the RTC is unavailable.
uint32_t currentFarmDateKey() {
  if (!rtcAvailable) return 0;
  return farmDateKeyFor(rtc.now());
}

// Roll the daily counter and the firedToday flags over at farm-local midnight.
// `today` is 0 when there is no clock (the 24 h uptime window still applies).
// A reset persists 0 g with the new day, so a later power cycle restores it.
void maybeResetDailyBudgetFor(uint32_t today) {
  if (today == 0) {
    if (millis() - lastDailyResetMs >= 24UL * 3600UL * 1000UL) {
      dailyGramsDispensed = 0.0;   // RTC unavailable: 24h window from boot
      lastDailyResetMs = millis();
    }
    return;
  }

  if (lastFarmDateKey == 0) {
    // First evaluation this boot: restoreScheduleState() already set the date
    // (and restored the counter when it belonged to today). Nothing to reset.
    lastFarmDateKey = today;
    lastDailyResetMs = millis();
    return;
  }
  if (today == lastFarmDateKey) return;

  lastFarmDateKey = today;
  dailyGramsDispensed = 0.0;
  lastDailyResetMs = millis();
  for (int i = 0; i < feedTimesCount; i++) feedTimes[i].firedToday = false;
  Serial.printf("[CAP] farm-local day %lu - daily grams reset\n", (unsigned long)today);
  persistScheduleState();
}

void maybeResetDailyBudget() {
  maybeResetDailyBudgetFor(currentFarmDateKey());
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

// Nearby 2.4 GHz networks shown in the setup page picker. Filled by the async
// scan below; typing the name by hand always works, so a scan is never a gate.
struct ScannedNetwork {
  String ssid;
  int32_t rssi;
  bool secure;
};
ScannedNetwork scannedNetworks[PROVISIONING_SCAN_MAX];
int scannedNetworkCount = 0;

// ---- Async 2.4 GHz scan (issue #252) ----
// The old synchronous scan ran while the station side was still retrying a
// failed join. esp_wifi_scan_start() refuses to run then, and the Arduino
// wrapper reports that as WIFI_SCAN_FAILED (-2), which the firmware printed as
// "0 network(s)". The scan now settles the station first, runs asynchronously
// and is polled from serviceProvisioningScan(), so loop() (and the feed button)
// never blocks on the radio.
enum ProvisioningScanState {
  PROV_SCAN_IDLE,
  PROV_SCAN_RUNNING,
  PROV_SCAN_RETRY_WAIT,
};
ProvisioningScanState provisioningScanState = PROV_SCAN_IDLE;
unsigned long provisioningScanStartedMs = 0;
unsigned long provisioningScanRetryAtMs = 0;
bool provisioningScanRetried = false;
int provisioningScanRawCount = 0;
int provisioningScanLastError = 0;   // raw return from scanNetworks/scanComplete
unsigned long provisioningScanCompletedAtMs = 0;

// ---- Test-before-save join (issue #252) ----
// The submitted credentials live in RAM until the station link is proven; only
// then are they written to NVS. A failure keeps the setup form (and the stored
// credentials untouched) so the user can retry.
enum ProvisioningJoinState {
  PROV_JOIN_IDLE,
  PROV_JOIN_CONNECTING,
  PROV_JOIN_CONNECTED,
  PROV_JOIN_FAILED,
};
ProvisioningJoinState provisioningJoinState = PROV_JOIN_IDLE;
unsigned long provisioningJoinStartedMs = 0;
unsigned long provisioningJoinConnectedMs = 0;
String provisioningPendingSsid;
String provisioningPendingPass;
String provisioningPendingDeviceId;
String provisioningPendingDeviceToken;
String provisioningJoinFailure;   // human-readable message for the form/status page
String provisioningJoinDetail;    // machine reason for /status (wrong_password, no_ssid, ...)

// Feed button (GPIO 23): falling-edge interrupt, 250 ms debounce, at most one
// pending press. A short press during a blocking network call is queued and
// dispensed as soon as loop() runs again. The interrupt only ever records a
// *candidate*; handleButton() confirms it by sampling the pin and applies the
// quiet window and cooldown (firmware 1.5.3).
volatile bool feedButtonPressQueued = false;
volatile unsigned long feedButtonLastEdgeMs = 0;
static portMUX_TYPE feedButtonMux = portMUX_INITIALIZER_UNLOCKED;

// Press guard state (1.5.3). dispenseQuietUntilMs is set when the relay turns
// OFF and is compared with a signed difference so a millis() wrap is harmless.
unsigned long dispenseQuietUntilMs = 0;
unsigned long lastButtonDispenseMs = 0;
bool buttonCooldownArmed = false;   // no cooldown before the first button dose
uint32_t buttonGlitchCount = 0;     // rejected edges, reported in the heartbeat
unsigned long lastGlitchLogMs = 0;
unsigned long lastQuietLogMs = 0;

// True after esp_task_wdt_add(NULL). The first portal start happens in setup()
// before the watchdog is subscribed, so resets are skipped until then.
bool watchdogSubscribed = false;

// ==================== Fail-safe state (firmware 1.6.0) ====================

// Pure logic lives in safety.h / filters.h so `pio test -e native` covers it.
fw::DispenseGate dispenseGate;
fw::ResetHistory resetHistory;
fw::SafeModeWindow safeModeWindow;
fw::ButtonNoiseGuard buttonNoise;
fw::HopperFilter hopperFilter;
fw::TokenBucket dispensedEventBucket;
fw::TokenBucket refusedEventBucket;
fw::TokenBucket ackEventBucket;
fw::NetRetry heartbeatRetry;
fw::NetRetry feedPollRetry;
fw::NetRetry scheduleRetry;
fw::NetRetry eventFlushRetry;
fw::NetRetry refusalRetry;
fw::NetRetry ackRetry;

bool safeModeActive = false;
char lastResetReasons[48] = "none";
uint16_t refusalCounts[(uint8_t)fw::Refusal::COUNT];
uint32_t relayOverruns = 0;
uint32_t sensorInvalidCount = 0;
uint32_t queueDropCount = 0;

// A relay overrun turns the motor off straight away, but the refusal report is
// a network call. It is deferred to loop() so it never runs inside an open TLS
// session (kickWatchdog() can trip this in the middle of a poll cycle).
bool pendingRelayOverrunReport = false;
float overrunGrams = 0.0f;
const char *overrunSource = "";

// Machine status interface (1.8.0).
fw::FaultManager faultManager;
fw::FaultDebounce hopperSensorHealth;
unsigned long lastFaultCheckMs = 0;
unsigned long lastHopperEchoCheckMs = 0;
bool faultChecksStarted = false;
bool wifiAckButtonWasDown = false;

bool buttonWasDisabled = false;
unsigned long lastDisabledLogMs = 0;
bool safetyHealthyCleared = false;
unsigned long lastSafeModeCheckMs = 0;
uint32_t nextEventSequence = 1;

// Set by stopFeedCycle() and serviceDispenseSafety(); never re-enter a stop.
void stopFeedCycle();
void serviceDispenseSafety();
void serviceSafetyReports();
void serviceSafeMode();
void serviceIndicators();
void serviceFaults();
void recordFault(fw::Fault fault, bool present);
void raiseFaultEvent(fw::Fault fault);
void recordHopperEcho(bool echoSeen);
void configureSafety();
void configureHopperFilter();
void clearSafetyStateForReset();
void initSafetyState(esp_reset_reason_t reason);
bool readHopperLevel(float &percent, float &cm);
int8_t netJitter();

void kickWatchdog() {
  if (watchdogSubscribed) esp_task_wdt_reset();
  // A blocking HTTPS call can delay loop() past the end of a short dose. The
  // relay is switched off here, at every network boundary, instead of waiting
  // for the next pass.
  serviceDispenseSafety();
  serviceIndicators();
}

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
// Scheduled in setup() once the persisted/server configuration is known.
unsigned long nextOtaCheckMs = 0;
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

// The API (ingest, feed-command, schedule-sync and OTA check) may only be
// called with a real provisioned identity. An unprovisioned unit runs the
// setup portal and keeps feeding locally; it never sends a request.
bool apiIdentityAvailable() {
  return !identityValueIsPlaceholder(provisionedDeviceId) &&
         !identityValueIsPlaceholder(provisionedDeviceToken);
}

// Load the active identity once, right after prefs.begin(). There is no
// compile-time fallback: a unit is provisioned only when NVS holds both a
// device_id and a device_token. Everything that talks to the API checks
// apiIdentityAvailable() first.
void loadDeviceIdentity() {
  provisionedDeviceId = prefs.getString("device_id", "");
  provisionedDeviceToken = prefs.getString("device_token", "");
  provisionedDeviceId.trim();
  provisionedDeviceToken.trim();
  provisionedFlag = prefs.getBool("provisioned", false);

  Serial.printf("[IDENTITY] Device ID: %s\n",
                provisionedDeviceId.length() ? provisionedDeviceId.c_str() : "(none)");
  // Never print the token itself: it authenticates every API call.
  Serial.printf("[IDENTITY] Device token: %s\n",
                identityValueIsPlaceholder(provisionedDeviceToken) ? "missing" : "configured");
  Serial.printf("[IDENTITY] Provisioned marker: %s\n", provisionedFlag ? "yes" : "no");
  if (!apiIdentityAvailable()) {
    Serial.println("[IDENTITY] not provisioned - API disabled");
  }
}

// ---- Dispense calibration (grams per second) -----------------------------
// The dashboard is the source of truth: the backend poll and schedule-sync
// both carry grams_per_second. It is mirrored into NVS (both the 1.6.x
// `cal_gps` key and the 1.7.0 last-good config blob) so that a reboot does not
// silently revert to DEFAULT_GRAMS_PER_SECOND until the next poll - a feed
// triggered in that window would otherwise run at the wrong rate.
void loadCalibration() {
  // A persisted 1.7.0 config blob already carries the calibrated rate; do not
  // let the legacy key overwrite it.
  if (configLoadedFromNvs) {
    gramsPerSecond = deviceConfig.gramsPerSecond;
    Serial.printf("[CAL] grams_per_second=%.2f (persisted config)\n", gramsPerSecond);
    return;
  }
  const bool stored = prefs.isKey(NVS_KEY_CAL_GPS);
  float gps = prefs.getFloat(NVS_KEY_CAL_GPS, DEFAULT_GRAMS_PER_SECOND);
  const fw::ConfigFieldSpec *spec = fw::findConfigSpec("grams_per_second");
  const float minGps = spec ? spec->minValue : 0.5f;
  const float maxGps = spec ? spec->maxValue : 50.0f;
  if (!(gps >= minGps && gps <= maxGps)) {
    Serial.printf("[CAL] stored grams_per_second %.2f out of range - using %.2f\n",
                  gps, (double)DEFAULT_GRAMS_PER_SECOND);
    gps = DEFAULT_GRAMS_PER_SECOND;
  }
  gramsPerSecond = gps;
  deviceConfig.gramsPerSecond = gps;
  Serial.printf("[CAL] grams_per_second=%.2f (%s)\n", gramsPerSecond,
                stored ? "from NVS" : "compile-time default");
}

// Apply a server-pushed calibration. Writes NVS only when the value actually
// changes, so a poll every few seconds cannot wear the flash.
void applyGramsPerSecond(float gps, const char *source) {
  const fw::ConfigFieldSpec *spec = fw::findConfigSpec("grams_per_second");
  const float minGps = spec ? spec->minValue : 0.5f;
  const float maxGps = spec ? spec->maxValue : 50.0f;
  if (!(gps >= minGps && gps <= maxGps)) {
    Serial.printf("[CAL] refused grams_per_second %.2f from %s (out of range)\n",
                  gps, source);
    return;
  }
  const float delta = gps - gramsPerSecond;
  if (delta < 0.001f && delta > -0.001f) return;  // unchanged - no NVS write
  gramsPerSecond = gps;
  deviceConfig.gramsPerSecond = gps;
  prefs.putFloat(NVS_KEY_CAL_GPS, gramsPerSecond);
  Serial.printf("[CAL] grams_per_second=%.2f applied from %s (saved to NVS)\n",
                gramsPerSecond, source);
}

// ==================== Dashboard-driven configuration (1.7.0) ====================
// One versioned `config` object in the feed-command poll response drives every
// operational value. The absolute envelope lives in config.h; this block owns
// the NVS last-good copy, the runtime application and the all-or-nothing rule.

// Persist the last-good configuration (new NVS keys only; namespace unchanged).
void persistConfig() {
  JsonDocument doc;
  fw::writeConfigJson(deviceConfig, doc);
  String json;
  serializeJson(doc, json);
  prefs.putString(NVS_CONFIG_JSON_KEY, json);
  prefs.putUInt(NVS_CONFIG_REV_KEY, appliedConfigRev);
}

// Restore the last-good copy at boot. Missing, corrupt or out-of-range: keep
// the compile-time defaults (the only values that are always safe).
void loadPersistedConfig() {
  deviceConfig = fw::defaultDeviceConfig();
  if (!prefs.isKey(NVS_CONFIG_JSON_KEY)) {
    Serial.println("[CONFIG] no persisted config - compile-time defaults");
    return;
  }
  const String json = prefs.getString(NVS_CONFIG_JSON_KEY, "");
  JsonDocument doc;
  const DeserializationError error = deserializeJson(doc, json);
  const char *badKey = nullptr;
  fw::DeviceConfig restored;
  const fw::ConfigStatus status =
      error ? fw::ConfigStatus::MALFORMED : fw::restoreConfig(doc, restored, &badKey);
  if (!fw::configStatusOk(status)) {
    Serial.printf("[CONFIG] persisted config rejected (%s %s) - defaults\n",
                  fw::configStatusName(status), badKey ? badKey : "");
    return;
  }
  deviceConfig = restored;
  appliedConfigRev = prefs.getUInt(NVS_CONFIG_REV_KEY, 0);
  configLoadedFromNvs = true;
  Serial.printf("[CONFIG] restored rev %lu from NVS\n", (unsigned long)appliedConfigRev);
}

// Push the current DeviceConfig into the runtime guards. Called at boot and
// after every accepted server object, never from inside a dispense.
void applyConfigToRuntime() {
  fw::DispenseLimits limits;
  limits.minGapMs = (unsigned long)(deviceConfig.minDispenseGapS * 1000.0f);
  limits.maxPerHour = (uint8_t)deviceConfig.maxDispensesPerHour;
  // E38: no per-dose gram cap. The daily ceiling bounds a dose, and the relay
  // time envelope bounds the rest (grams / gramsPerSecond <= maxDispenseMs).
  limits.maxGramsPerDose = fw::effectiveMaxGramsPerDose(deviceConfig);
  limits.maxGramsPerDay = deviceConfig.maxGramsPerDay;
  limits.maxDispenseMs = (unsigned long)deviceConfig.maxDispenseMs;
  dispenseGate.configure(limits);

  buttonNoise.configure((unsigned long)deviceConfig.buttonNoiseWindowMs,
                        (uint8_t)deviceConfig.buttonNoiseMax,
                        (unsigned long)deviceConfig.buttonDisableMs);
  configureHopperFilter();
  gramsPerSecond = deviceConfig.gramsPerSecond;
}

/*
  Apply the optional `config` object from a poll response.

  MISSING (an older server) keeps the last-good copy. MALFORMED,
  OUT_OF_RANGE and UNSUPPORTED keep the last-good copy and are logged by name,
  so the server never sends a value that raises a bound or disables a guard.
*/
fw::ConfigStatus applyServerConfig(const JsonDocument &doc, const char *source) {
  fw::ConfigPatch patch;
  const fw::ConfigStatus read = fw::readConfigPatch(doc, patch);
  if (read != fw::ConfigStatus::OK) return read;

  // The revision is a hash of the whole object, so an unchanged rev means an
  // unchanged configuration. Skip the work (and the NVS write) in that case.
  if (configFromServer && patch.rev == appliedConfigRev) return fw::ConfigStatus::OK;

  const char *badKey = nullptr;
  fw::DeviceConfig next;
  const fw::ConfigStatus applied = fw::applyConfigPatch(patch, deviceConfig, next, &badKey);
  if (!fw::configStatusOk(applied)) {
    Serial.printf("[CONFIG] %s config from %s rejected at %s - keeping rev %lu\n",
                  fw::configStatusName(applied), source, badKey ? badKey : "?",
                  (unsigned long)appliedConfigRev);
    return applied;
  }

  deviceConfig = next;
  appliedConfigRev = patch.rev;
  configFromServer = true;
  applyConfigToRuntime();
  // Mirror the two dose sizes into the schedule blob before cfg_json, so the
  // schedule copy is never older than the config copy if power is lost between
  // the two writes.
  persistScheduleState();
  persistConfig();
  Serial.printf("[CONFIG] applied rev %lu from %s (dose<=%.0fg day<=%.0fg gap=%lus "
                "hourly=%u relay=%lums)\n",
                (unsigned long)appliedConfigRev, source, fw::effectiveMaxGramsPerDose(deviceConfig),
                deviceConfig.maxGramsPerDay, (unsigned long)deviceConfig.minDispenseGapS,
                (unsigned)deviceConfig.maxDispensesPerHour,
                (unsigned long)deviceConfig.maxDispenseMs);
  return fw::ConfigStatus::OK;
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

// Full provisioning gate: a usable SSID AND a usable device identity from NVS.
// Without both the unit starts the setup portal and makes no API calls.
bool wifiCredentialsProvisioned() {
  return storedSsidAvailable() && apiIdentityAvailable();
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
    clearSafetyStateForReset();
    delay(300);
    ESP.restart();
  }

  bool wifiDown = readResetButton(WIFI_RESET_BUTTON_PIN, wifiResetButton, now);
  // 1.8.0: a tap (released before the 5 s hold) acknowledges latched faults.
  // A hold still resets Wi-Fi and reboots before it is ever released.
  if (wifiAckButtonWasDown && !wifiDown && !factoryDown) {
    const uint8_t cleared = faultManager.acknowledge();
    if (cleared) {
      Serial.printf("[FAULT] operator acknowledged (cleared mask 0x%02X)\n", cleared);
    } else if (faultManager.indicatorOn()) {
      Serial.printf("[FAULT] acknowledge refused: cause still present (mask 0x%02X)\n",
                    faultManager.presentMask());
    }
    serviceIndicators();
  }
  wifiAckButtonWasDown = wifiDown;
  if (wifiDown && !factoryDown && (now - wifiResetButton.pressStartMs) >= WIFI_RESET_HOLD_MS) {
    Serial.println("[RESET] WiFi reset button held - clearing WiFi, keeping device identity");
    clearWiFiStackCredentials();
    clearWiFiCredentials();
    clearSafetyStateForReset();
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

// "PakaonAI-XXXX". The last four hex digits come from the stored Device ID
// when that parses as a MAC (so the broadcast name matches the registered
// device and the printed sticker), otherwise from the chip's eFuse MAC. Before
// provisioning there is no stored ID, so an unprovisioned unit uses its chip
// MAC and every unit has a distinct name.
bool macDeviceIdLastFour(const String &value, String &lastFour) {
  String hex;
  unsigned separators = 0;
  for (size_t i = 0; i < value.length(); i++) {
    const char c = value[i];
    if (isxdigit((unsigned char)c)) {
      hex += (char)toupper((unsigned char)c);
    } else if (c == ':' || c == '-' || c == '.' || c == ' ') {
      separators++;
    } else {
      return false;
    }
  }
  if (hex.length() != 12) return false;
  // Either 12 bare hex digits, or a 17-character separated form.
  if (separators != 0 && (separators != 5 || value.length() != 17)) return false;
  lastFour = hex.substring(8);
  return true;
}

String provisioningApSsid() {
  String source = chipMacString();
  String storedLastFour;
  if (!identityValueIsPlaceholder(provisionedDeviceId) &&
      macDeviceIdLastFour(provisionedDeviceId, storedLastFour)) {
    source = provisionedDeviceId;
  }
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

// PakaonAI mark, simplified to a small inline SVG: the portal must work with no
// external file, CDN or web font (the full logo kit SVGs are 30-250 KB).
// Navy field, white fish, three orange feed pellets (brand #0A3D62 / #E8722C).
static const char PORTAL_MARK_SVG[] PROGMEM =
  "<svg class=\"mark\" viewBox=\"0 0 64 64\" role=\"img\" aria-label=\"PakaonAI\">"
  "<circle cx=\"32\" cy=\"32\" r=\"32\" fill=\"#0A3D62\"/>"
  "<path d=\"M9 22l13 10-13 10z\" fill=\"#fff\"/>"
  "<ellipse cx=\"37\" cy=\"32\" rx=\"17\" ry=\"11\" fill=\"#fff\"/>"
  "<circle cx=\"46\" cy=\"28\" r=\"2.2\" fill=\"#0A3D62\"/>"
  "<circle cx=\"57\" cy=\"20\" r=\"2.4\" fill=\"#E8722C\"/>"
  "<circle cx=\"60\" cy=\"28\" r=\"2.8\" fill=\"#E8722C\"/>"
  "<circle cx=\"57\" cy=\"36\" r=\"2.2\" fill=\"#E8722C\"/>"
  "</svg>";

static const char PORTAL_LOCK_SVG[] PROGMEM =
  "<span class=\"lock\" title=\"Secured network\" aria-label=\"Secured\">"
  "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\">"
  "<path d=\"M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm0 2a3 3 0 0 1 3 3v3H9V7a3 3 0 0 1 3-3z\"/>"
  "</svg></span>";

// Mobile-first, no external resources (no CDN, no web fonts): the portal is
// opened from a phone over an AP with no internet uplink.
static const char PORTAL_CSS[] PROGMEM =
  ":root{--navy:#0A3D62;--orange:#E8722C;--ink:#1B2430;--muted:#5A6775;--line:#D8E0E8;--bg:#F1F5F9;--card:#fff}"
  "*{box-sizing:border-box}"
  "html{-webkit-text-size-adjust:100%}"
  "body{margin:0;font-family:system-ui,-apple-system,\"Segoe UI\",Roboto,sans-serif;background:var(--bg);color:var(--ink);line-height:1.45}"
  "header.brand{background:var(--navy);color:#fff;padding:14px 18px;display:flex;align-items:center;gap:10px}"
  ".brand .mark{width:34px;height:34px;flex:none}"
  ".word{font-weight:800;font-size:1.25rem;letter-spacing:-.02em;color:#fff}"
  ".word .ai{color:#FF9A5A}"
  "main{max-width:460px;margin:0 auto;padding:18px 18px 6px}"
  ".card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;box-shadow:0 2px 10px rgba(10,61,98,.06)}"
  "h1{font-size:1.3rem;margin:0 0 4px;color:var(--navy)}"
  ".tagline{margin:0 0 14px;color:var(--muted);font-size:.95rem}"
  "label{display:block;font-weight:600;margin:16px 0 6px;font-size:.95rem}"
  "input{width:100%;padding:12px;border:1px solid var(--line);border-radius:10px;font-size:1rem;background:#fff;color:inherit}"
  "input:focus,button:focus-visible,a:focus-visible{outline:3px solid rgba(232,114,44,.55);outline-offset:2px}"
  "button{font:inherit}"
  ".btn{display:block;width:100%;margin-top:16px;padding:13px;border:0;border-radius:10px;background:var(--navy);color:#fff;font-size:1rem;font-weight:700;text-align:center;text-decoration:none;cursor:pointer}"
  ".btn.secondary{background:#fff;color:var(--navy);border:1px solid var(--line);font-weight:600}"
  ".btn.small{display:inline-block;width:auto;margin:0;padding:8px 14px;font-size:.9rem}"
  ".note{font-size:.85rem;color:var(--muted);margin:6px 0 0}"
  ".err{background:#FDECEC;border:1px solid #F5B5B5;border-radius:10px;padding:10px 12px;color:#8A1C1C;font-size:.92rem;margin:10px 0 0}"
  ".ok{background:#E8F5EC;border:1px solid #B7E0C4;border-radius:10px;padding:10px 12px;color:#14532D;font-size:.92rem;margin:12px 0 0}"
  ".networks{display:grid;gap:8px;margin-top:10px}"
  ".net{display:flex;align-items:center;gap:10px;width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:#fff;color:inherit;text-align:left;cursor:pointer}"
  ".net[aria-pressed=\"true\"]{border-color:var(--orange);box-shadow:0 0 0 2px rgba(232,114,44,.2)}"
  ".net .name{flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"
  ".meta{font-size:.78rem;color:var(--muted);flex:none}"
  ".bars{display:inline-flex;align-items:flex-end;gap:2px;height:14px;flex:none}"
  ".bars i{width:3px;background:#C3CDD8;border-radius:1px}"
  ".bars i:nth-child(1){height:4px}.bars i:nth-child(2){height:7px}"
  ".bars i:nth-child(3){height:10px}.bars i:nth-child(4){height:14px}"
  ".bars.s1 i:nth-child(1),.bars.s2 i:nth-child(-n+2),.bars.s3 i:nth-child(-n+3),.bars.s4 i{background:var(--navy)}"
  ".lock{flex:none;color:var(--muted);display:inline-flex}"
  ".lock svg{width:14px;height:14px;display:block}"
  ".scanrow{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;font-size:.85rem;color:var(--muted)}"
  ".spin{width:34px;height:34px;border:3px solid #DCE5EE;border-top-color:var(--orange);border-radius:50%;animation:sp 900ms linear infinite;margin:18px auto}"
  "@keyframes sp{to{transform:rotate(360deg)}}"
  "dl.facts{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin:14px 0 0;font-size:.92rem}"
  "dt{color:var(--muted)}dd{margin:0;font-weight:600;word-break:break-all}"
  "footer{max-width:460px;margin:0 auto;padding:14px 18px 30px;color:var(--muted);font-size:.8rem}"
  "footer code{background:#E6ECF2;padding:1px 5px;border-radius:4px;color:var(--navy)}"
  "@media (prefers-color-scheme:dark){:root{--ink:#E8EEF4;--muted:#A7B4C2;--line:#2A3A4A;--bg:#0D1B26;--card:#132635}"
  "input,.net,.btn.secondary{background:#0F2231}"
  "footer code{background:#1A2C3C;color:#CFE2F3}"
  ".bars i{background:#3A4C5E}}";

int signalBarsForRssi(int32_t rssi) {
  if (rssi > -55) return 4;
  if (rssi > -67) return 3;
  if (rssi > -78) return 2;
  return 1;
}

String portalDeviceIdForDisplay() {
  if (!identityValueIsPlaceholder(provisionedDeviceId)) return provisionedDeviceId;
  return chipMacString();
}

// Shared page shell: brand bar with the fish mark and the PakaonAI wordmark.
String portalPageHead(const char *title) {
  String page;
  page.reserve(4096);
  page += F("<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">"
            "<meta name=\"theme-color\" content=\"#0A3D62\">"
            "<title>");
  page += title;
  page += F("</title><style>");
  page += FPSTR(PORTAL_CSS);
  page += F("</style></head><body><header class=\"brand\">");
  page += FPSTR(PORTAL_MARK_SVG);
  page += F("<span class=\"word\">Pakaon<span class=\"ai\">AI</span></span></header>");
  return page;
}

// Footer: the unit's Device ID (the chip MAC before provisioning) and the AP
// name, so the person provisioning can match the box to the dashboard record.
String portalFooter() {
  String page;
  page += F("<footer><div>Device ID: <code>");
  page += htmlEscape(portalDeviceIdForDisplay());
  page += F("</code></div><div>Setup AP: <code>");
  page += htmlEscape(provisioningApName.length() ? provisioningApName : provisioningApSsid());
  page += F("</code> &middot; Portal: <code>192.168.4.1</code></div>"
            "<div>Firmware ");
  page += F(FW_VERSION);
  page += F(" &middot; Sakto nga pakaon, sakto nga oras.</div></footer>");
  return page;
}

bool provisioningScanInProgress() {
  return provisioningScanState == PROV_SCAN_RUNNING ||
         provisioningScanState == PROV_SCAN_RETRY_WAIT;
}

String buildNetworkRows(const String &currentSsid) {
  String rows;
  rows.reserve(120 + scannedNetworkCount * 240);
  for (int i = 0; i < scannedNetworkCount; i++) {
    rows += F("<button type=\"button\" class=\"net\" data-ssid=\"");
    rows += htmlEscape(scannedNetworks[i].ssid);
    rows += F("\" aria-pressed=\"");
    rows += scannedNetworks[i].ssid == currentSsid ? F("true") : F("false");
    rows += F("\"><span class=\"bars s");
    rows += String(signalBarsForRssi(scannedNetworks[i].rssi));
    rows += F("\" aria-hidden=\"true\"><i></i><i></i><i></i><i></i></span>"
              "<span class=\"name\">");
    rows += htmlEscape(scannedNetworks[i].ssid);
    rows += F("</span>");
    if (scannedNetworks[i].secure) {
      rows += FPSTR(PORTAL_LOCK_SVG);
    } else {
      rows += F("<span class=\"meta\">Open</span>");
    }
    rows += F("<span class=\"meta\">");
    rows += String((int)scannedNetworks[i].rssi);
    rows += F(" dBm</span></button>");
  }
  return rows;
}

String scanHintText() {
  if (provisioningScanInProgress()) return String(F("Scanning&hellip;"));
  if (scannedNetworkCount > 0) {
    String hint = String(scannedNetworkCount);
    hint += F(" network(s) found");
    return hint;
  }
  return String(F("No networks found"));
}

// Network picker body. The JS keeps this in sync after a Rescan; without JS the
// server-rendered list and the manual SSID field are both usable.
String buildNetworkPicker(const String &currentSsid) {
  String picker;
  if (provisioningScanInProgress()) {
    picker += F("<p class=\"note\">Scanning for nearby 2.4 GHz networks&hellip;</p>");
  }
  if (scannedNetworkCount > 0) {
    picker += buildNetworkRows(currentSsid);
  } else if (!provisioningScanInProgress()) {
    picker += F("<p class=\"err\">No Wi-Fi networks found. Check that the antenna is "
                "attached, move closer to the router (2.4 GHz only), then tap "
                "Rescan.</p>");
  }
  picker += F("<button type=\"button\" class=\"btn secondary\" id=\"manual\">"
              "Type it manually</button>");
  return picker;
}

// Portal JS. Plain ES5: an old phone must still be able to provision a feeder.
String portalSetupScript() {
  return String(F(
    "<script>(function(){"
    "var box=document.getElementById('networks'),hint=document.getElementById('scanhint'),"
    "rescan=document.getElementById('rescan'),ssid=document.getElementById('ssid');"
    "if(!box||!ssid)return;"
    "function esc(s){return String(s).replace(/[&<>\"']/g,function(c){"
    "return{'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c];});}"
    "function bars(n){return '<span class=\"bars s'+n+'\" aria-hidden=\"true\">"
    "<i></i><i></i><i></i><i></i></span>';}"
    "function lock(){return '<span class=\"lock\" title=\"Secured network\" aria-label=\"Secured\">"
    "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\">"
    "<path d=\"M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm0 2a3 3 0 0 1 3 3v3H9V7a3 3 0 0 1 3-3z\"/>"
    "</svg></span>';}"
    "function level(r){return r>-55?4:r>-67?3:r>-78?2:1;}"
    "function render(nets){var h='';"
    "if(!nets.length){h='<p class=\"err\">No Wi-Fi networks found. Check that the antenna is attached, "
    "move closer to the router (2.4 GHz only), then tap Rescan.</p>';}"
    "for(var i=0;i<nets.length;i++){var n=nets[i];"
    "h+='<button type=\"button\" class=\"net\" data-ssid=\"'+esc(n.ssid)+'\" aria-pressed=\"'"
    "+(n.ssid===ssid.value?'true':'false')+'\">'+bars(level(n.rssi))"
    "+'<span class=\"name\">'+esc(n.ssid)+'</span>'+(n.secure?lock():'<span class=\"meta\">Open</span>')"
    "+'<span class=\"meta\">'+n.rssi+' dBm</span></button>';}"
    "h+='<button type=\"button\" class=\"btn secondary\" id=\"manual\">Type it manually</button>';"
    "box.innerHTML=h;"
    "hint.textContent=nets.length?(nets.length+' network(s) found'):'No networks found';}"
    "function refresh(){"
    "fetch('/scan',{cache:'no-store'}).then(function(r){return r.json();}).then(function(j){"
    "if(j.scanning){hint.textContent='Scanning\\u2026';setTimeout(refresh,900);return;}"
    "render(j.networks||[]);"
    "}).catch(function(){hint.textContent='Scan failed. Tap Rescan.';});}"
    "box.addEventListener('click',function(e){var t=e.target;"
    "while(t&&t!==box&&(' '+t.className+' ').indexOf(' net ')===-1)t=t.parentNode;"
    "if(t&&t!==box){ssid.value=t.getAttribute('data-ssid')||'';ssid.focus();refresh();}"
    "if(e.target&&e.target.id==='manual'){ssid.value='';ssid.focus();}});"
    "if(rescan)rescan.addEventListener('click',function(){rescan.disabled=true;"
    "hint.textContent='Scanning\\u2026';"
    "fetch('/scan',{method:'POST',cache:'no-store'}).then(function(r){return r.json();})"
    ".then(function(){setTimeout(refresh,600);})"
    ".catch(function(){hint.textContent='Scan failed. Tap Rescan.';})"
    ".then(function(){rescan.disabled=false;});});"
    "refresh();"
    "})();</script>"));
}

String portalStatusScript() {
  return String(F(
    "<script>(function(){"
    "var h=document.getElementById('state'),msg=document.getElementById('msg'),"
    "spin=document.getElementById('spin'),facts=document.getElementById('facts'),"
    "err=document.getElementById('err'),done=document.getElementById('done'),"
    "back=document.getElementById('back'),fSsid=document.getElementById('f-ssid'),"
    "fIp=document.getElementById('f-ip'),fRssi=document.getElementById('f-rssi'),stopped=false;"
    "function dbm(v){return v<0?('\\u2212'+Math.abs(v)+' dBm'):(v+' dBm');}"
    "function tick(){"
    "fetch('/status',{cache:'no-store'}).then(function(r){return r.json();}).then(function(j){"
    "if(j.state==='connected'){stopped=true;h.textContent='Connected!';"
    "msg.textContent='Connected to '+j.ssid+'.';"
    "fSsid.textContent=j.ssid;fIp.textContent=j.ip;fRssi.textContent=dbm(j.rssi);"
    "facts.hidden=false;spin.hidden=true;err.hidden=true;done.hidden=false;"
    "done.textContent='PakaonAI will finish setup and restart in 5 s. You can close this page.';return;}"
    "if(j.state==='failed'){stopped=true;h.textContent='Not connected';"
    "msg.textContent='The feeder could not join that network.';"
    "err.textContent=j.message||'Check the name and password, then try again.';"
    "err.hidden=false;spin.hidden=true;back.hidden=false;return;}"
    "setTimeout(tick,1000);"
    "}).catch(function(){if(!stopped)setTimeout(tick,1500);});}"
    "tick();})();</script>"));
}

String buildProvisioningPage(const String &ssid, const String &error) {
  // Identity values are never rendered back into the form: the stored token
  // must not be readable by anyone who joins the open setup AP.
  const bool identityAvailable = apiIdentityAvailable();
  const String identityPlaceholder = identityAvailable
    ? String(F("leave blank to keep existing"))
    : String(F("required for first-time setup"));

  String page = portalPageHead("PakaonAI device setup");
  page += F("<main><div class=\"card\"><h1>Device setup</h1>"
            "<p class=\"tagline\">Sakto nga pakaon, sakto nga oras.</p>");
  if (error.length() > 0) {
    page += F("<p class=\"err\">");
    page += htmlEscape(error);
    page += F("</p>");
  }
  page += F("<p class=\"note\"><strong>Step 1. Wi-Fi</strong> &mdash; pick your 2.4 GHz "
            "network, or type its name.</p>"
            "<div class=\"networks\" id=\"networks\">");
  page += buildNetworkPicker(ssid);
  page += F("</div><div class=\"scanrow\"><span id=\"scanhint\">");
  page += scanHintText();
  page += F("</span><button type=\"button\" class=\"btn secondary small\" id=\"rescan\">"
            "Rescan</button></div>"
            "<form method=\"post\" action=\"/save\" id=\"setupform\">"
            "<label for=\"ssid\">Wi-Fi name (SSID)</label>"
            "<input id=\"ssid\" name=\"ssid\" type=\"text\" maxlength=\"32\" required "
            "autocomplete=\"off\" autocapitalize=\"none\" spellcheck=\"false\" value=\"");
  page += htmlEscape(ssid);
  page += F("\"><p class=\"note\">Wi-Fi names are case-sensitive. The feeder is 2.4 GHz "
            "only, so 5 GHz networks are not listed.</p>"
            "<label for=\"pass\">Password</label>"
            "<input id=\"pass\" name=\"pass\" type=\"password\" maxlength=\"63\" "
            "autocomplete=\"new-password\">"
            "<p class=\"note\">Leave empty for an open network; otherwise 8-63 characters. "
            "Nothing is saved until the connection works.</p>"
            "<p class=\"note\"><strong>Step 2. Device identity</strong> &mdash; from "
            "Admin &rarr; Devices in the PakaonAI dashboard.</p>"
            "<label for=\"device_id\">Device ID</label>"
            "<input id=\"device_id\" name=\"device_id\" type=\"text\" maxlength=\"64\" "
            "autocomplete=\"off\" value=\"\" placeholder=\"");
  page += identityPlaceholder;
  page += F("\"><label for=\"device_token\">Device Token</label>"
            "<input id=\"device_token\" name=\"device_token\" type=\"password\" maxlength=\"128\" "
            "autocomplete=\"new-password\" value=\"\" placeholder=\"");
  page += identityPlaceholder;
  page += F("\"><button class=\"btn\" type=\"submit\">Connect and save</button>"
            "</form>"
            "<p class=\"note\">The feeder tests the network first. It restarts only after the "
            "connection is confirmed, and discards the password if the join fails.</p>"
            "</div></main>");
  page += portalFooter();
  page += portalSetupScript();
  page += F("</body></html>");
  return page;
}

String buildProvisioningStatusPage() {
  String page = portalPageHead("PakaonAI connecting");
  page += F("<main><div class=\"card\">"
            "<h1 id=\"state\">Connecting&hellip;</h1>"
            "<p class=\"tagline\" id=\"msg\">Testing <strong>");
  page += htmlEscape(provisioningPendingSsid);
  page += F("</strong> &mdash; this can take up to 20 seconds.</p>"
            "<div class=\"spin\" id=\"spin\" aria-hidden=\"true\"></div>"
            "<dl class=\"facts\" id=\"facts\" hidden>"
            "<dt>Network</dt><dd id=\"f-ssid\">&mdash;</dd>"
            "<dt>IP address</dt><dd id=\"f-ip\">&mdash;</dd>"
            "<dt>Signal</dt><dd id=\"f-rssi\">&mdash;</dd></dl>"
            "<p class=\"err\" id=\"err\" hidden></p>"
            "<p class=\"ok\" id=\"done\" hidden></p>"
            "<a class=\"btn\" id=\"back\" href=\"/\" hidden>Back to setup</a>"
            "</div></main>");
  page += portalFooter();
  page += portalStatusScript();
  page += F("</body></html>");
  return page;
}

void sendPortalJson(const String &json, int code) {
  provisioningServer.sendHeader("Cache-Control", "no-store");
  provisioningServer.send(code, "application/json", json);
}

void handleProvisioningRoot() {
  provisioningServer.sendHeader("Cache-Control", "no-store");
  // While a join is being tested the root shows the live status page; the
  // status page polls /status and reports the result.
  if (provisioningJoinState == PROV_JOIN_CONNECTING ||
      provisioningJoinState == PROV_JOIN_CONNECTED) {
    provisioningServer.send(200, "text/html", buildProvisioningStatusPage());
    return;
  }

  String currentSsid;
  if (provisioningPendingSsid.length() > 0) {
    currentSsid = provisioningPendingSsid;
  } else if (storedSsidAvailable()) {
    currentSsid = prefs.getString("wifi_ssid", "");
  }

  // After a failed join the form comes back with the reason, so the user can
  // correct it and retry. Nothing was written to NVS.
  const String error = provisioningJoinState == PROV_JOIN_FAILED
    ? provisioningJoinFailure
    : String("");
  provisioningServer.send(200, "text/html", buildProvisioningPage(currentSsid, error));
}

void handleProvisioningSave() {
  if (provisioningJoinState == PROV_JOIN_CONNECTING ||
      provisioningJoinState == PROV_JOIN_CONNECTED) {
    provisioningServer.sendHeader("Location", "/", true);
    provisioningServer.send(303, "text/plain", "");
    return;
  }

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

  // Blank identity fields keep the active NVS identity. This is what lets the
  // WiFi-only reset flow save a new network without re-typing the Device ID /
  // token. A blank field also reuses the identity from the previous attempt in
  // the same portal session, so a mistyped password does not force the token to
  // be retyped (it is still never rendered back into the page).
  if (deviceId.length() == 0) {
    deviceId = provisioningPendingDeviceId.length() > 0
      ? provisioningPendingDeviceId
      : provisionedDeviceId;
  }
  if (deviceToken.length() == 0) {
    deviceToken = provisioningPendingDeviceToken.length() > 0
      ? provisioningPendingDeviceToken
      : provisionedDeviceToken;
  }

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

  // Test-before-save (issue #252): the credentials and identity stay in RAM
  // until the station link is proven, then both are written to NVS together and
  // the unit restarts. A failure keeps the old NVS values untouched.
  startProvisioningJoin(ssid, pass, deviceId, deviceToken);

  // 303 so a refresh does not resubmit the form; the status page takes over.
  provisioningServer.sendHeader("Location", "/", true);
  provisioningServer.sendHeader("Cache-Control", "no-store");
  provisioningServer.send(303, "text/plain", "");
}

// Captive-portal behaviour: anything else resolves to the setup page.
void handleProvisioningNotFound() {
  String target = String(F("http://")) + WiFi.softAPIP().toString() + "/";
  provisioningServer.sendHeader("Location", target, true);
  provisioningServer.send(302, "text/plain", "");
}

// ---- Async scan ----

void settleStationForScan() {
  // Root cause of the empty scan (issue #252): the portal starts right after a
  // failed join, so the station was still connecting when the scan ran.
  // esp_wifi_scan_start() refuses to start then (ESP_ERR_WIFI_STATE) and the
  // Arduino wrapper returns WIFI_SCAN_FAILED (-2), which the old code printed as
  // "0 network(s)". Stop the retry loop, finish the half-open attempt, then
  // scan with the station idle.
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.setAutoReconnect(false);   // no background begin() racing the radio
    WiFi.disconnect(false, false);
  }
  WiFi.mode(WIFI_AP_STA);           // scan needs STA; the setup AP stays up
}

void collectScannedNetworks(int found) {
  scannedNetworkCount = 0;
  // Look at a few more records than are shown so several BSSIDs of the same
  // SSID can be reduced to their strongest signal.
  const int limit = found > PROVISIONING_SCAN_MAX * 2 ? PROVISIONING_SCAN_MAX * 2 : found;

  for (int i = 0; i < limit; i++) {
    String ssid = WiFi.SSID(i);
    if (ssid.length() == 0 || ssid.length() > 32) continue;

    const int32_t rssi = WiFi.RSSI(i);
    const bool secure = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;

    int existing = -1;
    for (int j = 0; j < scannedNetworkCount; j++) {
      if (scannedNetworks[j].ssid == ssid) {
        existing = j;
        break;
      }
    }
    if (existing >= 0) {
      if (rssi > scannedNetworks[existing].rssi) {
        scannedNetworks[existing].rssi = rssi;
        scannedNetworks[existing].secure = secure;
      }
      continue;
    }
    if (scannedNetworkCount >= PROVISIONING_SCAN_MAX) continue;

    ScannedNetwork entry;
    entry.ssid = ssid;
    entry.rssi = rssi;
    entry.secure = secure;

    // Insertion sort: strongest signal first.
    int pos = scannedNetworkCount;
    while (pos > 0 && scannedNetworks[pos - 1].rssi < entry.rssi) {
      scannedNetworks[pos] = scannedNetworks[pos - 1];
      pos--;
    }
    scannedNetworks[pos] = entry;
    scannedNetworkCount++;
  }

  WiFi.scanDelete();

  Serial.printf("[PROV] WiFi scan finished: %d raw, %d shown\n", found, scannedNetworkCount);
  for (int i = 0; i < scannedNetworkCount && i < 5; i++) {
    Serial.printf("[PROV]   %s  %d dBm%s\n",
                  scannedNetworks[i].ssid.c_str(),
                  (int)scannedNetworks[i].rssi,
                  scannedNetworks[i].secure ? " (secured)" : " (open)");
  }
  if (scannedNetworkCount == 0) {
    Serial.println("[PROV] No 2.4 GHz networks visible - check the antenna");
  }
}

void finishScanAttempt(int count, bool failed);

// Starts (or restarts) an asynchronous scan. Never blocks loop(); the result is
// polled by serviceProvisioningScan().
void startAsyncWiFiScan(bool userInitiated) {
  if (provisioningScanState == PROV_SCAN_RUNNING) return;
  if (userInitiated) provisioningScanRetried = false;

  settleStationForScan();
  WiFi.scanDelete();   // release the previous result buffer before a new scan

  provisioningScanLastError = 0;
  provisioningScanStartedMs = millis();
  provisioningScanState = PROV_SCAN_RUNNING;

  // async, hidden networks included, active scan with a per-channel bound.
  const int16_t rc = WiFi.scanNetworks(true, true, false, PROVISIONING_SCAN_CHANNEL_MS);
  Serial.printf("[PROV] WiFi scan started (rc=%d)\n", (int)rc);

  if (rc == WIFI_SCAN_RUNNING) return;   // normal async path
  if (rc >= 0) {                          // completed before returning
    provisioningScanRawCount = rc;
    collectScannedNetworks(rc);
    finishScanAttempt(rc, false);
    return;
  }
  // WIFI_SCAN_FAILED: log the real value instead of pretending it was empty.
  provisioningScanLastError = rc;
  Serial.printf("[PROV] WiFi scan could not start (%d)\n", (int)rc);
  finishScanAttempt(0, true);
}

void finishScanAttempt(int count, bool failed) {
  provisioningScanCompletedAtMs = millis();
  if (!failed && count > 0) {
    provisioningScanState = PROV_SCAN_IDLE;
    return;
  }
  if (!provisioningScanRetried) {
    // One automatic retry covers a radio that was still settling right after
    // the failed join (the field case on 2026-10-28).
    provisioningScanRetried = true;
    provisioningScanState = PROV_SCAN_RETRY_WAIT;
    provisioningScanRetryAtMs = millis() + PROVISIONING_SCAN_RETRY_MS;
    Serial.printf("[PROV] Scan returned %d network(s)%s - retrying once in %lu ms\n",
                  count, failed ? " (failed)" : "",
                  (unsigned long)PROVISIONING_SCAN_RETRY_MS);
    return;
  }
  provisioningScanState = PROV_SCAN_IDLE;
  Serial.println(failed
    ? "[PROV] WiFi scan failed twice - manual entry only"
    : "[PROV] WiFi scan found 0 networks twice - check the antenna");
}

// Called from loop() while the portal is active. Keeps the scan state machine
// moving without ever blocking on the radio.
void serviceProvisioningScan() {
  if (provisioningScanState == PROV_SCAN_RUNNING) {
    const int16_t count = WiFi.scanComplete();
    if (count == WIFI_SCAN_RUNNING) {
      if (millis() - provisioningScanStartedMs >= PROVISIONING_SCAN_TIMEOUT_MS) {
        Serial.println("[PROV] WiFi scan timed out");
        provisioningScanLastError = WIFI_SCAN_FAILED;
        esp_wifi_scan_stop();
        WiFi.scanDelete();
        finishScanAttempt(0, true);
      }
      return;
    }
    if (count >= 0) {
      provisioningScanLastError = 0;
      provisioningScanRawCount = count;
      collectScannedNetworks(count);
      finishScanAttempt(count, false);
      return;
    }
    provisioningScanLastError = count;
    Serial.printf("[PROV] WiFi scan failed (%d)\n", (int)count);
    WiFi.scanDelete();
    finishScanAttempt(0, true);
    return;
  }

  if (provisioningScanState == PROV_SCAN_RETRY_WAIT &&
      (long)(millis() - provisioningScanRetryAtMs) >= 0) {
    startAsyncWiFiScan(false);   // automatic retry: keep the "already retried" flag
  }
}

// ---- Test-before-save join ----

String provisioningJoinMessage(const String &detail) {
  if (detail == "no_ssid") {
    return String(F("Network not found. Check the name (2.4 GHz only) and that the router "
                    "is switched on."));
  }
  if (detail == "wrong_password") {
    return String(F("Wrong password, or the router refused the connection."));
  }
  if (detail == "connection_lost") {
    return String(F("The connection dropped during setup. Move closer to the router and "
                    "try again."));
  }
  if (detail == "invalid_config") {
    return String(F("The radio rejected these Wi-Fi settings. Check the password and try "
                    "again."));
  }
  if (detail == "no_ip") {
    return String(F("No IP address from the network. Check that the router hands out "
                    "addresses (DHCP) and try again."));
  }
  return String(F("Could not join the network. Check the name and password, then try again."));
}

void failProvisioningJoin(const String &detail) {
  provisioningJoinDetail = detail;
  provisioningJoinFailure = provisioningJoinMessage(detail);
  provisioningJoinState = PROV_JOIN_FAILED;
  provisioningPendingPass = "";       // never keep the password after a failure
  WiFi.disconnect(false, false);      // stop the station retry cycle
  WiFi.setAutoReconnect(false);
  Serial.printf("[PROV] Join failed (%s) - credentials NOT saved\n", detail.c_str());
}

void provisioningJoinSucceeded() {
  // Save only after the link is proven. A wrong password must never replace
  // credentials that still work, nor leave a first-time unit provisioned with a
  // network it cannot reach.
  saveWiFiCredentials(provisioningPendingSsid, provisioningPendingPass);
  saveDeviceIdentity(provisioningPendingDeviceId, provisioningPendingDeviceToken);
  provisioningJoinState = PROV_JOIN_CONNECTED;
  provisioningJoinConnectedMs = millis();
  provisioningPendingPass = "";   // NVS owns it now; drop it from RAM
  Serial.printf("[PROV] Connected to \"%s\" IP %s RSSI %d dBm - saved, restarting in %lu s\n",
                provisioningPendingSsid.c_str(), WiFi.localIP().toString().c_str(),
                (int)WiFi.RSSI(),
                (unsigned long)(PROVISIONING_SUCCESS_RESTART_MS / 1000));
}

void startProvisioningJoin(const String &ssid, const String &pass,
                           const String &deviceId, const String &deviceToken) {
  provisioningPendingSsid = ssid;
  provisioningPendingPass = pass;
  provisioningPendingDeviceId = deviceId;
  provisioningPendingDeviceToken = deviceToken;
  provisioningJoinFailure = "";
  provisioningJoinDetail = "";

  // A scan in flight owns the radio; stop it before the join.
  if (provisioningScanInProgress()) {
    esp_wifi_scan_stop();
    WiFi.scanDelete();
    provisioningScanState = PROV_SCAN_IDLE;
  }

  WiFi.mode(WIFI_AP_STA);          // the setup AP stays reachable during the test
  WiFi.setAutoReconnect(false);    // one attempt we control, not a retry loop
  WiFi.disconnect(false, false);
  provisioningJoinState = PROV_JOIN_CONNECTING;
  provisioningJoinStartedMs = millis();

  const wl_status_t rc = WiFi.begin(ssid.c_str(), pass.c_str());
  Serial.printf("[PROV] Testing \"%s\" before saving (begin rc=%d)\n", ssid.c_str(), (int)rc);
  if (rc == WL_CONNECT_FAILED) failProvisioningJoin("invalid_config");
}

// Called from loop() while the portal is active. Non-blocking: the join is
// observed through WiFi.status(), and the watchdog is fed every pass.
void serviceProvisioningJoin() {
  if (provisioningJoinState == PROV_JOIN_CONNECTED) {
    if (millis() - provisioningJoinConnectedMs >= PROVISIONING_SUCCESS_RESTART_MS) {
      Serial.println("[PROV] Restarting with the verified WiFi settings");
      provisioningServer.client().flush();
      provisioningServer.client().stop();
      delay(100);
      ESP.restart();
    }
    return;
  }
  if (provisioningJoinState != PROV_JOIN_CONNECTING) return;

  kickWatchdog();
  const wl_status_t status = WiFi.status();
  if (status == WL_CONNECTED) {
    provisioningJoinSucceeded();
    return;
  }

  const unsigned long elapsed = millis() - provisioningJoinStartedMs;
  // A definitive answer (no such network, auth refused, link dropped) ends the
  // wait early once a full station attempt has had time to run; otherwise the
  // attempt gets the full 20 s before it is called a failure.
  const bool answered = status == WL_NO_SSID_AVAIL ||
                        status == WL_CONNECT_FAILED ||
                        status == WL_CONNECTION_LOST;
  if (answered && elapsed >= PROVISIONING_JOIN_QUICK_FAIL_MS) {
    if (status == WL_NO_SSID_AVAIL) failProvisioningJoin("no_ssid");
    else if (status == WL_CONNECT_FAILED) failProvisioningJoin("wrong_password");
    else failProvisioningJoin("connection_lost");
    return;
  }
  if (elapsed >= PROVISIONING_SETUP_JOIN_TIMEOUT_MS) {
    if (status == WL_NO_SSID_AVAIL) failProvisioningJoin("no_ssid");
    else if (status == WL_CONNECT_FAILED) failProvisioningJoin("wrong_password");
    else failProvisioningJoin("no_ip");
  }
}

// Small JSON status for the status page. No password or token is ever included.
void handleProvisioningStatus() {
  JsonDocument doc;
  const char *state = "idle";
  if (provisioningJoinState == PROV_JOIN_CONNECTING) state = "connecting";
  else if (provisioningJoinState == PROV_JOIN_CONNECTED) state = "connected";
  else if (provisioningJoinState == PROV_JOIN_FAILED) state = "failed";

  doc["state"] = state;
  doc["ssid"] = provisioningPendingSsid;
  if (provisioningJoinState == PROV_JOIN_CONNECTED) {
    doc["ip"] = WiFi.localIP().toString();
    doc["rssi"] = WiFi.RSSI();
    const unsigned long elapsed = millis() - provisioningJoinConnectedMs;
    doc["restartInMs"] = elapsed >= PROVISIONING_SUCCESS_RESTART_MS
      ? 0UL
      : (PROVISIONING_SUCCESS_RESTART_MS - elapsed);
  }
  if (provisioningJoinState == PROV_JOIN_FAILED) {
    doc["detail"] = provisioningJoinDetail;
    doc["message"] = provisioningJoinFailure;
  }

  String out;
  serializeJson(doc, out);
  sendPortalJson(out, 200);
}

void handleProvisioningScanGet() {
  JsonDocument doc;
  doc["scanning"] = provisioningScanInProgress();
  doc["count"] = scannedNetworkCount;
  doc["rawCount"] = provisioningScanRawCount;
  doc["error"] = provisioningScanLastError;
  doc["completedAtMs"] = provisioningScanCompletedAtMs;
  JsonArray nets = doc["networks"].to<JsonArray>();
  for (int i = 0; i < scannedNetworkCount; i++) {
    JsonObject network = nets.add<JsonObject>();
    network["ssid"] = scannedNetworks[i].ssid;
    network["rssi"] = scannedNetworks[i].rssi;
    network["secure"] = scannedNetworks[i].secure;
  }
  String out;
  serializeJson(doc, out);
  sendPortalJson(out, 200);
}

void handleProvisioningScanPost() {
  if (provisioningJoinState == PROV_JOIN_CONNECTING ||
      provisioningJoinState == PROV_JOIN_CONNECTED) {
    sendPortalJson(F("{\"ok\":false,\"error\":\"busy\"}"), 409);
    return;
  }
  if (provisioningScanInProgress()) {
    sendPortalJson(F("{\"ok\":true,\"scanning\":true}"), 200);
    return;
  }
  startAsyncWiFiScan(true);
  sendPortalJson(provisioningScanInProgress()
    ? F("{\"ok\":true,\"scanning\":true}")
    : F("{\"ok\":true,\"scanning\":false}"), 200);
}

void startProvisioningPortal() {
  if (provisioningActive) return;

  provisioningApName = provisioningApSsid();

  // Stop the station retry loop before touching the radio: an in-progress
  // connect makes esp_wifi_set_mode() and esp_wifi_scan_start() fail with
  // ESP_ERR_WIFI_STATE (issue #252, the empty scan).
  WiFi.setAutoReconnect(false);
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.disconnect(false, false);
  }
  // AP+STA keeps the setup AP and the station interface alive together: the new
  // credentials are tested on the station side while this AP stays reachable.
  // Auto-reconnect is restored when the portal stops, so the portal owns the
  // radio while it is open and a background begin() cannot race a scan.
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
    provisioningServer.on("/status", HTTP_GET, handleProvisioningStatus);
    provisioningServer.on("/scan", HTTP_GET, handleProvisioningScanGet);
    provisioningServer.on("/scan", HTTP_POST, handleProvisioningScanPost);
    provisioningServer.onNotFound(handleProvisioningNotFound);
    provisioningRoutesRegistered = true;
  }
  provisioningServer.begin();

  provisioningActive = true;
  wifiJoinPending = false;
  provisioningJoinState = PROV_JOIN_IDLE;
  provisioningJoinFailure = "";
  Serial.println("[PROV] Setup portal active");
  Serial.printf("[PROV] Join \"%s\" and open http://%s\n",
                provisioningApName.c_str(), WiFi.softAPIP().toString().c_str());

  // Scan after the AP is up and the station is idle. The page can be opened
  // while it runs: it shows "Scanning..." and the Rescan button refreshes it.
  startAsyncWiFiScan(true);
}

void stopProvisioningPortal() {
  if (!provisioningActive) return;
  if (provisioningScanInProgress()) {
    esp_wifi_scan_stop();
    WiFi.scanDelete();
    provisioningScanState = PROV_SCAN_IDLE;
  }
  provisioningDns.stop();
  provisioningServer.stop();
  WiFi.softAPdisconnect(true);   // drops the AP interface, keeps STA credentials
  // Normal operation keeps the core's auto-reconnect; the portal disables it
  // only so a background begin() does not race the scan.
  WiFi.setAutoReconnect(true);
  provisioningActive = false;
  provisioningApName = "";
  provisioningJoinState = PROV_JOIN_IDLE;
  Serial.println("[PROV] Setup portal stopped");
}

// Runs from loop() while provisioning is active. Never blocks long enough to
// trip the task watchdog, and never enters deep sleep.
void serviceProvisioningPortal() {
  // The loop task is subscribed to the 30 s task watchdog, and the only other
  // reset lives in the backend-poll block, which is skipped while the portal is
  // open. Without this the board rebooted ~30 s after the portal started, so a
  // user could never finish the setup form.
  kickWatchdog();
  provisioningDns.processNextRequest();  // compatibility no-op on ESP32 core 3.x
  provisioningServer.handleClient();

  serviceProvisioningJoin();
  serviceProvisioningScan();

  // Only close the portal once the unit is actually usable and no setup attempt
  // is on screen: a station link without a device identity would leave an
  // unprovisioned unit with no way back into its own setup page. Wait for a
  // running scan (a few seconds) instead of leaving its result buffer behind.
  if (provisioningJoinState == PROV_JOIN_IDLE && !provisioningScanInProgress() &&
      WiFi.status() == WL_CONNECTED && apiIdentityAvailable()) {
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
// Farm-local minute of day. The RTC runs UTC, so this applies the offset the
// server last sent (`farm_offset_minutes`), with the compile-time fleet
// fallback (Philippines, UTC+8, no DST) until the first response.
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
  minuteOfDay = fw::farmLocalMinuteOfDay(hour * 60 + minute, farmOffsetMinutes);
  return true;
}

bool otaWithinWindow() {
  int localMinute = 0;
  if (!otaLocalMinuteOfDay(localMinute)) return false;
  return localMinute >= (int)deviceConfig.otaWindowStartMin &&
         localMinute < (int)deviceConfig.otaWindowEndMin;
}

// Uses the same RTC clock and farm offset handleSchedule() fires on, so the
// guard matches when this unit would actually dispense.
bool otaScheduledFeedNearby() {
  if (!rtcAvailable) return false;   // no RTC means the scheduler is off
  DateTime now = rtc.now();
  const int nowMinute =
      fw::farmLocalMinuteOfDay(now.hour() * 60 + now.minute(), farmOffsetMinutes);
  for (int i = 0; i < feedTimesCount; i++) {
    const int feedMinute = feedTimes[i].hour * 60 + feedTimes[i].minute;
    int delta = feedMinute - nowMinute;
    if (delta < -720) delta += 1440;
    if (delta > 720) delta -= 1440;
    const int distance = delta < 0 ? -delta : delta;
    if (distance <= (int)deviceConfig.otaFeedGuardMin) return true;
  }
  return false;
}

bool scheduledFeedDueNow() {
  if (!rtcAvailable) return false;
  DateTime now = rtc.now();
  const int localMinute =
      fw::farmLocalMinuteOfDay(now.hour() * 60 + now.minute(), farmOffsetMinutes);
  const int localHour = localMinute / 60;
  const int localMinuteOfHour = localMinute % 60;
  for (int i = 0; i < feedTimesCount; i++) {
    if (!feedTimes[i].firedToday &&
        feedTimes[i].hour == localHour && feedTimes[i].minute == localMinuteOfHour) {
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
  // A unit in safe mode is unstable by definition: do not replace its firmware
  // until it has proved 30 quiet minutes (1.6.0).
  if (safeModeActive) return "safe_mode";
  if (feederActive) return "feeding";
  if (provisioningActive) return "provisioning";
  if (WiFi.status() != WL_CONNECTED) return "wifi_down";
  if (!validTimeAvailable()) return "time_invalid";
  if (WiFi.RSSI() <= (int32_t)deviceConfig.otaMinRssiDbm) return "rssi_weak";
  if (millis() - bootTime <= (unsigned long)deviceConfig.otaMinUptimeS * 1000UL) {
    return "uptime_too_short";
  }
  if (lastResetWasBrownout) return "brownout_reset";
  if (!otaWithinWindow()) return "outside_window";
  if (otaScheduledFeedNearby()) return "scheduled_feed_nearby";
  if (ESP.getFreeHeap() < (uint32_t)deviceConfig.otaMinFreeHeapBytes) return "low_heap";
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
                (unsigned long)deviceConfig.otaHealthCheckTimeoutMs / 1000UL);
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

  if (millis() - bootTime >= (unsigned long)deviceConfig.otaHealthCheckTimeoutMs) {
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

// ---- Persisted schedule, dose sizes, farm offset and daily counter (I-109) ----
// New, additive keys in the existing "optifeed" namespace (15-char NVS limit).
// Every value is written only when it actually differs from what NVS already
// holds: a 5 s poll, a day rollover and each completed dispense are the only
// callers, so the flash is not rewritten in a loop.
#define SCHED_NVS_SCHEDULE_KEY "sch_sched"    // count + hour/minute pairs, one blob
#define SCHED_NVS_GRAMS_KEY    "sch_grams"    // deviceConfig.gramsPerFeeding
#define SCHED_NVS_BUTTON_KEY   "sch_button"   // deviceConfig.buttonFeedGrams
#define SCHED_NVS_DAILY_KEY    "sch_daily"    // dailyGramsDispensed
#define SCHED_NVS_DAY_KEY      "sch_day"      // farm-local YYYYMMDD it belongs to
#define SCHED_NVS_OFFSET_KEY   "sch_offset"   // farm_offset_minutes (signed)

// One NVS blob for the schedule so a power loss cannot leave a new time array
// next to an old count.
struct PersistedSchedule {
  uint8_t count;
  uint8_t times[MAX_FEED_TIMES * 2];
};

void persistScheduleState() {
  int count = feedTimesCount;
  if (count < 0) count = 0;
  if (count > MAX_FEED_TIMES) count = MAX_FEED_TIMES;

  PersistedSchedule schedule;
  schedule.count = (uint8_t)count;
  for (int i = 0; i < MAX_FEED_TIMES; i++) {
    schedule.times[i * 2] = (i < count) ? feedTimes[i].hour : 0;
    schedule.times[i * 2 + 1] = (i < count) ? feedTimes[i].minute : 0;
  }

  PersistedSchedule stored;
  const bool scheduleChanged =
      prefs.getBytes(SCHED_NVS_SCHEDULE_KEY, &stored, sizeof(stored)) != sizeof(stored) ||
      memcmp(&stored, &schedule, sizeof(schedule)) != 0;
  if (scheduleChanged) {
    prefs.putBytes(SCHED_NVS_SCHEDULE_KEY, &schedule, sizeof(schedule));
    Serial.printf("[NVS] schedule saved (%d feed(s))\n", count);
  }

  // Dose sizes. The 1.7.0 cfg_json blob already carries both when a `config`
  // object has been applied; this copy also keeps the legacy flat contract and
  // the offline boot path persistent.
  if (!prefs.isKey(SCHED_NVS_GRAMS_KEY) ||
      fabsf(prefs.getFloat(SCHED_NVS_GRAMS_KEY, 0.0f) - deviceConfig.gramsPerFeeding) >
          0.001f) {
    prefs.putFloat(SCHED_NVS_GRAMS_KEY, deviceConfig.gramsPerFeeding);
  }
  if (!prefs.isKey(SCHED_NVS_BUTTON_KEY) ||
      fabsf(prefs.getFloat(SCHED_NVS_BUTTON_KEY, 0.0f) - deviceConfig.buttonFeedGrams) >
          0.001f) {
    prefs.putFloat(SCHED_NVS_BUTTON_KEY, deviceConfig.buttonFeedGrams);
  }

  if (!prefs.isKey(SCHED_NVS_OFFSET_KEY) ||
      prefs.getInt(SCHED_NVS_OFFSET_KEY, 0) != farmOffsetMinutes) {
    prefs.putInt(SCHED_NVS_OFFSET_KEY, farmOffsetMinutes);
    Serial.printf("[NVS] farm offset saved (%+d min)\n", farmOffsetMinutes);
  }

  // The daily counter needs a calendar day to be meaningful. Without an RTC
  // there is no farm-local day, so it stays RAM-only (the 24 h window above).
  if (rtcAvailable) {
    const uint32_t today = currentFarmDateKey();
    if (today != 0) {
      if (!prefs.isKey(SCHED_NVS_DAILY_KEY) ||
          fabsf(prefs.getFloat(SCHED_NVS_DAILY_KEY, -1.0f) - dailyGramsDispensed) > 0.001f) {
        prefs.putFloat(SCHED_NVS_DAILY_KEY, dailyGramsDispensed);
      }
      if (!prefs.isKey(SCHED_NVS_DAY_KEY) ||
          prefs.getUInt(SCHED_NVS_DAY_KEY, 0) != today) {
        prefs.putUInt(SCHED_NVS_DAY_KEY, today);
      }
    }
  }
}

// Restore what a plain power cycle would otherwise lose: the schedule, the two
// dose sizes, the last farm offset and (only when it belongs to today) the
// daily counter. Runs after buildDefaultSchedule() and the RTC init, before the
// OTA checkpoint below, which still wins because it is written immediately
// before an install reboot.
void restoreScheduleState() {
  PersistedSchedule stored;
  if (prefs.getBytes(SCHED_NVS_SCHEDULE_KEY, &stored, sizeof(stored)) == sizeof(stored) &&
      stored.count >= 1 && stored.count <= MAX_FEED_TIMES) {
    bool valid = true;
    for (int i = 0; i < stored.count; i++) {
      if (stored.times[i * 2] > 23 || stored.times[i * 2 + 1] > 59) {
        valid = false;
        break;
      }
    }
    if (valid) {
      for (int i = 0; i < stored.count; i++) {
        feedTimes[i].hour = stored.times[i * 2];
        feedTimes[i].minute = stored.times[i * 2 + 1];
        feedTimes[i].firedToday = false;
      }
      feedTimesCount = stored.count;
      Serial.printf("[SCHEDULE] restored %d feed(s) from NVS\n", stored.count);
    } else {
      Serial.println("[SCHEDULE] persisted schedule invalid - keeping the default");
    }
  }

  // The two dose sizes are mirrored here by every path that applies them, so
  // this copy is at least as fresh as cfg_json (which is written by the 1.7.0
  // `config` object path only). A first boot after this firmware has no
  // sch_* keys yet and simply keeps the cfg_json/default values above.
  {
    const fw::ConfigFieldSpec *gramsSpec = fw::findConfigSpec("grams_per_feeding");
    const fw::ConfigFieldSpec *buttonSpec = fw::findConfigSpec("button_feed_grams");
    if (prefs.isKey(SCHED_NVS_GRAMS_KEY)) {
      const float grams = prefs.getFloat(SCHED_NVS_GRAMS_KEY, 0.0f);
      const float minGrams = gramsSpec ? gramsSpec->minValue : 1.0f;
      const float maxGrams = gramsSpec ? gramsSpec->maxValue : 5000.0f;
      if (grams >= minGrams && grams <= maxGrams) {
        deviceConfig.gramsPerFeeding = grams;
      }
    }
    if (prefs.isKey(SCHED_NVS_BUTTON_KEY)) {
      const float grams = prefs.getFloat(SCHED_NVS_BUTTON_KEY, 0.0f);
      const float minGrams = buttonSpec ? buttonSpec->minValue : 1.0f;
      const float maxGrams = buttonSpec ? buttonSpec->maxValue : 500.0f;
      if (grams >= minGrams && grams <= maxGrams) {
        deviceConfig.buttonFeedGrams = grams;
      }
    }
  }
  // The schedule and button paths read the caches, not deviceConfig directly.
  cachedScheduledGrams = deviceConfig.gramsPerFeeding;
  cachedButtonFeedGrams = deviceConfig.buttonFeedGrams;

  if (prefs.isKey(SCHED_NVS_OFFSET_KEY)) {
    const int offset = prefs.getInt(SCHED_NVS_OFFSET_KEY, farmOffsetMinutes);
    if (offset >= -720 && offset <= 840) {
      farmOffsetMinutes = offset;
      Serial.printf("[TIME] farm offset restored from NVS (%+d min)\n", offset);
    }
  }

  if (!rtcAvailable) return;

  const uint32_t today = currentFarmDateKey();
  lastFarmDateKey = today;
  lastDailyResetMs = millis();

  const uint32_t storedDay = prefs.getUInt(SCHED_NVS_DAY_KEY, 0);
  if (storedDay != today) {
    if (storedDay != 0) {
      Serial.printf("[CAP] persisted day %lu != today %lu - daily grams start at 0\n",
                    (unsigned long)storedDay, (unsigned long)today);
    }
    return;
  }

  const float grams = prefs.getFloat(SCHED_NVS_DAILY_KEY, 0.0f);
  if (!isfinite(grams) || grams < 0.0f) {
    Serial.println("[CAP] persisted daily grams invalid - starting at 0");
  } else if (grams > deviceConfig.maxGramsPerDay) {
    // Never restore more headroom than the cap allows: an over-cap copy means
    // the day is already spent, not that it is free again.
    dailyGramsDispensed = deviceConfig.maxGramsPerDay;
    Serial.printf("[CAP] persisted daily grams %.0f over the cap - holding at %.0f g\n",
                  grams, dailyGramsDispensed);
  } else {
    dailyGramsDispensed = grams;
    Serial.printf("[CAP] daily grams restored: %.0f g (day %lu)\n",
                  dailyGramsDispensed, (unsigned long)today);
  }
}

// Apply farm_offset_minutes from a poll response. A malformed or implausible
// value is ignored (the compile-time fallback or the last good value stays).
void applyFarmOffset(JsonVariantConst value, const char *source) {
  int offset = 0;
  if (value.is<int>()) {
    offset = value.as<int>();
  } else if (value.is<float>()) {
    offset = (int)lroundf(value.as<float>());
  } else {
    return;
  }
  if (offset < -720 || offset > 840) {
    static int lastRejected = 0;
    if (offset != lastRejected) {
      lastRejected = offset;
      Serial.printf("[TIME] refused farm offset %+d min from %s (out of range)\n", offset,
                    source);
    }
    return;
  }
  if (offset == farmOffsetMinutes) return;
  farmOffsetMinutes = offset;
  Serial.printf("[TIME] farm offset %+d min from %s\n", offset, source);
  persistScheduleState();
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
    const uint32_t utcDay = dateKeyFromDateTime(now);
    const uint32_t localDay = currentFarmDateKey();
    // The checkpoint keeps its 1.6.x UTC date. The counter now belongs to the
    // farm-local date, so accept either match: an older image's checkpoint is
    // still restored, and a local-day match across UTC midnight is not lost.
    if (utcDay == storedDay || localDay == storedDay) {
      dailyGramsDispensed = prefs.getFloat(OTA_NVS_GRAMS_KEY, 0.0f);
      lastFarmDateKey = localDay;
      lastDailyResetMs = millis();
      const uint32_t firedMask = prefs.getUInt(OTA_NVS_FIRED_KEY, 0);
      for (int i = 0; i < feedTimesCount && i < 32; i++) {
        feedTimes[i].firedToday = (firedMask & (1UL << i)) != 0;
      }
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
void dispenseFeed(float grams, const char* source, const String &requestId = "", bool calibration = false);
// Defined with the rest of the button handling (Tier 3). The OTA download uses
// them to confirm that a press is real before aborting, and to dispense through
// the same cooldown/dispense path as a normal button press.
bool confirmFeedButtonPress(unsigned long &lowMs);
bool requestButtonDispense();

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
  if (ESP.getFreeHeap() < (uint32_t)deviceConfig.otaMinFreeHeapBytes) {
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
    https.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    if (!beginHttpsWithTimeout(https, url.c_str(), 6000, 12000)) break;

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

      // Decision OTA-2: feeding wins over updating. A *confirmed* press (the
      // same 50 ms LOW window as the normal button path, 1.5.3) aborts the
      // download; the press is consumed and dispensed below. A noise spike on
      // the button line must never abort an update.
      if (digitalRead(BUTTON_PIN) == LOW) {
        unsigned long lowMs = 0;
        if (confirmFeedButtonPress(lowMs)) {
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
        if (millis() - lastDataMs > (unsigned long)deviceConfig.otaNoDataTimeoutMs) {
          Serial.println("[OTA] download stalled - aborting");
          transferFailed = true;
          break;
        }
        if (millis() - startedMs > (unsigned long)deviceConfig.otaDownloadTimeoutMs) {
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
    // The ISR may also have queued this press; clear it so it cannot dispense
    // twice, then dispense through the same cooldown/dispense path as a normal
    // button press (1.5.3).
    discardQueuedFeedButtonPress();
    requestButtonDispense();
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
  kickWatchdog();
  if (!beginHttpsWithTimeout(https, url.c_str(), 6000, 10000)) {
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
    otaScheduleNextCheck((unsigned long)deviceConfig.otaCheckIntervalS * 1000UL);
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
  // No API traffic without a provisioned identity (the signed check sends the
  // device token and the device id).
  if (!apiIdentityAvailable()) return;
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

// ==================== Fail-safe: boot, safe mode, gate (1.6.0) ====================

// Maps the ESP-IDF reason to the stable code in safety.h. The on-wire names
// (`reset_reason` in the heartbeat) are unchanged.
uint8_t resetCodeFromEsp(esp_reset_reason_t reason) {
  switch (reason) {
    case ESP_RST_POWERON: return fw::RESET_POWERON;
    case ESP_RST_EXT: return fw::RESET_EXTERNAL;
    case ESP_RST_SW: return fw::RESET_SOFTWARE;
    case ESP_RST_PANIC: return fw::RESET_PANIC;
    case ESP_RST_INT_WDT: return fw::RESET_INT_WDT;
    case ESP_RST_TASK_WDT: return fw::RESET_TASK_WDT;
    case ESP_RST_WDT: return fw::RESET_WDT;
    case ESP_RST_DEEPSLEEP: return fw::RESET_DEEPSLEEP;
    case ESP_RST_BROWNOUT: return fw::RESET_BROWNOUT;
    case ESP_RST_SDIO: return fw::RESET_SDIO;
    default: return fw::RESET_UNKNOWN;
  }
}

// A usable wall clock for the reset history and the safe-mode window. The DS3231
// is read over I2C, so callers must not run this every loop pass.
bool clockValidNow() {
  if (!rtcAvailable) return false;
  return rtc.now().year() >= 2024;
}

// Runs before every software reset, panic reboot, OTA reboot and ESP.restart().
// It uses the register-level GPIO write so it works even when the Arduino HAL or
// the flash cache is not available. Boot already writes RELAY_OFF first.
void relayOffShutdownHandler() {
  gpio_set_level((gpio_num_t)RELAY_PIN, (uint32_t)RELAY_OFF);
  feederActive = false;
}

// +-20 % jitter for the HTTP retry backoff (safety.h NetRetry).
int8_t netJitter() { return (int8_t)((esp_random() % 41) - 20); }

void persistResetHistory() {
  prefs.putUChar(NVS_RESET_COUNT_KEY, resetHistory.count());
  prefs.putUInt(NVS_RESET_MASK_KEY, resetHistory.mask());
  prefs.putUInt(NVS_RESET_FIRST_KEY, resetHistory.firstEpoch());
  prefs.putUInt(NVS_RESET_LAST_KEY, resetHistory.lastEpoch());
}

// Called from the Wi-Fi/factory reset holds: a deliberate human intervention
// leaves safe mode and clears the history so the unit does not immediately
// re-enter it on the next boot.
void clearSafetyStateForReset() {
  resetHistory.clear();
  safeModeActive = false;
  prefs.putBool(NVS_SAFE_MODE_KEY, false);
  prefs.remove(NVS_SAFE_UNTIL_KEY);
  persistResetHistory();
  Serial.println("[SAFETY] safe mode and reset history cleared by a reset hold");
}

void enterSafeMode() {
  safeModeActive = true;
  digitalWrite(RELAY_PIN, RELAY_OFF);
  feederActive = false;
  const bool clockValid = clockValidNow();
  const uint32_t epoch = clockValid ? (uint32_t)rtc.now().unixtime() : 0;
  safeModeWindow.begin(clockValid, epoch, millis(),
                       (unsigned long)deviceConfig.safeModeQuietS * 1000UL);
  prefs.putBool(NVS_SAFE_MODE_KEY, true);
  if (clockValid) prefs.putUInt(NVS_SAFE_UNTIL_KEY, safeModeWindow.untilEpoch());
  else prefs.remove(NVS_SAFE_UNTIL_KEY);
  Serial.printf("[SAFETY] SAFE MODE: %s\n", lastResetReasons);
}

void leaveSafeMode(const char *reason) {
  if (!safeModeActive) {
    return;
  }
  safeModeActive = false;
  prefs.putBool(NVS_SAFE_MODE_KEY, false);
  prefs.remove(NVS_SAFE_UNTIL_KEY);
  Serial.printf("[SAFETY] safe mode cleared (%s)\n", reason);
}

// Restores the reset history, decides whether this boot is safe mode, and
// persists at most once (never in a loop).
void initSafetyState(esp_reset_reason_t reason) {
  const bool clockValid = clockValidNow();
  const uint32_t epoch = clockValid ? (uint32_t)rtc.now().unixtime() : 0;

  resetHistory.restore(prefs.getUChar(NVS_RESET_COUNT_KEY, 0),
                       prefs.getUInt(NVS_RESET_MASK_KEY, 0),
                       prefs.getUInt(NVS_RESET_FIRST_KEY, 0),
                       prefs.getUInt(NVS_RESET_LAST_KEY, 0));
  const bool historyChanged = resetHistory.addBoot(
      resetCodeFromEsp(reason), epoch, clockValid,
      (unsigned long)deviceConfig.safeModeAbnormalWindowS);
  fw::describeResetReasons(resetHistory.mask(), lastResetReasons, sizeof(lastResetReasons));

  if (historyChanged) {
    persistResetHistory();
    Serial.printf("[SAFETY] abnormal resets: %u (%s)\n", (unsigned)resetHistory.count(),
                  lastResetReasons);
  }

  const bool safeModeNvs = prefs.getBool(NVS_SAFE_MODE_KEY, false);
  const uint32_t until = prefs.getUInt(NVS_SAFE_UNTIL_KEY, 0);
  if (safeModeNvs) {
    safeModeActive = true;
    safeModeWindow.resume(until, millis(), (unsigned long)deviceConfig.safeModeQuietS * 1000UL);
    if (safeModeWindow.elapsed(clockValid, epoch, millis())) {
      leaveSafeMode("quiet period elapsed while off");
    } else {
      Serial.printf("[SAFETY] SAFE MODE persists: %s\n", lastResetReasons);
    }
  }

  if (!safeModeActive &&
      resetHistory.safeModeRequired((uint8_t)deviceConfig.safeModeAbnormalThreshold)) {
    enterSafeMode();
  }
}

// Once per second: leave safe mode after the quiet period, and clear the reset
// history after 10 healthy minutes so a later fault starts from zero.
void serviceSafeMode() {
  const unsigned long now = millis();
  if (now - lastSafeModeCheckMs < 1000UL) return;
  lastSafeModeCheckMs = now;

  if (safeModeActive) {
    const bool clockValid = clockValidNow();
    const uint32_t epoch = clockValid ? (uint32_t)rtc.now().unixtime() : 0;
    if (safeModeWindow.elapsed(clockValid, epoch, now)) {
      leaveSafeMode("30 minutes without an abnormal reset");
    }
    return;
  }

  if (!safetyHealthyCleared && resetHistory.count() > 0 &&
      (now - bootTime) >= (unsigned long)deviceConfig.safeModeHealthyClearS * 1000UL) {
    safetyHealthyCleared = true;
    resetHistory.clear();
    persistResetHistory();
    Serial.println("[SAFETY] reset history cleared after the healthy window");
  }
}

// ==================== Machine status interface (1.8.0) ====================

void writeLamp(int pin, bool on) {
  if (pin >= 0) digitalWrite(pin, on ? HIGH : LOW);
}

// Lamps start dark (level before mode, like the relay); POWER lights once the
// controller is running. Called right after the relay is forced OFF.
void setupIndicators() {
  const int pins[] = { POWER_LED_PIN, FEEDING_LED_PIN, WIFI_LED_PIN, FAULT_LED_PIN };
  for (int pin : pins) {
    if (pin < 0) continue;
    digitalWrite(pin, LOW);
    pinMode(pin, OUTPUT);
    digitalWrite(pin, LOW);
  }
  hopperSensorHealth.configure(HOPPER_SENSOR_FAULT_CHECKS);
  writeLamp(POWER_LED_PIN, true);
}

// GPIO writes only, no I/O, so it runs every loop pass and at every
// kickWatchdog() boundary: the green lamp goes out with the relay even in the
// middle of a blocking HTTPS call.
void serviceIndicators() {
  fw::IndicatorInputs in;
  in.feeding = feederActive;
  in.wifiConnected = WiFi.status() == WL_CONNECTED;
  in.provisioning = provisioningActive;
  in.fault = faultManager.indicatorOn();
  const fw::IndicatorLevels out = fw::indicatorLevels(in, millis(), WIFI_LED_BLINK_PERIOD_MS);
  writeLamp(POWER_LED_PIN, out.power);
  writeLamp(FEEDING_LED_PIN, out.feeding);
  writeLamp(WIFI_LED_PIN, out.wifi);
  writeLamp(FAULT_LED_PIN, out.fault);
}

// Fault log entry: code + timestamp. Epoch 0 when the clock is not trusted.
// An already-present fault returns early, so safe mode costs no I2C per pass.
void recordFault(fw::Fault fault, bool present) {
  if (present && faultManager.present(fault)) return;
  const uint32_t epoch = (present && clockValidNow()) ? (uint32_t)rtc.now().unixtime() : 0;
  if (faultManager.report(fault, present, epoch, millis())) {
    Serial.printf("[FAULT] %s raised (epoch %lu)\n", fw::faultName(fault), (unsigned long)epoch);
  }
}

void raiseFaultEvent(fw::Fault fault) {
  const uint32_t epoch = clockValidNow() ? (uint32_t)rtc.now().unixtime() : 0;
  faultManager.raiseEvent(fault, epoch, millis());
  Serial.printf("[FAULT] %s raised (epoch %lu)\n", fw::faultName(fault), (unsigned long)epoch);
}

void recordHopperEcho(bool echoSeen) {
  lastHopperEchoCheckMs = millis();
  recordFault(fw::Fault::HOPPER_SENSOR, hopperSensorHealth.update(echoSeen));
}

// One HC-SR04 ping, used only when no heartbeat has read the hopper recently
// (an offline unit). It does not feed the hopper filter.
bool hopperEchoPing() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  return pulseIn(ECHO_PIN, HIGH, 30000) > 0;
}

// Safe mode is a RAM flag, checked every pass. The DS3231 I2C probe and the
// offline echo check run once a minute (and once at the first pass).
void serviceFaults() {
  recordFault(fw::Fault::SAFE_MODE, safeModeActive);

  const unsigned long now = millis();
  if (faultChecksStarted && now - lastFaultCheckMs < FAULT_CHECK_INTERVAL_MS) return;
  faultChecksStarted = true;
  lastFaultCheckMs = now;

  bool rtcResponds = false;
  if (rtcAvailable) {
    Wire.beginTransmission(DS3231_I2C_ADDRESS);
    rtcResponds = (Wire.endTransmission() == 0);
  }
  recordFault(fw::Fault::RTC, !rtcResponds);

  if (now - lastHopperEchoCheckMs >= FAULT_CHECK_INTERVAL_MS) {
    recordHopperEcho(hopperEchoPing());
  }
}

void configureHopperFilter() {
  fw::HopperFilter::Config config;
  config.emptyCm = deviceConfig.hopperEmptyCm;
  config.fullCm = deviceConfig.hopperFullCm;
  config.rejectBelowCm = deviceConfig.hopperRejectBelowCm;
  config.rejectAboveMarginCm = deviceConfig.hopperRejectAboveMarginCm;
  config.emaAlpha = deviceConfig.hopperEmaAlpha;
  config.jumpPct = deviceConfig.hopperJumpPct;
  config.persistCycles = (uint8_t)deviceConfig.hopperPersistCycles;
  config.lowPct = deviceConfig.hopperLowPct;
  config.refillMarginPct = deviceConfig.hopperRefillMarginPct;
  config.stateHoldMs = (unsigned long)deviceConfig.hopperStateHoldS * 1000UL;
  hopperFilter.configure(config);
}

void configureSafety() {
  // Gate, button guard and hopper filter all come from the dashboard config
  // (envelope-bounded in config.h); the token buckets and retry ladders below
  // are transport constants that only change on a reflash.
  applyConfigToRuntime();

  dispensedEventBucket.configure(FEED_EVENT_BUCKET_CAPACITY, FEED_EVENT_REFILL_MS);
  refusedEventBucket.configure(REFUSAL_BUCKET_CAPACITY, REFUSAL_REFILL_MS);
  ackEventBucket.configure(ACK_BUCKET_CAPACITY, ACK_REFILL_MS);

  heartbeatRetry.configure(HTTP_RETRY_BASE_MS, HTTP_RETRY_CAP_MS);
  feedPollRetry.configure(HTTP_RETRY_BASE_MS, HTTP_RETRY_CAP_MS);
  scheduleRetry.configure(HTTP_RETRY_BASE_MS, HTTP_RETRY_CAP_MS);
  eventFlushRetry.configure(HTTP_RETRY_BASE_MS, HTTP_RETRY_CAP_MS);
  refusalRetry.configure(HTTP_RETRY_BASE_MS, HTTP_RETRY_CAP_MS);
  ackRetry.configure(HTTP_RETRY_BASE_MS, HTTP_RETRY_CAP_MS);
}

void setup() {
  // Relay OFF before anything else: set the level first, then the mode, so the
  // pin never drives the relay while the board boots. On a GPIO 5 unit the weak
  // internal pull-up holds that pin HIGH until this runs; a typical
  // opto-isolated relay input draws far less than its turn-on current from it.
  digitalWrite(RELAY_PIN, RELAY_OFF);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, RELAY_OFF);   // feeder must NEVER default to dispensing at boot
  setupIndicators();                     // lamps dark, then POWER on

  Serial.begin(115200);
  bootTime = millis();

  // Why the board restarted: reported in the heartbeat and used by the OTA
  // pre-flight gate (a brownout reset postpones updates).
  const esp_reset_reason_t resetReason = esp_reset_reason();
  resetReasonName = resetReasonLabel(resetReason);
  lastResetWasBrownout = (resetReason == ESP_RST_BROWNOUT);
  Serial.printf("[INIT] Reset reason: %s\n", resetReasonName);
  Serial.printf("[INIT] Relay on GPIO %d (active %s)\n", RELAY_PIN, RELAY_ACTIVE_LOW ? "LOW" : "HIGH");

  // The relay is also switched off before every software reset, panic reboot,
  // OTA install reboot and ESP.restart(). Registered before anything can restart.
  if (esp_register_shutdown_handler(relayOffShutdownHandler) == ESP_OK) {
    Serial.println("[INIT] Relay shutdown handler registered");
  } else {
    Serial.println("[WARN] Relay shutdown handler could not be registered");
  }

  // Gate, event buckets, retry states and the hopper filter, before any trigger.
  configureSafety();

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
  // The dashboard-driven last-good configuration (1.7.0) must be in force
  // before the safety state, the hopper filter and the boot summary are built.
  loadPersistedConfig();
  loadCalibration();
  // configureSafety() already ran with the defaults; re-apply the restored or
  // calibrated values now that NVS has been read.
  applyConfigToRuntime();
  nextOtaCheckMs = millis() + (unsigned long)deviceConfig.otaCheckIntervalS * 1000UL;

  // Button held through boot resets WiFi only; the device identity stays.
  // The interrupt is attached after this hold, so the hold can never queue a
  // feed press.
  bool credentialsResetAtBoot = false;
  if (bootButtonResetHeld()) {
    clearWiFiCredentials();
    clearSafetyStateForReset();   // a deliberate reset hold also leaves safe mode
    credentialsResetAtBoot = true;
  }
  attachInterrupt(digitalPinToInterrupt(BUTTON_PIN), onFeedButtonPress, FALLING);
  Serial.printf("[INIT] Feed button GPIO%d: falling-edge interrupt, %lums debounce, "
                "%d ms confirmation, %lus boot grace\n",
                BUTTON_PIN, (unsigned long)deviceConfig.buttonDebounceMs,
                BUTTON_CONFIRM_SAMPLES * BUTTON_CONFIRM_SAMPLE_MS,
                (unsigned long)deviceConfig.buttonStartupGraceMs / 1000UL);

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

  // Restore what a plain power cycle used to lose: the last schedule, dose
  // sizes, farm offset and (only when it belongs to today) the daily counter.
  // This runs after buildDefaultSchedule() and the RTC init, so an offline unit
  // boots with its last schedule instead of 06:00/19:00.
  restoreScheduleState();

  // Restore the feeding-state checkpoint a just-installed OTA image wrote
  // before its reboot (schedule every boot; daily grams and firedToday only
  // when the checkpoint is from today). It runs after restoreScheduleState()
  // and therefore still wins: it is the freshest state and is consumed here.
  restoreFeedingStateAfterOta();

  // Fail-safe state (1.6.0). The RTC is up, so this boot can be placed in the
  // reset history window and safe mode can be anchored on a real clock.
  initSafetyState(resetReason);

  // TLS: verify the server against ROOT_CA, the multi-root bundle in the config
  // section (never setInsecure). Cap the handshake so a dead TLS peer cannot
  // sit through the 30 s task watchdog (8 s connect + 8 s read + 8 s handshake
  // stay well inside it).
  secureClient.setHandshakeTimeout(8);
  secureClient.setCACert(ROOT_CA);

  // Missing WiFi credentials, missing identity, or a boot reset -> setup
  // portal. Only a unit with a stored SSID and a stored identity uses the
  // normal station path; an unprovisioned unit never calls the API.
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

  // Both identities are logged at boot: the chip eFuse MAC (what the registry
  // and sticker use) and the stored Device ID, plus the AP name it produces.
  Serial.print("[DEVICE MAC] ");
  Serial.println(chipMacString());
  Serial.printf("[IDENTITY] Setup AP name: %s\n", provisioningApSsid().c_str());
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
  watchdogSubscribed = true;

  // If this boot is the first boot of an OTA image, start the 5-minute
  // probation. A normal boot just reports "valid" and does nothing else.
  otaBeginHealthCheck();

  // One concise boot summary: what the unit is, how it last died, and the
  // limits it is now enforcing (dashboard config, envelope-bounded).
  Serial.printf("[BOOT] summary: fw=%s reset=%s safe_mode=%d brownout_hold=%lus relay=GPIO%d "
                "identity=%s wifi=%s feeds=%d limits=%lus-gap/%u-per-hour/%.0fg-per-day/"
                "dose<=%.0fg/hold=%lus/config_rev=%lu\n",
                FW_VERSION, resetReasonName, safeModeActive ? 1 : 0,
                (unsigned long)deviceConfig.brownoutHoldS, RELAY_PIN,
                apiIdentityAvailable() ? "yes" : "no",
                WiFi.status() == WL_CONNECTED ? "online" : "offline", feedTimesCount,
                (unsigned long)deviceConfig.minDispenseGapS,
                (unsigned)deviceConfig.maxDispensesPerHour, deviceConfig.maxGramsPerDay,
                fw::effectiveMaxGramsPerDose(deviceConfig),
                (unsigned long)deviceConfig.safeModeQuietS, (unsigned long)appliedConfigRev);

  Serial.println("[READY] OptiFeed controller online.");
}

void loop() {
#ifdef ENABLE_LAN_OTA
  ArduinoOTA.handle();  // bench builds only
#endif
  handleResetButtons(); // Dedicated WiFi / factory reset buttons, if wired
  // Relay first: stop a dose at its expected end (or trip an overrun) before
  // any blocking work below. Also runs at every kickWatchdog() boundary.
  serviceDispenseSafety();
  serviceSafetyReports();
  serviceSafeMode();
  serviceOtaHealthCheck();  // pending-verify deadline; relay stays OFF until valid
  serviceFaults();          // FaultManager: safe mode, RTC probe, offline echo check
  serviceIndicators();      // POWER / FEEDING / WI-FI / FAULT lamps

  if (provisioningActive) {
    serviceProvisioningPortal();  // captive DNS + setup page; never deep-sleeps
  } else {
    maintainWiFi();
  }

  handleButton();

  if (rtcAvailable) handleSchedule();

  // Local feeding keeps running while provisioning; backend calls do not. An
  // unprovisioned unit makes no API calls at all, and the watchdog is fed
  // between every network call so a slow link cannot trip it.
  const unsigned long pollIntervalMs =
      (unsigned long)deviceConfig.heartbeatIntervalS * 1000UL;
  if (!provisioningActive && apiIdentityAvailable() && millis() - lastPoll >= pollIntervalMs) {
    sendTelemetry();
    kickWatchdog();
    pollDashboardFeedCommand();
    kickWatchdog();
    pollScheduleCommand();
    kickWatchdog();
    flushQueuedEvents();
    kickWatchdog();
    lastPoll = millis();
  }

  // Signed update check at the configured interval, behind the pre-flight gate.
  // gate. It blocks only while it is actually due (or downloading).
  maybeCheckForUpdate();
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

// Opens a TLS session with ROOT_CA verification using explicit timeouts.
// Logs a clear hint when the handshake cannot start (wrong CA for the host,
// DNS down, etc.). The shared secure client is reused for every call.
bool beginHttpsWithTimeout(HTTPClient &https, const char *url, int connectTimeoutMs,
                           int readTimeoutMs) {
  https.setConnectTimeout(connectTimeoutMs);
  https.setTimeout(readTimeoutMs);
  if (https.begin(secureClient, url)) return true;
  Serial.println("[TLS] Connection failed — check ROOT_CA matches the server CA and the URL is correct");
  return false;
}

// 8 s connect + 8 s read: one poll call can never reach the 30 s task watchdog.
bool beginHttps(HTTPClient &https, const char *url) {
  return beginHttpsWithTimeout(https, url, HTTP_CONNECT_TIMEOUT_MS, HTTP_READ_TIMEOUT_MS);
}

// Best-effort report when a safety rule refuses a dose (audited server-side).
// The server's ingest contract has no `safety_trip` event type, so every
// refusal -- including a relay overrun -- travels as the existing
// `feed_refused` event with a stable reason. The reason values are asserted by
// the native tests and documented in firmware/README.md.
void reportFeedError(fw::Refusal reason, float grams, const char* source) {
  refusalCounts[(uint8_t)reason]++;
  Serial.printf("[FEED] REFUSED %s: %.0fg from %s\n", fw::refusalReason(reason), grams, source);
  // No API calls without a provisioned identity: an unprovisioned unit has no
  // device record to report against.
  if (!apiIdentityAvailable() || WiFi.status() != WL_CONNECTED) return;

  const unsigned long now = millis();
  if (!refusalRetry.ready(now)) return;            // backoff after a failed report
  if (!refusedEventBucket.tryConsume(now)) {       // token bucket per event type
    Serial.println("[FEED] refusal report rate-limited");
    return;
  }

  HTTPClient https;
  kickWatchdog();
  if (!beginHttps(https, INGEST_URL)) {
    refusalRetry.recordFailure(millis(), netJitter());
    return;
  }
  https.addHeader("Content-Type", "application/json");
  https.addHeader("X-Device-Token", provisionedDeviceToken);
  JsonDocument doc;
  doc["device_id"]  = provisionedDeviceId;
  doc["event_type"] = "feed_refused";
  doc["event_id"]   = generateEventId();
  doc["grams"]      = grams;
  doc["source"]     = source;
  doc["reason"]     = fw::refusalReason(reason);
  doc["timestamp"]  = rtcAvailable ? getRTCiso8601() : "unknown";
  String out;
  serializeJson(doc, out);
  int code = https.POST(out);
  https.end();
  kickWatchdog();
  if (code >= 200 && code < 300) {
    refusalRetry.recordSuccess();
  } else {
    refusalRetry.recordFailure(millis(), netJitter());
  }
  Serial.printf("[FEED] refusal report -> %d\n", code);
}

// Validates the legacy flat server-pushed values (firmware <= 1.6.x contract)
// BEFORE anything is stored. Bounds come from the same envelope table as the
// 1.7.0 `config` object, so the two paths can never disagree. Returns false if
// any present value is out of range — callers must then ignore the whole
// response (no stores, no dispense, no schedule update).
bool legacyValueInRange(const JsonDocument &doc, const char *key) {
  if (!doc[key].is<float>()) return true;  // absent: nothing to validate
  const fw::ConfigFieldSpec *spec = fw::findConfigSpec(key);
  if (spec == nullptr) return true;
  const float value = doc[key];
  if (isnan(value) || isinf(value)) return false;
  return value >= spec->minValue && value <= spec->maxValue;
}

bool validateServerConfig(const JsonDocument &doc) {
  if (!legacyValueInRange(doc, "grams_per_feeding")) return false;
  if (!legacyValueInRange(doc, "button_feed_grams")) return false;
  if (!legacyValueInRange(doc, "grams_per_second")) return false;
  if (!legacyValueInRange(doc, "temp_offset_c")) return false;
  if (!legacyValueInRange(doc, "hopper_full_cm")) return false;
  if (!legacyValueInRange(doc, "hopper_empty_cm")) return false;
  // Cross-field: hopper full distance must be nearer than the empty distance.
  float fullCm = doc["hopper_full_cm"].is<float>() ? (float)doc["hopper_full_cm"]
                                                   : deviceConfig.hopperFullCm;
  float emptyCm = doc["hopper_empty_cm"].is<float>() ? (float)doc["hopper_empty_cm"]
                                                     : deviceConfig.hopperEmptyCm;
  if (fullCm >= emptyCm) return false;
  return true;
}

// ==================== Shared dispense logic ====================

void dispenseFeed(float grams, const char* source, const String &requestId, bool calibration) {
  // The relay write itself is instant, but a refusal report below is a network
  // call: feed the watchdog around the whole dispense decision.
  kickWatchdog();

  // Fail-safe order: a unit in safe mode or inside its post-brownout hold must
  // not energize the relay for anything, including a schedule that was already
  // due. Both report a refusal so the server audit trail shows the skip.
  if (safeModeActive) {
    reportFeedError(fw::Refusal::SAFE_MODE, grams, source);
    return;
  }
  if (lastResetWasBrownout &&
      (millis() - bootTime) < (unsigned long)deviceConfig.brownoutHoldS * 1000UL) {
    reportFeedError(fw::Refusal::BROWNOUT_HOLD, grams, source);
    return;
  }

  // T-12a: never feed while a signed image is downloading. Dashboard requests
  // must be told why, so the refusal is reported as ota_in_progress.
  if (otaInProgress) {
    reportFeedError(fw::Refusal::OTA_IN_PROGRESS, grams, source);
    return;
  }

  // A freshly installed image is on probation: the relay stays OFF until the
  // health check marks it valid (at most five minutes). The heartbeat already
  // reports ota_state=pending_verify, so this does not report a refusal.
  if (otaHealthCheckActive) {
    refusalCounts[(uint8_t)fw::Refusal::OTA_PENDING_VERIFY]++;
    Serial.printf("[FEED] refused - OTA image pending verification (%s)\n", source);
    return;
  }

  if (feederActive) {
    refusalCounts[(uint8_t)fw::Refusal::BUSY]++;
    Serial.printf("[FEED] busy — ignoring %s trigger (mutex held)\n", source);
    return;
  }

  maybeResetDailyBudget();

  // One gate for every source: grams, dose time, daily cap, the configured gap
  // and the configured hourly ceiling. E38: there is no per-dose gram cap - a
  // single dose may use whatever the daily ceiling allows, bounded only by the
  // relay-time envelope (grams / gramsPerSecond <= maxDispenseMs). Calibration
  // is the one deliberate exception: it may run up to the configured
  // calibration window (10 minutes / 5,000 g envelope) when the request carries
  // the calibration flag from the server.
  const float rate = (gramsPerSecond > 0.0f) ? gramsPerSecond : 4.0f;
  const unsigned long durationMs = (unsigned long)((grams / rate) * 1000.0);
  fw::DispenseLimits limits = dispenseGate.limits();
  if (calibration) {
    limits.maxGramsPerDose = deviceConfig.calibrationMaxGrams;
    limits.maxDispenseMs = (unsigned long)deviceConfig.calibrationMaxDispenseMs;
  }
  const fw::Refusal refusal =
      dispenseGate.evaluate(millis(), grams, durationMs, dailyGramsDispensed, limits);
  if (refusal != fw::Refusal::NONE) {
    reportFeedError(refusal, grams, source);
    return;
  }

  feedDurationMs = durationMs;

  Serial.printf("[FEED] dispensing %.0fg (~%lums) — source: %s\n", grams, feedDurationMs, source);

  dispenseGate.recordStart(millis());
  digitalWrite(RELAY_PIN, RELAY_ON);
  feederActive = true;
  feedStartTime = millis();
  currentFeedGrams = grams;
  currentFeedSource = source;
  currentFeedRequestId = requestId;
  dailyGramsDispensed += grams;
  kickWatchdog();
}

// Relay hard stop shared by loop() and kickWatchdog(). Switching the relay off
// comes first, so the watchdog kick at the end cannot re-enter this path with
// feederActive still true.
void stopFeedCycle() {
  digitalWrite(RELAY_PIN, RELAY_OFF);
  feederActive = false;
  // 1.5.3: every button edge is ignored from relay ON until 2 s after relay OFF,
  // whatever started the dispense. The stamp is taken when the motor is
  // actually switched off, so the quiet window follows a long or short dose.
  dispenseQuietUntilMs = millis() + (unsigned long)deviceConfig.buttonQuietAfterDispenseMs;
  Serial.printf("[FEED] complete — %.0fg via %s\n", currentFeedGrams, currentFeedSource);
  enqueueEvent(currentFeedGrams, currentFeedSource, currentFeedRequestId);
  currentFeedRequestId = "";
  // The daily counter was incremented when the relay closed; persist the
  // completed dose so a power cycle cannot give the day its headroom back.
  persistScheduleState();
  kickWatchdog();
}

// Independent overrun check (1.6.0): a dose may run at most 2 s past its
// expected end. That happens when a blocking HTTPS call delayed loop(), and the
// relay must not wait for the next pass. The trip is reported from loop(), not
// from here, so it never opens a second TLS session.
void serviceDispenseSafety() {
  if (!feederActive) return;
  const unsigned long elapsed = millis() - feedStartTime;
  if (elapsed >= feedDurationMs + RELAY_OVERRUN_GRACE_MS) {
    relayOverruns++;
    refusalCounts[(uint8_t)fw::Refusal::RELAY_OVERRUN]++;
    pendingRelayOverrunReport = true;
    overrunGrams = currentFeedGrams;
    overrunSource = currentFeedSource;
    Serial.printf("[SAFETY] relay overrun: %lums for a %lums dose (%s)\n", elapsed,
                  feedDurationMs, currentFeedSource);
    stopFeedCycle();
    raiseFaultEvent(fw::Fault::RELAY_OVERRUN);
    return;
  }
  if (elapsed >= feedDurationMs) {
    stopFeedCycle();
  }
}

// Deferred out-of-band safety reports (currently only the relay overrun).
void serviceSafetyReports() {
  if (!pendingRelayOverrunReport) return;
  pendingRelayOverrunReport = false;
  reportFeedError(fw::Refusal::RELAY_OVERRUN, overrunGrams, overrunSource);
}

// ==================== Tier 1 — RTC Schedule ====================

void handleSchedule() {
  // Relay stays OFF until a pending-verify OTA image proves itself. The window
  // is seconds to minutes and the exact-minute match still fires afterwards if
  // the image becomes valid within the same minute.
  if (otaHealthCheckActive) return;
  if (!rtcAvailable) return;   // loop() already guards; keep the path safe

  DateTime now = rtc.now();
  // Farm-local midnight rolls both the daily cap and the firedToday flags.
  maybeResetDailyBudgetFor(farmDateKeyFor(now));

  // The RTC holds UTC; the slot times are the farmer's wall clock. Convert
  // once, then compare like with like (I-109).
  const int localMinute =
      fw::farmLocalMinuteOfDay(now.hour() * 60 + now.minute(), farmOffsetMinutes);
  const int localHour = localMinute / 60;
  const int localMinuteOfHour = localMinute % 60;

  for (int i = 0; i < feedTimesCount; i++) {
    if (!feedTimes[i].firedToday &&
        feedTimes[i].hour == localHour &&
        feedTimes[i].minute == localMinuteOfHour) {
      feedTimes[i].firedToday = true;
      dispenseFeed(cachedScheduledGrams, "scheduled");
    }
  }
}

// Apply the flat fields of the pre-1.7.0 contract (an older server sends no
// `config` object). Every value was already validated against the envelope by
// validateServerConfig(), so direct assignment cannot leave the window.
void applyLegacyDeviceValues(const JsonDocument &doc, const char *source) {
  if (doc["grams_per_feeding"].is<float>()) {
    deviceConfig.gramsPerFeeding = doc["grams_per_feeding"];
  }
  if (doc["button_feed_grams"].is<float>()) {
    const float value = doc["button_feed_grams"];
    if (value > 0) deviceConfig.buttonFeedGrams = value;
  }
  if (doc["hopper_full_cm"].is<float>()) {
    const float value = doc["hopper_full_cm"];
    if (value > 0) deviceConfig.hopperFullCm = value;
  }
  if (doc["hopper_empty_cm"].is<float>()) {
    const float value = doc["hopper_empty_cm"];
    if (value > 0) deviceConfig.hopperEmptyCm = value;
  }
  if (doc["grams_per_second"].is<float>()) {
    applyGramsPerSecond(doc["grams_per_second"] | gramsPerSecond, source);
  }
  if (doc["temp_offset_c"].is<float>()) {
    deviceConfig.tempOffsetC = doc["temp_offset_c"];
  }
  // Recompute the derived per-dose ceiling and the hopper filter from the
  // values just applied (a legacy server can change grams_per_second, which
  // changes grams-per-dose; nothing here resets state).
  applyConfigToRuntime();
}

// ==================== Tier 2 — Dashboard poll ====================

void pollDashboardFeedCommand() {
  if (!apiIdentityAvailable()) return;
  if (WiFi.status() != WL_CONNECTED) return;
  const unsigned long now = millis();
  if (!feedPollRetry.ready(now)) return;   // exponential backoff + jitter after a failure

  const String url = buildDeviceUrl(FEED_POLL_URL_BASE);
  HTTPClient https;
  kickWatchdog();
  if (!beginHttps(https, url.c_str())) {
    feedPollRetry.recordFailure(millis(), netJitter());
    return;
  }
  https.addHeader("X-Device-Token", provisionedDeviceToken);
  int code = https.GET();
  kickWatchdog();
  if (code == 200) {
    feedPollRetry.recordSuccess();
    // A freshly installed OTA image proves itself with one authenticated 200
    // from this poll (the health check also needs WiFi and a valid clock).
    otaHealthSawPoll = true;
    JsonDocument doc;
    if (!deserializeJson(doc, https.getString())) {
      // The farm offset is top-level in every response, independent of the
      // versioned `config` object below.
      applyFarmOffset(doc["farm_offset_minutes"], "feed-command");
      if (!validateServerConfig(doc)) {
        // N9: ignore the whole config when any pushed value is out of range.
        Serial.println("[POLL] invalid config from server — ignoring whole response");
      } else {
        // 1.7.0: the versioned `config` object is the source of truth. A
        // missing object means an older server, whose flat fields below are the
        // whole contract. Any malformed/out-of-range object keeps last-good.
        const fw::ConfigStatus configStatus = applyServerConfig(doc, "feed-command");
        if (configStatus == fw::ConfigStatus::MISSING) {
          applyLegacyDeviceValues(doc, "feed-command");
        } else if (!fw::configStatusOk(configStatus)) {
          Serial.printf("[POLL] config ignored (%s) — last-good kept\n",
                        fw::configStatusName(configStatus));
        }
        // The caches mirror the applied configuration, whichever path was used.
        cachedScheduledGrams = deviceConfig.gramsPerFeeding;
        cachedButtonFeedGrams = deviceConfig.buttonFeedGrams;
        // Writes only when a value differs, so a 5 s poll costs no flash.
        persistScheduleState();
        bool requested = doc["feed_requested"] | false;
        if (requested) {
          float grams = doc["grams"] | DEFAULT_MANUAL_GRAMS;
          String requestId = doc["feed_request_id"] | "";
          bool calibration = doc["calibration"] | false;
          dispenseFeed(grams, calibration ? "calibration" : "dashboard", requestId, calibration);
        }
      }
    }
  } else {
    // A timeout, a 5xx or a TLS failure: back off instead of hammering the
    // endpoint every 5 s for as long as the outage lasts.
    feedPollRetry.recordFailure(millis(), netJitter());
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
  if (!apiIdentityAvailable()) return;
  if (WiFi.status() != WL_CONNECTED) return;
  const unsigned long now = millis();
  if (!scheduleRetry.ready(now)) return;   // backoff after a failure

  const String url = buildDeviceUrl(SCHEDULE_SYNC_URL_BASE);
  HTTPClient https;
  kickWatchdog();
  if (!beginHttps(https, url.c_str())) {
    scheduleRetry.recordFailure(millis(), netJitter());
    return;
  }
  https.addHeader("X-Device-Token", provisionedDeviceToken);
  int code = https.GET();
  kickWatchdog();
  if (code == 200) {
    scheduleRetry.recordSuccess();
    // Schedule payloads are larger than the feed-command ones (times, counts,
    // rates); JsonDocument grows on demand, so no capacity constant is needed.
    JsonDocument doc;
    if (!deserializeJson(doc, https.getString())) {
      // The farm offset is top-level in every response (the maintenance window
      // and the schedule comparison both use it).
      applyFarmOffset(doc["farm_offset_minutes"], "schedule-sync");
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

          // Also update scheduled grams if feeding_rate_pct provided. With a
          // 1.7.0 config object in force the flat fields are ignored, so the
          // two paths can never disagree.
          if (!configFromServer) applyLegacyDeviceValues(doc, "schedule-sync");
          cachedScheduledGrams = deviceConfig.gramsPerFeeding;
          cachedButtonFeedGrams = deviceConfig.buttonFeedGrams;
          // Persist the new schedule and any dose change (writes only on
          // difference), so the next power cycle keeps them.
          persistScheduleState();

          // Ack the schedule change
          String commandId = doc["command_id"] | "";
          if (commandId.length() > 0) {
            postScheduleAck(commandId);
          }
        }
      }
    }
  } else {
    scheduleRetry.recordFailure(millis(), netJitter());
  }
  https.end();
}

void postScheduleAck(const String &commandId) {
  if (!apiIdentityAvailable()) return;
  const unsigned long now = millis();
  if (!ackRetry.ready(now)) return;
  if (!ackEventBucket.tryConsume(now)) {
    Serial.println("[SCHEDULE ACK] rate-limited");
    return;
  }
  HTTPClient https;
  kickWatchdog();
  if (!beginHttps(https, INGEST_URL)) {
    ackRetry.recordFailure(millis(), netJitter());
    return;
  }
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
  kickWatchdog();
  if (code >= 200 && code < 300) {
    ackRetry.recordSuccess();
  } else {
    ackRetry.recordFailure(millis(), netJitter());
  }
  Serial.printf("[SCHEDULE ACK] command %s -> %d\n", commandId.c_str(), code);
}

// ==================== Tier 3 — Physical button ====================

// Falling-edge ISR. Unlike the old loop poll, this cannot miss a short press
// while loop() is inside a blocking HTTPS call. millis() and the portMUX
// critical section are ISR-safe on the ESP32.
//
// Since 1.5.3 this only records a *candidate*: a microsecond spike on the long,
// internally pulled-up button line looks exactly like a falling edge inside an
// interrupt. handleButton() confirms a real press by sampling the pin.
void IRAM_ATTR onFeedButtonPress() {
  const unsigned long now = millis();
  if (now < (unsigned long)deviceConfig.buttonStartupGraceMs) return;  // boot grace
  if (now - feedButtonLastEdgeMs < (unsigned long)deviceConfig.buttonDebounceMs) return;
  feedButtonLastEdgeMs = now;
  portENTER_CRITICAL_ISR(&feedButtonMux);
  feedButtonPressQueued = true;   // at most one pending press, ever
  portEXIT_CRITICAL_ISR(&feedButtonMux);
}

bool takeQueuedFeedButtonPress() {
  bool pressed = false;
  portENTER_CRITICAL(&feedButtonMux);
  if (feedButtonPressQueued) {
    feedButtonPressQueued = false;
    pressed = true;
  }
  portEXIT_CRITICAL(&feedButtonMux);
  return pressed;
}

void discardQueuedFeedButtonPress() {
  portENTER_CRITICAL(&feedButtonMux);
  feedButtonPressQueued = false;
  portEXIT_CRITICAL(&feedButtonMux);
}

// True from relay ON until 2 s after relay OFF, whatever started the dispense.
bool buttonQuietWindowActive() {
  if (feederActive) return true;
  return (long)(millis() - dispenseQuietUntilMs) < 0;
}

// Rate limiter for the diagnostic button lines: the first call in a window logs,
// later ones stay silent. Unsigned subtraction stays correct across a wrap.
bool buttonLogDue(unsigned long &lastMs) {
  const unsigned long now = millis();
  if (lastMs != 0 && now - lastMs < (unsigned long)deviceConfig.buttonLogIntervalMs) return false;
  lastMs = now;
  return true;
}

// Samples GPIO 23 for 50 ms after a candidate edge. Accepts the press only when
// the line stays LOW: every sample, or at least 90 % of them if one is missed at
// release. `lowMs` reports how long the line was observed LOW (diagnostics).
bool confirmFeedButtonPress(unsigned long &lowMs) {
  const unsigned long startedMs = millis();
  uint8_t lowSamples = 0;
  unsigned long lastLowAtMs = 0;
  for (uint8_t i = 0; i < BUTTON_CONFIRM_SAMPLES; i++) {
    if (digitalRead(BUTTON_PIN) == LOW) {
      lowSamples++;
      lastLowAtMs = millis() - startedMs;
    }
    delay(BUTTON_CONFIRM_SAMPLE_MS);
  }
  kickWatchdog();   // 50 ms is far inside the 30 s task watchdog; be explicit
  lowMs = lowSamples ? lastLowAtMs : 0;
  return lowSamples >= BUTTON_CONFIRM_MIN_LOW_SAMPLES;
}

// The one path a confirmed button press takes to the relay. The 30 s cooldown is
// armed only when a dispense actually starts, so a refusal (daily cap, OTA
// probation) does not lock the button for 30 s.
bool requestButtonDispense() {
  if (buttonCooldownArmed &&
      (millis() - lastButtonDispenseMs) < (unsigned long)deviceConfig.buttonCooldownMs) {
    Serial.println("[BUTTON] cooldown");
    return false;
  }
  const bool wasActive = feederActive;
  dispenseFeed(cachedButtonFeedGrams, "button");
  const bool started = !wasActive && feederActive;
  if (started) {
    lastButtonDispenseMs = millis();
    buttonCooldownArmed = true;
  }
  return started;
}

// A queued press is evaluated on the next loop pass. The shared dispense mutex
// still drops it if the relay is busy.
void handleButton() {
  const unsigned long now = millis();

  // A line that keeps producing rejected edges is faulty, not pressed. More than
  // five glitches in a minute disables the button for ten minutes; the heartbeat
  // reports button_disabled so the fleet view can show it.
  if (buttonNoise.disabled(now)) {
    if (!buttonWasDisabled) {
      buttonWasDisabled = true;
      Serial.printf("[BUTTON] disabled for %lu s: noisy line\n", (unsigned long)deviceConfig.buttonDisableMs / 1000UL);
    }
    if (takeQueuedFeedButtonPress() && buttonLogDue(lastDisabledLogMs)) {
      Serial.println("[BUTTON] disabled: noisy line");
    }
    return;
  }
  if (buttonWasDisabled) {
    buttonWasDisabled = false;
    Serial.println("[BUTTON] re-enabled after the noise window");
  }

  // Relay ON .. 2 s after OFF: clear the candidate instead of dispensing it
  // late. This is what breaks the phantom-feed pattern: the relay/motor
  // switching off used to register as a fresh button press ~20 s later.
  if (buttonQuietWindowActive()) {
    if (takeQueuedFeedButtonPress() && buttonLogDue(lastQuietLogMs)) {
      Serial.println("[BUTTON] ignored during/after dispense");
    }
    return;
  }

  if (!takeQueuedFeedButtonPress()) return;

  unsigned long lowMs = 0;
  if (!confirmFeedButtonPress(lowMs)) {
    buttonGlitchCount++;
    buttonNoise.recordGlitch(millis());
    if (buttonNoise.justDisabled()) {
      buttonNoise.clearJustDisabled();
      Serial.printf("[BUTTON] disabled for %lu s: noisy line\n", (unsigned long)deviceConfig.buttonDisableMs / 1000UL);
      buttonWasDisabled = true;
    } else if (buttonLogDue(lastGlitchLogMs)) {
      Serial.printf("[BUTTON] rejected glitch (%lu ms low)\n", lowMs);
    }
    return;
  }

  requestButtonDispense();
}

// ==================== Feed level monitoring (HC-SR04) ====================

// Five samples, then the pure filter chain (range rejection, median, EMA,
// persistence, hysteresis). Returns false when this cycle is not plausible: the
// heartbeat then omits the level instead of reporting a fake 0 %.
bool readHopperLevel(float &percent, float &cm) {
  // Five samples per reading: an engineering constant, not a dashboard value
  // (the plausibility rules around them are configurable).
  float samples[5];
  bool anyEcho = false;
  for (int i = 0; i < 5; i++) {
    digitalWrite(TRIG_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);
    long duration = pulseIn(ECHO_PIN, HIGH, 30000);  // 30 ms timeout (~5 m)
    samples[i] = (duration == 0) ? -1.0f : (float)duration * 0.034f / 2.0f;
    if (duration != 0) anyEcho = true;
    delay(10);
  }
  recordHopperEcho(anyEcho);   // FAULT only when no sample echoes at all

  const fw::HopperFilter::Result result = hopperFilter.update(samples, 5, millis());
  if (!result.valid) {
    sensorInvalidCount++;
    return false;
  }
  if (result.stateChanged) {
    Serial.printf("[HOPPER] %s at %.0f%%\n", result.refilled ? "refilled" : "low", result.percent);
  }
  percent = result.percent;
  cm = result.cm;
  return true;
}

// ==================== Telemetry + offline event queue ====================

void enqueueEvent(float grams, const char* source, const String &requestId) {
  // Rate limit at the source. The dispense bucket is sized above the six-per-hour
  // ceiling, so a real feeding record is never dropped by this limit.
  if (!dispensedEventBucket.tryConsume(millis())) {
    queueDropCount++;
    Serial.println("[WARN] feed_dispensed event rate-limited — dropped");
    return;
  }

  int slot = -1;
  int oldestSlot = -1;
  uint32_t oldestSeq = 0;
  for (int i = 0; i < EVENT_QUEUE_SIZE; i++) {
    if (!eventQueue[i].used) {
      slot = i;
      break;
    }
    if (!eventQueue[i].synced && (oldestSlot < 0 || eventQueue[i].seq < oldestSeq)) {
      oldestSlot = i;
      oldestSeq = eventQueue[i].seq;
    }
  }
  if (slot < 0) {
    // Bounded queue: drop the oldest unsynced item, never the newest. The loss
    // is counted in the heartbeat (diag.queue_drops) and on the Serial line.
    queueDropCount++;
    if (oldestSlot < 0) {
      Serial.println("[WARN] event queue full — event dropped");
      return;
    }
    slot = oldestSlot;
    Serial.println("[WARN] event queue full — oldest event dropped");
  }

  eventQueue[slot].used = true;
  eventQueue[slot].synced = false;
  eventQueue[slot].seq = nextEventSequence++;
  eventQueue[slot].grams = grams;
  strncpy(eventQueue[slot].source, source, sizeof(eventQueue[slot].source) - 1);
  eventQueue[slot].source[sizeof(eventQueue[slot].source) - 1] = '\0';
  eventQueue[slot].requestId = requestId;
  eventQueue[slot].isoTimestamp = rtcAvailable ? getRTCiso8601() : "unknown";
  eventQueue[slot].eventId = generateEventId();  // id fixed at creation (Gap #2)
}

void flushQueuedEvents() {
  // Never replay a feed event without an identity: the server would reject it
  // and the event remains queued until the unit is provisioned.
  if (!apiIdentityAvailable() || WiFi.status() != WL_CONNECTED) return;
  if (!eventFlushRetry.ready(millis())) return;

  for (int i = 0; i < EVENT_QUEUE_SIZE; i++) {
    if (eventQueue[i].used && !eventQueue[i].synced) {
      if (postFeedEvent(eventQueue[i])) {
        eventQueue[i].synced = true;
        eventQueue[i].used = false;
      } else {
        // Back off the whole flush; the next attempt resends the same event_id.
        eventFlushRetry.recordFailure(millis(), netJitter());
        return;
      }
      kickWatchdog();  // progress between network posts — not a hang
    }
  }
  eventFlushRetry.recordSuccess();
}

bool postFeedEvent(QueuedEvent &ev) {
  if (!apiIdentityAvailable()) return false;
  HTTPClient https;
  kickWatchdog();
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
  // No API calls without a provisioned identity; local feeding is unaffected.
  if (!apiIdentityAvailable()) return;
  const unsigned long now = millis();
  if (!heartbeatRetry.ready(now)) return;   // backoff after a failed heartbeat
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient https;
  kickWatchdog();
  if (!beginHttps(https, INGEST_URL)) {
    heartbeatRetry.recordFailure(millis(), netJitter());
    return;
  }
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
  // 1.5.3: rejected button edges since boot. Zod strips unknown heartbeat keys,
  // so the ingest route accepts and ignores this field (no server change); the
  // same counter is named by the `[BUTTON] rejected glitch` Serial line.
  doc["button_glitches"]   = buttonGlitchCount;
  // 1.7.0: the revision of the configuration this unit has applied. An old
  // server strips the unknown key; the new ingest records a `config_applied`
  // state event when it changes, so ops can confirm the unit took a change.
  doc["config_rev"]        = appliedConfigRev;

  // 1.6.0 fail-safe state. Ingest strips keys its Zod schema does not declare
  // (verified by apps/web/lib/__tests__/ingest-route.test.ts), so these are
  // diagnostic until the server stores them; the analog values below
  // (feed_level_percent, water_temp_c) are still persisted as before.
  doc["safe_mode"]         = safeModeActive;
  doc["last_reset_reasons"] = lastResetReasons;
  JsonObject diag = doc["diag"].to<JsonObject>();
  diag["fw"] = FW_VERSION;
  diag["safe_mode"] = safeModeActive;
  diag["reset_abnormal_count"] = resetHistory.count();
  diag["reset_reason_mask"] = resetHistory.mask();
  diag["button_glitches"] = buttonGlitchCount;
  diag["button_disabled"] = buttonNoise.disabled(millis());
  diag["relay_overruns"] = relayOverruns;
  diag["sensor_invalid_count"] = sensorInvalidCount;
  diag["queue_drops"] = queueDropCount;
  // 1.8.0 FaultManager (bit n = fw::Fault n). Diagnostic only, like the rest.
  diag["faults_latched"] = faultManager.latchedMask();
  diag["faults_present"] = faultManager.presentMask();
  diag["last_fault"] = fw::faultName(faultManager.lastFault());
  diag["uptime_s"] = (millis() - bootTime) / 1000UL;
  diag["min_dispense_gap_s"] = (unsigned long)deviceConfig.minDispenseGapS;
  diag["max_dispenses_per_hour"] = (unsigned)deviceConfig.maxDispensesPerHour;
  diag["max_grams_per_day"] = deviceConfig.maxGramsPerDay;
  diag["max_grams_per_dose"] = fw::effectiveMaxGramsPerDose(deviceConfig);
  diag["config_rev"] = appliedConfigRev;
  diag["config_source"] = configFromServer ? "server" : (configLoadedFromNvs ? "nvs" : "default");
  diag["weak_after_min"] = (unsigned long)deviceConfig.weakAfterMin;
  diag["offline_after_min"] = (unsigned long)deviceConfig.offlineAfterMin;
  JsonObject refusals = diag["refusals_by_reason"].to<JsonObject>();
  for (uint8_t i = 1; i < (uint8_t)fw::Refusal::COUNT; i++) {
    if (refusalCounts[i] > 0) {
      refusals[fw::refusalReason((fw::Refusal)i)] = refusalCounts[i];
    }
  }

  // One hopper read per heartbeat. An implausible cycle is omitted (the server
  // keeps the last known level and shows it as stale) instead of sending 0 %.
  float hopperPercent = 0.0f;
  float hopperCm = 0.0f;
  if (readHopperLevel(hopperPercent, hopperCm)) {
    doc["feed_level_percent"] = hopperPercent;
    doc["feed_level_cm"] = hopperCm;
  }

  // Water temperature (DS18B20): reject the library's -127/85 sentinels and
  // anything outside 0..50 C. "Unknown" is an omitted value plus ok=false.
  tempSensor.requestTemperatures();
  const float rawTempC = tempSensor.getTempCByIndex(0);
  if (fw::temperaturePlausible(rawTempC)) {
    doc["water_temp_c"] = rawTempC + deviceConfig.tempOffsetC;
    doc["water_temp_ok"] = true;
  } else {
    doc["water_temp_ok"] = false;
    sensorInvalidCount++;
  }

  // Device health metrics
  doc["free_heap"] = ESP.getFreeHeap();
  doc["uptime_ms"] = millis() - bootTime;
  doc["reboot_count"] = rebootCount;
  doc["wifi_rssi"] = WiFi.RSSI();

  String out;
  serializeJson(doc, out);

  kickWatchdog();
  int code = https.POST(out);
  https.end();
  kickWatchdog();
  if (code >= 200 && code < 300) {
    heartbeatRetry.recordSuccess();
  } else {
    heartbeatRetry.recordFailure(millis(), netJitter());
  }
  Serial.printf("[POST] %d\n", code);
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
    // sleeping would leave it pending until the next reset. Never sleep during
    // a dispense either: the relay would stay energized with the CPU off, so
    // the motor is switched off first as a belt-and-braces measure.
    if (!provisioningActive && !otaHealthCheckActive && !feederActive && wifiRetryCount > 30) {
      Serial.println("[WiFi] prolonged failure — entering deep sleep for 5 minutes");
      digitalWrite(RELAY_PIN, RELAY_OFF);
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
  // RTClib reads the buffer as the format template and writes the result over
  // it. An uninitialized buffer produced garbage bytes in every timestamp, and
  // the server rejected those heartbeats and acks with 422 (found 2026-10-27).
  char buf[32] = "YYYY-MM-DDThh:mm:ss";
  now.toString(buf);
  return String(buf) + "+00:00";
}
