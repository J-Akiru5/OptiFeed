/**
 * Power rating printed on the PakaonAI feeder sticker (Admin → Devices →
 * Print label).
 *
 * The unit runs from mains: 220 V AC, 60 Hz. The earlier "12 V DC, 5 A" figure
 * (capstone manuscript p. 73) did not match the real parts and was dropped; the
 * 12 V adapter in the box is rated 12 V 2 A (output) and sits behind the mains
 * cord like everything else.
 *
 * The current is the sum of the loads taken from the mains, rounded up to the
 * next 0.1 A. Only the blower's figure is a label reading; the gear motor and
 * the control electronics are estimates, with the assumptions written next to
 * each one below.
 *
 * Labels read from photos of the built unit:
 *  - Creston electric blower 2": 220 V / 60 Hz, 1.0 A, 3600 RPM
 *  - Speed control motor M206-402 + 2GN-20K gearbox: 6 W, 220 V, 0.8 uF
 *  - Motor speed controller US-52: 2 A, 220/240 V, 50/60 Hz (the most motor
 *    current it can drive, not what it draws, so it is not added to the sum)
 *  - 12 V adapter: 2 A output
 *
 * TODO(verify-on-hardware): this has NOT been measured. Still open:
 *  - no meter reading of the real current during a feed, which would replace
 *    the estimates below;
 *  - the gear motor's "6 W" is taken as shaft (output) power, and efficiency,
 *    power factor and the speed controller's own draw are assumed;
 *  - the adapter's input-side label has not been read;
 *  - it is assumed that the blower, the speed controller + gear motor (behind
 *    the relay) and the adapter are all fed from the one mains cord, and that
 *    they can all run at once.
 * Do not treat the printed rating as final until someone has measured it and
 * updated this file.
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

// Gear motor: the label gives 6 W, which for a small induction gear motor is
// the rated shaft output. These assumptions turn it into a mains current.
const GEAR_MOTOR_RATED_W = 6;
const GEAR_MOTOR_EFFICIENCY = 0.35;
const GEAR_MOTOR_POWER_FACTOR = 0.8;
// Speed controller (phase control) own consumption, as a current allowance.
const SPEED_CONTROLLER_ALLOWANCE_A = 0.02;

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
		description:
			"Speed control motor M206-402 / 2GN-20K, 6 W, driven by speed controller US-52 (2 A max) behind the relay",
		// 6 W / 0.35 = 17 W in; 17 W / (220 V x 0.8) = 0.097 A; plus the
		// controller allowance. Not the controller's 2 A rating, which is the
		// most it can drive and not what this 6 W motor draws.
		currentA:
			GEAR_MOTOR_RATED_W / GEAR_MOTOR_EFFICIENCY / (MAINS_VOLTAGE_V * GEAR_MOTOR_POWER_FACTOR) +
			SPEED_CONTROLLER_ALLOWANCE_A,
		basis:
			"estimated: 6 W output, 35 % efficiency, power factor 0.8, plus 0.02 A for the speed controller",
	},
	{
		id: "electronics",
		description: "12 V 2 A adapter -> 12 V relay coil + buck converter -> 5 V ESP32",
		// Relay coil about 0.4 W plus ESP32 about 2.5 W peak with Wi-Fi is
		// 2.9 W DC. At about 72 % conversion efficiency (adapter 80 %, buck
		// 90 %) that is about 4 W from the wall, and at a power factor of 0.5
		// typical of a small switching adapter about 8 VA. This is the real
		// load, not the adapter's 2 A (24 W) capacity.
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
