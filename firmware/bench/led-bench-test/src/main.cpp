/*
  PakaonAI indicator LEDs — bench test
  ------------------------------------
  Checks the four indicator LEDs before anything is soldered into the enclosure.
  No WiFi, no NVS, no feed logic.

  Amended wiring: the green FEEDING LED is no longer a firmware output. It is a
  parallel tap on the relay control line, so it lights whenever the relay is
  energised. Only the blue and yellow LEDs are driven by firmware.

    POWER    white   5 V rail            hardwired, always on
    FEEDING  green   relay control line  parallel tap (GPIO 5 on the CICT unit)
    WIFI     blue    GPIO 26             active HIGH
    FAULT    yellow  GPIO 18             active HIGH

  Sequence:
    1. Relay line HIGH for 2 s -> relay should click and the green LED light.
    2. Blue on 2 s.
    3. Yellow on 2 s.
    4. Relay + blue + yellow together for 3 s so all four can be compared.

  The relay is pulsed, so DISCONNECT THE PUMP FROM MAINS before running this.
  This is a throwaway bench artifact, not production firmware.
*/

#include <Arduino.h>

// The CICT Building A unit uses the `esp32dev-relay5` build (relay on GPIO 5).
// The reference wiring uses GPIO 25; build with -DBENCH_RELAY_PIN=25 for that.
#ifndef BENCH_RELAY_PIN
#define BENCH_RELAY_PIN 5
#endif

namespace {

constexpr uint8_t kRelayPin = BENCH_RELAY_PIN;
// Hold the other candidate inactive too, so a floating input cannot chatter a
// coil on a board wired the other way.
constexpr uint8_t kOtherRelayPin = (kRelayPin == 5) ? 25 : 5;

constexpr uint8_t kWifiLedPin = 26;
constexpr uint8_t kFaultLedPin = 18;

constexpr uint32_t kOnMs = 2000;
constexpr uint32_t kOffMs = 1000;
constexpr uint32_t kCompareMs = 3000;

void allOff() {
  digitalWrite(kRelayPin, LOW);
  digitalWrite(kWifiLedPin, LOW);
  digitalWrite(kFaultLedPin, LOW);
}

void relayOn(const char *note) {
  Serial.printf("[ON ] RELAY/GREEN  GPIO %u  %s\n", kRelayPin, note);
  digitalWrite(kRelayPin, HIGH);
}

void relayOff() {
  digitalWrite(kRelayPin, LOW);
  Serial.printf("[OFF] RELAY/GREEN  GPIO %u\n", kRelayPin);
}

}  // namespace

void setup() {
  // Before anything else: hold every relay candidate inactive.
  pinMode(kRelayPin, OUTPUT);
  digitalWrite(kRelayPin, LOW);
  pinMode(kOtherRelayPin, OUTPUT);
  digitalWrite(kOtherRelayPin, LOW);

  pinMode(kWifiLedPin, OUTPUT);
  pinMode(kFaultLedPin, OUTPUT);
  allOff();

  Serial.begin(115200);
  delay(200);

  Serial.println();
  Serial.println("PakaonAI indicator bench test (relay-tap FEEDING LED)");
  Serial.printf("Relay line: GPIO %u. Pump must be disconnected from mains.\n", kRelayPin);
  Serial.println("POWER (white) must be lit continuously: hardwired to 5 V.");
  Serial.println("If it is dark, stop and check the rail and its resistor.");
  Serial.println();
}

void loop() {
  relayOn("relay should click, green LED on");
  delay(kOnMs);
  relayOff();
  delay(kOffMs);

  Serial.println("[ON ] WIFI    blue   GPIO 26");
  digitalWrite(kWifiLedPin, HIGH);
  delay(kOnMs);
  digitalWrite(kWifiLedPin, LOW);
  Serial.println("[OFF] WIFI    blue   GPIO 26");
  delay(kOffMs);

  Serial.println("[ON ] FAULT   yellow GPIO 18");
  digitalWrite(kFaultLedPin, HIGH);
  delay(kOnMs);
  digitalWrite(kFaultLedPin, LOW);
  Serial.println("[OFF] FAULT   yellow GPIO 18");
  delay(kOffMs);

  Serial.println("[ALL] relay + blue + yellow for 3 s - compare brightness");
  relayOn("compare phase");
  digitalWrite(kWifiLedPin, HIGH);
  digitalWrite(kFaultLedPin, HIGH);
  delay(kCompareMs);
  allOff();
  Serial.println();
}
