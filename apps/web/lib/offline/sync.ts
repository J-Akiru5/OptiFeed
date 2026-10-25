import { saveBiomassLog } from "@/lib/actions/biomass";
import { listOutbox, markOutboxAttempt, removeOutboxItem } from "./outbox";

export interface FlushOutboxResult {
	synced: number;
	remaining: number;
	errors: string[];
}

function buildFormData(item: Awaited<ReturnType<typeof listOutbox>>[number]): FormData {
	const payload = item.payload;
	const formData = new FormData();
	formData.append("clientEventId", payload.clientEventId);
	formData.append("pondId", payload.pondId);
	formData.append("sampleWeightKg", String(payload.sampleWeightKg));
	formData.append("sampleLengthCm", String(payload.sampleLengthCm));
	formData.append("sampleCount", String(payload.sampleCount));
	formData.append("batchLabel", payload.batchLabel ?? "");
	formData.append("recordedAt", payload.recordedAt);
	if (payload.fishSamples && payload.fishSamples.length > 0) {
		formData.append("fishSamples", JSON.stringify(payload.fishSamples));
	}
	return formData;
}

/**
 * Replay the queued offline samples through the same server action the form
 * uses. Sequential on purpose: preserves order and stops on a lost session so
 * the rest of the queue is not burned through with 401s.
 */
export async function flushBiomassOutbox(scope: string): Promise<FlushOutboxResult> {
	if (typeof navigator !== "undefined" && !navigator.onLine) {
		const pending = await listOutbox();
		return {
			synced: 0,
			remaining: pending.filter((item) => item.payload.scope === scope).length,
			errors: [],
		};
	}

	const items = (await listOutbox()).filter(
		(item) => item.payload.scope === scope && item.status !== "failed",
	);
	let synced = 0;
	const errors: string[] = [];

	for (const item of items) {
		if (typeof navigator !== "undefined" && !navigator.onLine) break;
		try {
			const result = await saveBiomassLog(buildFormData(item));
			if (result.success) {
				await removeOutboxItem(item.id);
				synced += 1;
				continue;
			}
			await markOutboxAttempt(item.id, result.error);
			errors.push(result.error);
			if (/session|unauth|login|permission/i.test(result.error)) break;
		} catch (error) {
			const message = error instanceof Error ? error.message : "Network error";
			await markOutboxAttempt(item.id, message);
			errors.push(message);
			break;
		}
	}

	const remaining = (await listOutbox()).filter(
		(item) => item.payload.scope === scope && item.status !== "failed",
	).length;
	return { synced, remaining, errors };
}
