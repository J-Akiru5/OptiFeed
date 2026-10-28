/*
  OptiFeed — pure safety logic (firmware 1.6.0)
  ---------------------------------------------
  Arduino-free, header-only logic for the dispense gate, reset history, safe
  mode, the button noise guard, per-type event rate limiting and HTTP retry
  backoff. Unit-tested on the host with `pio test -e native`.
*/
#pragma once

#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace fw {

// ---------------------------------------------------------------------------
// Refusal reasons. The string values are the `reason` field of the existing
// `feed_refused` ingest event (apps/web/app/api/ingest/route.ts), so every
// refusal stays in the server-side audit trail without a server change.
// ---------------------------------------------------------------------------
enum class Refusal : uint8_t {
  NONE = 0,
  SAFE_MODE,
  BROWNOUT_HOLD,
  OTA_IN_PROGRESS,
  OTA_PENDING_VERIFY,
  BUSY,
  GRAMS_OUT_OF_RANGE,
  DOSE_TOO_LONG,
  DAILY_CAP,
  TOO_SOON,
  HOURLY_LIMIT,
  RELAY_OVERRUN,
  COUNT,
};

inline const char *refusalReason(Refusal reason) {
  switch (reason) {
    case Refusal::SAFE_MODE: return "safe_mode";
    case Refusal::BROWNOUT_HOLD: return "brownout_hold";
    case Refusal::OTA_IN_PROGRESS: return "ota_in_progress";
    case Refusal::OTA_PENDING_VERIFY: return "ota_pending_verify";
    case Refusal::BUSY: return "busy";
    case Refusal::GRAMS_OUT_OF_RANGE: return "grams_out_of_range";
    case Refusal::DOSE_TOO_LONG: return "dose_time_exceeds_cap";
    case Refusal::DAILY_CAP: return "daily_gram_cap_exceeded";
    case Refusal::TOO_SOON: return "too_soon";
    case Refusal::HOURLY_LIMIT: return "hourly_limit";
    case Refusal::RELAY_OVERRUN: return "relay_overrun";
    default: return "none";
  }
}

// ---------------------------------------------------------------------------
// Dispense gate: one decision point for every source (button, schedule,
// dashboard) so a limit cannot be bypassed by picking another trigger.
// ---------------------------------------------------------------------------
struct DispenseLimits {
  unsigned long minGapMs;      // between any two dispenses, any source
  uint8_t maxPerHour;          // rolling hour, any source
  float maxGramsPerDose;
  float maxGramsPerDay;
  unsigned long maxDispenseMs;

  DispenseLimits()
      : minGapMs(10000UL),
        maxPerHour(6),
        maxGramsPerDose(1000.0f),
        maxGramsPerDay(5000.0f),
        maxDispenseMs(300000UL) {}
};

class DispenseGate {
 public:
  static const uint8_t kSlots = 8;

  DispenseGate() { reset(); }

  void configure(const DispenseLimits &limits) { limits_ = limits; }
  const DispenseLimits &limits() const { return limits_; }

  void reset() {
    count_ = 0;
    next_ = 0;
    for (uint8_t i = 0; i < kSlots; i++) starts_[i] = 0;
  }

  // Pure: no state change. Order matches the historical refusal reasons so an
  // existing log line keeps its meaning.
  Refusal evaluate(unsigned long nowMs, float grams, unsigned long durationMs,
                   float dailyGrams) const {
    if (!(grams > 0.0f) || grams > limits_.maxGramsPerDose) return Refusal::GRAMS_OUT_OF_RANGE;
    if (durationMs > limits_.maxDispenseMs) return Refusal::DOSE_TOO_LONG;
    if (dailyGrams + grams > limits_.maxGramsPerDay) return Refusal::DAILY_CAP;
    if (count_ > 0) {
      const unsigned long last = starts_[(next_ + kSlots - 1) % kSlots];
      if ((nowMs - last) < limits_.minGapMs) return Refusal::TOO_SOON;
    }
    if (dispensesLastHour(nowMs) >= limits_.maxPerHour) return Refusal::HOURLY_LIMIT;
    return Refusal::NONE;
  }

  // Call only when a dispense actually starts.
  void recordStart(unsigned long nowMs) {
    starts_[next_] = nowMs;
    next_ = (next_ + 1) % kSlots;
    if (count_ < kSlots) count_++;
  }

  uint8_t dispensesLastHour(unsigned long nowMs) const {
    uint8_t n = 0;
    for (uint8_t i = 0; i < count_; i++) {
      const unsigned long t = starts_[(next_ + kSlots - 1 - i) % kSlots];
      if ((nowMs - t) < 3600000UL) n++;
    }
    return n;
  }

  uint8_t recordedDispenses() const { return count_; }

 private:
  DispenseLimits limits_;
  unsigned long starts_[kSlots];
  uint8_t count_;
  uint8_t next_;
};

// ---------------------------------------------------------------------------
// Reset history and safe mode
// ---------------------------------------------------------------------------
enum ResetCode : uint8_t {
  RESET_UNKNOWN = 0,
  RESET_POWERON,
  RESET_EXTERNAL,
  RESET_SOFTWARE,
  RESET_PANIC,
  RESET_INT_WDT,
  RESET_TASK_WDT,
  RESET_WDT,
  RESET_DEEPSLEEP,
  RESET_BROWNOUT,
  RESET_SDIO,
};

inline const char *resetCodeName(uint8_t code) {
  switch (code) {
    case RESET_POWERON: return "poweron";
    case RESET_EXTERNAL: return "external";
    case RESET_SOFTWARE: return "software";
    case RESET_PANIC: return "panic";
    case RESET_INT_WDT: return "interrupt_wdt";
    case RESET_TASK_WDT: return "task_wdt";
    case RESET_WDT: return "wdt";
    case RESET_DEEPSLEEP: return "deepsleep";
    case RESET_BROWNOUT: return "brownout";
    case RESET_SDIO: return "sdio";
    default: return "unknown";
  }
}

inline bool resetIsAbnormal(uint8_t code) {
  switch (code) {
    case RESET_BROWNOUT:
    case RESET_PANIC:
    case RESET_INT_WDT:
    case RESET_TASK_WDT:
    case RESET_WDT:
      return true;
    default:
      return false;
  }
}

// "brownout,task_wdt" for the heartbeat and the safe-mode log. Always
// NUL-terminated; "none" when the mask is empty.
inline void describeResetReasons(uint32_t mask, char *out, size_t size) {
  if (out == nullptr || size == 0) return;
  out[0] = '\0';
  if (mask == 0) {
    strncpy(out, "none", size - 1);
    out[size - 1] = '\0';
    return;
  }
  bool first = true;
  for (uint8_t code = 1; code <= RESET_SDIO; code++) {
    if ((mask & (1UL << code)) == 0) continue;
    const char *name = resetCodeName(code);
    const size_t used = strlen(out);
    if (used + (first ? 0 : 1) + strlen(name) >= size) break;
    if (!first) strncat(out, ",", size - strlen(out) - 1);
    strncat(out, name, size - strlen(out) - 1);
    first = false;
  }
}

/*
  Aggregate reset history that survives a reboot.

  - A normal power-on clears it (the electrical fault is gone).
  - Only brownout / panic / watchdog resets are counted.
  - With a clock, entries older than the window are dropped, so three brownouts
    spread over an hour are not the same as three in ten minutes.
  - Without a clock (no RTC, no NTP yet) the count is consecutive abnormal
    resets; the caller clears it after a healthy uptime.
*/
class ResetHistory {
 public:
  ResetHistory() : count_(0), mask_(0), firstEpoch_(0), lastEpoch_(0) {}

  void clear() {
    count_ = 0;
    mask_ = 0;
    firstEpoch_ = 0;
    lastEpoch_ = 0;
  }

  // Restore the persisted aggregate before registering this boot.
  void restore(uint8_t count, uint32_t mask, uint32_t firstEpoch, uint32_t lastEpoch) {
    count_ = count;
    mask_ = mask;
    firstEpoch_ = firstEpoch;
    lastEpoch_ = lastEpoch;
  }

  // Register this boot. Returns true when the history changed.
  bool addBoot(uint8_t code, uint32_t epoch, bool clockValid, unsigned long windowSeconds) {
    if (code == RESET_POWERON) {
      const bool changed = count_ != 0 || mask_ != 0;
      clear();
      return changed;
    }
    if (!resetIsAbnormal(code)) return false;

    if (clockValid) {
      const bool sameWindow =
          count_ > 0 && lastEpoch_ != 0 && epoch >= lastEpoch_ &&
          (epoch - lastEpoch_) <= windowSeconds;
      if (sameWindow) {
        if (count_ < 255) count_++;
      } else {
        count_ = 1;
        firstEpoch_ = epoch;
      }
      lastEpoch_ = epoch;
    } else {
      if (count_ < 255) count_++;
      firstEpoch_ = 0;
      lastEpoch_ = 0;
    }
    mask_ |= (1UL << code);
    return true;
  }

  uint8_t count() const { return count_; }
  uint32_t mask() const { return mask_; }
  uint32_t firstEpoch() const { return firstEpoch_; }
  uint32_t lastEpoch() const { return lastEpoch_; }
  bool safeModeRequired(uint8_t threshold) const { return count_ >= threshold; }

 private:
  uint8_t count_;
  uint32_t mask_;
  uint32_t firstEpoch_;
  uint32_t lastEpoch_;
};

/*
  The 30-minute quiet period of safe mode. Anchored on the RTC when it holds a
  plausible date (so a reboot does not restart the clock), otherwise on uptime.
*/
class SafeModeWindow {
 public:
  SafeModeWindow() : clockAnchored_(false), untilEpoch_(0), startedMs_(0), quietMs_(0) {}

  void begin(bool clockValid, uint32_t epoch, unsigned long nowMs, unsigned long quietMs) {
    quietMs_ = quietMs;
    clockAnchored_ = clockValid && epoch != 0;
    if (clockAnchored_) {
      untilEpoch_ = epoch + (uint32_t)(quietMs / 1000UL);
    } else {
      startedMs_ = nowMs;
      untilEpoch_ = 0;
    }
  }

  // Restore from NVS. `untilEpoch == 0` means the previous boot had no clock.
  void resume(uint32_t untilEpoch, unsigned long nowMs, unsigned long quietMs) {
    quietMs_ = quietMs;
    if (untilEpoch != 0) {
      clockAnchored_ = true;
      untilEpoch_ = untilEpoch;
    } else {
      clockAnchored_ = false;
      startedMs_ = nowMs;
      untilEpoch_ = 0;
    }
  }

  bool elapsed(bool clockValid, uint32_t epoch, unsigned long nowMs) const {
    if (clockAnchored_ && clockValid) return epoch >= untilEpoch_;
    return (nowMs - startedMs_) >= quietMs_;
  }

  bool clockAnchored() const { return clockAnchored_; }
  uint32_t untilEpoch() const { return untilEpoch_; }

 private:
  bool clockAnchored_;
  uint32_t untilEpoch_;
  unsigned long startedMs_;
  unsigned long quietMs_;
};

// ---------------------------------------------------------------------------
// Button noise guard: more than `maxGlitches` rejected edges inside `windowMs`
// disables the button for `disableMs`. A real press is never rejected, so only
// a genuinely noisy line reaches the limit.
// ---------------------------------------------------------------------------
class ButtonNoiseGuard {
 public:
  ButtonNoiseGuard() { configure(60000UL, 5, 600000UL); reset(); }

  void configure(unsigned long windowMs, uint8_t maxGlitches, unsigned long disableMs) {
    windowMs_ = windowMs;
    maxGlitches_ = maxGlitches;
    disableMs_ = disableMs;
  }

  void reset() {
    windowStartMs_ = 0;
    windowOpen_ = false;
    glitches_ = 0;
    disabled_ = false;
    justDisabled_ = false;
    disabledUntilMs_ = 0;
  }

  void recordGlitch(unsigned long nowMs) {
    justDisabled_ = false;
    if (!windowOpen_ || (nowMs - windowStartMs_) > windowMs_) {
      windowStartMs_ = nowMs;
      windowOpen_ = true;
      glitches_ = 0;
    }
    if (glitches_ < 255) glitches_++;
    if (!disabled_ && glitches_ > maxGlitches_) {
      disabled_ = true;
      justDisabled_ = true;
      disabledUntilMs_ = nowMs + disableMs_;
    }
  }

  bool disabled(unsigned long nowMs) {
    if (!disabled_) return false;
    if ((long)(nowMs - disabledUntilMs_) >= 0) {
      disabled_ = false;
      justDisabled_ = false;
      windowOpen_ = false;
      glitches_ = 0;
      return false;
    }
    return true;
  }

  bool justDisabled() const { return justDisabled_; }
  void clearJustDisabled() { justDisabled_ = false; }
  uint8_t glitchesInWindow() const { return glitches_; }
  unsigned long disabledForMs(unsigned long nowMs) const {
    if (!disabled_) return 0;
    if ((long)(nowMs - disabledUntilMs_) >= 0) return 0;
    return disabledUntilMs_ - nowMs;
  }

 private:
  unsigned long windowMs_;
  uint8_t maxGlitches_;
  unsigned long disableMs_;
  unsigned long windowStartMs_;
  bool windowOpen_;
  uint8_t glitches_;
  bool disabled_;
  bool justDisabled_;
  unsigned long disabledUntilMs_;
};

// ---------------------------------------------------------------------------
// Per-event-type token bucket. One token per `refillMs`, capped at `capacity`.
// ---------------------------------------------------------------------------
class TokenBucket {
 public:
  TokenBucket() { configure(1, 1000UL); }

  void configure(uint8_t capacity, unsigned long refillMs) {
    capacity_ = capacity == 0 ? 1 : capacity;
    refillMs_ = refillMs == 0 ? 1 : refillMs;
    tokens_ = capacity_;
    lastMs_ = 0;
    started_ = false;
  }

  bool tryConsume(unsigned long nowMs) {
    if (!started_) {
      started_ = true;
      lastMs_ = nowMs;
    } else if (nowMs != lastMs_) {
      const unsigned long elapsed = nowMs - lastMs_;
      if (elapsed >= refillMs_) {
        const unsigned long gained = elapsed / refillMs_;
        const unsigned long room = capacity_ - tokens_;
        const unsigned long add = gained > room ? room : gained;
        tokens_ = (uint8_t)(tokens_ + add);
        lastMs_ += gained * refillMs_;
        if (gained > room) lastMs_ = nowMs;
      }
    }
    if (tokens_ == 0) return false;
    tokens_--;
    return true;
  }

  uint8_t tokens() const { return tokens_; }

 private:
  uint8_t capacity_;
  uint8_t tokens_;
  unsigned long refillMs_;
  unsigned long lastMs_;
  bool started_;
};

// ---------------------------------------------------------------------------
// Non-blocking HTTP retry state. The caller keeps looping; this only says when
// the next attempt is due. Delay = base << (failures-1), jittered +-20 %,
// capped at `capMs` (5 minutes by default).
// ---------------------------------------------------------------------------
class NetRetry {
 public:
  NetRetry() { configure(5000UL, 300000UL); }

  void configure(unsigned long baseMs, unsigned long capMs) {
    baseMs_ = baseMs == 0 ? 1000UL : baseMs;
    capMs_ = capMs < baseMs_ ? baseMs_ : capMs;
    reset();
  }

  void reset() {
    failures_ = 0;
    nextAttemptMs_ = 0;
  }

  bool ready(unsigned long nowMs) const {
    return failures_ == 0 || (long)(nowMs - nextAttemptMs_) >= 0;
  }

  // `jitterPct` in -20..20 (the device passes esp_random()); the host tests
  // pass 0 for a deterministic delay.
  void recordFailure(unsigned long nowMs, int8_t jitterPct) {
    if (failures_ < 16) failures_++;
    uint8_t shift = failures_ > 1 ? (uint8_t)(failures_ - 1) : 0;
    if (shift > 6) shift = 6;
    unsigned long delay = baseMs_ << shift;
    if (jitterPct < -20) jitterPct = -20;
    if (jitterPct > 20) jitterPct = 20;
    delay = (delay * (unsigned long)(100 + jitterPct)) / 100UL;
    if (delay < 50UL) delay = 50UL;
    if (delay > capMs_) delay = capMs_;
    nextAttemptMs_ = nowMs + delay;
  }

  void recordSuccess() { reset(); }

  uint8_t failures() const { return failures_; }
  unsigned long nextAttemptMs() const { return nextAttemptMs_; }

 private:
  unsigned long baseMs_;
  unsigned long capMs_;
  uint8_t failures_;
  unsigned long nextAttemptMs_;
};

}  // namespace fw
