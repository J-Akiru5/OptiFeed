import { NotificationList } from "@/components/NotificationList";
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
	const pond = await prisma.pond.findFirst({
		where: { ownerId: "demo-farmer-1" },
	});

	if (!pond) {
		return (
			<div className="flex h-[50vh] items-center justify-center">
				<p className="text-lg text-gray-500">No pond data found.</p>
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
		{ key: "all", label: "All" },
		{ key: "CRITICAL", label: "Critical" },
		{ key: "WARNING", label: "Warning" },
		{ key: "INFO", label: "Info" },
		{ key: "SUCCESS", label: "Success" },
	];

	const categories = [
		{ key: "all", label: "All Categories" },
		{ key: "connectivity", label: "Connectivity" },
		{ key: "feeding", label: "Feeding" },
		{ key: "schedule", label: "Schedule" },
		{ key: "system", label: "System" },
	];

	return (
		<div className="mx-auto max-w-4xl space-y-6 animate-in fade-in duration-500">
			<section className="rounded-[32px] border border-[#0A3D62]/5 bg-white p-5 shadow-md md:p-8">
				<div className="flex flex-col justify-between gap-4 border-b border-gray-100 pb-6 sm:flex-row sm:items-end">
					<div>
						<h1 className="mt-1 text-2xl font-black uppercase text-[#0A3D62] md:text-3xl">
							{t("title")}
						</h1>
						<p className="mt-1 max-w-xl text-sm font-semibold text-[#3D5568]">
							{serialized.length} notification(s)
						</p>
					</div>
				</div>

				{/* Tier filter tabs */}
				<div className="mt-6 flex flex-wrap gap-2">
					{tiers.map((tier) => {
						const isActive =
							tier.key === "all" ? !params.tier || params.tier === "all" : params.tier === tier.key;
						return (
							<a
								key={tier.key}
								href={
									tier.key === "all"
										? "/dashboard/notifications"
										: `?tier=${tier.key}${params.category && params.category !== "all" ? `&category=${params.category}` : ""}`
								}
								className={`rounded-full px-4 py-1.5 text-xs font-bold uppercase transition-colors ${
									isActive
										? "bg-[#0A3D62] text-white"
										: "bg-[#F4F7F6] text-[#3D5568] hover:bg-[#E8EDED]"
								}`}
							>
								{tier.label}
							</a>
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
							<a
								key={cat.key}
								href={
									cat.key === "all"
										? "/dashboard/notifications"
										: `?category=${cat.key}${params.tier && params.tier !== "all" ? `&tier=${params.tier}` : ""}`
								}
								className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase transition-colors ${
									isActive
										? "bg-[#3D5568] text-white"
										: "bg-gray-100 text-[#3D5568] hover:bg-gray-200"
								}`}
							>
								{cat.label}
							</a>
						);
					})}
				</div>

				<NotificationList initialNotifications={serialized} pondId={pond.id} />
			</section>
		</div>
	);
}
