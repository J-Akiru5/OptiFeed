import prisma from "@/lib/prisma";

/**
 * Dead-letter list for the platform console (issue #590).
 *
 * A job leaves the retry loop as `failed` after `JOB_MAX_ATTEMPTS` (or on an
 * import timeout, where the write may already have committed). Those rows are
 * the ones an operator needs: the type, the farm, how many attempts it took and
 * the last error. `lastError` is operator-only; the tenant status endpoint keeps
 * serving the sanitized `error` column.
 */

const DEAD_LETTER_DEFAULT_LIMIT = 20;
const DEAD_LETTER_MAX_LIMIT = 100;

type DeadLetterJobRow = {
	id: string;
	type: string;
	ownerId: string;
	attempts: number;
	lastError: string | null;
	finishedAt: string | null;
	createdAt: string;
};

export async function listDeadLetterJobs(
	limit = DEAD_LETTER_DEFAULT_LIMIT,
): Promise<DeadLetterJobRow[]> {
	const take = Math.min(Math.max(1, limit), DEAD_LETTER_MAX_LIMIT);

	const rows = await prisma.backgroundJob.findMany({
		where: { status: "failed" },
		orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
		take,
		select: {
			id: true,
			type: true,
			ownerId: true,
			attempts: true,
			lastError: true,
			finishedAt: true,
			createdAt: true,
		},
	});

	return rows.map((row) => ({
		...row,
		finishedAt: row.finishedAt?.toISOString() ?? null,
		createdAt: row.createdAt.toISOString(),
	}));
}
