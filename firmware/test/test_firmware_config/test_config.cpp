/*
  Native (host) tests for the 1.7.0 dashboard-driven configuration (I-100).

  Run with:  pio test -d firmware -e native
  No board, no network, no database. The tests cover exactly what the brief
  requires of the contract: parsing, the absolute envelope, the last-good
  fallback and malformed input, plus E38 (the daily ceiling is the only gram
  cap).
*/
#include <unity.h>

#include <math.h>
#include <string.h>

#include "../../firmware-main/config.h"
#include "../../firmware-main/safety.h"

using namespace fw;

void setUp(void) {}
void tearDown(void) {}

// ---------------------------------------------------------------- helpers

static DeviceConfig applyJson(const char *json, ConfigStatus &status, const char *&badKey,
                              const DeviceConfig &current) {
  JsonDocument doc;
  const DeserializationError error = deserializeJson(doc, json);
  if (error) {
    status = ConfigStatus::MALFORMED;
    return current;
  }
  ConfigPatch patch;
  status = readConfigPatch(doc, patch);
  if (status != ConfigStatus::OK) return current;
  DeviceConfig out;
  badKey = nullptr;
  status = applyConfigPatch(patch, current, out, &badKey);
  return status == ConfigStatus::OK ? out : current;
}

static DeviceConfig applyJson(const char *json, ConfigStatus &status) {
  const char *badKey = nullptr;
  return applyJson(json, status, badKey, defaultDeviceConfig());
}

static const char *kFullConfig =
    "{\"config\":{\"version\":1,\"rev\":4242,"
    "\"min_dispense_gap_s\":30,\"max_dispenses_per_hour\":4,"
    "\"max_grams_per_day\":2500,\"max_dispense_ms\":120000,"
    "\"calibration_max_grams\":3000,\"calibration_max_dispense_ms\":300000,"
    "\"brownout_hold_s\":90,\"safe_mode_abnormal_window_s\":900,"
    "\"safe_mode_abnormal_threshold\":4,\"safe_mode_quiet_s\":2400,"
    "\"safe_mode_healthy_clear_s\":720,"
    "\"grams_per_feeding\":175,\"button_feed_grams\":120,"
    "\"grams_per_second\":6.5,\"temp_offset_c\":1.5,"
    "\"hopper_full_cm\":6,\"hopper_empty_cm\":28,\"hopper_low_pct\":25,"
    "\"hopper_refill_margin_pct\":12,\"hopper_reject_below_cm\":2.5,"
    "\"hopper_reject_above_margin_cm\":11,\"hopper_ema_alpha\":0.4,"
    "\"hopper_jump_pct\":18,\"hopper_persist_cycles\":4,"
    "\"hopper_state_hold_s\":300,\"button_debounce_ms\":200,"
    "\"button_startup_grace_ms\":6000,\"button_quiet_after_dispense_ms\":2500,"
    "\"button_cooldown_ms\":45000,\"button_log_interval_ms\":12000,"
    "\"button_noise_window_ms\":90000,\"button_noise_max\":6,"
    "\"button_disable_ms\":900000,\"heartbeat_interval_s\":8,"
    "\"ota_check_interval_s\":3600,\"ota_min_uptime_s\":900,"
    "\"ota_min_rssi_dbm\":-70,\"ota_feed_guard_min\":30,"
    "\"ota_window_start_min\":720,\"ota_window_end_min\":960,"
    "\"ota_min_free_heap_bytes\":70000,\"ota_no_data_timeout_ms\":90000,"
    "\"ota_download_timeout_ms\":1200000,\"ota_health_check_timeout_ms\":360000}}";

// ---------------------------------------------------------------- defaults

void test_defaults_match_the_shipped_values(void) {
  const DeviceConfig config = defaultDeviceConfig();
  TEST_ASSERT_EQUAL_FLOAT(10.0f, config.minDispenseGapS);
  TEST_ASSERT_EQUAL_FLOAT(6.0f, config.maxDispensesPerHour);
  TEST_ASSERT_EQUAL_FLOAT(5000.0f, config.maxGramsPerDay);
  TEST_ASSERT_EQUAL_FLOAT(300000.0f, config.maxDispenseMs);
  TEST_ASSERT_EQUAL_FLOAT(5000.0f, config.calibrationMaxGrams);
  TEST_ASSERT_EQUAL_FLOAT(60.0f, config.brownoutHoldS);
  TEST_ASSERT_EQUAL_FLOAT(150.0f, config.gramsPerFeeding);
  TEST_ASSERT_EQUAL_FLOAT(80.0f, config.buttonFeedGrams);
  TEST_ASSERT_EQUAL_FLOAT(4.0f, config.gramsPerSecond);
  TEST_ASSERT_EQUAL_FLOAT(5.0f, config.hopperFullCm);
  TEST_ASSERT_EQUAL_FLOAT(30.0f, config.hopperEmptyCm);
  TEST_ASSERT_EQUAL_FLOAT(20.0f, config.hopperLowPct);
  TEST_ASSERT_EQUAL_FLOAT(5.0f, config.heartbeatIntervalS);
  TEST_ASSERT_EQUAL_FLOAT(1800.0f, config.otaCheckIntervalS);
  TEST_ASSERT_EQUAL_FLOAT(-75.0f, config.otaMinRssiDbm);
  TEST_ASSERT_EQUAL_UINT8((uint8_t)ConfigFieldId::field_Count, configFieldCount());
}

void test_every_field_has_an_envelope(void) {
  const ConfigFieldSpec *specs = configSpecs();
  for (uint8_t i = 0; i < configFieldCount(); i++) {
    TEST_ASSERT_NOT_NULL(specs[i].key);
    TEST_ASSERT_TRUE(specs[i].minValue <= specs[i].maxValue);
    TEST_ASSERT_NOT_NULL(findConfigSpec(specs[i].key));
  }
  TEST_ASSERT_NULL(findConfigSpec("does_not_exist"));
}

// ---------------------------------------------------------------- parsing

void test_full_config_applies(void) {
  ConfigStatus status = ConfigStatus::MISSING;
  const DeviceConfig config = applyJson(kFullConfig, status);

  TEST_ASSERT_EQUAL_INT((int)ConfigStatus::OK, (int)status);
  TEST_ASSERT_EQUAL_FLOAT(30.0f, config.minDispenseGapS);
  TEST_ASSERT_EQUAL_FLOAT(4.0f, config.maxDispensesPerHour);
  TEST_ASSERT_EQUAL_FLOAT(2500.0f, config.maxGramsPerDay);
  TEST_ASSERT_EQUAL_FLOAT(120000.0f, config.maxDispenseMs);
  TEST_ASSERT_EQUAL_FLOAT(175.0f, config.gramsPerFeeding);
  TEST_ASSERT_EQUAL_FLOAT(120.0f, config.buttonFeedGrams);
  TEST_ASSERT_EQUAL_FLOAT(6.5f, config.gramsPerSecond);
  TEST_ASSERT_EQUAL_FLOAT(1.5f, config.tempOffsetC);
  TEST_ASSERT_EQUAL_FLOAT(28.0f, config.hopperEmptyCm);
  TEST_ASSERT_EQUAL_FLOAT(25.0f, config.hopperLowPct);
  TEST_ASSERT_EQUAL_FLOAT(360000.0f, config.otaHealthCheckTimeoutMs);
}

void test_revision_is_read(void) {
  JsonDocument doc;
  deserializeJson(doc, kFullConfig);
  ConfigPatch patch;
  TEST_ASSERT_EQUAL_INT((int)ConfigStatus::OK, (int)readConfigPatch(doc, patch));
  TEST_ASSERT_TRUE(patch.hasRev);
  TEST_ASSERT_EQUAL_UINT32(4242UL, patch.rev);
}

void test_missing_config_object_is_not_an_error(void) {
  ConfigStatus status = ConfigStatus::OK;
  const DeviceConfig before = defaultDeviceConfig();
  const DeviceConfig config = applyJson("{\"feed_requested\":false}", status);
  TEST_ASSERT_EQUAL_INT((int)ConfigStatus::MISSING, (int)status);
  TEST_ASSERT_EQUAL_FLOAT(before.minDispenseGapS, config.minDispenseGapS);
}

void test_partial_config_keeps_the_last_good_value(void) {
  DeviceConfig current = defaultDeviceConfig();
  current.maxGramsPerDay = 1800.0f;
  current.gramsPerFeeding = 220.0f;

  ConfigStatus status = ConfigStatus::MISSING;
  const char *badKey = nullptr;
  const DeviceConfig config = applyJson(
      "{\"config\":{\"version\":1,\"rev\":7,\"min_dispense_gap_s\":20}}", status, badKey, current);

  TEST_ASSERT_EQUAL_INT((int)ConfigStatus::OK, (int)status);
  TEST_ASSERT_EQUAL_FLOAT(20.0f, config.minDispenseGapS);
  // Absent fields keep the last-good value, not the compile-time default.
  TEST_ASSERT_EQUAL_FLOAT(1800.0f, config.maxGramsPerDay);
  TEST_ASSERT_EQUAL_FLOAT(220.0f, config.gramsPerFeeding);
}

void test_unsupported_contract_version_is_ignored(void) {
  ConfigStatus status = ConfigStatus::OK;
  const DeviceConfig before = defaultDeviceConfig();
  const DeviceConfig config = applyJson(
      "{\"config\":{\"version\":2,\"rev\":1,\"min_dispense_gap_s\":20}}", status);
  TEST_ASSERT_EQUAL_INT((int)ConfigStatus::UNSUPPORTED, (int)status);
  TEST_ASSERT_EQUAL_FLOAT(before.minDispenseGapS, config.minDispenseGapS);
}

void test_missing_revision_is_malformed(void) {
  ConfigStatus status = ConfigStatus::OK;
  applyJson("{\"config\":{\"version\":1,\"min_dispense_gap_s\":20}}", status);
  TEST_ASSERT_EQUAL_INT((int)ConfigStatus::MALFORMED, (int)status);
}

void test_config_must_be_an_object(void) {
  ConfigStatus status = ConfigStatus::OK;
  applyJson("{\"config\":[1,2,3]}", status);
  TEST_ASSERT_EQUAL_INT((int)ConfigStatus::MALFORMED, (int)status);

  status = ConfigStatus::OK;
  applyJson("{\"config\":\"nope\"}", status);
  TEST_ASSERT_EQUAL_INT((int)ConfigStatus::MALFORMED, (int)status);
}

void test_wrong_typed_field_is_malformed(void) {
  ConfigStatus status = ConfigStatus::OK;
  applyJson("{\"config\":{\"version\":1,\"rev\":1,\"max_grams_per_day\":\"lots\"}}", status);
  TEST_ASSERT_EQUAL_INT((int)ConfigStatus::MALFORMED, (int)status);
}

void test_fractional_integer_field_is_malformed(void) {
  ConfigStatus status = ConfigStatus::OK;
  applyJson("{\"config\":{\"version\":1,\"rev\":1,\"max_dispenses_per_hour\":3.5}}", status);
  TEST_ASSERT_EQUAL_INT((int)ConfigStatus::MALFORMED, (int)status);
}

void test_nan_patch_is_rejected(void) {
  ConfigPatch patch;
  patch.present[(uint8_t)ConfigFieldId::field_gramsPerFeeding] = true;
  patch.values[(uint8_t)ConfigFieldId::field_gramsPerFeeding] = NAN;
  DeviceConfig out;
  TEST_ASSERT_EQUAL_INT((int)ConfigStatus::OUT_OF_RANGE,
                        (int)applyConfigPatch(patch, defaultDeviceConfig(), out));
}

// ---------------------------------------------------------------- envelope

void test_out_of_range_field_rejects_the_whole_object(void) {
  const char *badKey = nullptr;
  ConfigStatus status = ConfigStatus::OK;

  // Above the daily hard guard: env must refuse, not clamp.
  DeviceConfig config = applyJson(
      "{\"config\":{\"version\":1,\"rev\":9,\"min_dispense_gap_s\":20,"
      "\"max_grams_per_day\":6000}}",
      status, badKey, defaultDeviceConfig());
  TEST_ASSERT_EQUAL_INT((int)ConfigStatus::OUT_OF_RANGE, (int)status);
  TEST_ASSERT_EQUAL_STRING("max_grams_per_day", badKey);
  TEST_ASSERT_EQUAL_FLOAT(10.0f, config.minDispenseGapS);  // untouched

  // The dashboard can never shorten the safety gap below 10 s...
  status = ConfigStatus::OK;
  applyJson("{\"config\":{\"version\":1,\"rev\":9,\"min_dispense_gap_s\":1}}", status, badKey,
            defaultDeviceConfig());
  TEST_ASSERT_EQUAL_INT((int)ConfigStatus::OUT_OF_RANGE, (int)status);
  TEST_ASSERT_EQUAL_STRING("min_dispense_gap_s", badKey);

  // ...raise the hourly ceiling above 6...
  status = ConfigStatus::OK;
  applyJson("{\"config\":{\"version\":1,\"rev\":9,\"max_dispenses_per_hour\":20}}", status);
  TEST_ASSERT_EQUAL_INT((int)ConfigStatus::OUT_OF_RANGE, (int)status);

  // ...disable the post-brownout hold or the OTA near-feed guard...
  status = ConfigStatus::OK;
  applyJson("{\"config\":{\"version\":1,\"rev\":9,\"brownout_hold_s\":0}}", status);
  TEST_ASSERT_EQUAL_INT((int)ConfigStatus::OUT_OF_RANGE, (int)status);
  status = ConfigStatus::OK;
  applyJson("{\"config\":{\"version\":1,\"rev\":9,\"ota_feed_guard_min\":0}}", status);
  TEST_ASSERT_EQUAL_INT((int)ConfigStatus::OUT_OF_RANGE, (int)status);

  // ...lengthen the relay beyond 300 s...
  status = ConfigStatus::OK;
  applyJson("{\"config\":{\"version\":1,\"rev\":9,\"max_dispense_ms\":600000}}", status);
  TEST_ASSERT_EQUAL_INT((int)ConfigStatus::OUT_OF_RANGE, (int)status);

  // ...or raise the dose above the 5,000 g envelope.
  status = ConfigStatus::OK;
  applyJson("{\"config\":{\"version\":1,\"rev\":9,\"max_grams_per_day\":5001}}", status);
  TEST_ASSERT_EQUAL_INT((int)ConfigStatus::OUT_OF_RANGE, (int)status);
}

void test_inverted_hopper_geometry_is_rejected(void) {
  ConfigStatus status = ConfigStatus::OK;
  applyJson(
      "{\"config\":{\"version\":1,\"rev\":9,\"hopper_full_cm\":30,\"hopper_empty_cm\":10}}",
      status);
  TEST_ASSERT_EQUAL_INT((int)ConfigStatus::OUT_OF_RANGE, (int)status);
}

void test_inverted_ota_window_is_rejected(void) {
  ConfigStatus status = ConfigStatus::OK;
  applyJson(
      "{\"config\":{\"version\":1,\"rev\":9,\"ota_window_start_min\":900,"
      "\"ota_window_end_min\":600}}",
      status);
  TEST_ASSERT_EQUAL_INT((int)ConfigStatus::OUT_OF_RANGE, (int)status);
}

// ---------------------------------------------------------------- E38

void test_no_per_dose_cap_daily_is_the_only_gram_cap(void) {
  DeviceConfig config = defaultDeviceConfig();
  // 4 g/s over the 300 s relay envelope is 1,200 g; the daily ceiling is 5,000.
  TEST_ASSERT_EQUAL_FLOAT(1200.0f, effectiveMaxGramsPerDose(config));

  // A slow motor no longer hides behind a 1,000 g constant: the daily ceiling
  // and the relay envelope bound it.
  config.gramsPerSecond = 10.0f;
  TEST_ASSERT_EQUAL_FLOAT(3000.0f, effectiveMaxGramsPerDose(config));

  config.maxGramsPerDay = 2000.0f;
  TEST_ASSERT_EQUAL_FLOAT(2000.0f, effectiveMaxGramsPerDose(config));

  config.maxDispenseMs = 120000.0f;
  TEST_ASSERT_EQUAL_FLOAT(1200.0f, effectiveMaxGramsPerDose(config));
}

void test_gate_accepts_a_dose_above_one_thousand_grams(void) {
  DeviceConfig config = defaultDeviceConfig();
  config.gramsPerSecond = 10.0f;  // 1,500 g = 150 s, inside 300 s
  DispenseLimits limits;
  limits.maxGramsPerDose = effectiveMaxGramsPerDose(config);
  limits.maxGramsPerDay = config.maxGramsPerDay;
  limits.maxDispenseMs = (unsigned long)config.maxDispenseMs;

  DispenseGate gate;
  gate.configure(limits);
  const unsigned long durationMs = (unsigned long)((1500.0f / 10.0f) * 1000.0f);
  TEST_ASSERT_EQUAL_INT((int)Refusal::NONE,
                        (int)gate.evaluate(1000, 1500.0f, durationMs, 0.0f, limits));

  // The relay envelope still refuses a dose that would run too long: 2,500 g at
  // 10 g/s is 250 s, past a 200 s envelope (still inside the 3,000 g dose bound
  // derived from the 300 s default, so the refusal is the time guard).
  limits.maxDispenseMs = 200000UL;
  const unsigned long tooLongMs = (unsigned long)((2500.0f / 10.0f) * 1000.0f);
  TEST_ASSERT_EQUAL_INT((int)Refusal::DOSE_TOO_LONG,
                        (int)gate.evaluate(1000, 2500.0f, tooLongMs, 0.0f, limits));
}

// ---------------------------------------------------------------- NVS

void test_nvs_roundtrip_preserves_every_field(void) {
  ConfigStatus status = ConfigStatus::MISSING;
  const DeviceConfig applied = applyJson(kFullConfig, status);
  TEST_ASSERT_EQUAL_INT((int)ConfigStatus::OK, (int)status);

  JsonDocument doc;
  writeConfigJson(applied, doc);
  DeviceConfig restored;
  const char *badKey = nullptr;
  TEST_ASSERT_EQUAL_INT((int)ConfigStatus::OK, (int)restoreConfig(doc, restored, &badKey));

  const ConfigFieldSpec *specs = configSpecs();
  for (uint8_t i = 0; i < configFieldCount(); i++) {
    TEST_ASSERT_EQUAL_FLOAT(applied.*(specs[i].member), restored.*(specs[i].member));
  }
}

void test_corrupt_nvs_copy_falls_back_to_defaults(void) {
  JsonDocument doc;
  deserializeJson(doc, "{\"min_dispense_gap_s\":1,\"max_grams_per_day\":9000}");
  DeviceConfig restored;
  const char *badKey = nullptr;
  TEST_ASSERT_EQUAL_INT((int)ConfigStatus::OUT_OF_RANGE,
                        (int)restoreConfig(doc, restored, &badKey));

  JsonDocument malformed;
  deserializeJson(malformed, "{\"max_grams_per_day\":\"huge\"}");
  TEST_ASSERT_EQUAL_INT((int)ConfigStatus::MALFORMED,
                        (int)restoreConfig(malformed, restored, &badKey));
}

void test_partial_nvs_copy_fills_gaps_with_defaults(void) {
  JsonDocument doc;
  deserializeJson(doc, "{\"min_dispense_gap_s\":15}");
  DeviceConfig restored;
  TEST_ASSERT_EQUAL_INT((int)ConfigStatus::OK,
                        (int)restoreConfig(doc, restored, nullptr));
  TEST_ASSERT_EQUAL_FLOAT(15.0f, restored.minDispenseGapS);
  TEST_ASSERT_EQUAL_FLOAT(5000.0f, restored.maxGramsPerDay);
  TEST_ASSERT_EQUAL_FLOAT(4.0f, restored.gramsPerSecond);
}

// ---------------------------------------------------------------- runner

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_defaults_match_the_shipped_values);
  RUN_TEST(test_every_field_has_an_envelope);
  RUN_TEST(test_full_config_applies);
  RUN_TEST(test_revision_is_read);
  RUN_TEST(test_missing_config_object_is_not_an_error);
  RUN_TEST(test_partial_config_keeps_the_last_good_value);
  RUN_TEST(test_unsupported_contract_version_is_ignored);
  RUN_TEST(test_missing_revision_is_malformed);
  RUN_TEST(test_config_must_be_an_object);
  RUN_TEST(test_wrong_typed_field_is_malformed);
  RUN_TEST(test_fractional_integer_field_is_malformed);
  RUN_TEST(test_nan_patch_is_rejected);
  RUN_TEST(test_out_of_range_field_rejects_the_whole_object);
  RUN_TEST(test_inverted_hopper_geometry_is_rejected);
  RUN_TEST(test_inverted_ota_window_is_rejected);
  RUN_TEST(test_no_per_dose_cap_daily_is_the_only_gram_cap);
  RUN_TEST(test_gate_accepts_a_dose_above_one_thousand_grams);
  RUN_TEST(test_nvs_roundtrip_preserves_every_field);
  RUN_TEST(test_corrupt_nvs_copy_falls_back_to_defaults);
  RUN_TEST(test_partial_nvs_copy_fills_gaps_with_defaults);
  return UNITY_END();
}
