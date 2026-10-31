/**
 * Hopper capacity from tank geometry (issue #415).
 *
 * The ultrasonic sensor measures the distance from the top of the tank, so the
 * full/empty pair already gives the usable *height*. The missing dimension was
 * the tank diameter: with it, the usable volume is the cylinder between the
 * two marks,
 *
 *   V = π · (diameter / 2)² · (empty − full)   [cm³]
 *
 * and the feed weight that fits is that volume times the feed bulk density,
 *
 *   capacity = V · density                      [g]
 *
 * Before this, the capacity in grams was typed in by hand and was only as
 * accurate as the guess behind it. The geometry and the density are both
 * measurable, so the estimate is now reproducible and reviewable, and the
 * operator can see the volume the number came from.
 *
 * Assumption: the tank is a straight cylinder between the full and empty
 * marks. A tapered bottle holds less near the shoulder; the operator keeps the
 * override (the stored `hopperCapacityG`) when the shape is far from a
 * cylinder.
 */

/** Bulk density of a typical floating fish pellet, g/cm³. */
export const DEFAULT_HOPPER_BULK_DENSITY_G_CM3 = 0.65;

/** A measurable tank: a ruler-sized diameter avoids divide-by-zero shapes. */
export const HOPPER_DIAMETER_CM_MIN = 1;
export const HOPPER_DIAMETER_CM_MAX = 200;

/**
 * Plausible feed bulk densities. Below ~0.2 g/cm³ the feed is mostly air;
 * above ~1.2 g/cm³ it sinks faster than the pellets this feeder is built for.
 */
export const HOPPER_DENSITY_G_CM3_MIN = 0.2;
export const HOPPER_DENSITY_G_CM3_MAX = 1.2;

export interface HopperGeometry {
	diameterCm: number | null | undefined;
	fullCm: number | null | undefined;
	emptyCm: number | null | undefined;
}

function finite(value: number | null | undefined): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

/**
 * Usable volume between the full and empty marks, in cm³, or null when any
 * dimension is missing or the marks are inverted.
 */
export function hopperUsableVolumeCm3(geometry: HopperGeometry): number | null {
	const { diameterCm, fullCm, emptyCm } = geometry;
	if (!finite(diameterCm) || !finite(fullCm) || !finite(emptyCm)) return null;
	if (diameterCm <= 0 || emptyCm <= fullCm) return null;
	const radiusCm = diameterCm / 2;
	return Math.PI * radiusCm * radiusCm * (emptyCm - fullCm);
}

/** The same volume in litres, for display. */
export function hopperUsableVolumeL(geometry: HopperGeometry): number | null {
	const cm3 = hopperUsableVolumeCm3(geometry);
	return cm3 === null ? null : cm3 / 1000;
}

/**
 * Capacity in whole grams, or null when the geometry or the density is not
 * usable. Rounded to the gram because the stored column and every downstream
 * estimate work in whole grams.
 */
export function hopperCapacityFromGeometry(
	geometry: HopperGeometry,
	densityGCm3: number | null | undefined = DEFAULT_HOPPER_BULK_DENSITY_G_CM3,
): number | null {
	const volumeCm3 = hopperUsableVolumeCm3(geometry);
	if (volumeCm3 === null) return null;
	if (!finite(densityGCm3)) return null;
	if (densityGCm3 < HOPPER_DENSITY_G_CM3_MIN || densityGCm3 > HOPPER_DENSITY_G_CM3_MAX) {
		return null;
	}
	return Math.round(volumeCm3 * densityGCm3);
}
