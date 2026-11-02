/*
  Hardware variant identity (issue #582)
  --------------------------------------
  The relay GPIO is a property of the physical unit, not of the board alone:
  the CICT Building A feeder is wired to GPIO 5 while the reference build uses
  GPIO 25. A binary built for the other pin still boots, heartbeats and reports
  feeds, but the relay never closes - a silent physical failure.

  Every PlatformIO environment therefore names its variant explicitly:

    [env:esp32dev-gpio5]   -DRELAY_PIN=5  -DFW_HW_VARIANT="gpio5"
    [env:esp32dev-gpio25]  -DRELAY_PIN=25 -DFW_HW_VARIANT="gpio25"

  firmware-main.ino static_asserts that the two agree, and the signed OTA
  manifest carries both `variant` and `relay_gpio`. A unit refuses a release
  whose pair does not match the variant provisioned into its own image.

  Arduino-free and constexpr so the mapping is usable at compile time and in
  the host test suite (`pio test -d firmware -e native`).
*/
#pragma once

#include <string.h>

namespace fw {

/** constexpr strcmp for the small, fixed variant names used here. */
constexpr bool sameVariantName(const char *a, const char *b) {
  return *a == *b && (*a == '\0' || sameVariantName(a + 1, b + 1));
}

/** Relay GPIO for a variant name, or -1 when the name is unknown. */
constexpr int relayPinForVariant(const char *variant) {
  // One return expression so the sketch also compiles under the core's
  // C++11-style constexpr rules.
  return variant == nullptr ? -1
       : sameVariantName(variant, "gpio5") ? 5
       : sameVariantName(variant, "gpio25") ? 25
       : -1;
}

/** Variant name for a relay GPIO, or nullptr when the pin is not supported. */
constexpr const char *variantForRelayPin(int pin) {
  return pin == 5 ? "gpio5"
       : pin == 25 ? "gpio25"
       : nullptr;
}

/**
 * True only when a signed OTA manifest targets exactly this hardware.
 *
 * Both halves are required: a manifest that says `gpio5` but declares relay
 * GPIO 25 (or the reverse) is malformed and is refused, even if one field
 * happens to match. Unknown variant names never match.
 */
inline bool otaMatchesHardware(const char *manifestVariant, int manifestRelayGpio,
                               const char *provisionedVariant, int provisionedRelayGpio) {
  if (manifestVariant == nullptr || provisionedVariant == nullptr) return false;
  if (manifestRelayGpio != provisionedRelayGpio) return false;
  if (!sameVariantName(manifestVariant, provisionedVariant)) return false;
  // The pair must also be internally consistent with the known pin map.
  return relayPinForVariant(manifestVariant) == manifestRelayGpio;
}

}  // namespace fw
