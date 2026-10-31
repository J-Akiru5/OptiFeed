# CICT Building A feeder: pin map and component health (2026-10-28)

Unit: Device ID `68:09:47:25:E1:80`, chip MAC `70:4B:CA:45:FB:54`, AP `PakaonAI-E180`,
reflashed 2026-10-28 from `develop` with the `esp32dev-relay5` build (relay on GPIO 5).
Visual wiring map: https://claude.ai/artifact/RghPSrLuspqU7heBFHqpdy

## Pin map (firmware on develop)

| GPIO | Connects to | Notes |
|---|---|---|
| 5 | Relay IN | This unit only (`esp32dev-relay5`). Default build uses 25. HIGH = ON |
| 23 | Feed button → GND | Press = LOW; dispenses the button dose; hold 5 s at boot = Wi-Fi reset |
| 17 | Wi-Fi reset button → GND | Hold 5 s; keeps Device ID and token |
| 16 | Factory reset button → GND | Hold 10 s; clears Wi-Fi, Device ID and token |
| 21 / 22 | DS3231 SDA / SCL | RTC for offline schedules |
| 32 | DS18B20 DATA | 4.7 kΩ pull-up to 3V3 |
| 12 | HC-SR04 TRIG | 10 kΩ pull-down (strapping pin) |
| 14 | HC-SR04 ECHO | 1 kΩ / 2 kΩ divider (5 V → 3.3 V) |
| 5V / GND | Buck converter (12 V → 5 V) | 12 V adapter also feeds the relay and the motor |

## Component health

Boot log (other session) plus server-side telemetry (this check, 12:05 Manila):

| Component | Pin | Status | Evidence |
|---|---|---|---|
| DS18B20 water temp | 32 | OK | `[INIT] DS18B20 temperature probe initialized`; server reads **30.6 °C**, `waterTempOk = true`, updated 12:05 |
| HC-SR04 hopper level | 12 / 14 | **OK (confirmed from the server)** | Serial prints no values, but ingest stored distance **25.6 cm → 17.5 %** (empty 30 cm, full 5 cm: (30 − 25.6) / 25 = 17.5 %), updated 12:05; a `pellet_refilled` event at 11:46 (17.5 % → 21.1 %) shows the reading follows the hopper |
| DS3231 RTC | 21 / 22 | OK | No `[WARN] RTC not found`; `[NTP] RTC synced` |
| Feed button | 23 | OK, but **phantom presses** | `[INIT] Feed button GPIO23: falling-edge interrupt…`; see below |
| Reset buttons | 16 / 17 | OK | `[RESET] Buttons ready`; Wi-Fi reset confirmed by Jeff |
| Relay | 5 | OK | `[INIT] Relay on GPIO 5 (active HIGH)`; feeds dispense |
| Wi-Fi / server | — | OK | `[READY] … online`, `[POST] 204`; `lastSeenAt` current |

## Open hardware issue: phantom button feeds

21 feeds between 11:09 and 11:52 Manila, all `source = button`, 80 g each, with no
server feed request. They arrive in pairs or triples ~20 s apart, which is one 80 g
dispense: a new "press" registers as the relay and motor switch off. The likely cause
is switching noise coupling into the button line (internal pull-up only, long wire).

Hardware fix (to do): 10 kΩ GPIO 23 → 3V3, 100 nF GPIO 23 → GND at the pin, flyback
diode across the motor (stripe to motor +), and button wires twisted and kept away
from the motor/relay wiring. Recommended: 470–1000 µF on the 5 V rail, 100 nF on
GPIO 16/17. A firmware guard is built in 1.5.3 (press must stay LOW ≥ 50 ms; edges
ignored during a dispense and for 2 s after; one button dispense per 30 s) — see
`firmware/README.md` → **Firmware 1.5.3 button guard**. The hardware fix is still
recommended: the guard removes the symptom, not the noise.
