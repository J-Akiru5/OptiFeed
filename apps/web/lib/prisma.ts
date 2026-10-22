import { recordQuery } from "@/lib/api/request-context";
import { Prisma, PrismaClient } from "@prisma/client";

/**
 * Query counting lives at the data layer (§8.2 rule 13), not in handlers.
 *
 * Every Prisma operation — including `$queryRaw` and calls inside
 * `$transaction` — passes through this extension hook. When the call happens
 * inside an instrumented route (`withApi`), the duration and count are added
 * to that request's `Server-Timing`. Outside a request the hook is a no-op.
 */
const queryMetrics = Prisma.defineExtension({
	name: "api-query-metrics",
	query: {
		$allOperations({ args, query }) {
			const startedAt = performance.now();
			return query(args).finally(() => recordQuery(performance.now() - startedAt));
		},
	},
});

const prismaClientSingleton = () => new PrismaClient().$extends(queryMetrics);

declare global {
	var prismaGlobal: PrismaClient | undefined;
}

/**
 * The runtime client carries the query hook, but it is typed as `PrismaClient`
 * so existing helpers that accept `Prisma.TransactionClient` keep compiling.
 * The extension only observes queries; it adds no model or result surface, so
 * the narrower type is accurate for callers.
 */
const prisma = (globalThis.prismaGlobal ?? prismaClientSingleton()) as unknown as PrismaClient;

export default prisma;

if (process.env.NODE_ENV !== "production") globalThis.prismaGlobal = prisma;
