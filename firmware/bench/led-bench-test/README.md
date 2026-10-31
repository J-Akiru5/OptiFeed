# PakaonAI indicator LEDs — bench test

Bench-only sketch used to prove the four indicator LEDs and their resistors
before anything is soldered into the enclosure. It drives **only** the three
firmware-controlled LEDs; the white POWER LED is hardwired to 3.3 V.

This is not production firmware and is not built by `firmware/platformio.ini`.
Production firmware 1.6.0 on `staging` has no LED code yet, so flashing it will
leave all three of these LEDs dark. That is why this sketch exists.

## Wiring

| Indicator | Colour | Connection                          | Resistor |
| --------- | ------ | ----------------------------------- | -------- |
| POWER     | White  | 3.3 V rail (always on)              | 200 Ω    |
| FEEDING   | Green  | GPIO 27 → resistor → anode → GND    | 200 Ω    |
| WI-FI     | Blue   | GPIO 26 → resistor → anode → GND    | 100 Ω    |
| FAULT     | Yellow | GPIO 18 → resistor → anode → GND    | 200 Ω    |

All four cathodes share the same GND. The resistor may sit before or after the
LED; it only has to be in series.

Polarity: longer leg = anode (+), shorter leg and flat side of the casing =
cathode (−). If an LED does not light in the sweep, reverse it before assuming
the GPIO is dead.

All three GPIOs are unused by the production sketch on `staging`:

- GPIO 27 — free (the feed button moved to GPIO 23)
- GPIO 26 — free (the DS18B20 moved to GPIO 32)
- GPIO 18 — free (the reset buttons are on GPIO 16/17)

Do **not** take the pin map from `docs/gpio-button-map.html` in an old `main`
checkout: that page still describes the pre-1.5 board (button 27, DS18B20 26,
TRIG 32, ECHO 33). Staging's `firmware/README.md` is the current map.

## Resistor maths at 3.3 V

`I = (3.3 − Vf) / R`

| Colour | Vf (typical) | 200 Ω     | 100 Ω     |
| ------ | ------------ | --------- | --------- |
| Green  | 2.1 V        | 6.0 mA    | 12 mA*    |
| Yellow | 2.0 V        | 6.5 mA    | 13 mA*    |
| Blue   | 3.0–3.4 V    | 0.5–1.5 mA | 1–3 mA   |
| White  | 3.0–3.4 V    | 0.5–1.5 mA | 1–3 mA   |

\* stay at 200 Ω for green/yellow; they are already bright.

The important correction to the original plan: **200 Ω is not a good choice for
blue and white on a 3.3 V rail.** Those LEDs have a forward voltage close to the
rail, so the available headroom is tiny. A white LED with Vf = 3.4 V will not
conduct at all from 3.3 V, no matter the resistor. Expect blue to be an order of
magnitude dimmer than green at the same resistor value.

Options, in order of preference:

1. Use **100 Ω** on blue (and white, if it is firmware-driven). Still dim, but
   usable indoors.
2. Move the white POWER LED to the **5 V rail** with **330 Ω** (≈5 mA). It is not
   firmware-controlled, so 5 V is fine. Measure the rail first.
3. If blue must be bright, it needs a 5 V supply and a small low-side switch
   (2N2222 + 1 kΩ base resistor), or a blue LED rated for 3.3 V drive. A GPIO
   cannot make a 3.4 V LED emit from a 3.3 V rail.

Never drive an LED from 5 V into a GPIO. GPIO 34–39 are input-only and cannot
drive anything.

## Flash

```sh
pio run -d firmware/bench/led-bench-test -t upload
pio device monitor -d firmware/bench/led-bench-test
```

The board must be the ESP32-WROOM-32U unit under test. The sketch writes nothing
to NVS, so the unit's stored Wi-Fi credentials and device identity survive the
round trip. It holds both relay control candidates (GPIO 25 and GPIO 5) LOW for
the whole run, so a floating input cannot chatter the coil — but disconnect the
pump from mains anyway before any bench test.

The sketch uses PlatformIO's default partition table, while production uses
`min_spiffs.csv`. Both keep NVS at 0x9000, so provisioning is not lost, but the
production application is overwritten until you flash it again over USB.

## Expected result

1. White POWER is lit from the moment the board is powered.
2. Green (27), blue (26), yellow (18) each light for 2 s in turn, 1 s apart.
3. All three light together for 3 s, then the sweep repeats.
4. Serial prints the LED name with every step, so a mis-wired LED is obvious.

If one LED never lights: check polarity, then the resistor, then the dupont
lead, then the GPIO with a multimeter. If all three are dark but the white LED
is lit, the sketch did not flash or the GPIOs are not wired to the right pins.
