import { Link } from "@/i18n/routing";
import { formatDateTimeLocal } from "@/lib/date-local";
import prisma from "@/lib/prisma";
import {
	AlertCircle,
	AlertTriangle,
	CheckCircle2,
	ChevronRight,
	History,
	Info,
	ServerCrash,
	WifiOff,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const revalidate = 0;

const tierConfig: Record<string, { icon: LucideIcon; className: string; label: string }> = {
	CRITICAL: {
		icon: WifiOff,
		className: "border-[#C42B3A]/20 bg-red-50 text-[#C42B3A]",
		label: "Critical",
	},
	WARNING: {
		icon: AlertTriangle,
		className: "border-amber-200 bg-amber-50 text-amber-700",
		label: "Warning",
	},
	SUCCESS: {
		icon: CheckCircle2,
		className: "border-green-200 bg-green-50 text-green-700",
		label: "Success",
	},
	INFO: { icon: Info, className: "border-blue-200 bg-blue-50 text-blue-700", label: "Info" },
};

export default async function NotificationsPage() {
	const tHome = await getTranslations("dashboard.home");
	const t = await getTranslations("dashboard.notifications");
	const tTiers = await getTranslations("dashboard.notifications.tiers");
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

	return (
		<div className="mx-auto max-w-4xl space-y-6 animate-in fade-in duration-500">
			<section className="rounded-[32px] border border-[#0A3D62]/5 bg-white p-5 shadow-md md:p-8">
				<div className="flex flex-col justify-between gap-4 border-b border-gray-100 pb-6 sm:flex-row sm:items-end">
					<div>
						<p className="text-xs font-black uppercase tracking-[0.2em] text-[#E85A2A]">
							Prototype frame
						</p>
						<h1 className="mt-1 text-2xl font-black uppercase text-[#0A3D62] md:text-3xl">
							Notification Center
						</h1>
						<p className="mt-1 max-w-xl text-sm font-semibold text-[#3D5568]">
							Static representative alert list for the OptiFeed prototype. Rows are color-coded by
							tier.
						</p>
					</div>
					<Link
						href="/dashboard"
						className="min-h-12 flex items-center justify-center rounded-2xl bg-[#C42B3A] px-4 text-sm font-black text-white shadow-sm transition hover:bg-[#a9202c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C42B3A]"
					>
						View critical dashboard state
					</Link>
				</div>

				<div className="mt-6 space-y-3">
					{notifications.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-20 text-gray-400">
							<AlertCircle size={48} className="mb-4 opacity-30" />
							<p className="text-lg font-medium">{t("allClear")}</p>
							<p className="text-sm">{t("empty")}</p>
						</div>
					) : (
						notifications.map((notification) => {
							const tier = tierConfig[notification.tier] || tierConfig.INFO;
							const Icon = tier.icon;

							return (
								<button
									key={notification.id}
									type="button"
									className="flex w-full items-start gap-3 rounded-3xl border border-[#0A3D62]/8 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]"
								>
									<span
										className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${tier.className}`}
									>
										<Icon className="h-5 w-5" />
									</span>
									<span className="min-w-0 flex-1">
										<span className="flex flex-wrap items-center gap-2">
											<span
												className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${tier.className}`}
											>
												{tTiers(notification.tier as Parameters<typeof tTiers>[0]) || tier.label}
											</span>
											<span className="text-xs font-bold text-[#3D5568]">
												{formatDate(notification.createdAt)}
											</span>
										</span>
										<span className="mt-2 block text-base font-black text-[#0A3D62]">
											{notification.message.split("!")[0] || "Alert"}
										</span>
										<span className="mt-1 block text-sm font-semibold leading-relaxed text-[#3D5568]">
											{notification.message}
										</span>
									</span>
									<ChevronRight className="mt-3 h-5 w-5 shrink-0 text-[#3D5568]" />
								</button>
							);
						})
					)}
				</div>

				<div className="mt-6 rounded-3xl bg-[#F4F7F6] p-4 text-sm font-semibold text-[#3D5568]">
					<History className="mr-2 inline h-4 w-4 text-[#0A3D62]" />
					This screen is intentionally static: no filtering, dismissal, acknowledgement, or live
					state tracking.
				</div>
			</section>
		</div>
	);
}
