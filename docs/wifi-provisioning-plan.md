# WiFi provisioning — design and rollout

Status: WiFi dashboard panel and firmware merged (PR #75); the firmware
compiles in the `Firmware` CI workflow. Device identity provisioning (Device ID
+ Device Token) is in progress: the admin console can reveal a token and the
hardware panel now documents the identity fields. **The firmware portal on this
branch's base (`eaff9a6`) still asks for SSID and password only** — the Device
ID/token fields land with the paired firmware change. **Bench verification is
pending** — do not flash a production unit before it passes. Owner: Jeff.

## Starting point before this work (verified 2026-10-22)

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
- Documentation (`CHANGELOG.md`, `TESTING-CHECKLIST.html`) claimed provisioning
  that did not exist at the time; the feature is now implemented.

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
2. Serve a minimal setup page at `http://192.168.4.1` with the WiFi name,
   password, Device ID (MAC) and Device Token fields, and a Save button.
3. Save the WiFi values to the existing NVS keys (`wifi_ssid`, `wifi_pass`) and
   the device identity to NVS, reboot, and join the network.
4. Recovery without reflashing: hold the feed button (GPIO 27) for ~5 seconds
   during boot to clear the WiFi keys and reopen the portal. The portal also
   reopens on repeated join failure.
5. No WiFi password is logged, stored server-side, sent to the server, or
   included in telemetry. The Device Token is the credential the device sends
   back to the API; it is never logged either.

### Device identity: Device ID and Device Token

The feeder authenticates every API call with `X-Device-Token` and identifies
itself by MAC, so a unit cannot heartbeat until both are provisioned:

| Portal field | Source | Notes |
| --- | --- | --- |
| Device ID | `EnergyDevice.mac` | `A4:CF:12:7E:3B:09`; its last four hex digits also name the setup AP |
| Device Token | `EnergyDevice.token` | per-device credential; API auth compares against `tokenHash` (sha256) |

The token is the device's credential, not a display field:

- `getDevices()` selects display columns only and never returns `token` or
  `tokenHash`, so a list render, RSC payload or cached page cannot leak it.
- `revealDeviceToken(deviceId)` is the only read path. It requires
  `requireRole("ADMIN")`, resolves the caller's org scope and matches the device
  through `pondId in scope.pondIds`. A device outside that scope is reported as
  not found, so the response cannot confirm another tenant's rows.
- It returns `{ success: true, token, mac, label }` for exactly one device, or
  `{ success: false, error }`. The token is never written to a log — success or
  failure — and never enters the URL or localStorage.
- Admin → Devices shows the MAC as **Device ID (MAC)** and each row has a
  **Show token** button that calls the action on demand, displays the value in a
  monospace box with Copy, and warns that it is a credential. Nothing is
  revealed until the button is pressed.

### Security notes

- The setup AP is local-only and open for v1 (no per-device AP password yet).
  It must stop once provisioning succeeds. A future revision can protect it
  with a printed per-device PSK.
- The Device Token is a bearer credential for the device API. Treat it like a
  password: share it only with the person provisioning that unit, do not paste
  it into chat or tickets, and rotate it if it is exposed. The portal is
  reachable only from the device's own AP, but anyone who joins that AP during
  provisioning can read the page.
- The form validates SSID 1–32 chars and password 8–63 chars (WPA2), or empty
  for an open network; HTML output escapes the SSID.
- The portal is not reachable from the internet and is not exposed by the
  Next.js app in any way.

## Dashboard (honest UI)

**Implemented** in
`apps/web/app/[locale]/(dashboard)/dashboard/settings/hardware/page.tsx`
(PR #75; the identity fields and token guidance were added with the token-reveal
change). The hardware page replaces the fake network form with a read-only WiFi
and identity setup panel:

- the AP name is derived from the selected `EnergyDevice.mac`: uppercase hex,
  strip `:`/`-`/`.`/spaces, take the last four characters, prefix
  `OptiFeed-` (e.g. `A4:CF:12:7E:3B:09` → `OptiFeed-3B09`);
- the **Device ID** is that same MAC, shown next to the AP name so both values
  the portal asks for are on one screen;
- no paired device: a neutral "No device paired yet" message instead of an AP
  name, and no status claim;
- device online (`lastSeenAt` within 5 minutes): "WiFi is already configured on
  the device" plus a note that the setup AP is off;
- device offline or never seen: the five provisioning steps (join the AP, open
  `192.168.4.1`, enter the farm WiFi, enter the Device ID and Device Token, save)
  and the button-hold recovery instruction;
- a note says where the token comes from — the farm administrator, or
  Admin → Devices → **Show token** — and that it is a credential to share only
  with the person provisioning the unit;
- no password field, no Save button, no server-URL field. The server URL was
  removed because firmware URLs are compile-time, and the dashboard has no
  write path for WiFi credentials.

The ADMIN-only token reveal lives in `apps/web/lib/actions/admin.ts`
(`revealDeviceToken`) and
`apps/web/components/admin/device-token-reveal.tsx`. The admin device table
passes only display fields; the credential is fetched when the button is
pressed and kept in component state, never in the URL, localStorage or the
server-rendered HTML.

The firmware side of the WiFi design is merged and compiles in CI; bench
verification is still pending.

## Acceptance criteria

- [ ] Fresh/erased NVS: `OptiFeed-XXXX` appears within 10 s of boot.
- [ ] Saving valid credentials reboots and the device heartbeats within 60 s.
- [ ] Wrong password: portal is recoverable by holding the button at boot, with
      no reflash.
- [ ] Button-hold recovery clears both NVS keys and reopens the portal.
- [ ] Password never appears in serial logs, server payloads, or the database.
- [x] Dashboard never claims to have saved WiFi credentials (read-only panel).
- [x] Token reveal requires ADMIN and is scoped to the caller's organization;
      a device outside scope is reported as not found.
- [x] Device token never appears in an admin list payload, page HTML, or a log;
      it is returned only by an explicit `revealDeviceToken` call.
- [ ] Firmware portal accepts Device ID and Device Token and persists them —
      **not on `origin/develop` at `eaff9a6`**; belongs to the paired firmware
      change.
- [x] Firmware compiles for the target board (`arduino-cli compile`, run by the
      `Firmware` workflow).
- [ ] Bench test on a real ESP32 before a production unit is flashed.

The compile is verified in CI. The remaining firmware items can only be verified
on hardware: the dashboard panel is code-complete but has not been exercised
against a device running the new firmware.

## Out of scope

BLE/Web Bluetooth, USB/Web Serial provisioning, remote credential rotation,
captive-portal DNS hijacking beyond the minimal AP, per-device AP passwords.

## Rollout

1. Merge the dashboard panel and the firmware branch to `develop`.
   **Done** — PR #75.
2. Compile and bench-test the firmware on a spare device. **Compile passed in
   CI; bench test remains.**
3. Flash one production unit and verify the portal and recovery.
4. Promote with the next staging release. **Included in `staging@6d858d6`.**

---

## Verification status (2026-10-22)

| Item | Status |
| --- | --- |
| Dashboard panel | Implemented and merged (PR #75); identity guidance + token reveal added on `feat/wifi-identity-ui` (lint + typecheck pass) |
| Token reveal (web) | Implemented on `feat/wifi-identity-ui`; ADMIN-only, org-scoped, on demand |
| Firmware source | Implemented and merged (PR #75); **compiles in CI** |
| Firmware identity fields | **Not implemented on `origin/develop` at `eaff9a6`**; paired firmware change pending |
| Firmware compile | **Passed** in the `Firmware` workflow (`compile`) on `aa88ef2` and `6d858d6` |
| Bench test | **Not performed** — requires a spare ESP32 and a flashed unit |
| Production unit | Not flashed; blocked on the bench test |

Local reproduction (the CI workflow runs this; `arduino-cli` is not installed on
the development machine):

```
arduino-cli lib install "RTClib" "Adafruit BusIO" "ArduinoJson" "OneWire" "DallasTemperature"
arduino-cli compile --fqbn esp32:esp32:esp32 firmware/firmware-main
```

Do not flash a production unit until the bench acceptance criteria above are
checked on hardware.
