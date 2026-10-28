/**
 * The label print routes take repeatable `?id=` values, one per device to
 * print. Missing, blank and duplicate values are not a selection: the Devices
 * pages' "print selected labels" form submits no `id` at all when no box is
 * ticked, and that has to mean "every device in scope" rather than a 404.
 *
 * The action and the page share this parser so "is this an explicit
 * selection?" cannot drift between the query and the not-found guard.
 */
export function parseDeviceLabelIds(param: string | string[] | undefined): string[] {
	const raw = param === undefined ? [] : Array.isArray(param) ? param : [param];
	return [...new Set(raw.filter((id) => typeof id === "string" && id.trim().length > 0))];
}
