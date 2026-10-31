/**
 * Calendar capability for the current caller.
 *
 * The UI state is derived from the same inputs the server writes with:
 * - no write permission (or a view-only session) -> read
 * - write permission but only some ponds writable -> own-farm
 * - write permission across every listed pond -> edit
 */
export type CalendarCapability = "edit" | "own-farm" | "read";

export interface CalendarCapabilityInput {
	canManage: boolean;
	/** Pond ids the caller may edit. Omitted means every listed pond. */
	writablePondIds?: readonly string[];
	/** Number of ponds rendered on the page. */
	pondCount: number;
}

export function calendarCapability({
	canManage,
	writablePondIds,
	pondCount,
}: CalendarCapabilityInput): CalendarCapability {
	if (!canManage) return "read";
	if (!writablePondIds) return "edit";
	return writablePondIds.length < pondCount ? "own-farm" : "edit";
}
