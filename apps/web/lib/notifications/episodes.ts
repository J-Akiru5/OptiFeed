import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

/**
 * Recurring condition alerts are episodes, not events (#534).
 *
 * A condition (low hopper, unreachable device, cold water) opens exactly one
 * notification row. While the episode is open, further readings update that row
 * in place — escalating WARNING → CRITICAL is an update, never a second row —
 * and a recovery closes it (`resolvedAt` + `autoCleared`) so the next dip opens
 * a fresh episode. `episodeKey` is the stable condition identity.
 */
export type EpisodeCategory = "pellet" | "connectivity" | "feeding" | "system";

export function pelletEpisodeKey(deviceId: string): string {
	return `pellet:${deviceId}`;
}

export function feedDaysEpisodeKey(deviceId: string): string {
	return `pellet-days:${deviceId}`;
}

export function offlineEpisodeKey(deviceId: string): string {
	return `offline:${deviceId}`;
}

export function coldWaterEpisodeKey(deviceId: string): string {
	return `cold-water:${deviceId}`;
}

type EpisodeStore = Pick<PrismaClient, "notification" | "$queryRaw">;

export interface EpisodeInput {
	pondId: string;
	category: EpisodeCategory;
	episodeKey: string;
	tier: string;
	message: string;
	linkTo?: string | null;
}

export interface EpisodeResult {
	/** A new row was opened for this condition. */
	created: boolean;
	/** An already-open episode changed (escalated or reworded). */
	updated: boolean;
	id: string | null;
}

type OpenEpisode = {
	id: string;
	tier: string;
	message: string;
};

async function findOpenEpisode(
	store: Pick<PrismaClient, "notification">,
	episodeKey: string,
): Promise<OpenEpisode | null> {
	return store.notification.findFirst({
		where: { episodeKey, resolvedAt: null, autoCleared: false },
		orderBy: { createdAt: "desc" },
		select: { id: true, tier: true, message: true },
	});
}

async function reconcileOpenEpisode(
	store: Pick<PrismaClient, "notification">,
	open: OpenEpisode,
	input: EpisodeInput,
): Promise<EpisodeResult> {
	if (open.tier === input.tier && open.message === input.message) {
		return { created: false, updated: false, id: open.id };
	}

	await store.notification.update({
		where: { id: open.id },
		data: {
			tier: input.tier,
			message: input.message,
			linkTo: input.linkTo ?? null,
			read: false,
		},
	});
	return { created: false, updated: true, id: open.id };
}

/**
 * Open the episode for `episodeKey`, or bring the open one up to date.
 *
 * Writes only when the signature (tier + message) changes, so a heartbeat every
 * few seconds against an already-reported condition costs one read and no write.
 *
 * The partial unique index on open `episodeKey` rows is the concurrency
 * authority. The insert uses `ON CONFLICT DO NOTHING` rather than catching
 * P2002: a P2002 aborts the caller's PostgreSQL transaction (the ingest path
 * passes `tx`), so a benign race must not raise. A conflict leaves the winner
 * for the next pass to re-read and update (#585).
 */
export async function openEpisode(
	store: EpisodeStore,
	input: EpisodeInput,
): Promise<EpisodeResult> {
	for (let attempt = 0; attempt < 2; attempt++) {
		const open = await findOpenEpisode(store, input.episodeKey);
		if (open) return reconcileOpenEpisode(store, open, input);

		const inserted = await store.$queryRaw<{ id: string }[]>`
			INSERT INTO "Notification" ("id", "pondId", "tier", "category", "message", "linkTo", "episodeKey")
			VALUES (${randomUUID()}, ${input.pondId}, ${input.tier}, ${input.category}, ${input.message}, ${input.linkTo ?? null}, ${input.episodeKey})
			ON CONFLICT ("episodeKey") WHERE "resolvedAt" IS NULL AND "autoCleared" = false
			DO NOTHING
			RETURNING "id"
		`;
		if (inserted.length > 0) {
			return { created: true, updated: false, id: inserted[0].id };
		}
		// A concurrent caller won the unique index. The next pass re-reads it
		// and updates it; if it is already resolved, the insert is retried once.
	}

	throw new Error(`Could not open episode ${input.episodeKey}`);
}

/**
 * Close every open row for `episodeKey`. Returns the number of rows closed.
 *
 * Rows are never deleted: they stay readable in the audit trail with
 * `resolvedAt` set and `autoCleared` true, and the list keeps them collapsed.
 */
export async function closeEpisode(
	store: Pick<PrismaClient, "notification">,
	episodeKey: string,
): Promise<number> {
	const { count } = await store.notification.updateMany({
		where: { episodeKey, resolvedAt: null, autoCleared: false },
		data: { autoCleared: true, read: true, resolvedAt: new Date() },
	});
	return count;
}
