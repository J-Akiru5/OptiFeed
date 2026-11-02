import type { Prisma } from "@prisma/client";

/**
 * Recurring condition alerts are episodes, not events (#534).
 *
 * A condition (low hopper, unreachable device, cold water) opens exactly one
 * notification row. While the episode is open, further readings update that row
 * in place — escalating WARNING → CRITICAL is an update, never a second row —
 * and a recovery closes it (`resolvedAt` + `autoCleared`) so the next dip opens
 * a fresh episode. `episodeKey` is the stable condition identity.
 *
 * The race-safe guarantee is the partial unique index
 * `Notification_one_open_per_episode` (migration 20261102200000): one open row
 * per `episodeKey`. The index predicate and `openEpisode()`'s lookup must stay
 * identical, because a row excluded from one but not the other could leave the
 * caller unable to either reuse the row or insert a new one.
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

type NotificationDelegate = Prisma.TransactionClient["notification"];

type NotificationStore = Pick<
	NotificationDelegate,
	"findFirst" | "create" | "update" | "updateMany"
> & {
	/**
	 * Optional only so a narrower test double still works. Prisma's delegate
	 * always has it; `skipDuplicates` turns the insert into
	 * `ON CONFLICT DO NOTHING`, which keeps the caller's transaction usable when
	 * a concurrent heartbeat wins the insert. Without it, the create falls back
	 * to catching the unique violation below.
	 */
	createMany?: NotificationDelegate["createMany"];
};

type EpisodeStore = {
	notification: NotificationStore;
};

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
 * The one definition of an open episode. `supersededById` rows were folded by
 * the #534 migration and are audit history, not live alerts.
 */
function openEpisodeWhere(episodeKey: string) {
	return {
		episodeKey,
		resolvedAt: null,
		autoCleared: false,
		supersededById: null,
	};
}

function episodeData(input: EpisodeInput) {
	return {
		pondId: input.pondId,
		tier: input.tier,
		category: input.category,
		message: input.message,
		linkTo: input.linkTo ?? null,
		episodeKey: input.episodeKey,
	};
}

/** Prisma reports P2002; a raw PostgreSQL driver can surface 23505. */
function isUniqueViolation(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const code = (error as { code?: unknown }).code;
	return code === "P2002" || code === "23505";
}

async function reconcileOpenEpisode(
	store: EpisodeStore,
	open: { id: string; tier: string; message: string },
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
 * Concurrent callers converge on one row: the insert is guarded by the partial
 * unique index, and a caller that loses the race re-reads the winner and
 * updates it instead of throwing or opening a second episode.
 *
 * All reads and writes go through the supplied store, so a caller with a
 * transaction client (`Prisma.TransactionClient`) keeps the episode in that
 * transaction; this function never opens a transaction of its own.
 */
export async function openEpisode(
	store: EpisodeStore,
	input: EpisodeInput,
): Promise<EpisodeResult> {
	let lastInsertError: unknown;

	for (let attempt = 0; attempt < 3; attempt += 1) {
		const open = await store.notification.findFirst({
			where: openEpisodeWhere(input.episodeKey),
			orderBy: { createdAt: "desc" },
			select: { id: true, tier: true, message: true },
		});
		if (open) return reconcileOpenEpisode(store, open, input);

		if (typeof store.notification.createMany === "function") {
			const { count } = await store.notification.createMany({
				data: [episodeData(input)],
				skipDuplicates: true,
			});
			if (count === 0) continue; // someone else won; re-read them on the next pass
			const created = await store.notification.findFirst({
				where: openEpisodeWhere(input.episodeKey),
				orderBy: { createdAt: "desc" },
				select: { id: true },
			});
			if (created) return { created: true, updated: false, id: created.id };
			continue; // the condition cleared before we could read the row back
		}

		try {
			const created = await store.notification.create({
				data: episodeData(input),
				select: { id: true },
			});
			return { created: true, updated: false, id: created.id };
		} catch (error) {
			if (!isUniqueViolation(error)) throw error;
			// Another caller inserted first. The next pass re-reads their row.
			lastInsertError = error;
		}
	}

	throw lastInsertError instanceof Error
		? lastInsertError
		: new Error(
				`Could not open notification episode ${input.episodeKey}: concurrent insert did not settle`,
			);
}

/**
 * Close every open row for `episodeKey`. Returns the number of rows closed.
 *
 * Rows are never deleted: they stay readable in the audit trail with
 * `resolvedAt` set and `autoCleared` true, and the list keeps them collapsed.
 * This deliberately does not filter `supersededById`: a legacy folded row that
 * is still open must be closed by the same recovery.
 */
export async function closeEpisode(store: EpisodeStore, episodeKey: string): Promise<number> {
	const { count } = await store.notification.updateMany({
		where: { episodeKey, resolvedAt: null, autoCleared: false },
		data: {
			autoCleared: true,
			read: true,
			resolvedAt: new Date(),
			resolutionReason: "condition_recovered",
		},
	});
	return count;
}
