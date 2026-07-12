import { getAuditLog } from "@/lib/actions/audit";
import { formatDateTimeLocal } from "@/lib/date-local";
import {
	AlertCircle,
	CheckCircle2,
	ChevronRight,
	Clock,
	Cpu,
	RefreshCw,
	User,
	Wifi,
	WifiOff,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const revalidate = 0;

const eventTypeConfig: Record<
	string,
	{ icon: LucideIcon; className: string; filterGroup: string }
> = {
	connected: {
		icon: Wifi,
		className: "border-green-200 bg-green-50 text-green-700",
		filterGroup: "connectivity",
	},
	disconnected: {
		icon: WifiOff,
		className: "border-red-200 bg-red-50 text-red-700",
		filterGroup: "connectivity",
	},
	command_sent: {
		icon: Clock,
		className: "border-blue-200 bg-blue-50 text-blue-700",
		filterGroup: "commands",
	},
	command_acked: {
		icon: CheckCircle2,
		className: "border-green-200 bg-green-50 text-green-700",
		filterGroup: "commands",
	},
	command_failed: {
		icon: AlertCircle,
		className: "border-red-200 bg-red-50 text-red-700",
		filterGroup: "commands",
	},
	schedule_changed: {
		icon: RefreshCw,
		className: "border-purple-200 bg-purple-50 text-purple-700",
		filterGroup: "schedule",
	},
	schedule_applied: {
		icon: CheckCircle2,
		className: "border-purple-200 bg-purple-50 text-purple-700",
		filterGroup: "schedule",
	},
	feed_dispensed: {
		icon: Cpu,
		className: "border-amber-200 bg-amber-50 text-amber-700",
		filterGroup: "feeding",
	},
	feed_reconciled: {
		icon: RefreshCw,
		className: "border-amber-200 bg-amber-50 text-amber-700",
		filterGroup: "feeding",
	},
	pellet_low: {
		icon: AlertCircle,
		className: "border-orange-200 bg-orange-50 text-orange-700",
		filterGroup: "feeding",
	},
	pellet_refilled: {
		icon: CheckCircle2,
		className: "border-green-200 bg-green-50 text-green-700",
		filterGroup: "feeding",
	},
	manual_trigger: {
		icon: User,
		className: "border-gray-200 bg-gray-50 text-gray-700",
		filterGroup: "commands",
	},
};

const defaultEventConfig = {
	icon: AlertCircle,
	className: "border-gray-200 bg-gray-50 text-gray-700",
	filterGroup: "commands",
};

export default async function AuditPage({
	searchParams,
}: {
	searchParams: Promise<{ filter?: string }>;
}) {
	const t = await getTranslations("dashboard.audit");
	const tDates = await getTranslations("dates");
	const params = await searchParams;
	const filterParam = params.filter;

	const filterGroupToTypes: Record<string, string[]> = {
		all: [],
		feeding: ["feed_dispensed", "feed_reconciled", "pellet_low", "pellet_refilled"],
		connectivity: ["connected", "disconnected"],
		schedule: ["schedule_changed", "schedule_applied"],
		commands: ["command_sent", "command_acked", "command_failed", "manual_trigger"],
	};

	const eventTypes = filterGroupToTypes[filterParam ?? "all"] ?? [];

	const result = await getAuditLog({ eventTypes: eventTypes.length > 0 ? eventTypes : undefined });

	const formatDate = (date: Date) => formatDateTimeLocal(date, tDates);
	const sourceLabel = (s: string) => t(`source_${s}`);

	const filterGroups = [
		{ key: "all", label: t("filterAll") },
		{ key: "feeding", label: t("filterFeeding") },
		{ key: "connectivity", label: t("filterConnectivity") },
		{ key: "schedule", label: t("filterSchedule") },
		{ key: "commands", label: t("filterCommands") },
	];

	return (
		<div className="mx-auto max-w-5xl space-y-6 animate-in fade-in duration-500">
			<section className="rounded-[32px] border border-[#0A3D62]/5 bg-white p-5 shadow-md md:p-8">
				<div className="flex flex-col justify-between gap-4 border-b border-gray-100 pb-6 sm:flex-row sm:items-end">
					<div>
						<h1 className="mt-1 text-2xl font-black uppercase text-[#0A3D62] md:text-3xl">
							{t("title")}
						</h1>
						<p className="mt-1 max-w-xl text-sm font-semibold text-[#3D5568]">{t("desc")}</p>
					</div>
				</div>

				{/* Filter tabs */}
				<div className="mt-6 flex flex-wrap gap-2">
					{filterGroups.map((group) => {
						const isActive =
							group.key === "all"
								? !filterParam || filterParam === "all"
								: filterParam === group.key;
						return (
							<a
								key={group.key}
								href={group.key === "all" ? "/dashboard/audit" : `?filter=${group.key}`}
								className={`rounded-full px-4 py-1.5 text-xs font-bold uppercase transition-colors ${
									isActive
										? "bg-[#0A3D62] text-white"
										: "bg-[#F4F7F6] text-[#3D5568] hover:bg-[#E8EDED]"
								}`}
							>
								{group.label}
							</a>
						);
					})}
				</div>

				<div className="mt-6 space-y-3">
					{result.events.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-20 text-gray-400">
							<Clock size={48} className="mb-4 opacity-30" />
							<p className="text-lg font-medium">{t("empty")}</p>
						</div>
					) : (
						result.events.map((event) => {
							const cfg = eventTypeConfig[event.eventType] || defaultEventConfig;
							const Icon = cfg.icon;
							const formatted = formatDate(event.createdAt);
							const m = event.metadata as Record<string, string | number | boolean> | null;
							const grams = m?.grams;
							const src = m?.source;
							const expiredId = m?.expiredRequestId;
							const schedStart = m?.scheduleStart;
							const schedEnd = m?.scheduleEnd;
							const feedsPerDayMeta = m?.feedsPerDay;

							return (
								<div
									key={event.id}
									className="flex w-full items-start gap-3 rounded-3xl border border-[#0A3D62]/8 bg-white p-4 text-left shadow-sm"
								>
									<span
										className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${cfg.className}`}
									>
										<Icon className="h-5 w-5" />
									</span>
									<span className="min-w-0 flex-1">
										<span className="flex flex-wrap items-center gap-2">
											<span
												className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${cfg.className}`}
											>
												{t(`eventType_${event.eventType}`) || event.eventType}
											</span>
											<span className="text-xs font-bold text-[#3D5568]">{formatted.full}</span>
											<span className="text-[10px] font-semibold uppercase text-[#3D5568]/60">
												{sourceLabel(event.source)}
											</span>
										</span>
										<span className="mt-2 block text-sm font-semibold text-[#3D5568]">
											{event.device.label}
											{event.actorId && (
												<span className="ml-2 text-xs text-[#3D5568]/60">by {event.actorId}</span>
											)}
										</span>
										{event.deviceTime && (
											<span className="mt-1 block text-xs text-[#3D5568]/50">
												{t("deviceTime")}: {event.deviceTime}
											</span>
										)}
										{grams && (
											<span className="mt-1 block text-xs font-semibold text-[#3D5568]/70">
												{Number(grams).toFixed(0)}g{src && <> via {String(src)}</>}
											</span>
										)}
										{expiredId && (
											<span className="mt-1 block text-xs font-semibold text-amber-600">
												Reconciled from expired request {String(expiredId).slice(0, 8)}...
											</span>
										)}
										{schedStart && schedEnd && (
											<span className="mt-1 block text-xs text-[#3D5568]/70">
												Schedule: {String(schedStart)} - {String(schedEnd)},{" "}
												{String(feedsPerDayMeta ?? "")} feeds/day
											</span>
										)}
									</span>
									<ChevronRight className="mt-3 h-5 w-5 shrink-0 text-[#3D5568]" />
								</div>
							);
						})
					)}
				</div>

				{result.nextCursor && (
					<div className="mt-6 flex justify-center">
						<a
							href={`/dashboard/audit?cursor=${result.nextCursor}${filterParam ? `&filter=${filterParam}` : ""}`}
							className="rounded-full bg-[#F4F7F6] px-6 py-2 text-sm font-bold text-[#0A3D62] hover:bg-[#E8EDED] transition-colors"
						>
							Load more
						</a>
					</div>
				)}
			</section>
		</div>
	);
}
