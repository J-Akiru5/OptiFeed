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

type EpisodeStore = Pick<
	PrismaClient["notification"],
	"findFirst" | "create" | "update" | "updateMany"
>;

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

/**
 * Open the episode for `episodeKey`, or bring the open one up to date.
 *
 * Writes only when the signature (tier + message) changes, so a heartbeat every
 * few seconds against an already-reported condition costs one read and no write.
 */
export async function openEpisode(
	store: Pick<PrismaClient, "notification">,
	input: EpisodeInput,
): Promise<EpisodeResult> {
	const open = await store.notification.findFirst({
		where: { episodeKey: input.episodeKey, resolvedAt: null, autoCleared: false },
		orderBy: { createdAt: "desc" },
		select: { id: true, tier: true, message: true },
	});

	if (!open) {
		const created = await store.notification.create({
			data: {
				pondId: input.pondId,
				tier: input.tier,
				category: input.category,
				message: input.message,
				linkTo: input.linkTo ?? null,
				episodeKey: input.episodeKey,
			},
			select: { id: true },
		});
		return { created: true, updated: false, id: created.id };
	}

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
