/*
  PakaonAI firmware 1.7.0 - dashboard-driven configuration (I-100)
  ----------------------------------------------------------------
  One versioned `config` object rides every feed-command poll response. The
  firmware validates each field against the absolute safety envelope below,
  applies the whole object only when every present field is inside its bound,
  keeps the last-good copy in NVS and echoes `rev` in the heartbeat.

  Three classes:

  - **Envelope (A)**: `min`/`max` per field in `kSpecs`. A dashboard value can
    never move outside this window, so a bug or a bad row can never raise a
    dose, lengthen the relay, shorten the dispense gap or disable a guard.
  - **Operational (B)**: every field in `DeviceConfig`, server-driven within
    the envelope. The defaults below are exactly the compile-time values the
    firmware shipped with, so an old server (no `config`) changes nothing.
  - **Fixed (C)**: GPIO pins, URLs, NVS namespace, TLS, HTTP timeouts and
    queue sizes. Not feeding parameters; no dashboard home.

  Rules (brief I-100):
  - missing object, malformed field, unknown contract version or any
    out-of-range value -> the whole object is ignored; the last-good copy
    (else these compile-time defaults) stays in force;
  - a present field that is absent from the object keeps the last-good value;
  - the daily ceiling is the only gram cap (E38): the per-dose ceiling is
    derived from it and the relay-time envelope, never from a fixed 1,000 g.

  Arduino-free enough to unit-test on the host: only ArduinoJson is used, and
  the native test environment installs it.
*/
#pragma once

#include <ArduinoJson.h>
#include <math.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace fw {

/** Contract version of the `config` object. A server bump is ignored safely. */
static const int kConfigContractVersion = 1;

/*
  Every operational field, its JSON key, its envelope (min/max) and whether it
  must be a whole number. Order defines the enum, the spec table and the patch
  slots, so the three can never drift apart.
*/
#define FW_CONFIG_FIELDS(X)                                                          \
  /* Feed safety gates (class B, editable in the superadmin config centre) */        \
  X(minDispenseGapS, "min_dispense_gap_s", 10.0f, 3600.0f, true, 10.0f)              \
  X(maxDispensesPerHour, "max_dispenses_per_hour", 1.0f, 6.0f, true, 6.0f)           \
  X(maxGramsPerDay, "max_grams_per_day", 0.0f, 5000.0f, false, 5000.0f)              \
  X(maxDispenseMs, "max_dispense_ms", 5000.0f, 300000.0f, true, 300000.0f)           \
  X(calibrationMaxGrams, "calibration_max_grams", 100.0f, 5000.0f, false, 5000.0f)   \
  X(calibrationMaxDispenseMs, "calibration_max_dispense_ms", 10000.0f, 600000.0f,    \
    true, 600000.0f)                                                                 \
  X(brownoutHoldS, "brownout_hold_s", 10.0f, 3600.0f, true, 60.0f)                    \
  X(safeModeAbnormalWindowS, "safe_mode_abnormal_window_s", 60.0f, 86400.0f, true,   \
    600.0f)                                                                          \
  X(safeModeAbnormalThreshold, "safe_mode_abnormal_threshold", 2.0f, 10.0f, true,    \
    3.0f)                                                                            \
  X(safeModeQuietS, "safe_mode_quiet_s", 60.0f, 86400.0f, true, 1800.0f)             \
  X(safeModeHealthyClearS, "safe_mode_healthy_clear_s", 60.0f, 86400.0f, true, 600.0f) \
  /* Per-device feeding values (class B, from the device row) */                     \
  X(gramsPerFeeding, "grams_per_feeding", 1.0f, 5000.0f, false, 150.0f)              \
  X(buttonFeedGrams, "button_feed_grams", 1.0f, 500.0f, false, 80.0f)                \
  X(gramsPerSecond, "grams_per_second", 0.5f, 50.0f, false, 4.0f)                    \
  X(tempOffsetC, "temp_offset_c", -20.0f, 20.0f, false, 0.0f)                        \
  X(hopperFullCm, "hopper_full_cm", 0.1f, 200.0f, false, 5.0f)                       \
  X(hopperEmptyCm, "hopper_empty_cm", 0.1f, 500.0f, false, 30.0f)                    \
  X(hopperLowPct, "hopper_low_pct", 1.0f, 90.0f, false, 20.0f)                       \
  X(hopperRefillMarginPct, "hopper_refill_margin_pct", 0.0f, 50.0f, false, 10.0f)    \
  /* Hopper filter tuning (class B, guards the reading against field noise) */       \
  X(hopperRejectBelowCm, "hopper_reject_below_cm", 0.0f, 50.0f, false, 2.0f)         \
  X(hopperRejectAboveMarginCm, "hopper_reject_above_margin_cm", 0.0f, 100.0f, false, \
    10.0f)                                                                           \
  X(hopperEmaAlpha, "hopper_ema_alpha", 0.05f, 1.0f, false, 0.35f)                   \
  X(hopperJumpPct, "hopper_jump_pct", 1.0f, 100.0f, false, 15.0f)                    \
  X(hopperPersistCycles, "hopper_persist_cycles", 1.0f, 20.0f, true, 3.0f)           \
  X(hopperStateHoldS, "hopper_state_hold_s", 0.0f, 86400.0f, true, 600.0f)           \
  /* Button guard (class B) */                                                       \
  X(buttonDebounceMs, "button_debounce_ms", 10.0f, 2000.0f, true, 250.0f)            \
  X(buttonStartupGraceMs, "button_startup_grace_ms", 0.0f, 60000.0f, true, 5000.0f)  \
  X(buttonQuietAfterDispenseMs, "button_quiet_after_dispense_ms", 0.0f, 60000.0f,    \
    true, 2000.0f)                                                                   \
  X(buttonCooldownMs, "button_cooldown_ms", 0.0f, 3600000.0f, true, 30000.0f)        \
  X(buttonLogIntervalMs, "button_log_interval_ms", 1000.0f, 600000.0f, true,         \
    10000.0f)                                                                        \
  X(buttonNoiseWindowMs, "button_noise_window_ms", 1000.0f, 3600000.0f, true,        \
    60000.0f)                                                                        \
  X(buttonNoiseMax, "button_noise_max", 1.0f, 50.0f, true, 5.0f)                     \
  X(buttonDisableMs, "button_disable_ms", 1000.0f, 86400000.0f, true, 600000.0f)     \
  /* Polling (class B) */                                                            \
  X(heartbeatIntervalS, "heartbeat_interval_s", 2.0f, 300.0f, true, 5.0f)            \
  /* Connectivity diagnostic (I-95 policy, informational: the server classifies) */  \
  X(weakAfterMin, "weak_after_min", 1.0f, 60.0f, true, 5.0f)                         \
  X(offlineAfterMin, "offline_after_min", 5.0f, 180.0f, true, 15.0f)                 \
  /* OTA pre-flight and timeouts (class B, guards stay mandatory) */                 \
  X(otaCheckIntervalS, "ota_check_interval_s", 300.0f, 86400.0f, true, 1800.0f)      \
  X(otaMinUptimeS, "ota_min_uptime_s", 60.0f, 86400.0f, true, 600.0f)                \
  X(otaMinRssiDbm, "ota_min_rssi_dbm", -100.0f, -30.0f, true, -75.0f)                \
  X(otaFeedGuardMin, "ota_feed_guard_min", 5.0f, 240.0f, true, 20.0f)                \
  X(otaWindowStartMin, "ota_window_start_min", 0.0f, 1440.0f, true, 600.0f)          \
  X(otaWindowEndMin, "ota_window_end_min", 0.0f, 1440.0f, true, 900.0f)              \
  X(otaMinFreeHeapBytes, "ota_min_free_heap_bytes", 20000.0f, 200000.0f, true,       \
    60000.0f)                                                                        \
  X(otaNoDataTimeoutMs, "ota_no_data_timeout_ms", 10000.0f, 600000.0f, true,         \
    60000.0f)                                                                        \
  X(otaDownloadTimeoutMs, "ota_download_timeout_ms", 60000.0f, 3600000.0f, true,     \
    900000.0f)                                                                       \
  X(otaHealthCheckTimeoutMs, "ota_health_check_timeout_ms", 60000.0f, 1800000.0f,    \
    true, 300000.0f)

#define FW_CONFIG_FIELD_MEMBER(name, key, minValue, maxValue, integer, defaultValue) \
  float name;
#define FW_CONFIG_FIELD_ENUM(name, key, minValue, maxValue, integer, defaultValue) \
  field_##name,
#define FW_CONFIG_FIELD_SPEC(name, key, minValue, maxValue, integer, defaultValue) \
  ConfigFieldSpec{key, minValue, maxValue, integer, &DeviceConfig::name},
#define FW_CONFIG_FIELD_DEFAULT(name, key, minValue, maxValue, integer, defaultValue) \
  config.name = defaultValue;

/** The last-good, currently enforced operational configuration. */
struct DeviceConfig {
  FW_CONFIG_FIELDS(FW_CONFIG_FIELD_MEMBER)
};

enum ConfigFieldId : uint8_t {
  FW_CONFIG_FIELDS(FW_CONFIG_FIELD_ENUM) field_Count,
};

struct ConfigFieldSpec {
  const char *key;
  float minValue;
  float maxValue;
  bool integer;
  float DeviceConfig::*member;
};

inline const ConfigFieldSpec *configSpecs() {
  static const ConfigFieldSpec specs[] = {
      FW_CONFIG_FIELDS(FW_CONFIG_FIELD_SPEC)
  };
  return specs;
}

inline uint8_t configFieldCount() { return (uint8_t)ConfigFieldId::field_Count; }

/** The spec for a JSON key, or nullptr. Lets one place own every bound. */
inline const ConfigFieldSpec *findConfigSpec(const char *key) {
  if (key == nullptr) return nullptr;
  const ConfigFieldSpec *specs = configSpecs();
  for (uint8_t i = 0; i < configFieldCount(); i++) {
    if (strcmp(specs[i].key, key) == 0) return &specs[i];
  }
  return nullptr;
}

/** The compile-time defaults: identical to the values firmware 1.6.x used. */
inline DeviceConfig defaultDeviceConfig() {
  DeviceConfig config;
  FW_CONFIG_FIELDS(FW_CONFIG_FIELD_DEFAULT)
  return config;
}

/** One poll response's optional fields. Absent fields keep the last-good value. */
struct ConfigPatch {
  bool present[(uint8_t)ConfigFieldId::field_Count];
  float values[(uint8_t)ConfigFieldId::field_Count];
  uint32_t rev;
  bool hasRev;

  ConfigPatch() { reset(); }

  void reset() {
    for (uint8_t i = 0; i < (uint8_t)ConfigFieldId::field_Count; i++) {
      present[i] = false;
      values[i] = 0.0f;
    }
    rev = 0;
    hasRev = false;
  }
};

enum class ConfigStatus : uint8_t {
  OK = 0,
  /** No `config` object at all: an older server. Keep the last-good copy. */
  MISSING,
  /** Not an object, a field of the wrong type, NaN/Infinity or a non-integer. */
  MALFORMED,
  /** A field outside its envelope, or an impossible combination. */
  OUT_OF_RANGE,
  /** A contract version this firmware does not understand. */
  UNSUPPORTED,
};

/** True only for a value the firmware may act on. */
inline bool configStatusOk(ConfigStatus status) { return status == ConfigStatus::OK; }

inline const char *configStatusName(ConfigStatus status) {
  switch (status) {
    case ConfigStatus::OK: return "ok";
    case ConfigStatus::MISSING: return "missing";
    case ConfigStatus::MALFORMED: return "malformed";
    case ConfigStatus::OUT_OF_RANGE: return "out_of_range";
    case ConfigStatus::UNSUPPORTED: return "unsupported";
    default: return "unknown";
  }
}

/*
  Read the optional `config` object into a patch.

  A missing object returns MISSING (old server). A wrong version returns
  UNSUPPORTED. A wrong-typed field, NaN/Infinity or a fractional value in an
  integer field returns MALFORMED. Missing fields stay absent, which is what
  makes a partial object additive and forward compatible.
*/
inline ConfigStatus readConfigPatch(const JsonDocument &doc, ConfigPatch &patch) {
  patch.reset();
  JsonVariantConst configValue = doc["config"];
  if (configValue.isNull()) return ConfigStatus::MISSING;
  if (!configValue.is<JsonObjectConst>()) return ConfigStatus::MALFORMED;

  JsonObjectConst config = configValue.as<JsonObjectConst>();

  JsonVariantConst versionValue = config["version"];
  if (versionValue.isNull() || !versionValue.is<int>()) return ConfigStatus::MALFORMED;
  if (versionValue.as<int>() != kConfigContractVersion) return ConfigStatus::UNSUPPORTED;

  JsonVariantConst revValue = config["rev"];
  if (revValue.isNull() || !revValue.is<uint32_t>()) return ConfigStatus::MALFORMED;
  patch.rev = revValue.as<uint32_t>();
  patch.hasRev = true;

  const ConfigFieldSpec *specs = configSpecs();
  for (uint8_t i = 0; i < configFieldCount(); i++) {
    JsonVariantConst value = config[specs[i].key];
    if (value.isNull()) continue;  // absent: keep the last-good value
    if (!value.is<float>()) return ConfigStatus::MALFORMED;
    const float number = value.as<float>();
    if (isnan(number) || isinf(number)) return ConfigStatus::MALFORMED;
    if (specs[i].integer && number != floorf(number)) return ConfigStatus::MALFORMED;
    patch.present[i] = true;
    patch.values[i] = number;
  }
  return ConfigStatus::OK;
}

/*
  Apply a patch over `current`.

  Every present field must be inside its envelope; one bad field rejects the
  whole patch (all-or-nothing), so a partly-bad object can never half-apply.
  Cross-field combinations are checked too. On success `out` is `current` with
  the present fields overlaid; on failure `out` is untouched.
*/
inline ConfigStatus applyConfigPatch(const ConfigPatch &patch, const DeviceConfig &current,
                                     DeviceConfig &out, const char **rejectedKey = nullptr) {
  const ConfigFieldSpec *specs = configSpecs();
  DeviceConfig candidate = current;

  for (uint8_t i = 0; i < configFieldCount(); i++) {
    if (!patch.present[i]) continue;
    const float value = patch.values[i];
    if (!(value >= specs[i].minValue && value <= specs[i].maxValue)) {
      if (rejectedKey != nullptr) *rejectedKey = specs[i].key;
      return ConfigStatus::OUT_OF_RANGE;
    }
    candidate.*(specs[i].member) = value;
  }

  // Cross-field: the sensor must measure downward (empty is farther) and the
  // OTA window must have a positive length. Both are envelope rules, not
  // preferences: an inverted pair would break a guard silently.
  if (!(candidate.hopperFullCm < candidate.hopperEmptyCm)) {
    if (rejectedKey != nullptr) *rejectedKey = "hopper_full_cm";
    return ConfigStatus::OUT_OF_RANGE;
  }
  if (!(candidate.otaWindowStartMin < candidate.otaWindowEndMin)) {
    if (rejectedKey != nullptr) *rejectedKey = "ota_window_start_min";
    return ConfigStatus::OUT_OF_RANGE;
  }
  if (!(candidate.maxGramsPerDay >= 0.0f)) {
    if (rejectedKey != nullptr) *rejectedKey = "max_grams_per_day";
    return ConfigStatus::OUT_OF_RANGE;
  }

  out = candidate;
  return ConfigStatus::OK;
}

/**
 * The per-dose ceiling (E38).
 *
 * The daily ceiling is the only gram cap, so a single dose may use all of it.
 * The relay-time envelope still bounds it: grams per second times the maximum
 * relay on-time. There is deliberately no fixed 1,000 g constant any more.
 */
inline float effectiveMaxGramsPerDose(const DeviceConfig &config) {
  const float rate = config.gramsPerSecond > 0.0f ? config.gramsPerSecond : 0.0f;
  const float byTime = (config.maxDispenseMs / 1000.0f) * rate;
  const float byDay = config.maxGramsPerDay;
  return byDay < byTime ? byDay : byTime;
}

/** Write the operational fields only (no version/rev) - used for NVS. */
inline void writeConfigJson(const DeviceConfig &config, JsonDocument &doc) {
  JsonObject object = doc.to<JsonObject>();
  const ConfigFieldSpec *specs = configSpecs();
  for (uint8_t i = 0; i < configFieldCount(); i++) {
    const float value = config.*(specs[i].member);
    if (specs[i].integer) {
      object[specs[i].key] = (long)lroundf(value);
    } else {
      object[specs[i].key] = value;
    }
  }
}

/*
  Restore a persisted NVS copy (no version/rev, unknown keys ignored).

  A missing field falls back to the compile-time default; one bad field rejects
  the whole stored copy, so a corrupt or hand-edited NVS string can never leave
  the firmware half-configured.
*/
inline ConfigStatus restoreConfig(const JsonDocument &doc, DeviceConfig &out,
                                  const char **rejectedKey = nullptr) {
  if (!doc.is<JsonObjectConst>()) return ConfigStatus::MALFORMED;

  ConfigPatch patch;
  JsonObjectConst object = doc.as<JsonObjectConst>();
  const ConfigFieldSpec *specs = configSpecs();
  for (uint8_t i = 0; i < configFieldCount(); i++) {
    JsonVariantConst value = object[specs[i].key];
    if (value.isNull()) continue;
    if (!value.is<float>()) return ConfigStatus::MALFORMED;
    const float number = value.as<float>();
    if (isnan(number) || isinf(number)) return ConfigStatus::MALFORMED;
    if (specs[i].integer && number != floorf(number)) return ConfigStatus::MALFORMED;
    patch.present[i] = true;
    patch.values[i] = number;
  }

  const DeviceConfig defaults = defaultDeviceConfig();
  return applyConfigPatch(patch, defaults, out, rejectedKey);
}

}  // namespace fw
