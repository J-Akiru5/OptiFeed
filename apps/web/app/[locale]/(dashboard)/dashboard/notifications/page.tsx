import { formatDateTimeLocal } from "@/lib/date-local";
import prisma from "@/lib/prisma";
import { AlertCircle, AlertTriangle, Bell, CheckCircle2, Info } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const revalidate = 0;

const tierConfig: Record<
	string,
	{ icon: typeof AlertCircle; color: string; bg: string; label: string }
> = {
	CRITICAL: { icon: AlertCircle, color: "text-red-600", bg: "bg-red-50", label: "Critical" },
	WARNING: { icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-50", label: "Warning" },
	SUCCESS: { icon: CheckCircle2, color: "text-green-600", bg: "bg-green-50", label: "Success" },
	INFO: { icon: Info, color: "text-blue-600", bg: "bg-blue-50", label: "Info" },
};

export default async function NotificationsPage() {
	const tHome = await getTranslations("dashboard.home");
	const t = await getTranslations("dashboard.notifications");
	const tTiers = await getTranslations("dashboard.notifications.tiers");
	const tMsgs = await getTranslations("dashboard.notifications.messages");
	const tDates = await getTranslations("dates");
	const pond = await prisma.pond.findFirst({
		where: { ownerId: "demo-farmer-1" },
	});

	if (!pond) {
		return (
			<div className="flex h-[50vh] items-center justify-center">
				<p className="text-lg text-gray-500">{tHome("noData")}</p>
			</div>
		);
	}

	const notifications = await prisma.notification.findMany({
		where: { pondId: pond.id },
		orderBy: { createdAt: "desc" },
		take: 100,
	});

	const formatDate = (date: Date) => {
		const loc = formatDateTimeLocal(date, tDates);
		return `${loc.date}, ${loc.time}`;
	};

	const translateMessage = (msg: string) => {
		if (msg.includes("Battery levels are running low on Feeder #")) {
			const feeder = msg.split("#")[1]?.replace(".", "");
			return tMsgs("batteryLow", { feeder: feeder || "1" });
		}
		if (msg.includes("URGENT: Feeder hopper is completely empty!")) {
			return tMsgs("hopperEmpty");
		}
		if (msg.includes("Scheduled feeding of") && msg.includes("completed successfully.")) {
			const amountMatch = msg.match(/(\d+)g/);
			const amount = amountMatch ? amountMatch[1] : "1500";
			return tMsgs("feedingCompleted", { amount });
		}
		return msg;
	};

	return (
		<div className="mx-auto max-w-4xl space-y-6 animate-in fade-in duration-500">
			<div>
				<h1 className="flex items-center gap-2 text-3xl font-bold text-[var(--ofd-base)]">
					<Bell size={28} />
					{t("title")}
				</h1>
				<p className="mt-2 text-gray-500">
					{t("desc", { count: notifications.length, pond: pond.name })}
				</p>
			</div>

			{notifications.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-20 text-gray-400">
					<Bell size={48} className="mb-4 opacity-30" />
					<p className="text-lg font-medium">{t("allClear")}</p>
					<p className="text-sm">{t("empty")}</p>
				</div>
			) : (
				<div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden divide-y divide-gray-100">
					{notifications.map((notification) => {
						const tier = tierConfig[notification.tier] || tierConfig.INFO;
						const Icon = tier.icon;

						return (
							<div
								key={notification.id}
								className={`p-4 sm:p-5 flex items-start gap-4 transition-colors ${notification.read ? "bg-white" : "bg-blue-50/30"}`}
							>
								<div className={`shrink-0 mt-0.5 p-2 rounded-xl ${tier.bg} ${tier.color}`}>
									<Icon size={20} />
								</div>
								<div className="flex-1">
									<p className={`text-xs font-bold tracking-wider uppercase mb-1 ${tier.color}`}>
										{tTiers(notification.tier as Parameters<typeof tTiers>[0])}
									</p>
									<p
										className={`text-sm font-medium ${notification.read ? "text-gray-600" : "text-gray-900"}`}
									>
										{translateMessage(notification.message)}
									</p>
									<p className="text-xs text-gray-400 mt-1">{formatDate(notification.createdAt)}</p>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
