import { NotificationList } from "@/components/NotificationList";
import { Link } from "@/i18n/routing";
import { getActivePond } from "@/lib/pond-selection";
import prisma from "@/lib/prisma";
import { getTranslations } from "next-intl/server";

export const revalidate = 0;

export default async function NotificationsPage({
	searchParams,
}: {
	searchParams: Promise<{ tier?: string; category?: string }>;
}) {
	const t = await getTranslations("dashboard.notifications");
	const params = await searchParams;
	const pond = await getActivePond();

	if (!pond) {
		return (
			<div className="flex h-[50vh] items-center justify-center">
				<p className="text-lg text-gray-500 dark:text-gray-400">{t("noPondData")}</p>
			</div>
		);
	}

	const where: Record<string, unknown> = { pondId: pond.id };
	if (params.tier && params.tier !== "all") {
		where.tier = params.tier;
	}
	if (params.category && params.category !== "all") {
		where.category = params.category;
	}

	const notifications = await prisma.notification.findMany({
		where,
		orderBy: { createdAt: "desc" },
		take: 100,
	});

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
		<div className="mx-auto max-w-4xl space-y-6 animate-in fade-in duration-150">
			<section className="rounded-[32px] border border-[#0A3D62]/5 bg-white p-5 shadow-md dark:bg-gray-900 md:p-8">
				<div className="flex flex-col justify-between gap-4 border-b border-gray-100 pb-6 dark:border-gray-700/50 sm:flex-row sm:items-end">
					<div>
						<h1 className="mt-1 text-2xl font-black uppercase text-[#0A3D62] dark:text-[#5b9bd5] md:text-3xl">
							{t("title")}
						</h1>
						<p className="mt-1 max-w-xl text-sm font-semibold text-[#3D5568] dark:text-gray-300">
							{t("count", { count: serialized.length })}
						</p>
					</div>
				</div>

				{/* Tier filter tabs */}
				<div className="mt-6 flex flex-wrap gap-2">
					{tiers.map((tier) => {
						const isActive =
							tier.key === "all" ? !params.tier || params.tier === "all" : params.tier === tier.key;
						return (
							<Link
								key={tier.key}
								href={tierHref(tier.key)}
								className={`rounded-full px-4 py-1.5 text-xs font-bold uppercase transition-colors ${
									isActive
										? "bg-[#0A3D62] text-white"
										: "bg-[#F4F7F6] text-[#3D5568] hover:bg-[#E8EDED] dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
								}`}
							>
								{t.has(tier.labelKey) ? t(tier.labelKey) : tier.key}
							</Link>
						);
					})}
				</div>

				{/* Category filter tabs */}
				<div className="mt-3 flex flex-wrap gap-2">
					{categories.map((cat) => {
						const isActive =
							cat.key === "all"
								? !params.category || params.category === "all"
								: params.category === cat.key;
						return (
							<Link
								key={cat.key}
								href={categoryHref(cat.key)}
								className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase transition-colors ${
									isActive
										? "bg-[#3D5568] text-white"
										: "bg-gray-100 text-[#3D5568] hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
								}`}
							>
								{t.has(cat.labelKey) ? t(cat.labelKey) : cat.key}
							</Link>
						);
					})}
				</div>

				<NotificationList initialNotifications={serialized} pondId={pond.id} />
			</section>
		</div>
	);
}
