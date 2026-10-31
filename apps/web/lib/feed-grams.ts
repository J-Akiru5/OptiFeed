import { type DeriveOverrides, deriveDeviceDose } from "@/lib/feeding/derive";

export type GramsSyncConfig = DeriveOverrides;

/**
 * Backwards-compatible wrapper around `deriveDeviceDose`.
 *
 * New code should call `deriveDeviceDose` directly; this name is kept for the
 * settings and biomass call sites that already import it.
 */
export async function syncDeviceGramsForPond(
	pondId: string,
	config?: GramsSyncConfig,
): Promise<number | null> {
	const result = await deriveDeviceDose(pondId, config);
	return result.status === "updated" ? result.grams : null;
}
