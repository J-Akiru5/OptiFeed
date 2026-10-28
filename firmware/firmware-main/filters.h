/*
  OptiFeed — pure sensor filters (firmware 1.6.0)
  ------------------------------------------------
  Arduino-free, header-only logic so it can be unit-tested on the host with
  `pio test -e native` (test/test_firmware_safety). Nothing here touches a pin,
  NVS, the network or the clock; callers pass samples and a millisecond stamp.

  Why this exists (docs/missions/2026-10-27-issues.md, I-41): the field unit
  reported a hopper reading that flapped 0 % <-> 47 % every 30-60 s with the
  motor off, and the DS18B20 occasionally returns its -127 / 85 sentinels. A
  single noisy echo must never become a percentage, an alert or a feeding
  decision.
*/
#pragma once

#include <math.h>
#include <stddef.h>
#include <stdint.h>

namespace fw {

// Median of `count` values. Returns false for an empty set and copies the
// median of the valid (non-NaN) values into `out`.
bool medianOf(const float *values, size_t count, float &out);

// DS18B20 plausibility for a water probe. Rejects the library sentinels
// (-127 disconnected, 85 power-on) and anything outside 0..50 C, which no
// pond this product serves can legitimately reach.
bool temperaturePlausible(float celsius);

/*
  Hopper chain: raw HC-SR04 distances -> range rejection -> median -> EMA ->
  percentage -> persistence gate -> Schmitt state with a hold time.

  - Range rejection: a sample below `rejectBelowCm` (an echo off the cone or a
    zero-length pulse) or above `emptyCm + rejectAboveMarginCm` is discarded.
    Fewer than three plausible samples in a cycle is "unknown": the previous
    smoothed state is kept and `valid` is false, so the caller omits the level
    instead of sending 0 %.
  - EMA: `emaAlpha` per cycle on the distance, so one bad-but-plausible echo
    moves the reading by at most a third.
  - Persistence: a change larger than `jumpPct` percentage points is accepted
    only after `persistCycles` consecutive cycles agree.
  - Hysteresis: a unit enters the low state at or below `lowPct` and leaves it
    only above `lowPct + refillMarginPct`. While low, the reported percentage is
    capped at `lowPct`, so the server cannot see a "refill" (or a warning) from
    a value inside the band.
  - Hold: a state change needs `stateHoldMs` since the previous one, which is
    what stops the 30-60 s flapping seen on the CICT unit. During the hold the
    reported value stays in the previous band; under-reporting the feed level
    is the safe direction.
*/
class HopperFilter {
 public:
  struct Config {
    float emptyCm;             // sensor distance at 0 %
    float fullCm;              // sensor distance at 100 %
    float rejectBelowCm;       // shorter than this is not a real echo
    float rejectAboveMarginCm; // longer than emptyCm + this is not a real echo
    float emaAlpha;            // 0..1, weight of a new median
    float jumpPct;             // a bigger change must persist
    uint8_t persistCycles;     // cycles required before a big change is kept
    float lowPct;              // warning threshold (org default 20 %)
    float refillMarginPct;     // leave low only above lowPct + this
    unsigned long stateHoldMs; // minimum time between two state changes
    Config()
        : emptyCm(30.0f),
          fullCm(5.0f),
          rejectBelowCm(2.0f),
          rejectAboveMarginCm(10.0f),
          emaAlpha(0.35f),
          jumpPct(15.0f),
          persistCycles(3),
          lowPct(20.0f),
          refillMarginPct(10.0f),
          stateHoldMs(10UL * 60UL * 1000UL) {}
  };

  struct Result {
    bool valid;         // this cycle had enough plausible samples
    float cm;           // smoothed distance (last valid state)
    float percent;      // value to report (hysteresis and hold applied)
    bool low;           // current alert state
    bool stateChanged;  // OK -> low or low -> OK on this cycle
    bool refilled;      // stateChanged and the new state is not low
  };

  HopperFilter();
  void configure(const Config &config);
  const Config &config() const;
  void reset();

  // `samples` may contain -1 for a failed echo; rejection happens here.
  Result update(const float *samples, size_t count, unsigned long nowMs);

  bool hasReading() const;

 private:
  float percentFromCm(float cm) const;

  Config cfg_;
  bool hasReading_;
  float emaCm_;
  bool hasStable_;
  float stablePct_;
  float lastPct_;
  bool pendingActive_;
  float pendingPct_;
  uint8_t pendingCount_;
  bool low_;
  unsigned long lastTransitionMs_;
};

// ---------------------------------------------------------------------------
// Inline implementations (header-only: one copy for the sketch and the tests).
// ---------------------------------------------------------------------------

inline bool medianOf(const float *values, size_t count, float &out) {
  if (values == nullptr || count == 0) return false;
  // Insertion sort into a small local buffer; counts here are 5-9 samples.
  float sorted[16];
  size_t used = 0;
  for (size_t i = 0; i < count && used < sizeof(sorted) / sizeof(sorted[0]); i++) {
    const float v = values[i];
    if (isnan(v) || isinf(v)) continue;
    size_t j = used;
    while (j > 0 && sorted[j - 1] > v) {
      sorted[j] = sorted[j - 1];
      j--;
    }
    sorted[j] = v;
    used++;
  }
  if (used == 0) return false;
  out = sorted[used / 2];
  return true;
}

inline bool temperaturePlausible(float celsius) {
  if (isnan(celsius) || isinf(celsius)) return false;
  return celsius > 0.0f && celsius < 50.0f;
}

inline HopperFilter::HopperFilter() { reset(); }

inline void HopperFilter::configure(const Config &config) {
  cfg_ = config;
}

inline const HopperFilter::Config &HopperFilter::config() const { return cfg_; }

inline void HopperFilter::reset() {
  hasReading_ = false;
  emaCm_ = 0.0f;
  hasStable_ = false;
  stablePct_ = 0.0f;
  lastPct_ = 0.0f;
  pendingActive_ = false;
  pendingPct_ = 0.0f;
  pendingCount_ = 0;
  low_ = false;
  lastTransitionMs_ = 0;
}

inline bool HopperFilter::hasReading() const { return hasReading_; }

inline float HopperFilter::percentFromCm(float cm) const {
  if (cm >= cfg_.emptyCm) return 0.0f;
  if (cm <= cfg_.fullCm) return 100.0f;
  const float span = cfg_.emptyCm - cfg_.fullCm;
  if (span <= 0.0f) return 0.0f;
  float pct = ((cfg_.emptyCm - cm) / span) * 100.0f;
  if (pct < 0.0f) pct = 0.0f;
  if (pct > 100.0f) pct = 100.0f;
  return pct;
}

inline HopperFilter::Result HopperFilter::update(const float *samples, size_t count,
                                                 unsigned long nowMs) {
  Result result;
  result.valid = false;
  result.cm = hasReading_ ? emaCm_ : 0.0f;
  result.percent = hasStable_ ? stablePct_ : 0.0f;
  result.low = low_;
  result.stateChanged = false;
  result.refilled = false;

  // 1. Reject implausible echoes before they can influence the median.
  float plausible[16];
  size_t plausibleCount = 0;
  const float upper = cfg_.emptyCm + cfg_.rejectAboveMarginCm;
  for (size_t i = 0; i < count && plausibleCount < sizeof(plausible) / sizeof(plausible[0]); i++) {
    const float v = samples[i];
    if (isnan(v) || isinf(v) || v < 0.0f) continue;
    if (v < cfg_.rejectBelowCm || v > upper) continue;
    plausible[plausibleCount++] = v;
  }
  if (plausibleCount < 3) {
    // Unknown, not 0 %: keep the last good state for the next cycle.
    return result;
  }

  float medianCm = 0.0f;
  if (!medianOf(plausible, plausibleCount, medianCm)) return result;

  // 2. EMA on the distance.
  if (!hasReading_) {
    emaCm_ = medianCm;
    hasReading_ = true;
  } else {
    float alpha = cfg_.emaAlpha;
    if (!(alpha > 0.0f && alpha <= 1.0f)) alpha = 0.35f;
    emaCm_ = alpha * medianCm + (1.0f - alpha) * emaCm_;
  }
  const float pct = percentFromCm(emaCm_);

  // 3. Persistence: a large change must repeat before it is believed.
  if (!hasStable_) {
    hasStable_ = true;
    stablePct_ = pct;
    lastPct_ = pct;
    low_ = pct <= cfg_.lowPct;
    lastTransitionMs_ = nowMs;
  } else if (fabsf(pct - stablePct_) > cfg_.jumpPct) {
    if (!pendingActive_ || fabsf(pct - lastPct_) > cfg_.jumpPct) {
      pendingActive_ = true;
      pendingPct_ = pct;
      pendingCount_ = 1;
    } else {
      pendingPct_ = pct;
      if (pendingCount_ < 255) pendingCount_++;
    }
    if (pendingCount_ >= (cfg_.persistCycles == 0 ? 1 : cfg_.persistCycles)) {
      stablePct_ = pendingPct_;
      pendingActive_ = false;
      pendingCount_ = 0;
    }
  } else {
    stablePct_ = pct;
    pendingActive_ = false;
    pendingCount_ = 0;
  }
  lastPct_ = pct;

  // 4. Schmitt state with a hold time.
  const bool holdElapsed = (nowMs - lastTransitionMs_) >= cfg_.stateHoldMs;
  if (!low_) {
    if (stablePct_ <= cfg_.lowPct && holdElapsed) {
      low_ = true;
      lastTransitionMs_ = nowMs;
      result.stateChanged = true;
    }
  } else {
    if (stablePct_ > cfg_.lowPct + cfg_.refillMarginPct && holdElapsed) {
      low_ = false;
      lastTransitionMs_ = nowMs;
      result.stateChanged = true;
      result.refilled = true;
    }
  }

  // 5. Report inside the current band: while low the value may not creep above
  // the threshold, so the server cannot fabricate a refill (or a warning) from
  // a reading that never really left the band.
  float reported = stablePct_;
  if (low_ && reported > cfg_.lowPct) reported = cfg_.lowPct;

  result.valid = true;
  result.cm = emaCm_;
  result.percent = reported;
  result.low = low_;
  return result;
}

}  // namespace fw
