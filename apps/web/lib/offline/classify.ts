/**
 * Whether a failed save is worth queueing in the offline outbox (#751).
 *
 * The biomass form used to queue on *any* throw. A server action that reached
 * the server and failed (validation, permissions, a database error) can never
 * succeed when replayed later, so it must surface as an error instead of
 * disappearing into the outbox as a fake "saved offline".
 */
const TRANSPORT_MESSAGE = /failed to fetch|networkerror|network request failed|load failed/i;

export function shouldQueueOffline(error: unknown, online: boolean): boolean {
	// Abort and timeout are deliberate cancellations, never an offline sample.
	if (error instanceof DOMException) return false;
	// The browser already knows it has no connection: a mid-flight drop is the
	// one case where the server never saw the request.
	if (!online) return true;
	// `fetch` rejects with TypeError for DNS/connection failures.
	if (error instanceof TypeError) return true;
	if (error instanceof Error && TRANSPORT_MESSAGE.test(error.message)) return true;
	return false;
}
