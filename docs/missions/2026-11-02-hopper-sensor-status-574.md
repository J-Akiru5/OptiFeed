# Mission 2026-11-02 — Hopper sensor status (#574)

Issue: <https://github.com/J-Akiru5/OptiFeed/issues/574>
Branch: `fix/574-sensor-status` (from `develop`)

## What the issue asked for

1. The ultrasonic reading must read **offline** when the sensor is not attached or the
   ESP32 is offline, while still showing the **last known** hopper level.
2. Bug: an ESP32 that is online but has no sensor still shows the ultrasonic as live.
3. Readings should be more frequent than 5 s (1 s) to count as realtime; because of the
   database write volume, record only in the hour before a feeding window and add an
   on-demand **Refresh** button.
4. Tell the team whether a reflash is required.

## What this change implements

### Sensor offline, last reading kept

- `lib/device-hopper.ts` gains `resolveHopperSensorOffline()` and `HopperSnapshot.sensorOffline`.
  A reading is sensor-offline when either:
  - the firmware reports the `hopper_sensor` fault (bit 1 of `diag.faults_present`, set after
    three consecutive no-echo checks — about 15 s online, 3 min offline), or
  - the unit is online but the level has not been refreshed for **twice** the configured
    offline window (10 min at the default 5 min). This is the fallback for firmware older
    than 1.6.0, which has no `diag` block.
- A fully offline unit is deliberately **not** labelled sensor-offline: the reader already
  says Offline and the sensor is not the part at fault.
- `loadPondHopper()` reads the newest `device_health` row (one bounded query, advisory on
  failure) so the sidebar gets the fault without a new schema or migration.
- The dashboard card and the sidebar show `Last known N%` with an **Ultrasonic offline**
  tag instead of a live value. The remaining-feed estimate is hidden, because it is only
  meaningful for a current reading.
- i18n: `dashboard.feedLevel.sensorOffline` added to `en`, `tl`, `hil`; the Tagalog string
  is added to the `tl.draft-keys.json` review queue rather than claimed as reviewed.

Surfaces that build a snapshot without a health read (hardware settings, history, admin and
platform device lists) still get the age fallback. Wiring the explicit fault into those is a
follow-up, not a correctness gap for the dashboard.

### Tests

`lib/__tests__/hopper-sensor-offline.test.tsx` covers the fault flag, the age fallback, the
offline-vs-sensor precedence, the preserved last-known value, and both rendered tags.

## Answer 4 — do we need to reflash?

| Ask | Reflash? | Why |
| --- | --- | --- |
| Mark the ultrasonic offline | **No** | The firmware already reports `hopper_sensor` in `diag.faults_present`; the fix is server-side. |
| 2 s polling | **No** | `heartbeat_interval_s` already allows 2–300 s; set it through the firmware gates. |
| 1 s polling | **Yes** | The firmware and server both clamp the minimum to 2 s (`firmware-main/config.h:95`, `apps/web/lib/firmware/config.ts:396`). The bound has to change on the device. |
| On-demand “read the sensor now” button | **Yes** | The device command poll carries config and feed requests only; there is no ping command for the firmware to answer. A true refresh needs a new command type on both sides. |

A UI button that only calls `router.refresh()` would re-read the last stored value, not the
sensor, so it is intentionally not added — it would look like a live probe without being one.

## Answer 3 — database volume

The 30-minute / 5 % throttle already exists, so a faster heartbeat does not multiply rows:

- every heartbeat: one `EnergyDevice` **UPDATE** (`lastSeenAt`, energy counters), no insert;
- `FeedLevelLog`: one insert at most every 30 min, or when the level moves more than 5 %
  (`app/api/ingest/route.ts`, the `shouldLog` block);
- `WaterTempLog`: at most one row per device per 5 min;
- `DeviceStateEvent`: only when the reported state changes;
- notifications: episode-based, not per heartbeat.

At 1 s the cost is 5× the HTTP requests and 5× the row updates compared with 5 s, not 5× the
inserts. Dropping history outside the hour before a feeding would also gut the hopper chart,
which reads `FeedLevelLog`; the throttle is the safer lever. If request volume still matters,
raising the heartbeat to 2 s is the no-reflash setting and gives the “realtime” feel the
evaluator asked for.

## Follow-ups (not in this change)

- Wire the explicit `hopper_sensor` fault into the hardware, history and admin surfaces.
- Add a `read_sensor` device command if a true on-demand probe is required; that is a
  firmware change and a reflash.
- Decide on 2 s (config only) versus 1 s (firmware bound change) with the team.
