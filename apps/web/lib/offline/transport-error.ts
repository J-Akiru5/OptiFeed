/**
 * Whether a thrown server-action error is a transport failure that the offline
 * outbox can safely retry later.
 *
 * Only connectivity failures qualify. Permission, session, validation and
 * server errors must be shown to the farmer instead of being queued: replaying
 * a rejected write would hide the refusal and could save a sample the server
 * never accepted (#751).
 */
export function isTransportFailure(error: unknown, online?: boolean): boolean {
	const browserOnline =
		typeof online === "boolean"
			? online
			: typeof navigator !== "undefined"
				? navigator.onLine
				: true;
	if (!browserOnline) return true;

	const name =
		typeof error === "object" && error !== null && "name" in error
			? String((error as { name?: unknown }).name ?? "")
			: "";
	const message =
		typeof error === "object" && error !== null && "message" in error
			? String((error as { message?: unknown }).message ?? "")
			: typeof error === "string"
				? error
				: "";

	if (name === "TypeError" && /fetch|network|load failed/i.test(message)) return true;

	return /failed to fetch|network ?error|network ?request ?failed|load failed|fetch failed|err_internet_disconnected|err_network/i.test(
		message,
	);
}
