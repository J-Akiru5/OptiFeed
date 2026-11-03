/*
  Native (host) tests for the hardware variant contract (issue #582).

  Run with:  pio test -d firmware -e native
  No board, no network, no database. These tests prove the variant <-> relay
  pin map is total and that a signed OTA manifest for the other wiring is
  rejected, which is the refusal the field unit relies on.
*/
#include <unity.h>

#include <stddef.h>

#include "../../firmware-main/hardware.h"

using namespace fw;

// The map must also be usable at compile time: firmware-main.ino static_asserts
// the current environment against it.
static_assert(relayPinForVariant("gpio5") == 5, "gpio5 must map to relay GPIO 5");
static_assert(relayPinForVariant("gpio25") == 25, "gpio25 must map to relay GPIO 25");
static_assert(relayPinForVariant("gpio99") == -1, "unknown variants must not map");

void setUp(void) {}
void tearDown(void) {}

void test_variant_names_map_to_their_relay_pin(void) {
  TEST_ASSERT_EQUAL_INT(5, relayPinForVariant("gpio5"));
  TEST_ASSERT_EQUAL_INT(25, relayPinForVariant("gpio25"));
  TEST_ASSERT_EQUAL_INT(-1, relayPinForVariant(""));
  TEST_ASSERT_EQUAL_INT(-1, relayPinForVariant("GPIO5"));
  TEST_ASSERT_EQUAL_INT(-1, relayPinForVariant("gpio12"));
  TEST_ASSERT_EQUAL_INT(-1, relayPinForVariant(nullptr));
}

void test_relay_pins_map_back_to_one_variant(void) {
  TEST_ASSERT_EQUAL_STRING("gpio5", variantForRelayPin(5));
  TEST_ASSERT_EQUAL_STRING("gpio25", variantForRelayPin(25));
  TEST_ASSERT_NULL(variantForRelayPin(12));
  TEST_ASSERT_NULL(variantForRelayPin(-1));
}

void test_exact_variant_and_pin_are_accepted(void) {
  TEST_ASSERT_TRUE(otaMatchesHardware("gpio5", 5, "gpio5", 5));
  TEST_ASSERT_TRUE(otaMatchesHardware("gpio25", 25, "gpio25", 25));
}

void test_other_variant_is_rejected(void) {
  // The field failure: a GPIO 25 image offered to the GPIO 5 unit.
  TEST_ASSERT_FALSE(otaMatchesHardware("gpio25", 25, "gpio5", 5));
  TEST_ASSERT_FALSE(otaMatchesHardware("gpio5", 5, "gpio25", 25));
}

void test_variant_pin_disagreement_is_rejected(void) {
  // Even a manifest that names the right variant is refused when its pin is
  // for another wiring: the signed pair must be internally consistent.
  TEST_ASSERT_FALSE(otaMatchesHardware("gpio5", 25, "gpio5", 5));
  TEST_ASSERT_FALSE(otaMatchesHardware("gpio25", 5, "gpio25", 25));
  TEST_ASSERT_FALSE(otaMatchesHardware("gpio5", 5, "gpio5", 25));
}

void test_missing_or_unknown_variant_is_rejected(void) {
  TEST_ASSERT_FALSE(otaMatchesHardware("", -1, "gpio5", 5));
  TEST_ASSERT_FALSE(otaMatchesHardware("gpio30", 30, "gpio5", 5));
  TEST_ASSERT_FALSE(otaMatchesHardware(nullptr, 5, "gpio5", 5));
  TEST_ASSERT_FALSE(otaMatchesHardware("gpio5", 5, nullptr, 5));
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_variant_names_map_to_their_relay_pin);
  RUN_TEST(test_relay_pins_map_back_to_one_variant);
  RUN_TEST(test_exact_variant_and_pin_are_accepted);
  RUN_TEST(test_other_variant_is_rejected);
  RUN_TEST(test_variant_pin_disagreement_is_rejected);
  RUN_TEST(test_missing_or_unknown_variant_is_rejected);
  return UNITY_END();
}
