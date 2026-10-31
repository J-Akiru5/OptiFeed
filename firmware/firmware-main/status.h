/*
  PakaonAI — machine status interface (firmware 1.8.0)
  -----------------------------------------------------
  Arduino-free, header-only logic for the four panel indicators and the
  central fault manager. Unit-tested on the host with `pio test -e native`.

    POWER   (white)  solid: control power available
    FEEDING (green)  solid: the relay is actually energized
    WI-FI   (blue)   solid: joined the configured network; blink: setup portal
    FAULT   (yellow) solid: at least one latched fault; off: none

  Wi-Fi loss is never a fault (scheduled feeding runs offline) and a low hopper
  is a server-side warning, not a fault. The FAULT lamp is an operator notice,
  not a safety interlock: the relay limits in safety.h stay the only interlock.
*/
#pragma once

#include <stdint.h>

namespace fw {

// ---------------------------------------------------------------------------
// Detectable faults on the current hardware (ESP32, DS3231, HC-SR04, relay,
// 12 V motor). A jammed auger or a welded relay needs motor-current sensing or
// relay feedback, which this hardware does not have.
// ---------------------------------------------------------------------------
enum class Fault : uint8_t {
  NONE = 0,
  HOPPER_SENSOR,   // HC-SR04: no echo for several consecutive checks
  RTC,             // DS3231 not found at boot or not answering on I2C
  RELAY_OVERRUN,   // a dose ran past its expected end + grace (timing trip)
  SAFE_MODE,       // repeated abnormal resets locked the relay off
  COUNT,
};

inline const char *faultName(Fault fault) {
  switch (fault) {
    case Fault::HOPPER_SENSOR: return "hopper_sensor";
    case Fault::RTC: return "rtc";
    case Fault::RELAY_OVERRUN: return "relay_overrun";
    case Fault::SAFE_MODE: return "safe_mode";
    default: return "none";
  }
}

inline uint8_t faultBit(Fault fault) { return (uint8_t)(1u << (uint8_t)fault); }

// ---------------------------------------------------------------------------
// A health check that must fail `threshold` times in a row before it counts,
// and recovers on the first pass. Stops one lost echo lighting the lamp.
// ---------------------------------------------------------------------------
class FaultDebounce {
 public:
  void configure(uint8_t threshold) { threshold_ = threshold ? threshold : 1; }

  // Returns true while the condition counts as faulted.
  bool update(bool ok) {
    if (ok) {
      failures_ = 0;
    } else if (failures_ < threshold_) {
      failures_++;
    }
    return failures_ >= threshold_;
  }

  bool faulted() const { return failures_ >= threshold_; }

 private:
  uint8_t threshold_ = 1;
  uint8_t failures_ = 0;
};

// ---------------------------------------------------------------------------
// Central fault manager. A fault is *present* while its cause exists and
// *latched* from the first report until the operator acknowledges it after the
// cause is gone. An acknowledgement never clears a fault that is still present,
// and clearing a fault never resumes an interrupted dose.
// ---------------------------------------------------------------------------
class FaultManager {
 public:
  // Report the current state of one condition. Returns true when this call
  // raised a new fault (not already latched), so the caller logs it once.
  bool report(Fault fault, bool present, uint32_t epoch, unsigned long nowMs) {
    if (fault == Fault::NONE || fault >= Fault::COUNT) return false;
    const uint8_t bit = faultBit(fault);
    if (!present) {
      presentMask_ &= (uint8_t)~bit;
      return false;
    }
    const bool wasPresent = (presentMask_ & bit) != 0;
    const bool raised = (latchedMask_ & bit) == 0;
    presentMask_ |= bit;
    latchedMask_ |= bit;
    if (!wasPresent && counts_[(uint8_t)fault] < UINT16_MAX) counts_[(uint8_t)fault]++;
    if (raised || !wasPresent) {
      lastFault_ = fault;
      lastEpoch_ = epoch;
      lastMs_ = nowMs;
    }
    return raised;
  }

  // A one-shot event (no lasting condition), e.g. a relay overrun trip.
  bool raiseEvent(Fault fault, uint32_t epoch, unsigned long nowMs) {
    const bool raised = report(fault, true, epoch, nowMs);
    report(fault, false, epoch, nowMs);
    return raised;
  }

  // Operator acknowledgement: clears every latched fault whose cause is gone.
  // Returns the mask of faults cleared (0 when nothing could be cleared).
  uint8_t acknowledge() {
    const uint8_t cleared = latchedMask_ & (uint8_t)~presentMask_;
    latchedMask_ &= presentMask_;
    return cleared;
  }

  bool indicatorOn() const { return latchedMask_ != 0; }
  bool latched(Fault fault) const { return (latchedMask_ & faultBit(fault)) != 0; }
  bool present(Fault fault) const { return (presentMask_ & faultBit(fault)) != 0; }
  uint8_t latchedMask() const { return latchedMask_; }
  uint8_t presentMask() const { return presentMask_; }
  uint16_t count(Fault fault) const {
    return fault < Fault::COUNT ? counts_[(uint8_t)fault] : 0;
  }
  Fault lastFault() const { return lastFault_; }
  uint32_t lastEpoch() const { return lastEpoch_; }     // 0 without a valid clock
  unsigned long lastMs() const { return lastMs_; }

 private:
  uint8_t presentMask_ = 0;
  uint8_t latchedMask_ = 0;
  uint16_t counts_[(uint8_t)Fault::COUNT] = {};
  Fault lastFault_ = Fault::NONE;
  uint32_t lastEpoch_ = 0;
  unsigned long lastMs_ = 0;
};

// ---------------------------------------------------------------------------
// Indicator levels. Pure, so the lamp rules are tested without a board.
// ---------------------------------------------------------------------------
struct IndicatorInputs {
  bool feeding;          // relay energized right now
  bool wifiConnected;    // WiFi.status() == WL_CONNECTED
  bool provisioning;     // setup portal (SoftAP) running
  bool fault;            // FaultManager::indicatorOn()
};

struct IndicatorLevels {
  bool power;
  bool feeding;
  bool wifi;
  bool fault;
};

inline IndicatorLevels indicatorLevels(const IndicatorInputs &in, unsigned long nowMs,
                                       unsigned long blinkPeriodMs) {
  IndicatorLevels out;
  out.power = true;
  out.feeding = in.feeding;
  // Provisioning wins: the portal's join test may connect the station briefly,
  // but the unit is still in setup until it reboots onto the saved network.
  if (in.provisioning) {
    const unsigned long half = blinkPeriodMs / 2 ? blinkPeriodMs / 2 : 1;
    out.wifi = ((nowMs / half) % 2) == 0;
  } else {
    out.wifi = in.wifiConnected;
  }
  out.fault = in.fault;
  return out;
}

}  // namespace fw
