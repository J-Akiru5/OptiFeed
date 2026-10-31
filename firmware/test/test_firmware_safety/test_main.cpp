/*
  Native (host) tests for the pure 1.6.0 safety and filter modules.

  Run with:  pio test -d firmware -e native
  No board, no network, no database. The tests cover the rules that the field
  evidence in docs/hardware/2026-10-28-cict-pin-map-and-health.md demands:
  spike rejection, persistence, hysteresis, the dispense gap/hourly/daily caps,
  safe-mode entry and exit, and the noisy-button disable.
*/
#include <unity.h>

#include <math.h>

#include "../../firmware-main/filters.h"
#include "../../firmware-main/safety.h"
#include "../../firmware-main/status.h"

using namespace fw;

void setUp(void) {}
void tearDown(void) {}

// ---------------------------------------------------------------- helpers

static HopperFilter::Config hopperConfig(unsigned long holdMs = 0) {
  HopperFilter::Config cfg;
  cfg.emptyCm = 30.0f;
  cfg.fullCm = 5.0f;
  cfg.rejectBelowCm = 2.0f;
  cfg.rejectAboveMarginCm = 10.0f;
  cfg.emaAlpha = 1.0f;  // deterministic: no smoothing lag in the tests
  cfg.jumpPct = 15.0f;
  cfg.persistCycles = 3;
  cfg.lowPct = 20.0f;
  cfg.refillMarginPct = 10.0f;
  cfg.stateHoldMs = holdMs;
  return cfg;
}

// One cycle of five identical samples.
static HopperFilter::Result cycle(HopperFilter &filter, float cm, unsigned long nowMs) {
  const float samples[5] = {cm, cm, cm, cm, cm};
  return filter.update(samples, 5, nowMs);
}

// 20 cm on a 5..30 cm hopper is 60 %.
static const float kSixtyPctCm = 20.0f;
// 18 cm is 48 %.
static const float kFortyEightPctCm = 18.0f;
// 29 cm is 4 %.
static const float kFourPctCm = 29.0f;
// 5 cm is 100 %.
static const float kFullCm = 5.0f;

// ---------------------------------------------------------------- filters

void test_median_rejects_empty_and_sorts(void) {
  const float values[5] = {30.0f, 18.0f, -1.0f, 0.5f, 19.0f};
  float out = 0.0f;
  TEST_ASSERT_TRUE(medianOf(values, 5, out));
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 18.0f, out);

  TEST_ASSERT_FALSE(medianOf(values, 0, out));
  TEST_ASSERT_FALSE(medianOf(nullptr, 3, out));
}

void test_temperature_rejects_library_sentinels(void) {
  TEST_ASSERT_FALSE(temperaturePlausible(-127.0f));  // DEVICE_DISCONNECTED_C
  TEST_ASSERT_FALSE(temperaturePlausible(85.0f));    // power-on reset value
  TEST_ASSERT_FALSE(temperaturePlausible(0.0f));
  TEST_ASSERT_FALSE(temperaturePlausible(50.0f));
  TEST_ASSERT_FALSE(temperaturePlausible(-5.0f));
  TEST_ASSERT_FALSE(temperaturePlausible(NAN));
  TEST_ASSERT_TRUE(temperaturePlausible(28.4f));
  TEST_ASSERT_TRUE(temperaturePlausible(0.5f));
}

void test_hopper_first_valid_cycle_reports_its_percentage(void) {
  HopperFilter filter;
  filter.configure(hopperConfig());
  const HopperFilter::Result r = cycle(filter, kFortyEightPctCm, 1000);
  TEST_ASSERT_TRUE(r.valid);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 48.0f, r.percent);
  TEST_ASSERT_FALSE(r.low);
  TEST_ASSERT_TRUE(filter.hasReading());
}

void test_hopper_rejects_a_cycle_of_spikes_and_keeps_the_last_reading(void) {
  HopperFilter filter;
  filter.configure(hopperConfig());
  const HopperFilter::Result first = cycle(filter, kFortyEightPctCm, 1000);
  TEST_ASSERT_TRUE(first.valid);

  // A zero-length echo (-1) and out-of-range distances must not become 0 %.
  const float spikes[5] = {-1.0f, 0.0f, 1.5f, 41.0f, -1.0f};
  const HopperFilter::Result spike = filter.update(spikes, 5, 2000);
  TEST_ASSERT_FALSE(spike.valid);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 48.0f, spike.percent);
  TEST_ASSERT_FALSE(spike.low);

  // And the next good cycle is unaffected.
  const HopperFilter::Result again = cycle(filter, kFortyEightPctCm, 3000);
  TEST_ASSERT_TRUE(again.valid);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 48.0f, again.percent);
}

void test_hopper_ignores_a_few_samples_of_which_most_are_implausible(void) {
  HopperFilter filter;
  filter.configure(hopperConfig());
  cycle(filter, kFortyEightPctCm, 1000);

  // Only two plausible samples: below the three-sample minimum, so unknown.
  const float mixed[5] = {18.0f, 18.0f, -1.0f, 0.0f, 60.0f};
  const HopperFilter::Result r = filter.update(mixed, 5, 2000);
  TEST_ASSERT_FALSE(r.valid);
}

void test_hopper_persistence_needs_three_cycles_for_a_big_jump(void) {
  HopperFilter filter;
  filter.configure(hopperConfig());
  cycle(filter, kFortyEightPctCm, 1000);

  // 48 % -> 4 % is a 44-point jump: the first two cycles keep the old value.
  const HopperFilter::Result first = cycle(filter, kFourPctCm, 2000);
  const HopperFilter::Result second = cycle(filter, kFourPctCm, 3000);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 48.0f, first.percent);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 48.0f, second.percent);

  // The third consecutive cycle is believed.
  const HopperFilter::Result third = cycle(filter, kFourPctCm, 4000);
  TEST_ASSERT_TRUE(third.valid);
  TEST_ASSERT_TRUE(third.low);
  TEST_ASSERT_TRUE(third.stateChanged);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 4.0f, third.percent);
}

void test_hopper_alternating_flap_never_changes_state(void) {
  HopperFilter filter;
  filter.configure(hopperConfig());
  cycle(filter, kFortyEightPctCm, 1000);

  unsigned long now = 2000;
  for (int i = 0; i < 20; i++) {
    const HopperFilter::Result r = cycle(filter, (i % 2 == 0) ? kFourPctCm : kFortyEightPctCm, now);
    TEST_ASSERT_FALSE(r.low);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 48.0f, r.percent);
    now += 1000;
  }
}

void test_hopper_hysteresis_holds_low_inside_the_band(void) {
  HopperFilter filter;
  filter.configure(hopperConfig());
  cycle(filter, kFortyEightPctCm, 1000);

  for (int i = 0; i < 3; i++) cycle(filter, kFourPctCm, 2000 + (unsigned long)i * 1000);
  TEST_ASSERT_TRUE(filter.hasReading());

  // 28 cm is 8 %... climb into the band (25 %): still low, reported at the cap.
  const float bandCm = 23.75f;  // (30 - 23.75) / 25 = 25 %
  HopperFilter::Result r = cycle(filter, bandCm, 6000);
  r = cycle(filter, bandCm, 7000);
  r = cycle(filter, bandCm, 8000);
  TEST_ASSERT_TRUE(r.low);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 20.0f, r.percent);
  TEST_ASSERT_FALSE(r.stateChanged);

  // Refill to 100 %: leaves low only because it is above threshold + 10.
  for (int i = 0; i < 3; i++) r = cycle(filter, kFullCm, 9000 + (unsigned long)i * 1000);
  TEST_ASSERT_FALSE(r.low);
  TEST_ASSERT_TRUE(r.refilled);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 100.0f, r.percent);
}

void test_hopper_state_change_waits_for_the_hold_time(void) {
  HopperFilter filter;
  filter.configure(hopperConfig(10UL * 60UL * 1000UL));
  cycle(filter, kFortyEightPctCm, 1000);

  // Three cycles agree on 4 %, but the 10-minute hold has not elapsed.
  HopperFilter::Result r = cycle(filter, kFourPctCm, 2000);
  TEST_ASSERT_FALSE(r.low);
  r = cycle(filter, kFourPctCm, 3000);
  TEST_ASSERT_FALSE(r.low);
  r = cycle(filter, kFourPctCm, 4000);
  TEST_ASSERT_FALSE(r.low);

  // Still inside the hold.
  r = cycle(filter, kFourPctCm, 599999);
  TEST_ASSERT_FALSE(r.low);

  // Once the hold passes the state flips exactly once.
  r = cycle(filter, kFourPctCm, 601001);
  TEST_ASSERT_TRUE(r.low);
  TEST_ASSERT_TRUE(r.stateChanged);
  r = cycle(filter, kFourPctCm, 602001);
  TEST_ASSERT_TRUE(r.low);
  TEST_ASSERT_FALSE(r.stateChanged);
}

void test_hopper_never_reports_a_zero_for_an_invalid_first_cycle(void) {
  HopperFilter filter;
  filter.configure(hopperConfig());
  const float invalid[5] = {-1.0f, -1.0f, -1.0f, -1.0f, -1.0f};
  const HopperFilter::Result r = filter.update(invalid, 5, 1000);
  TEST_ASSERT_FALSE(r.valid);
  TEST_ASSERT_FALSE(filter.hasReading());
}

// ---------------------------------------------------------------- dispense gate

void test_dispense_gate_gap_between_any_two_dispenses(void) {
  DispenseGate gate;
  DispenseLimits limits;
  limits.minGapMs = 10000UL;
  limits.maxPerHour = 6;
  limits.maxGramsPerDose = 1000.0f;
  limits.maxGramsPerDay = 5000.0f;
  limits.maxDispenseMs = 300000UL;
  gate.configure(limits);

  TEST_ASSERT_TRUE(gate.evaluate(1000, 100.0f, 25000UL, 0.0f) == Refusal::NONE);
  gate.recordStart(1000);

  TEST_ASSERT_TRUE(gate.evaluate(2000, 100.0f, 25000UL, 0.0f) == Refusal::TOO_SOON);
  TEST_ASSERT_TRUE(gate.evaluate(10999, 100.0f, 25000UL, 0.0f) == Refusal::TOO_SOON);
  TEST_ASSERT_TRUE(gate.evaluate(11000, 100.0f, 25000UL, 0.0f) == Refusal::NONE);
}

void test_dispense_gate_hourly_ceiling(void) {
  DispenseGate gate;
  DispenseLimits limits;
  limits.minGapMs = 0;
  limits.maxPerHour = 6;
  gate.configure(limits);

  for (int i = 0; i < 6; i++) {
    const unsigned long now = 1000 + (unsigned long)i * 20000;
    TEST_ASSERT_TRUE(gate.evaluate(now, 50.0f, 12500UL, 0.0f) == Refusal::NONE);
    gate.recordStart(now);
  }
  TEST_ASSERT_TRUE(gate.evaluate(130000, 50.0f, 12500UL, 0.0f) == Refusal::HOURLY_LIMIT);

  // An hour after the first one the oldest slot no longer counts: at 1 h + 1 s
  // only five remain... but six were recorded, so one left the window.
  TEST_ASSERT_TRUE(gate.evaluate(1000 + 3600000UL + 1UL, 50.0f, 12500UL, 0.0f) == Refusal::NONE);
}

void test_dispense_gate_daily_cap_and_absolute_limits(void) {
  DispenseGate gate;
  DispenseLimits limits;
  limits.minGapMs = 0;
  limits.maxPerHour = 100;
  limits.maxGramsPerDose = 1000.0f;
  limits.maxGramsPerDay = 5000.0f;
  limits.maxDispenseMs = 300000UL;
  gate.configure(limits);

  TEST_ASSERT_TRUE(gate.evaluate(1000, 0.0f, 0UL, 0.0f) == Refusal::GRAMS_OUT_OF_RANGE);
  TEST_ASSERT_TRUE(gate.evaluate(1000, 1001.0f, 1000UL, 0.0f) == Refusal::GRAMS_OUT_OF_RANGE);
  TEST_ASSERT_TRUE(gate.evaluate(1000, 100.0f, 300001UL, 0.0f) == Refusal::DOSE_TOO_LONG);
  TEST_ASSERT_TRUE(gate.evaluate(1000, 100.0f, 25000UL, 4950.0f) == Refusal::DAILY_CAP);
  TEST_ASSERT_TRUE(gate.evaluate(1000, 100.0f, 25000UL, 4900.0f) == Refusal::NONE);
}

void test_dispense_gate_calibration_exception(void) {
  DispenseGate gate;
  DispenseLimits normal;
  normal.minGapMs = 0;
  normal.maxPerHour = 6;
  normal.maxGramsPerDose = 1000.0f;
  normal.maxGramsPerDay = 5000.0f;
  normal.maxDispenseMs = 300000UL;
  gate.configure(normal);

  DispenseLimits calibration = normal;
  calibration.maxGramsPerDose = 5000.0f;
  calibration.maxDispenseMs = 600000UL;

  // A 10-minute, 5 kg dose is refused by the normal gate...
  TEST_ASSERT_TRUE(gate.evaluate(1000, 5000.0f, 600000UL, 0.0f) == Refusal::GRAMS_OUT_OF_RANGE);
  // ...and allowed only when the calibration limits are passed explicitly.
  TEST_ASSERT_TRUE(gate.evaluate(1000, 5000.0f, 600000UL, 0.0f, calibration) == Refusal::NONE);
  // The calibration ceiling is still a ceiling.
  TEST_ASSERT_TRUE(gate.evaluate(1000, 5000.1f, 600000UL, 0.0f, calibration) ==
                   Refusal::GRAMS_OUT_OF_RANGE);
  TEST_ASSERT_TRUE(gate.evaluate(1000, 5000.0f, 600001UL, 0.0f, calibration) ==
                   Refusal::DOSE_TOO_LONG);
}

void test_refusal_reasons_match_the_server_contract(void) {
  TEST_ASSERT_EQUAL_STRING("too_soon", refusalReason(Refusal::TOO_SOON));
  TEST_ASSERT_EQUAL_STRING("hourly_limit", refusalReason(Refusal::HOURLY_LIMIT));
  TEST_ASSERT_EQUAL_STRING("safe_mode", refusalReason(Refusal::SAFE_MODE));
  TEST_ASSERT_EQUAL_STRING("relay_overrun", refusalReason(Refusal::RELAY_OVERRUN));
  TEST_ASSERT_EQUAL_STRING("daily_gram_cap_exceeded", refusalReason(Refusal::DAILY_CAP));
  TEST_ASSERT_EQUAL_STRING("dose_time_exceeds_cap", refusalReason(Refusal::DOSE_TOO_LONG));
}

// ---------------------------------------------------------------- safe mode

void test_reset_history_counts_three_abnormal_resets_in_ten_minutes(void) {
  ResetHistory history;
  TEST_ASSERT_TRUE(history.addBoot(RESET_BROWNOUT, 1000, true, 600));
  TEST_ASSERT_TRUE(history.addBoot(RESET_TASK_WDT, 1120, true, 600));
  TEST_ASSERT_FALSE(history.safeModeRequired(3));
  TEST_ASSERT_TRUE(history.addBoot(RESET_BROWNOUT, 1180, true, 600));
  TEST_ASSERT_TRUE(history.safeModeRequired(3));
  TEST_ASSERT_EQUAL_UINT8(3, history.count());
  TEST_ASSERT_TRUE((history.mask() & (1UL << RESET_BROWNOUT)) != 0);
  TEST_ASSERT_TRUE((history.mask() & (1UL << RESET_TASK_WDT)) != 0);
}

void test_reset_history_does_not_count_brownouts_spread_over_an_hour(void) {
  ResetHistory history;
  history.addBoot(RESET_BROWNOUT, 1000, true, 600);
  history.addBoot(RESET_BROWNOUT, 2000, true, 600);  // same window (1000 s? no: >600)
  // The second reset is 1000 s after the first: it starts a new window.
  TEST_ASSERT_EQUAL_UINT8(1, history.count());
  history.addBoot(RESET_BROWNOUT, 2500, true, 600);
  history.addBoot(RESET_BROWNOUT, 3000, true, 600);
  TEST_ASSERT_TRUE(history.safeModeRequired(3));
}

void test_reset_history_poweron_clears_and_normal_resets_do_not_count(void) {
  ResetHistory history;
  history.addBoot(RESET_BROWNOUT, 1000, true, 600);
  history.addBoot(RESET_BROWNOUT, 1100, true, 600);
  history.addBoot(RESET_SOFTWARE, 1200, true, 600);  // deliberate restart
  TEST_ASSERT_EQUAL_UINT8(2, history.count());
  history.addBoot(RESET_POWERON, 1300, true, 600);
  TEST_ASSERT_EQUAL_UINT8(0, history.count());
  TEST_ASSERT_EQUAL_UINT32(0, history.mask());
}

void test_reset_history_without_a_clock_counts_consecutive_resets(void) {
  ResetHistory history;
  history.addBoot(RESET_PANIC, 0, false, 600);
  history.addBoot(RESET_TASK_WDT, 0, false, 600);
  TEST_ASSERT_FALSE(history.safeModeRequired(3));
  history.addBoot(RESET_BROWNOUT, 0, false, 600);
  TEST_ASSERT_TRUE(history.safeModeRequired(3));
}

void test_safe_mode_window_is_thirty_minutes(void) {
  SafeModeWindow window;
  window.begin(true, 1700000000UL, 5000, 30UL * 60UL * 1000UL);
  TEST_ASSERT_TRUE(window.clockAnchored());
  TEST_ASSERT_EQUAL_UINT32(1700000000UL + 1800UL, window.untilEpoch());
  TEST_ASSERT_FALSE(window.elapsed(true, 1700001700UL, 100000));
  TEST_ASSERT_TRUE(window.elapsed(true, 1700001800UL, 100000));
}

void test_safe_mode_window_falls_back_to_uptime_without_a_clock(void) {
  SafeModeWindow window;
  window.begin(false, 0, 10000, 30UL * 60UL * 1000UL);
  TEST_ASSERT_FALSE(window.clockAnchored());
  TEST_ASSERT_FALSE(window.elapsed(false, 0, 10000 + 1799999UL));
  TEST_ASSERT_TRUE(window.elapsed(false, 0, 10000 + 1800000UL));
}

void test_safe_mode_window_resumes_from_nvs(void) {
  SafeModeWindow window;
  window.resume(1700001800UL, 100, 30UL * 60UL * 1000UL);
  TEST_ASSERT_FALSE(window.elapsed(true, 1700001000UL, 100));
  TEST_ASSERT_TRUE(window.elapsed(true, 1700001800UL, 100));
}

void test_describe_reset_reasons(void) {
  char out[64];
  describeResetReasons((1UL << RESET_BROWNOUT) | (1UL << RESET_TASK_WDT), out, sizeof(out));
  TEST_ASSERT_EQUAL_STRING("task_wdt,brownout", out);
  describeResetReasons(0, out, sizeof(out));
  TEST_ASSERT_EQUAL_STRING("none", out);
}

// ---------------------------------------------------------------- button guard

void test_button_noise_disables_after_more_than_five_glitches_in_a_minute(void) {
  ButtonNoiseGuard guard;
  guard.configure(60000UL, 5, 600000UL);

  for (int i = 0; i < 5; i++) {
    guard.recordGlitch(1000 + (unsigned long)i * 1000);
    TEST_ASSERT_FALSE(guard.disabled(1000 + (unsigned long)i * 1000));
  }
  guard.recordGlitch(7000);
  TEST_ASSERT_TRUE(guard.justDisabled());
  TEST_ASSERT_TRUE(guard.disabled(7001));

  // Still disabled at 9 minutes 59 s, back at 10 minutes.
  TEST_ASSERT_TRUE(guard.disabled(7000 + 599999UL));
  TEST_ASSERT_FALSE(guard.disabled(7000 + 600000UL));
  TEST_ASSERT_FALSE(guard.justDisabled());
}

void test_button_noise_window_forgets_old_glitches(void) {
  ButtonNoiseGuard guard;
  guard.configure(60000UL, 5, 600000UL);
  for (int i = 0; i < 4; i++) guard.recordGlitch(1000 + (unsigned long)i * 1000);
  // More than a minute later the window restarts: the 5th is the first of a
  // new window, so the button stays enabled.
  guard.recordGlitch(100000);
  guard.recordGlitch(100001);
  TEST_ASSERT_FALSE(guard.disabled(100002));
}

// ---------------------------------------------------------------- rate limits

void test_token_bucket_refills_and_caps(void) {
  TokenBucket bucket;
  bucket.configure(2, 1000UL);
  TEST_ASSERT_TRUE(bucket.tryConsume(100));
  TEST_ASSERT_TRUE(bucket.tryConsume(100));
  TEST_ASSERT_FALSE(bucket.tryConsume(100));
  TEST_ASSERT_TRUE(bucket.tryConsume(1100));
  TEST_ASSERT_FALSE(bucket.tryConsume(1100));
  // Ten seconds later only two tokens are available, not ten.
  TEST_ASSERT_TRUE(bucket.tryConsume(11100));
  TEST_ASSERT_TRUE(bucket.tryConsume(11100));
  TEST_ASSERT_FALSE(bucket.tryConsume(11100));
}

void test_net_retry_backs_off_exponentially_and_caps(void) {
  NetRetry retry;
  retry.configure(5000UL, 300000UL);
  TEST_ASSERT_TRUE(retry.ready(0));

  retry.recordFailure(1000, 0);
  TEST_ASSERT_FALSE(retry.ready(1000 + 4999));
  TEST_ASSERT_TRUE(retry.ready(1000 + 5000));

  retry.recordFailure(1000, 0);  // failures = 2 -> 10 s
  TEST_ASSERT_FALSE(retry.ready(1000 + 9999));
  TEST_ASSERT_TRUE(retry.ready(1000 + 10000));

  for (int i = 0; i < 10; i++) retry.recordFailure(1000, 0);
  TEST_ASSERT_FALSE(retry.ready(1000 + 299999));
  TEST_ASSERT_TRUE(retry.ready(1000 + 300000));

  retry.recordSuccess();
  TEST_ASSERT_TRUE(retry.ready(0));
  TEST_ASSERT_EQUAL_UINT8(0, retry.failures());
}

void test_net_retry_jitter_stays_inside_twenty_percent(void) {
  NetRetry retry;
  retry.configure(10000UL, 300000UL);
  retry.recordFailure(0, -20);   // 10 s base, minus 20 % -> 8 s
  TEST_ASSERT_FALSE(retry.ready(7999));
  TEST_ASSERT_TRUE(retry.ready(8000));

  retry.recordFailure(0, 20);    // second failure: 20 s base, plus 20 % -> 24 s
  TEST_ASSERT_FALSE(retry.ready(23999));
  TEST_ASSERT_TRUE(retry.ready(24000));
}

// ---------------------------------------------------------------- status (1.8.0)

void test_fault_debounce_needs_consecutive_failures(void) {
  FaultDebounce d;
  d.configure(3);
  TEST_ASSERT_FALSE(d.update(false));
  TEST_ASSERT_FALSE(d.update(false));
  TEST_ASSERT_FALSE(d.update(true));   // one good check resets the run
  TEST_ASSERT_FALSE(d.update(false));
  TEST_ASSERT_FALSE(d.update(false));
  TEST_ASSERT_TRUE(d.update(false));
  TEST_ASSERT_TRUE(d.update(false));
  TEST_ASSERT_FALSE(d.update(true));   // recovers on the first pass
}

void test_fault_latches_until_cause_gone_and_acknowledged(void) {
  FaultManager f;
  TEST_ASSERT_FALSE(f.indicatorOn());
  TEST_ASSERT_TRUE(f.report(Fault::RTC, true, 1000, 10));
  TEST_ASSERT_FALSE(f.report(Fault::RTC, true, 1001, 20));   // already latched
  TEST_ASSERT_TRUE(f.indicatorOn());

  // Acknowledging while the cause is present clears nothing.
  TEST_ASSERT_EQUAL_UINT8(0, f.acknowledge());
  TEST_ASSERT_TRUE(f.indicatorOn());

  // Cause gone: still latched until the operator acknowledges.
  f.report(Fault::RTC, false, 1002, 30);
  TEST_ASSERT_TRUE(f.indicatorOn());
  TEST_ASSERT_EQUAL_UINT8(faultBit(Fault::RTC), f.acknowledge());
  TEST_ASSERT_FALSE(f.indicatorOn());
  TEST_ASSERT_EQUAL_UINT16(1, f.count(Fault::RTC));
  TEST_ASSERT_EQUAL_UINT32(1000, f.lastEpoch());
}

void test_fault_acknowledge_keeps_faults_still_present(void) {
  FaultManager f;
  f.report(Fault::HOPPER_SENSOR, true, 0, 1);
  f.raiseEvent(Fault::RELAY_OVERRUN, 0, 2);
  TEST_ASSERT_TRUE(f.latched(Fault::RELAY_OVERRUN));
  TEST_ASSERT_FALSE(f.present(Fault::RELAY_OVERRUN));
  TEST_ASSERT_EQUAL_UINT8(faultBit(Fault::RELAY_OVERRUN), f.acknowledge());
  TEST_ASSERT_TRUE(f.latched(Fault::HOPPER_SENSOR));
  TEST_ASSERT_TRUE(f.indicatorOn());
  TEST_ASSERT_EQUAL(Fault::RELAY_OVERRUN, f.lastFault());
}

void test_fault_counts_each_new_occurrence(void) {
  FaultManager f;
  f.raiseEvent(Fault::RELAY_OVERRUN, 0, 1);
  f.raiseEvent(Fault::RELAY_OVERRUN, 0, 2);   // re-trips while latched
  TEST_ASSERT_EQUAL_UINT16(2, f.count(Fault::RELAY_OVERRUN));
  TEST_ASSERT_FALSE(f.report(Fault::NONE, true, 0, 3));
  TEST_ASSERT_EQUAL_STRING("hopper_sensor", faultName(Fault::HOPPER_SENSOR));
  TEST_ASSERT_EQUAL_STRING("safe_mode", faultName(Fault::SAFE_MODE));
}

void test_indicators_follow_the_status_rules(void) {
  IndicatorInputs in = { false, false, false, false };
  IndicatorLevels out = indicatorLevels(in, 0, 1000);
  TEST_ASSERT_TRUE(out.power);
  TEST_ASSERT_FALSE(out.feeding);
  TEST_ASSERT_FALSE(out.wifi);   // disconnected: blue off, not a fault
  TEST_ASSERT_FALSE(out.fault);

  in.feeding = true;
  in.wifiConnected = true;
  in.fault = true;
  out = indicatorLevels(in, 0, 1000);
  TEST_ASSERT_TRUE(out.feeding);
  TEST_ASSERT_TRUE(out.wifi);    // solid only once joined
  TEST_ASSERT_TRUE(out.fault);
}

void test_wifi_indicator_blinks_while_provisioning(void) {
  IndicatorInputs in = { false, true, true, false };   // join test connected
  TEST_ASSERT_TRUE(indicatorLevels(in, 0, 1000).wifi);
  TEST_ASSERT_TRUE(indicatorLevels(in, 499, 1000).wifi);
  TEST_ASSERT_FALSE(indicatorLevels(in, 500, 1000).wifi);
  TEST_ASSERT_FALSE(indicatorLevels(in, 999, 1000).wifi);
  TEST_ASSERT_TRUE(indicatorLevels(in, 1000, 1000).wifi);
}

int main(int, char **) {
  UNITY_BEGIN();

  RUN_TEST(test_median_rejects_empty_and_sorts);
  RUN_TEST(test_temperature_rejects_library_sentinels);
  RUN_TEST(test_hopper_first_valid_cycle_reports_its_percentage);
  RUN_TEST(test_hopper_rejects_a_cycle_of_spikes_and_keeps_the_last_reading);
  RUN_TEST(test_hopper_ignores_a_few_samples_of_which_most_are_implausible);
  RUN_TEST(test_hopper_persistence_needs_three_cycles_for_a_big_jump);
  RUN_TEST(test_hopper_alternating_flap_never_changes_state);
  RUN_TEST(test_hopper_hysteresis_holds_low_inside_the_band);
  RUN_TEST(test_hopper_state_change_waits_for_the_hold_time);
  RUN_TEST(test_hopper_never_reports_a_zero_for_an_invalid_first_cycle);

  RUN_TEST(test_dispense_gate_gap_between_any_two_dispenses);
  RUN_TEST(test_dispense_gate_hourly_ceiling);
  RUN_TEST(test_dispense_gate_daily_cap_and_absolute_limits);
  RUN_TEST(test_dispense_gate_calibration_exception);
  RUN_TEST(test_refusal_reasons_match_the_server_contract);

  RUN_TEST(test_reset_history_counts_three_abnormal_resets_in_ten_minutes);
  RUN_TEST(test_reset_history_does_not_count_brownouts_spread_over_an_hour);
  RUN_TEST(test_reset_history_poweron_clears_and_normal_resets_do_not_count);
  RUN_TEST(test_reset_history_without_a_clock_counts_consecutive_resets);
  RUN_TEST(test_safe_mode_window_is_thirty_minutes);
  RUN_TEST(test_safe_mode_window_falls_back_to_uptime_without_a_clock);
  RUN_TEST(test_safe_mode_window_resumes_from_nvs);
  RUN_TEST(test_describe_reset_reasons);

  RUN_TEST(test_button_noise_disables_after_more_than_five_glitches_in_a_minute);
  RUN_TEST(test_button_noise_window_forgets_old_glitches);

  RUN_TEST(test_token_bucket_refills_and_caps);
  RUN_TEST(test_net_retry_backs_off_exponentially_and_caps);
  RUN_TEST(test_net_retry_jitter_stays_inside_twenty_percent);

  RUN_TEST(test_fault_debounce_needs_consecutive_failures);
  RUN_TEST(test_fault_latches_until_cause_gone_and_acknowledged);
  RUN_TEST(test_fault_acknowledge_keeps_faults_still_present);
  RUN_TEST(test_fault_counts_each_new_occurrence);
  RUN_TEST(test_indicators_follow_the_status_rules);
  RUN_TEST(test_wifi_indicator_blinks_while_provisioning);

  return UNITY_END();
}
