# Device loop and OTA bench checklist

Status: **procedure ready, not yet executed on a physical unit.** Every server-side
assertion below has a runnable harness (`scripts/bench/device-loop.mjs`); the
hardware steps are what remains to be proven.

This is the bench record for the loop that already exists in `develop`:

```
provision -> heartbeat -> queue/claim -> dispense -> ingest -> dashboard
          -> OTA check -> signed install -> pending verify -> rollback
```

It never authorizes a write to production. The harness refuses a non-loopback
target, and the hardware procedure uses a disposable local stack plus a
dedicated bench unit.

---

## 0. Read this before connecting a unit

The committed sketch hardcodes the production backend:

```c
#define INGEST_URL             "https://pakaonai.syntaxure.dev/api/ingest"
#define FEED_POLL_URL_BASE     "https://pakaonai.syntaxure.dev/api/feed-command"
#define SCHEDULE_SYNC_URL_BASE "https://pakaonai.syntaxure.dev/api/schedule-sync"
#define OTA_CHECK_URL          "https://pakaonai.syntaxure.dev/api/firmware/check"
```

It also pins the production CA (`ROOT_CA`). There is **no build flag that
overrides these values**: `-DINGEST_URL=...` is redefined by the sketch, so the
sketch wins. A committed field build therefore cannot talk to `127.0.0.1` or a
laptop on the LAN, and this checklist must **not** be run against production.

Two consequences:

- **Today**, only Part 1 (the server-side harness) is executable. It proves the
  device routes, the claim/ack flow, ingest idempotency, the dashboard reads and
  the signed-channel contract without a unit.
- **When a unit exists**, the hardware half needs an owner-approved bench build
  that overrides the four URLs (and trusts a bench CA, or terminates TLS on a
  local proxy). That is a separate firmware task; this document does not modify
  the sketch. Until it lands, every hardware step below is marked
  **[bench build required]**.

If someone proposes "just point it at staging", stop: staging is a preview
deployment, not the disposable stack, and the task record for this bench is
localhost-only.

---

## 1. Server-side harness (no unit, run today)

### Prerequisites

- Docker (or Podman) running.
- Supabase CLI **2.121.0** (`supabase --version`).
- Node.js >= 22.5, `pnpm install` completed.
- Repository checkout at the branch under test.

### Start the disposable stack and the app

From `apps/web` (PowerShell):

```powershell
supabase start
supabase status -o env
```

Read `API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY` and `DB_URL` from the output.
Then, in the same terminal:

```powershell
$env:DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
$env:DIRECT_URL = $env:DATABASE_URL
$env:NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321"
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY = "<ANON_KEY>"
$env:SUPABASE_SERVICE_ROLE_KEY = "<SERVICE_ROLE_KEY>"
$env:E2E_ALLOW_LOCAL_STACK = "yes"
$env:E2E_PASSWORD = "e2e-local-password-only"
$env:CRON_SECRET = "bench-local-cron-secret"

pnpm --filter web prisma:generate
pnpm --filter web exec prisma migrate deploy
pnpm --filter web exec tsx scripts/e2e/seed-e2e.ts
pnpm --filter web exec next build
pnpm --filter web exec next start -p 3000
```

The `CRON_SECRET` literal is local-only. The app and the harness must see the
same value; the harness uses it to invoke the real `device-watch` rollup.

Bash equivalent for the exports:

```bash
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
export DIRECT_URL="$DATABASE_URL"
export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="<ANON_KEY>"
export SUPABASE_SERVICE_ROLE_KEY="<SERVICE_ROLE_KEY>"
export E2E_ALLOW_LOCAL_STACK=yes
export E2E_PASSWORD=e2e-local-password-only
export CRON_SECRET=bench-local-cron-secret
```

### Run the harness

In a second terminal, from the repository root, with the same environment:

```powershell
$env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:3000"
node scripts/bench/device-loop.mjs
```

No network needed for the offline half:

```powershell
node scripts/bench/device-loop.mjs --self-check
```

Useful flags:

| Flag | Effect |
| --- | --- |
| `--self-check` | contract constants + signing/tamper checks; no stack, no HTTP |
| `--skip-ota` | device loop only |
| `--require-ota-delivery` | fail instead of SKIP when the stack is HTTP (for a TLS stack) |
| `--keep-fixture` | keep the temp signing dir and the `bench-` rows for inspection |

Optional environment:

| Variable | Default | Why |
| --- | --- | --- |
| `BENCH_BASE_URL` | `PLAYWRIGHT_BASE_URL` or `127.0.0.1:3000` | app under test |
| `BENCH_DEVICE_MAC` | `02:00:00:BE:00:01` | fixture MAC; must be unique |
| `BENCH_OTA_VARIANT` | `gpio5` | channel variant; `gpio25` for the reference board |
| `BENCH_OTA_PRIVATE_KEY` | unset | offline key path; makes the image installable by a unit |
| `BENCH_OTA_KEY_ID` | `primary` | matches `firmware/keys/pakaonai-ota-<id>-public.pem` |
| `BENCH_KEEP_FIXTURE` | unset | same as `--keep-fixture` |

### What the harness proves

| Area | Assertion | Contract owner |
| --- | --- | --- |
| contract | bucket `firmware`, channel path, 10-minute TTL, 8 KB cap, board, variant/GPIO map still match the source | `apps/web/lib/firmware/ota.ts`, `firmware-main.ino` |
| provision | device row with `APPROVED` and the SHA-256 token hash, same columns the Register action writes | `lib/device-registration.ts`, `lib/device-auth.ts` |
| heartbeat | `POST /api/ingest` 204; `EnergyDevice.lastSeenAt`, hopper level, RSSI; `connected` + `firmware_reported` state events | `app/api/ingest/route.ts` |
| connectivity | a live beat does **not** write today's `DeviceConnectivityDaily`; `device-watch` rolls yesterday's stored heartbeat into a row (`heartbeatCount=1`, `onlineMinutes=0`); if the cron fails after the rollup, the rollup row is still asserted separately | `lib/platform/connectivity.ts`, `app/api/cron/device-watch/route.ts` |
| feed | idle poll returns the 1.7.0 `config` object (`rev`, dose sizes, `farm_offset_minutes=480`) | `app/api/feed-command/route.ts` |
| claim | two overlapping polls claim one `FeedRequest` exactly once; the loser sees `feed_requested:false`; the row moves to `dispatched`; a later poll does not re-claim | `lib/feed/commands.ts:439` |
| ingest | dashboard dispense completes the request, writes one `FeedEvent`, one `DeviceStateEvent`, one notification | `app/api/ingest/route.ts` |
| ingest replay | exact replay (`feed_request_id` fast path) and same-`event_id` replay (unique index) both 204 with unchanged counts | `app/api/ingest/route.ts` |
| button | a `source:"button"` dispense with no `feed_request_id` is recorded once and replays idempotently; this is the real physical-button wire shape | `firmware-main.ino:4816`, `app/api/ingest/route.ts` |
| dashboard reads | hopper level/cm/history, fresh `lastSeenAt`, no pending request, both farmer notifications | `EnergyDevice`, `FeedLevelLog`, `FeedRequest`, `Notification` |
| OTA sign | `scripts/ota/sign-release.mjs` output verifies (ECDSA P-256/SHA-256, DER base64); manifest agrees with the envelope; size <= slot; response < 8 KB | `scripts/ota/sign-release.mjs`, `firmware-main.ino:2432` |
| OTA route | on an HTTPS stack: `update:true`, exact version/size/sha256/key_id/variant/relay_gpio/manifest/signature, `content-length`, <= 8 KB, HTTPS URL, 600 s TTL, URL bytes hash to the signed sha256 | `app/api/firmware/check/route.ts` |
| OTA fail-closed | on the HTTP local stack: `update:false` because the signed URL is not HTTPS | `apps/web/lib/firmware/ota.ts:304` |
| OTA negatives | wrong variant, missing variant, already latest, below `min_from_version`, manifest/envelope mismatch, variant/GPIO mismatch | route + `parseChannel` |
| OTA device-side | a tampered signature is rejected by the same check the firmware runs | `verifyManifestSignature`, `firmware-main.ino:2432` |
| OTA TTL | a 1-second signed URL returns 4xx after 2.5 s; the 600-second token decodes to 600 s | Storage API, `OTA_SIGNED_URL_TTL_SECONDS` |

Expected result today: all PASS except one **SKIP** for
`GET /api/firmware/check` delivering `update:true`, because the local stack is
HTTP. The harness still asserts the route fails closed and that the signed URL
would serve the exact bytes once TLS is present.

Cleanup: the harness deletes only rows scoped to its `bench-` ids and the
`firmware` bucket objects it uploaded. It leaves the recomputed
`connectivity.rollup` marker pointing at yesterday; the next run deletes it
before invoking `device-watch`. It also runs the real `device-watch` cron, so an
unrelated stale device on the same local stack may get its normal offline
episode.

---

## 2. Unit bring-up **[bench build required]**

> **Do not provision a unit with the committed build for this bench.** The
> committed sketch sends every heartbeat, poll and OTA check to
> `https://pakaonai.syntaxure.dev`. Until the bench build override from
> section 0 is flashed, stop after the flash/serial check: the unit must not
> register against production as part of this procedure. The commands below
> are the real bootstrap commands and apply unchanged once the bench build
> exists.

### Flash the bootstrap image over USB

The partition table (`min_spiffs.csv`) and the bootloader are written only by
USB; OTA can never change them.

```powershell
cd S:\Dev\Capstone\optifeed
pio run -d firmware -e esp32dev-gpio5 -t upload    # CICT field unit, relay GPIO 5
# or, for the reference board:
pio run -d firmware -e esp32dev-gpio25 -t upload   # relay GPIO 25
pio device monitor -d firmware -b 115200
```

Do not use `esp32dev` or the `-lan` alias for a field unit. The variant is a
property of the wiring; see `firmware/platformio.ini` and
`docs/hardware/2026-10-28-cict-pin-map-and-health.md`.

Expected boot markers (1.10.0):

```
[INIT] Reset reason: poweron
[INIT] Relay on GPIO 5 (active HIGH, variant gpio5)
[INIT] Relay shutdown handler registered
[DEVICE MAC] 02:00:00:BE:00:01
[IDENTITY] Device ID: (none)
[IDENTITY] Device token: missing
[IDENTITY] Provisioned marker: no
[HW] provisioned variant gpio5 (relay GPIO 5)
[BOOT] summary: fw=1.10.0 variant=gpio5 reset=poweron safe_mode=0 ... identity=no wifi=offline ...
[PROV] Provisioning needed - starting setup portal
```

Pass: the relay does not click; the green/relay LED is off; `[INIT] Relay ...`
names the expected GPIO and variant. A unit that boots with `active LOW` or the
wrong GPIO has the wrong build — stop before connecting the pump.

### Provision Wi-Fi and identity

1. Join the open AP `PakaonAI-XXXX` (XXXX = last four of the MAC before
   provisioning; `[IDENTITY] Setup AP name` prints it).
2. Open `http://192.168.4.1`.
3. Enter the farm Wi-Fi, **Device ID = the MAC from `[DEVICE MAC]`**, and the
   **Device Token** from the dashboard: **Superadmin -> Devices -> Register
   device** (or Admin -> Devices in the tenant console). The token is shown once.
4. Press **Connect and save**.

Expected:

```
[PROV] Testing "<SSID>" before saving (begin rc=0)
[PROV] Connected to "<SSID>" IP 192.168.x.x RSSI -NN dBm - saved, restarting in 5 s
[IDENTITY] Device ID: 02:00:00:BE:00:01
[IDENTITY] Device token: configured
[IDENTITY] Provisioned marker: yes
[READY] OptiFeed controller online.
```

Pass: `[IDENTITY] Device token: configured` (never prints the token), the AP
disappears, and the dashboard row flips to online within one heartbeat.

If the token is lost, use **Rotate token** and re-enter it; the old token stops
working immediately.

---

## 3. Heartbeat

Watch serial for roughly 15 seconds.

Expected markers:

```
[POST] 204
```

and, at the next dashboard refresh, the device card shows online, a fresh
"last seen", firmware `1.10.0`, and `diag.hw_variant=gpio5`,
`diag.relay_gpio=5`, `diag.hw_variant_ok=true`.

Pass:

- at least one `[POST] 204` at the configured beat (5 s by default);
- `GET /api/ingest` returns 204, not 429/503 (a 429 within 1 s is the ingest
  rate limit, not a failure);
- `EnergyDevice.lastSeenAt` advances; a `DeviceStateEvent` `connected` row is
  written on first contact;
- the first heartbeat writes a `firmware_reported` row with `1.10.0`;
- the hopper percentage and RSSI on the card match the physical reading.

Note: `DeviceConnectivityDaily` is **not** written by a live heartbeat. It is a
completed-UTC-day rollup written by the `device-watch` cron. Do not wait for it
during a bench session; the harness proves it by seeding yesterday and running
the cron.

---

## 4. Physical button feed

Press the feed button (GPIO 23) once. The button dose is
`button_feed_grams` (80 g by default) and is limited to one per 30 s; edges in
the 2 s after a dispense are ignored.

Expected:

```
[FEED] dispensing 80g (~20000ms) — source: button
[FEED] complete — 80g via button
[EVENT POST] button 80g -> 204
```

Pass:

- the relay clicks and the motor runs for roughly `80 / grams_per_second`
  seconds (20 s at 4 g/s);
- `[EVENT POST] ... -> 204` (200/201/204 are all accepted by the firmware);
- exactly **one** `FeedEvent` row with `source=button` and no `feed_request_id`;
- exactly one farmer notification "Button feed completed — 80g ...";
- replaying the same event id (the harness does this) does not add a second row.

Failure that looks like success: the serial says `[FEED] dispensing` but the
relay never closes. Check `[HW] variant ...` versus the physical wiring; a
wrong-pin image heartbeats normally and never feeds. See section 8.

---

## 5. Queued feed (dashboard -> claim -> dispense -> ingest)

In the dashboard, queue a manual feed for the bench device (80 g). The device
polls `/api/feed-command` every 5 s.

Expected:

```
[FEED] dispensing 80g (~20000ms) — source: dashboard
[FEED] complete — 80g via dashboard
[EVENT POST] dashboard 80g -> 204
```

Pass:

- the poll returns `feed_requested:true`, `feed_request_id`, `grams:80`,
  `calibration:false` and the `config` object once;
- the `FeedRequest` moves `pending -> dispatched -> completed`;
- exactly one `FeedEvent` with `feed_request_id`, one `DeviceStateEvent`, one
  "Dashboard feed completed — 80g" notification;
- a second poll while the first is in flight returns `feed_requested:false`
  (the claim is a compare-and-set); it must not be told to dispense the same
  request twice;
- after `completed`, the dashboard's in-flight state clears and no pending row
  remains.

The harness runs the stronger version: two overlapping polls, exactly one
winner.

If the physical button is pressed instead of the dashboard path, the firmware
dispenses locally and reports `source:"button"` with **no** `feed_request_id`;
a queued request in the same window is reconciled to
`fulfilled_by_other_trigger`. That is expected, not a lost command.

---

## 6. Dashboard read-back

Check the same rows the dashboard reads:

- **Device card:** online, last seen now, firmware `1.10.0`, hopper level
  updated, RSSI plausible, `diag.hw_variant/relay_gpio/hw_variant_ok`.
- **History:** the two dispenses, with source and grams; no duplicate replay row.
- **Notifications:** "Button feed completed" and "Dashboard feed completed",
  each once.
- **Hardware/firmware card:** the `firmware_reported` version row; the
  superadmin firmware page shows the new version after an OTA.

Optional SQL (only if `psql` is installed; the dashboard is enough):

```sql
SELECT mac, "lastSeenAt", "feedLevelPercent", "wifiRssiDbm"
FROM "EnergyDevice" WHERE mac = '02:00:00:BE:00:01';

SELECT status, grams, "createdAt"
FROM "FeedRequest"
WHERE "deviceId" = (SELECT id FROM "EnergyDevice" WHERE mac = '02:00:00:BE:00:01')
ORDER BY "createdAt" DESC LIMIT 5;

SELECT "eventType", metadata, "createdAt"
FROM "DeviceStateEvent"
WHERE "deviceId" = (SELECT id FROM "EnergyDevice" WHERE mac = '02:00:00:BE:00:01')
ORDER BY "createdAt" DESC LIMIT 10;
```

Pass: no duplicate feed rows, no stuck `pending`/`dispatched`, and the version
the card shows is the version the unit reports.

---

## 7. OTA check and signed install

### 7.1 Publish a release the unit can install

Use the real offline key. The private key never enters the repository or CI.

```powershell
cd S:\Dev\Capstone\optifeed
pio run -d firmware -e esp32dev-gpio5
node scripts/ota/sign-release.mjs `
  --bin firmware/.pio/build/esp32dev-gpio5/firmware.bin `
  --variant gpio5 `
  --version 1.10.1 `
  --key C:\Users\Lenovo\Documents\PakaonAI\ota-signing-keys\pakaonai-ota-primary-private.pem `
  --key-id primary `
  --min-from 1.10.0 `
  --targets all `
  --out ota-out
```

Upload **both** objects to the private `firmware` bucket, exactly at the paths
the signer printed:

```powershell
# The harness creates the bucket on a fresh local stack. To create it by hand:
$headers = @{
  apikey = $env:SUPABASE_SERVICE_ROLE_KEY
  Authorization = "Bearer $env:SUPABASE_SERVICE_ROLE_KEY"
}
Invoke-RestMethod -Method Post `
  -Uri "$env:NEXT_PUBLIC_SUPABASE_URL/storage/v1/bucket" `
  -Headers $headers -ContentType "application/json" `
  -Body '{"id":"firmware","name":"firmware","public":false}'

supabase storage cp --local firmware/.pio/build/esp32dev-gpio5/firmware.bin `
  ss:///firmware/releases/1.10.1/firmware.bin
supabase storage cp --local ota-out/channels/stable.json `
  ss:///firmware/channels/stable.json
```

The `ss:///firmware/...` form is the Supabase CLI's storage URL
(`ss:///<bucket>/<object>`). On a hosted project use `--linked` instead of
`--local`, never the production project for this bench.

The harness does this locally through the Storage API with an ephemeral key; on
the bench unit use the real key so the embedded public key accepts the image.

### 7.2 Pre-flight gate

The check runs only when all of these hold (`otaPreflightFailure()`):

- not feeding, no scheduled feed within ±20 min;
- not provisioning, not in safe mode, not in `pending_verify`;
- Wi-Fi connected, RSSI > -75 dBm;
- uptime > 10 minutes;
- last reset not a brownout;
- local time 10:00-15:00 (farm offset, UTC+8 default);
- free heap >= 60 KB.

If any fails, the serial says `[OTA] check postponed: <reason>` (or
`[OTA] update postponed: <reason>` after a valid check) and backs off 1 h -> 6 h
-> 24 h. A check that answers `{update:false}` resets the ladder.

Expected on a valid check:

```
[OTA] state -> checking
[OTA] update 1.10.1 available (NNNNNN bytes, key primary)
[OTA] state -> downloading
[OTA] download 100% (...)
[OTA] image verified and installed - checkpointing state and rebooting
```

Pass: the version is newer than the running one, the key id is `primary`, the
size matches the built image, and the unit reboots once. A `[OTA] no update`
here is only a pass if you have verified the channel version equals the
running version; anything else is a deferred check, not a current unit.

### 7.3 Pending verify

After the install reboot:

```
[OTA] first boot of a new image - 300 s to pass the health check
[OTA] state -> pending_verify
[FIRMWARE] v1.10.1
```

The relay stays **off** and every feed trigger is refused while this state is
active:

```
[FEED] refused - OTA image pending verification (dashboard)
```

The image must get Wi-Fi, a valid clock, and one authenticated HTTP 200 from
`GET /api/feed-command` within 5 minutes. Then:

```
[OTA] health check passed - image marked valid
[OTA] state -> valid
```

Pass: the unit marks itself valid, the dashboard shows `1.10.1`, and a feed
queued after `valid` dispenses normally. Do not queue a dose during
`pending_verify` and call the silence a server bug: the firmware refuses it by
design.

### 7.4 Rollback on a corrupted image (A/B safety)

This is the test that proves a bad download cannot brick the unit. It is a
**corrupted image** test, not a rollback-to-old-slot test:

1. Sign a valid channel for `1.10.2` as in 7.1.
2. Upload **different bytes** to `releases/1.10.2/firmware.bin` (truncate the
   file, or upload a byte-flipped copy). Keep the signed manifest/sha256 from
   the real build.
3. Let the unit check and download.

Expected:

```
[OTA] download 100% (...)
[OTA] SHA-256 mismatch: got ..., signed ... - refusing
[OTA] state -> failed
```

Pass: the unit does **not** reboot, the relay stays on the old image, the
dashboard version stays `1.10.1`, and the next check backs off. The inactive
slot was written but `Update.end(true)` was never called, so the boot partition
did not change. This is the correct "corrupted image" result; no bootloader
rollback is involved.

### 7.5 Rollback after a failed health check

This is the pending-verify path that returns to the previous slot:

1. Publish and install a valid `1.10.2`.
2. On the first boot of the new image (`pending_verify`), stop the **app**
   server (not the whole stack, and keep Wi-Fi/router up). The unit cannot get
   the authenticated 200 from `/api/feed-command`.
3. Wait 5 minutes (`ota_health_check_timeout_ms`, default 300000).

Expected:

```
[OTA] health check FAILED (wifi=1 time=1 poll=0) - rolling back
[OTA] state -> rolled_back
```

Then the bootloader returns to the previous slot and the old image boots:

```
[FIRMWARE] v1.10.1
[OTA] running image is already validated
```

Pass: the old version is running again, the relay is off, and no `ota_valid`
row exists for `1.10.2`. Restart the app and confirm the old version heartbeats.
The `[OTA] state -> rolled_back` line is serial-only: the firmware reboots
before it can send a heartbeat in that state, so the server does not receive an
`ota_rolled_back` event. The dashboard shows the rollback as a
`firmware_reported` version change, not as an `ota_rolled_back` row. See
section 9.

A crash or watchdog reset during `pending_verify` is handled by the bootloader
the same way; pulling power during the five-minute probation is a valid
additional test.

---

## 8. Failure modes that look like success

| Symptom | What is actually happening | How to prove it |
| --- | --- | --- |
| Unit is online and heartbeats, relay never clicks | Wrong GPIO/variant image. `[HW] ERROR: this image is built for 'gpio25' ... but the unit is provisioned as 'gpio5'`; `diag.hw_variant_ok=false`; every dose is refused with `hardware_variant_mismatch`. | Check `[HW]` and `diag.relay_gpio`; listen for the relay. A green online badge is not a feed. |
| Dashboard says "in progress", nothing dispenses | Safe mode or a stale `dispatched` row. Safe mode logs `[SAFETY] SAFE MODE: ...` and `[FEED] REFUSED safe_mode: ...`; the refusal closes a dispatched dashboard request. | Look for `feed_refused`/`safe_mode`; do not retry blindly. |
| Heartbeat shows `ota_state=pending_verify` and the unit looks healthy | The new image is on probation; the relay is locked off and doses are refused locally, without a server refusal report. The dashboard request may expire instead of completing. | Wait for `[OTA] state -> valid`; only then is the install proven. |
| `[OTA] no update` | Could be a genuinely current unit, or a deferred check (uptime/RSSI/window/safe mode/pending verify), or a channel the server refuses (variant/manifest/HTTPS). | Read the preceding `[OTA] check postponed: <reason>` or `[OTA] update postponed: <reason>`; compare versions. |
| Install succeeds, then the old version is back | Health check failed; the bootloader rolled back. This is the safety net working, not a successful update. | Look for `health check FAILED ... rolling back`; the dashboard version returns to the old one. |
| Download returns 403 | The 10-minute signed URL expired (deferred download), or the object moved. | Re-check; a fresh check mints a new URL. |
| Ingest retry returns 429 | The 1 s per-device ingest rate limit, not idempotency. | Retry after >1 s; the duplicate event id then returns 204 without a second row. |
| Two feeds appear for one dashboard request | Claim/ack bug: the request was dispensed twice. | Count `FeedEvent` rows for the `feed_request_id`; the harness's two-poll test must show one winner. |
| Relay stays on after a dose | Safety overrun should force it off after the expected end + 2 s; `[SAFETY] relay overrun` appears. A stuck relay is a hardware fault. | Cut power; do not retry until the relay is checked. |

---

## 9. Known contract gaps found while building this harness

These are recorded here and in the PR; they are **not** fixed by the harness.

1. **`DeviceConnectivityDaily` is not a heartbeat table.** It is written only
   by the completed-UTC-day rollup in `device-watch`, from stored `FeedEvent`
   heartbeat rows. A live heartbeat updates `EnergyDevice.lastSeenAt` and the
   state/event ledgers. The harness seeds yesterday and runs the real cron to
   prove the rollup; a bench session should not expect today's row.
2. **The OTA route requires HTTPS, so the HTTP local stack cannot deliver
   `update:true`.** `createReleaseDownloadUrl` rejects a signed URL that does
   not start with `https://`; the local stack is `http://127.0.0.1:54321`. The
   harness asserts the fail-closed answer and skips the delivery assertion.
   A TLS-terminated stack runs the full assertion with
   `--require-ota-delivery` and no code change.
3. **The committed firmware cannot target localhost.** The four API base URLs
   and the CA are compile-time constants pointing at production. The hardware
   checklist therefore requires a bench build override; the server-side harness
   is the part that runs today.
4. **`ota_installed` and `ota_rolled_back` are not reachable from a real
   heartbeat.** The firmware sets `installed` and reboots 500 ms later, and sets
   `rolled_back` immediately before
   `esp_ota_mark_app_invalid_rollback_and_reboot()`. No `sendTelemetry()` runs
   in either state. Ingest maps those states to lifecycle rows, but a physical
   unit cannot emit them; the actual install/rollback is visible as a
   `firmware_reported` version change. `ota_valid` is reachable and is the
   install-success signal.
5. **The physical button does not queue a `FeedRequest`.** A button press calls
   `dispenseFeed(..., "button", "")` locally; the report has no
   `feed_request_id`. The "queued button feed" in the automated harness is the
   dashboard/manual queue path with the button dose size, plus a separate
   button-origin report that matches the firmware wire shape.
6. **There is no committed private test key.** `firmware/keys/` holds only the
   public PEMs, and the real private keys are offline (decision OTA-4). The
   harness generates a throwaway P-256 key unless `BENCH_OTA_PRIVATE_KEY` is
   set. The server route does not verify signatures by design (delivery only);
   the harness verifies the signature itself and names
   `verifyManifestSignature` as the device-side owner. A channel signed with
   the ephemeral key is therefore a contract fixture, not an installable image
   for a real unit.
7. **`device-watch` currently returns 500 after the connectivity rollup.**
   Migration `20261104180000_drop_dead_error_event` drops `ErrorEvent` on the
   claim that it has "no Prisma model and no reader or writer", but
   `apps/web/prisma/schema.prisma` still defines `model ErrorEvent` and
   `apps/web/lib/error-capture.ts` still calls
   `prisma.errorEvent.findMany()` from `deleteExpiredErrorEvents()`, which the
   cron invokes. The harness's first full run proved it:
   `Invalid prisma.errorEvent.findMany() invocation: The table
   public.ErrorEvent does not exist in the current database` (CI run
   `42336097695`, job `128293262951`). The rollup row is still written before
   the failing housekeeping step, so the data path is proven; the cron as a
   whole is not. This is an owner decision: restore the table/model, or remove
   the stale error-capture persistence (and the superadmin errors page that
   reads it). Do not paper over it in the harness.

---

## 10. Teardown

```powershell
# stop the app (Ctrl+C in its terminal), then:
cd S:\Dev\Capstone\optifeed\apps\web
supabase stop --no-backup
```

`--no-backup` deletes the volumes, including the `firmware` bucket objects and
the bench rows. The harness also removes its own fixture on a successful run
unless `--keep-fixture`/`BENCH_KEEP_FIXTURE=1` was used.

Record in the PR or task note: firmware commit, build env
(`esp32dev-gpio5`/`gpio25`), unit MAC, channel version, image sha256, the
PASS/FAIL table, and every marker that did not match this document.
