/**
 * Power rating printed on the PakaonAI feeder sticker (Admin → Devices →
 * Print label).
 *
 * The unit runs from mains: 220 V AC, 60 Hz. The earlier "12 V DC, 5 A" figure
 * (capstone manuscript p. 73) did not match the real parts and was dropped.
 *
 * The current is the sum of the loads taken from the mains, rounded up to the
 * next 0.1 A. The blower and gear motor come from their nameplates (read from
 * photos of the built unit); the control electronics are an estimate: a 12 V
 * adapter feeds the 12 V relay and a buck converter that gives the ESP32 5 V.
 *
 * TODO(verify-on-hardware): this has NOT been measured. Still open:
 *  - the 12 V adapter's own label (rated output and input current) has not
 *    been read, and the speed-control unit's label is not legible, so the
 *    electronics figure below is an estimate and the speed controller's own
 *    draw is not counted (the round-up leaves about 0.04 A for it);
 *  - the manuscript's "12 V, 5 A supply" most likely describes that adapter's
 *    output, not the unit's input; confirm against its label;
 *  - the blower and gear-motor figures are nameplate maxima, not a meter
 *    reading during a feed;
 *  - it is assumed that the blower, gear motor and adapter are all fed from
 *    the one mains cord.
 * Do not treat the printed rating as final until someone has read the missing
 * labels and measured the current, then updated this file.
 *
 * Deliberately a constant rather than a database column: it describes the
 * hardware design, not an individual device record.
 */

export type HardwareRating = {
	inputVoltage: number;
	maxCurrentA: number;
} & ({ supplyType: "DC" } | { supplyType: "AC"; frequencyHz: number });

export const MAINS_VOLTAGE_V = 220;
export const MAINS_FREQUENCY_HZ = 60;

/**
 * Loads counted in the rating. `basis` records where each current comes from
 * so a reviewer can tell a label reading from arithmetic.
 */
export const RATED_LOADS = [
	{
		id: "blower",
		description: "Creston electric blower 2 in, 220 V / 60 Hz, 3600 RPM",
		currentA: 1.0,
		basis: "nameplate: AMP 1.0 A",
	},
	{
		id: "gear-motor",
		description: "Speed control motor M206-402 with 2GN-20K gearbox, 6 W, 220 V",
		// 6 W / 220 V. The label gives watts, not amps; this assumes a power
		// factor of 1, so it is a lower bound for a capacitor-run motor.
		currentA: 6 / MAINS_VOLTAGE_V,
		basis: "calculated: 6 W / 220 V (power factor 1)",
	},
	{
		id: "electronics",
		description: "12 V adapter -> 12 V relay coil + buck converter -> 5 V ESP32",
		// Relay coil about 0.4 W plus ESP32 about 2.5 W peak with Wi-Fi is
		// 2.9 W DC. At about 72 % conversion efficiency (adapter 80 %, buck
		// 90 %) that is about 4 W from the wall, and at a power factor of 0.5
		// typical of a small switching adapter about 8 VA.
		currentA: 8 / MAINS_VOLTAGE_V,
		basis: "estimated: about 8 VA at the wall (3 W DC load, 72 % efficiency, power factor 0.5)",
	},
] as const;

/** Smallest multiple of 0.1 that is not below `value` (floats guarded). */
function roundUpToTenth(value: number): number {
	return Math.ceil(Math.round(value * 1e6) / 1e5) / 10;
}

export const HARDWARE_RATING = {
	inputVoltage: MAINS_VOLTAGE_V,
	supplyType: "AC",
	frequencyHz: MAINS_FREQUENCY_HZ,
	maxCurrentA: roundUpToTenth(RATED_LOADS.reduce((sum, load) => sum + load.currentA, 0)),
} as const satisfies HardwareRating;

/**
 * Maximum apparent power, V × A. For an AC load this is in volt-amperes: an
 * upper bound on the watts actually drawn, since power factor is below 1.
 */
export function maxPower(
	rating: Pick<HardwareRating, "inputVoltage" | "maxCurrentA"> = HARDWARE_RATING,
): number {
	return rating.inputVoltage * rating.maxCurrentA;
}

/** Unit of `maxPower`: VA for AC, W for DC. */
export function powerUnit(
	rating: Pick<HardwareRating, "supplyType"> = HARDWARE_RATING,
): "W" | "VA" {
	return rating.supplyType === "AC" ? "VA" : "W";
}
