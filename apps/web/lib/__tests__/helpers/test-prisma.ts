import type { QueryArgs, TenancyClient, TenancyDb } from "./tenancy";

/**
 * The shared tenancy double, plus the Prisma shapes the admin/superadmin
 * actions use that the base harness does not implement:
 *
 * - the `orgId_userId` compound key (`prisma.membership.findUnique`), which
 *   `inviteOrAttachMember` uses to find an existing membership;
 * - `membership.groupBy({ by: ["orgId"] })`, used by the platform lists and
 *   `listTenantMembers` to count members/owners per organization;
 * - the array form of `$transaction([...])`, used by the daily-cap actions.
 *
 * It deliberately delegates every other call to the harness so a test still
 * exercises the real query filters instead of stubbing the answer. `$transaction`
 * passes this same client to the callback, so a test can spy on one delegate
 * and observe both the pre-check and the in-transaction re-check.
 */

type Row = Record<string, unknown>;

export type TestPrismaClient = TenancyClient & {
	membership: TenancyClient["membership"] & {
		groupBy: (args: QueryArgs & { by?: readonly string[] }) => Promise<Row[]>;
	};
};

export function createTestPrisma(db: TenancyDb): TestPrismaClient {
	const base = db.client;

	const membership = {
		...base.membership,
		async findUnique(args: QueryArgs = {}) {
			const composite = args.where?.orgId_userId as { orgId?: string; userId?: string } | undefined;
			if (!composite) return base.membership.findUnique(args);
			return base.membership.findFirst({
				where: { orgId: composite.orgId, userId: composite.userId },
				select: args.select,
			});
		},
		async groupBy(args: QueryArgs & { by?: readonly string[] }) {
			const field = args.by?.[0];
			if (!field) return [];
			const rows = await base.membership.findMany({ where: args.where });
			const counts = new Map<string, number>();
			for (const row of rows) {
				const key = String(row[field]);
				counts.set(key, (counts.get(key) ?? 0) + 1);
			}
			return [...counts].map(([key, count]) => ({
				[field]: key,
				_count: { _all: count },
			}));
		},
	};

	const client = { ...base, membership } as unknown as TestPrismaClient;
	client.$transaction = (<T>(arg: unknown): Promise<T> => {
		if (Array.isArray(arg)) return Promise.all(arg) as unknown as Promise<T>;
		return (arg as (tx: TestPrismaClient) => Promise<T>)(client);
	}) as TestPrismaClient["$transaction"];
	return client;
}
