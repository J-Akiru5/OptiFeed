import { DataExportButton } from "@/components/DataImportExport";
import {
	DashboardEmptyState,
	DashboardPageHeader,
	DashboardPageShell,
} from "@/components/dashboard/dashboard-ui";
import { Pagination } from "@/components/ui/pagination";
import { Link } from "@/i18n/routing";
import { getAuditLog } from "@/lib/actions/audit";
import { formatFarmDateTime } from "@/lib/date-local";
import { parsePage } from "@/lib/pagination";
import {
	AlertCircle,
	Bell,
	CheckCircle2,
	Clock,
	Cpu,
	FileText,
	PauseCircle,
	Plug,
	RefreshCw,
	Ruler,
	Settings,
	User,
	Weight,
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
	feed_refused: {
		icon: AlertCircle,
		className: "border-red-200 bg-red-50 text-red-700",
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
	pause_toggled: {
		icon: PauseCircle,
		className: "border-yellow-200 bg-yellow-50 text-yellow-700",
		filterGroup: "schedule",
	},
	hopper_calibrated: {
		icon: Ruler,
		className: "border-blue-200 bg-blue-50 text-blue-700",
		filterGroup: "feeding",
	},
	settings_changed: {
		icon: Settings,
		className: "border-purple-200 bg-purple-50 text-purple-700",
		filterGroup: "schedule",
	},
	device_registered: {
		icon: Plug,
		className: "border-green-200 bg-green-50 text-green-700",
		filterGroup: "connectivity",
	},
	biomass_logged: {
		icon: Weight,
		className: "border-teal-200 bg-teal-50 text-teal-700",
		filterGroup: "feeding",
	},
	notification_acknowledged: {
		icon: Bell,
		className: "border-blue-200 bg-blue-50 text-blue-700",
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
	searchParams: Promise<{ filter?: string; page?: string }>;
}) {
	const t = await getTranslations("dashboard.audit");
	const tCommon = await getTranslations("dashboard.common");
	const tDates = await getTranslations("dates");
	const params = await searchParams;
	const filterParam = params.filter;
	const page = parsePage(params.page);

	const filterGroupToTypes: Record<string, string[]> = {
		all: [],
		feeding: [
			"feed_dispensed",
			"feed_reconciled",
			"feed_refused",
			"pellet_low",
			"pellet_refilled",
			"hopper_calibrated",
			"biomass_logged",
		],
		connectivity: ["connected", "disconnected", "device_registered"],
		schedule: ["schedule_changed", "schedule_applied", "pause_toggled", "settings_changed"],
		commands: [
			"command_sent",
			"command_acked",
			"command_failed",
			"manual_trigger",
			"notification_acknowledged",
		],
	};

	const eventTypes = filterGroupToTypes[filterParam ?? "all"] ?? [];

	const result = await getAuditLog({
		eventTypes: eventTypes.length > 0 ? eventTypes : undefined,
		page,
	});
	const firstRow = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
	const lastRow = Math.min(result.page * result.pageSize, result.total);

	const formatDate = (date: Date) => formatFarmDateTime(date, tDates);
	const sourceLabel = (s: string) => (t.has(`source_${s}`) ? t(`source_${s}`) : s);

	const filterGroups = [
		{ key: "all", label: t("filterAll") },
		{ key: "feeding", label: t("filterFeeding") },
		{ key: "connectivity", label: t("filterConnectivity") },
		{ key: "schedule", label: t("filterSchedule") },
		{ key: "commands", label: t("filterCommands") },
	];

	return (
		<DashboardPageShell className="space-y-6 animate-in fade-in duration-150">
			<section className="rounded-3xl border border-[#0A3D62]/5 bg-white p-4 shadow-md dark:bg-gray-900 sm:p-6 md:p-8">
				<div className="border-b border-gray-100 pb-6 dark:border-gray-700/50">
					<DashboardPageHeader
						icon={FileText}
						title={t("title")}
						description={t("desc")}
						actions={<DataExportButton />}
					/>
				</div>

				{/* Filter tabs */}
				<nav aria-label={t("filtersLabel")} className="mt-6 flex flex-wrap gap-2">
					{filterGroups.map((group) => {
						const isActive =
							group.key === "all"
								? !filterParam || filterParam === "all"
								: filterParam === group.key;
						return (
							<Link
								key={group.key}
								href={
									group.key === "all"
										? "/dashboard/audit"
										: { pathname: "/dashboard/audit", query: { filter: group.key } }
								}
								aria-current={isActive ? "page" : undefined}
								className={`inline-flex min-h-11 items-center rounded-full px-4 py-2 text-xs font-bold uppercase transition-colors focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea] ${
									isActive
										? "bg-[#0A3D62] text-white"
										: "bg-[#F4F7F6] text-[#3D5568] hover:bg-[#E8EDED] dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
								}`}
							>
								{group.label}
							</Link>
						);
					})}
				</nav>

				<ol aria-label={t("timelineLabel")} className="mt-6 space-y-3">
					{result.events.length === 0 ? (
						<li>
							<DashboardEmptyState icon={Clock} title={t("empty")} />
						</li>
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
							const count = m?.count;
							const eventTypeKey = `eventType_${event.eventType}`;
							const eventTypeLabel = t.has(eventTypeKey) ? t(eventTypeKey) : event.eventType;

							return (
								<li
									key={event.id}
									className="flex w-full items-start gap-3 rounded-3xl border border-[#0A3D62]/8 bg-white p-4 text-left shadow-sm dark:bg-gray-900"
								>
									<span
										aria-hidden="true"
										className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${cfg.className}`}
									>
										<Icon className="h-5 w-5" />
									</span>
									<span className="min-w-0 flex-1">
										<span className="flex flex-wrap items-center gap-2">
											<span
												className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${cfg.className}`}
											>
												{eventTypeLabel}
											</span>
											<span className="text-xs font-bold text-[#3D5568] dark:text-gray-300">
												{formatted.full}
											</span>
											<span className="text-[10px] font-semibold uppercase text-[#3D5568]/60 dark:text-gray-300/60">
												{sourceLabel(event.source)}
											</span>
										</span>
										<span className="mt-2 block text-sm font-semibold text-[#3D5568] dark:text-gray-300">
											{event.device.label}
											{event.actorId && (
												<span className="ml-2 text-xs text-[#3D5568]/60 dark:text-gray-300/60">
													{t("byActor", { actor: event.actorId })}
												</span>
											)}
										</span>
										{event.deviceTime && (
											<span className="mt-1 block text-xs text-[#3D5568]/50 dark:text-gray-300/50">
												{t("deviceTime")}: {event.deviceTime}
											</span>
										)}
										{grams && (
											<span className="mt-1 block text-xs font-semibold text-[#3D5568]/70 dark:text-gray-300/70">
												{Number(grams).toFixed(0)}g
												{src && <> {t("viaSource", { source: String(src) })}</>}
											</span>
										)}
										{expiredId && (
											<span className="mt-1 block text-xs font-semibold text-amber-600">
												{t("reconciledFrom", { id: String(expiredId).slice(0, 8) })}
											</span>
										)}
										{schedStart && schedEnd && (
											<span className="mt-1 block text-xs text-[#3D5568]/70 dark:text-gray-300/70">
												{t("scheduleRange", {
													start: String(schedStart),
													end: String(schedEnd),
													feedsPerDay: String(feedsPerDayMeta ?? ""),
												})}
											</span>
										)}
										{count && (
											<span className="mt-1 block text-xs font-semibold text-[#3D5568]/70 dark:text-gray-300/70">
												{t("markedRead", { count: String(count) })}
											</span>
										)}
									</span>
								</li>
							);
						})
					)}
				</ol>

				{result.total > 0 && (
					<Pagination
						basePath="/dashboard/audit"
						params={{ filter: filterParam }}
						page={result.page}
						pageCount={Math.max(1, Math.ceil(result.total / result.pageSize))}
						showing={tCommon("pagination.showing", {
							from: firstRow,
							to: lastRow,
							total: result.total,
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
