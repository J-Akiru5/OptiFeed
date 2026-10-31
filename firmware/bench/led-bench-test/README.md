# PakaonAI indicator LEDs — bench test

Bench-only sketch used to prove the indicator LEDs and their resistors before
anything is soldered into the enclosure.

**Amended wiring:** the green FEEDING LED is no longer a firmware output. It is
a parallel tap on the relay control line, so it lights whenever the relay is
energised. Only the blue and yellow LEDs are driven by firmware.

This is not production firmware and is not built by `firmware/platformio.ini`.
Production firmware 1.7.0 on `staging` has no LED code, so flashing it will leave
the blue and yellow LEDs dark. That is why this sketch exists.

## Wiring

| Indicator | Colour | Connection                                   | Resistor | Driven by   |
| --------- | ------ | -------------------------------------------- | -------- | ----------- |
| POWER     | White  | 5 V rail (always on)                         | 330 Ω    | hardware    |
| FEEDING   | Green  | GPIO 5 (relay control) → resistor → GND      | 200 Ω    | relay line  |
| WI-FI     | Blue   | GPIO 26 → resistor → anode → GND             | 100 Ω    | firmware    |
| FAULT     | Yellow | GPIO 18 → resistor → anode → GND             | 200 Ω    | firmware    |

All cathodes share the same GND. The resistor may sit before or after the LED;
it only has to be in series.

Polarity: longer leg = anode (+), shorter leg and flat side of the casing =
cathode (−). If an LED does not light, reverse it before assuming the GPIO is
dead.

GPIO 27 is now unused and available. The feed button is on GPIO 23; the DS18B20
moved to GPIO 32.

Do **not** take the pin map from `docs/gpio-button-map.html` in an old `main`
checkout: that page still describes the pre-1.5 board (button 27, DS18B20 26,
TRIG 32, ECHO 33). Staging's `firmware/README.md` is the current map.

## The relay tap: what it does and does not tell you

The green LED is in parallel with the relay input, so it reflects **relay
energised**, not "a dose was dispensed". It will also light during the known
GPIO 5 boot glitch on every reset, and it stays lit if the relay ever sticks on.
For an operator that is useful, but do not label it "FEEDING OK" in the
enclosure legend — "FEED" or "RELAY" is accurate.

If you later want a true dispense-confirmed light, GPIO 27 is free and can be
driven by firmware at the end of `stopFeedCycle()`.

## GPIO 5 electrical notes

- GPIO 5 is the relay line only on the **CICT Building A unit**
  (`esp32dev-relay5` build). The reference wiring uses GPIO 25; build this
  sketch with `-DBENCH_RELAY_PIN=25` for that board.
- The LED adds about 6 mA to whatever the relay input already draws. An
  opto-isolated relay module typically draws 2–4 mA, so the pin sees roughly
  10 mA — well inside the ESP32's limit.
- Tap the line at the **ESP32 pin / module input**, not at a point pulled up to
  5 V. If the relay board pulls its input to 5 V, the LED would see 5 V and the
  GPIO would no longer be driving it directly.
- GPIO 5 has a weak pull-up and emits a PWM glitch at reset. That is already
  true of the production relay line on this unit; the green LED will blip with
  it. It is not a new fault.

Keep the LED leads away from the feed-button line and the motor/relay wiring:
that unit has a documented phantom-press issue from switching noise on GPIO 23.

## Resistor maths at 3.3 V

`I = (3.3 − Vf) / R`

| Colour | Vf (typical) | 200 Ω      | 100 Ω     |
| ------ | ------------ | ---------- | --------- |
| Green  | 2.1 V        | 6.0 mA     | 12 mA*    |
| Yellow | 2.0 V        | 6.5 mA     | 13 mA*    |
| Blue   | 3.0–3.4 V    | 0.5–1.5 mA | 1–3 mA    |
| White  | 3.0–3.4 V    | 0.5–1.5 mA | 1–3 mA    |

\* stay at 200 Ω for green/yellow; they are already bright.

**200 Ω is not a good choice for blue on a 3.3 V rail.** Blue has a forward
voltage close to the rail, so the available headroom is tiny. Expect blue to be
an order of magnitude dimmer than green at the same resistor value.

- Blue: use **100 Ω**; still dim, but usable indoors.
- White POWER: **5 V rail + 330 Ω** (≈5 mA). It is not firmware-controlled, and
  the CICT unit already has a 5 V buck output. A white LED with Vf = 3.4 V will
  not conduct at all from 3.3 V, no matter the resistor.
- If blue must be bright, it needs a 5 V supply and a small low-side switch
  (2N2222 + 1 kΩ base resistor), or a blue LED rated for 3.3 V drive.

Never drive an LED from 5 V into a GPIO. GPIO 34–39 are input-only and cannot
drive anything.

## Flash

```sh
pio run -d firmware/bench/led-bench-test -t upload
pio device monitor -d firmware/bench/led-bench-test
```

For the CICT unit the relay pin defaults to GPIO 5. For the reference board:

```sh
pio run -d firmware/bench/led-bench-test -e esp32dev-relay25 -t upload
```

The sketch writes nothing to NVS, so the unit's stored Wi-Fi credentials and
device identity survive the round trip. It holds both relay candidates LOW
except during the test pulse, so a floating input cannot chatter the coil.

The sketch uses PlatformIO's default partition table, while production uses
`min_spiffs.csv`. Both keep NVS at 0x9000, so provisioning is not lost, but the
production application is overwritten until you flash it again over USB.

## Safety

**Disconnect the pump from mains.** The test deliberately pulses the relay, and
if the pump is still connected it will run for 2 s per sweep plus 3 s in the
compare phase.

## Expected result

1. White POWER is lit from the moment the board is powered.
2. Relay pulses for 2 s: a click and the green FEEDING LED lights.
3. Blue (26) lights for 2 s, then yellow (18) for 2 s.
4. Relay + blue + yellow together for 3 s, then the sweep repeats.
5. Serial prints each step, so a mis-wired LED is obvious.

If one LED never lights: check polarity, then the resistor, then the dupont
lead, then the GPIO with a multimeter. If green lights but the relay does not
click, the tap is on the wrong side of the relay driver.
