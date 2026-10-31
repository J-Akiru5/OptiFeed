/*
  PakaonAI indicator LEDs — bench test
  ------------------------------------
  Flashes the three firmware-driven indicator LEDs in a fixed sequence so the
  wiring, polarity and brightness can be checked before anything is soldered
  into the enclosure. No WiFi, no NVS, no relay, no feed logic.

  Pin map matches the pin map in firmware/README.md on staging (firmware 1.6.0).
  All three GPIOs are unused by the production sketch:

    FEEDING  green   GPIO 27   active HIGH
    WIFI     blue    GPIO 26   active HIGH
    FAULT    yellow  GPIO 18   active HIGH
    POWER    white   3.3 V     hardwired, no firmware control

  Sequence per LED: 2 s ON, 1 s OFF, with a serial line naming the LED.
  After the sweep all three light together for 3 s so the colours can be
  compared side by side at the same drive current.

  This is a throwaway bench artifact, not production firmware.
*/

#include <Arduino.h>

namespace {

constexpr uint8_t kFeedLedPin = 27;
constexpr uint8_t kWifiLedPin = 26;
constexpr uint8_t kFaultLedPin = 18;

// The production board drives a relay from GPIO 25 (or GPIO 5 on the CICT
// build). A test sketch that leaves those pins floating can let the coil
// chatter, so both candidates are driven to the inactive level first. This
// assumes the active-HIGH field board documented in firmware/README.md.
// Disconnect the pump from mains before running any bench sketch.
constexpr uint8_t kRelayPins[] = {25, 5};

constexpr uint32_t kOnMs = 2000;
constexpr uint32_t kOffMs = 1000;
constexpr uint32_t kCompareMs = 3000;

struct Step {
  uint8_t pin;
  const char *label;
};

const Step kSteps[] = {
    {kFeedLedPin, "FEEDING  green   GPIO 27"},
    {kWifiLedPin, "WIFI     blue    GPIO 26"},
    {kFaultLedPin, "FAULT    yellow  GPIO 18"},
};

constexpr size_t kStepCount = sizeof(kSteps) / sizeof(kSteps[0]);

void allOff() {
  digitalWrite(kFeedLedPin, LOW);
  digitalWrite(kWifiLedPin, LOW);
  digitalWrite(kFaultLedPin, LOW);
}

}  // namespace

void setup() {
  // Before anything else: hold the relay control line inactive.
  for (size_t i = 0; i < sizeof(kRelayPins); i++) {
    pinMode(kRelayPins[i], OUTPUT);
    digitalWrite(kRelayPins[i], LOW);
  }

  Serial.begin(115200);
  delay(200);

  pinMode(kFeedLedPin, OUTPUT);
  pinMode(kWifiLedPin, OUTPUT);
  pinMode(kFaultLedPin, OUTPUT);
  allOff();

  Serial.println();
  Serial.println("PakaonAI indicator bench test");
  Serial.println("Relay control pins held LOW (inactive) for the whole run.");
  Serial.println("POWER (white) must be lit continuously: it is hardwired to 3.3 V.");
  Serial.println("If it is dark, stop and check the 3.3 V rail and its resistor.");
  Serial.println("Expected per LED: 2 s on, 1 s off. Watch colour and brightness.");
  Serial.println();
}

void loop() {
  for (size_t i = 0; i < kStepCount; i++) {
    Serial.printf("[ON ] %s\n", kSteps[i].label);
    digitalWrite(kSteps[i].pin, HIGH);
    delay(kOnMs);
    digitalWrite(kSteps[i].pin, LOW);

    Serial.printf("[OFF] %s\n", kSteps[i].label);
    delay(kOffMs);
  }

  Serial.println("[ALL] all three on for 3 s - compare brightness");
  digitalWrite(kFeedLedPin, HIGH);
  digitalWrite(kWifiLedPin, HIGH);
  digitalWrite(kFaultLedPin, HIGH);
  delay(kCompareMs);
  allOff();
  Serial.println();
}
