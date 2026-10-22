# WiFi provisioning — design and rollout

Status: dashboard panel implemented (2026-10-22); the firmware branch is
**pending bench verification**. Do not flash a production unit before it passes.
Owner: Jeff.

## What exists today (verified)

- WiFi credentials are compile-time placeholders (`DEFAULT_WIFI_SSID` /
  `DEFAULT_WIFI_PASS`) with an NVS override path.
- `loadWiFiCredentials()` reads NVS; `saveWiFiCredentials()` exists but **has no
  caller anywhere in the firmware**.
- There is no SoftAP, captive portal, BLE, serial command parser or config
  endpoint. A freshly flashed unit with empty NVS tries `YOUR_WIFI_SSID` and
  cannot be corrected without reflashing or an external NVS write.
- The dashboard's network form was static markup with fake values and a dead
  Save button. It was disabled in the 2026-10-22 quality pass, then replaced by
  the read-only WiFi setup panel described below.
- The server has no WiFi fields and no provisioning route. `/api/schedule-sync`
  and `/api/feed-command` require the device to already be online.
- Documentation (`CHANGELOG.md`, `TESTING-CHECKLIST.html`) claims provisioning
  that does not exist.

## Why not server-side credentials

A device with no network cannot fetch credentials from the server. Storing a
household WiFi password in `EnergyDevice` and pushing it through
`schedule-sync` would:

- not work for first-time provisioning (chicken-and-egg);
- turn a device token into a WiFi-password bearer credential;
- expose PSKs to every whole-row query, backup and support session, since
  Prisma runs as the table owner and bypasses RLS.

Rejected for v1. If remote rotation is ever required, it is a separate feature
for already-online devices with envelope encryption/KMS, strict owner scoping,
audit and no read-back.

## Chosen design: device-hosted SoftAP portal

1. On boot, if the stored SSID is missing/placeholder, or the device fails to
   join N consecutive times, start an access point named
   `OptiFeed-XXXX` (last four hex of the MAC).
2. Serve a minimal setup page at `http://192.168.4.1` with SSID and password
   fields and a Save button.
3. Save both values to the existing NVS keys (`wifi_ssid`, `wifi_pass`), reboot,
   and join the network.
4. Recovery without reflashing: hold the feed button (GPIO 27) for ~5 seconds
   during boot to clear the WiFi keys and reopen the portal. The portal also
   reopens on repeated join failure.
5. No password is logged, stored server-side, sent to the server, or included in
   telemetry.

### Security notes

- The setup AP is local-only and open for v1 (no per-device label exists yet).
  It must stop once provisioning succeeds. A future revision can protect it
  with a printed per-device PSK.
- The form validates SSID 1–32 chars and password 8–63 chars (WPA2), or empty
  for an open network; HTML output escapes the SSID.
- The portal is not reachable from the internet and is not exposed by the
  Next.js app in any way.

## Dashboard (honest UI)

**Implemented** in `apps/web/app/[locale]/(dashboard)/dashboard/settings/hardware/page.tsx`
(branch `feat/wifi-provisioning-ui`). The hardware page replaces the fake
network form with a read-only WiFi setup panel:

- the AP name is derived from the selected `EnergyDevice.mac`: uppercase hex,
  strip `:`/`-`/`.`/spaces, take the last four characters, prefix
  `OptiFeed-` (e.g. `A4:CF:12:7E:3B:09` → `OptiFeed-3B09`);
- no paired device: a neutral "No device paired yet" message instead of an AP
  name, and no status claim;
- device online (`lastSeenAt` within 5 minutes): "WiFi is already configured on
  the device" plus a note that the setup AP is off;
- device offline or never seen: the three provisioning steps and the
  button-hold recovery instruction;
- no password field, no Save button, no server-URL field. The server URL was
  removed because firmware URLs are compile-time, and the dashboard has no
  write path for WiFi credentials.

The firmware side of this design is still pending bench verification.

## Acceptance criteria

- [ ] Fresh/erased NVS: `OptiFeed-XXXX` appears within 10 s of boot.
- [ ] Saving valid credentials reboots and the device heartbeats within 60 s.
- [ ] Wrong password: portal is recoverable by holding the button at boot, with
      no reflash.
- [ ] Button-hold recovery clears both NVS keys and reopens the portal.
- [ ] Password never appears in serial logs, server payloads, or the database.
- [x] Dashboard never claims to have saved WiFi credentials (read-only panel).
- [ ] Firmware compiles for the target board (`arduino-cli compile`).
- [ ] Bench test on a real ESP32 before a production unit is flashed.

Firmware items above are open: they can only be verified on hardware. The
dashboard panel is code-complete but has not been exercised against a device
running the new firmware.

## Out of scope

BLE/Web Bluetooth, USB/Web Serial provisioning, remote credential rotation,
captive-portal DNS hijacking beyond the minimal AP, per-device AP passwords.

## Rollout

1. Merge the dashboard panel (`feat/wifi-provisioning-ui`) and the firmware
   branch to `develop`.
2. Compile and bench-test the firmware on a spare device.
3. Flash one production unit and verify the portal and recovery.
4. Promote with the next staging release.
