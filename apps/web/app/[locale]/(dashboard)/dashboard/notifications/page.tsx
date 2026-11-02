import { NotificationList } from "@/components/NotificationList";
import {
	DashboardEmptyState,
	DashboardPageHeader,
	DashboardPageShell,
	ReadOnlyNotice,
} from "@/components/dashboard/dashboard-ui";
import { Pagination } from "@/components/ui/pagination";
import { Link } from "@/i18n/routing";
import { canWrite } from "@/lib/auth/session";
import { parsePage, resolvePagination } from "@/lib/pagination";
import { getActivePond } from "@/lib/pond-selection";
import prisma from "@/lib/prisma";
import { getListPageSize } from "@/lib/settings/platform";
import { Bell } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const revalidate = 0;

export default async function NotificationsPage({
	searchParams,
}: {
	searchParams: Promise<{ tier?: string; category?: string; page?: string }>;
}) {
	const [t, tCommon, writeAccess, pageSize] = await Promise.all([
		getTranslations("dashboard.notifications"),
		getTranslations("dashboard.common"),
		canWrite(),
		getListPageSize(),
	]);
	const params = await searchParams;
	const page = parsePage(params.page);
	const pond = await getActivePond();

	if (!pond) {
		return (
			<div className="mx-auto max-w-2xl py-10">
				<DashboardEmptyState icon={Bell} title={t("noPondData")} description={t("empty")} />
			</div>
		);
	}

	const where: Record<string, unknown> = { pondId: pond.id, supersededById: null };
	if (params.tier && params.tier !== "all") {
		where.tier = params.tier;
	}
	if (params.category && params.category !== "all") {
		where.category = params.category;
	}

	const [total, firstFetch] = await Promise.all([
		prisma.notification.count({ where }),
		prisma.notification.findMany({
			where,
			orderBy: { createdAt: "desc" },
			skip: (page - 1) * pageSize,
			take: pageSize,
		}),
	]);
	const paging = resolvePagination(page, pageSize, total);
	const notifications =
		paging.page === page
			? firstFetch
			: await prisma.notification.findMany({
					where,
					orderBy: { createdAt: "desc" },
					skip: paging.offset,
					take: paging.pageSize,
				});
	const firstRow = total === 0 ? 0 : (paging.page - 1) * paging.pageSize + 1;
	const lastRow = Math.min(paging.page * paging.pageSize, total);

	const serialized = notifications.map((n) => ({
		id: n.id,
		tier: n.tier,
		message: n.message,
		category: n.category,
		read: n.read,
		autoCleared: n.autoCleared,
		acknowledgedAt: n.acknowledgedAt?.toISOString() ?? null,
		createdAt: n.createdAt.toISOString(),
	}));

	const tiers = [
		{ key: "all", labelKey: "tierAll" },
		{ key: "CRITICAL", labelKey: "tierCritical" },
		{ key: "WARNING", labelKey: "tierWarning" },
		{ key: "INFO", labelKey: "tierInfo" },
		{ key: "SUCCESS", labelKey: "tierSuccess" },
	];

	const categories = [
		{ key: "all", labelKey: "categoryAll" },
		{ key: "connectivity", labelKey: "categoryConnectivity" },
		{ key: "feeding", labelKey: "categoryFeeding" },
		{ key: "schedule", labelKey: "categorySchedule" },
		{ key: "system", labelKey: "categorySystem" },
	];

	const tierHref = (key: string) =>
		key === "all"
			? "/dashboard/notifications"
			: {
					pathname: "/dashboard/notifications",
					query: {
						tier: key,
						...(params.category && params.category !== "all" ? { category: params.category } : {}),
					},
				};

	const categoryHref = (key: string) =>
		key === "all"
			? "/dashboard/notifications"
			: {
					pathname: "/dashboard/notifications",
					query: {
						category: key,
						...(params.tier && params.tier !== "all" ? { tier: params.tier } : {}),
					},
				};

	return (
		<DashboardPageShell className="space-y-6 animate-in fade-in duration-150">
			<section className="rounded-3xl border border-[#0A3D62]/5 bg-white p-4 shadow-md dark:bg-gray-900 sm:p-6 md:p-8">
				<div className="border-b border-gray-100 pb-6 dark:border-gray-700/50">
					<DashboardPageHeader
						icon={Bell}
						title={t("title")}
						description={t("count", { count: total })}
					/>
				</div>

				{/* Tier filter tabs */}
				<nav aria-label={t("filtersTierLabel")} className="mt-6 flex flex-wrap gap-2">
					{tiers.map((tier) => {
						const isActive =
							tier.key === "all" ? !params.tier || params.tier === "all" : params.tier === tier.key;
						return (
							<Link
								key={tier.key}
								href={tierHref(tier.key)}
								aria-current={isActive ? "page" : undefined}
								className={`inline-flex min-h-11 items-center rounded-full px-4 py-2 text-xs font-bold uppercase transition-colors focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea] ${
									isActive
										? "bg-[#0A3D62] text-white"
										: "bg-[#F4F7F6] text-[#3D5568] hover:bg-[#E8EDED] dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
								}`}
							>
								{t.has(tier.labelKey) ? t(tier.labelKey) : tier.key}
							</Link>
						);
					})}
				</nav>

				{/* Category filter tabs */}
				<nav aria-label={t("filtersCategoryLabel")} className="mt-3 flex flex-wrap gap-2">
					{categories.map((cat) => {
						const isActive =
							cat.key === "all"
								? !params.category || params.category === "all"
								: params.category === cat.key;
						return (
							<Link
								key={cat.key}
								href={categoryHref(cat.key)}
								aria-current={isActive ? "page" : undefined}
								className={`inline-flex min-h-11 items-center rounded-full px-3 py-2 text-[10px] font-bold uppercase transition-colors focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea] ${
									isActive
										? "bg-[#3D5568] text-white"
										: "bg-gray-100 text-[#3D5568] hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
								}`}
							>
								{t.has(cat.labelKey) ? t(cat.labelKey) : cat.key}
							</Link>
						);
					})}
				</nav>

				{!writeAccess && (
					<ReadOnlyNotice title={tCommon("readOnlyTitle")} description={tCommon("readOnlyDesc")} />
				)}

				<NotificationList
					initialNotifications={serialized}
					pondId={pond.id}
					canWrite={writeAccess}
				/>

				{total > 0 && (
					<Pagination
						basePath="/dashboard/notifications"
						params={{
							tier: params.tier && params.tier !== "all" ? params.tier : undefined,
							category: params.category && params.category !== "all" ? params.category : undefined,
						}}
						page={paging.page}
						pageCount={paging.pageCount}
						showing={tCommon("pagination.showing", {
							from: firstRow,
							to: lastRow,
							total,
						})}
						previousLabel={tCommon("pagination.previous")}
						nextLabel={tCommon("pagination.next")}
						label={tCommon("pagination.label")}
					/>
				)}
			</section>
		</DashboardPageShell>
	);
}
