# 2026-10-31: Machine status interface (firmware 1.8.0)

Session: Claude (Opus 5.5), branch `claude/pakaon-indicator-system-af4f1f`.

## Decisions (Jeff, 2026-10-31)

| ID | Decision |
|---|---|
| S1 | Four indicator lamps: POWER white (solid = control power), FEEDING green (solid = actual feeding), WI-FI blue (solid = connected, blink = provisioning), FAULT yellow (solid = fault, off = none). |
| S2 | Blue is solid only after the unit has joined its configured network, not while it is trying. |
| S3 | Wi-Fi loss is not a machine fault; a low hopper is a warning, not a fault. |
| S4 | Faults go through one central FaultManager with a defined list; a fault stays latched until the cause is resolved and the operator acknowledges it; nothing resumes an interrupted dose. |
| S5 | Each lamp is driven by an NPN transistor (1 kΩ base, 10 kΩ pull-down), never directly from the GPIO. The lamp is a notice, not an interlock. |

## Implementation choices (Claude, open for Jeff to change)

| ID | Choice | Why |
|---|---|---|
| S6 | GPIO 13 POWER, 18 FEEDING, 19 WI-FI, 33 FAULT. | The four pins the pin map already listed as free; none is a strapping or input-only pin. |
| S7 | Acknowledge = a tap (< 5 s) on the existing Wi-Fi reset button, GPIO 17. | No spare button; a hold still resets Wi-Fi. A dashboard acknowledge would need a server change. |
| S8 | Faults detected now: `hopper_sensor` (no echo, 3 checks in a row), `rtc` (missing at boot or no I2C ACK, probed every 60 s), `relay_overrun` (existing timing trip), `safe_mode`. | Only these are detectable with the current hardware. Jam/overcurrent needs a current sensor; relay failure needs feedback (P2). |
| S9 | No fault adds a feeding refusal. | Safe mode and the dispense gate already inhibit unsafe feeding; blocking feeds on a sensor fault would starve fish. |
| S10 | Fault log = Serial line + heartbeat `diag` fields; no NVS log yet. | Avoids flash wear; persistent log is the P1 follow-up. |

## Open hardware questions (from the design)

1. Motor driver: the firmware already uses a mechanical relay module (active HIGH, GPIO 25 / 5). Answered.
2. Are the pilot lamps 12 V DC LED types? Not answered; determines the driver.
3. Motor-current sensing: none on current hardware. Answered.

## State

- Native tests: 34/34 pass (`pio test -d firmware -e native`), including 6 new status tests.
- Not flashed. Flashing needs Jeff's yes. Not bench-verified on lamps.
