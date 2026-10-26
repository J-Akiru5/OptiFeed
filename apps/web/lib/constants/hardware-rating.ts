/**
 * Power rating printed on the PakaonAI feeder sticker (Admin → Devices →
 * Print label).
 *
 * TODO(verify-on-hardware): these values come from the capstone manuscript
 * (12 V, 5 A supply, p. 73). They have NOT been read off the physical supply
 * or the motor nameplate, and the current has not been measured during a
 * feed. Do not treat the printed rating as correct until someone has checked
 * it against the real parts and updated this file.
 *
 * Deliberately a constant rather than a database column: it describes the
 * hardware design, not an individual device record.
 */
export const HARDWARE_RATING = {
	inputVoltage: 12,
	supplyType: "DC",
	maxCurrentA: 5,
} as const satisfies { inputVoltage: number; supplyType: "DC" | "AC"; maxCurrentA: number };

/**
 * Supply capacity in watts, derived as V × A. It is what the supply can
 * deliver, not what the feeder actually draws.
 */
export function maxPowerW(
	rating: { inputVoltage: number; maxCurrentA: number } = HARDWARE_RATING,
): number {
	return rating.inputVoltage * rating.maxCurrentA;
}
