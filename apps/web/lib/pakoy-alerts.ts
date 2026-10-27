/**
 * Which alerts Pakoy fronts (#221).
 *
 * Presentation only: the notification row keeps its tier colour and its
 * actions. Pakoy's head replaces the severity glyph on the three alert
 * categories that are about the feeder itself, so the mascot always means
 * "this one is about feeding or the device".
 */
const PAKOY_ALERT_CATEGORIES = new Set(["feeding", "hopper_low", "connectivity"]);

export function showsPakoy(category: string | null | undefined): boolean {
	return typeof category === "string" && PAKOY_ALERT_CATEGORIES.has(category);
}
