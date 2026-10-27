import { type ChartLabels, LineTrend } from "@/components/charts";
import { OpsNav } from "@/components/superadmin/ops-nav";
import {
	Badge,
	CARD,
	Card,
	EmptyState,
	MetaPair,
	MobileCard,
	PageHeader,
	SECONDARY_BUTTON,
	SectionTitle,
	StatCard,
	TableFrame,
} from "@/components/superadmin/ui";
import { ItemCardGrid } from "@/components/ui/item-card";
import { ListView } from "@/components/ui/view-toggle";
import { Link } from "@/i18n/routing";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { formatDateTimeLocal } from "@/lib/date-local";
import {
	type DeviceSortField,
	HEALTH_DEVICE_LIMIT,
	type SortDirection,
	getSystemHealth,
	isDeviceOffline,
	parseDeviceSort,
	sortHealthDevices,
} from "@/lib/platform/health";
import { cn } from "@/lib/utils";
import {
	AlertTriangle,
	CheckCircle2,
	Clock,
	Cpu,
	ListChecks,
	PlayCircle,
	XCircle,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

function first(param: string | string[] | undefined): string | undefined {
	return Array.isArray(param) ? param[0] : param;
}

const SORT_FIELDS: DeviceSortField[] = ["lastSeen", "label", "mac"];

/**
 * Operations → system health (E16.4, task I-15).
 *
 * Three read-only questions in one place: is the background queue moving, when
 * did each cron last leave a trace, and when did each feeder last check in.
 * Every query is gated by `requirePlatformAdmin()` in the page and again in the
 * data module.
 */
export default async function OperationsHealthPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	await requirePlatformAdmin();

	const params = await searchParams;
	const { field: sortField, direction: sortDirection } = parseDeviceSort(
		first(params.sort),
		first(params.dir),
	);

	const [health, t, tCommon, tDates] = await Promise.all([
		getSystemHealth(),
		getTranslations("superadmin.operations"),
		getTranslations("superadmin.common"),
		getTranslations("dates"),
	]);

	const chartLabels: ChartLabels = {
		period: t("charts.period"),
		value: t("charts.value"),
		name: t("charts.name"),
		empty: t("charts.empty"),
	};
	const devices = sortHealthDevices(health.devices, sortField, sortDirection);
	const now = health.generatedAt;
	const lastSeen = (value: Date | null) =>
		value ? formatDateTimeLocal(value, tDates).full : tCommon("never");

	const sortHref = (nextField: DeviceSortField) => {
		// Clicking the active column flips it; a new column keeps its own
		// natural direction (newest first for time, A→Z for text).
		const nextDirection: SortDirection =
			nextField === sortField
				? sortDirection === "asc"
					? "desc"
					: "asc"
				: nextField === "lastSeen"
					? "desc"
					: "asc";
		return {
			pathname: "/superadmin/operations" as const,
			query: { sort: nextField, dir: nextDirection },
		};
	};

	const sortMarker = (target: DeviceSortField) =>
		sortField === target ? (sortDirection === "asc" ? "↑" : "↓") : "";

	const cronJobs = health.cron;

	return (
		<div className="space-y-6">
			<PageHeader title={t("health.title")} description={t("health.description")} />
			<OpsNav />

			<section aria-labelledby="ops-jobs" className="space-y-3">
				<h2 id="ops-jobs" className="text-lg font-black text-[#0A3D62]">
					{t("jobs.title")}
				</h2>
				<div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
					<StatCard label={t("jobs.total")} value={health.jobs.total} icon={ListChecks} />
					<StatCard label={t("jobs.queued")} value={health.jobs.queued} icon={Clock} />
					<StatCard label={t("jobs.running")} value={health.jobs.running} icon={PlayCircle} />
					<StatCard label={t("jobs.succeeded")} value={health.jobs.succeeded} icon={CheckCircle2} />
					<StatCard label={t("jobs.failed")} value={health.jobs.failed} icon={XCircle} />
				</div>

				<Card className="p-5">
					<p className="text-sm text-[#3D5568]">
						{health.jobs.oldestQueued
							? t("jobs.oldestQueued", {
									time: lastSeen(health.jobs.oldestQueued.createdAt),
									type: health.jobs.oldestQueued.type,
								})
							: t("jobs.noQueue")}
					</p>
				</Card>

				<div className="grid gap-4 lg:grid-cols-2">
					<LineTrend
						title={t("charts.jobsTitle", { days: health.rangeDays })}
						summary={t("charts.jobsSummary", { days: health.rangeDays })}
						labels={chartLabels}
						points={health.jobs.jobsPerDay}
						decimals={0}
					/>
					<LineTrend
						title={t("charts.failuresTitle", { days: health.rangeDays })}
						summary={t("charts.failuresSummary", { days: health.rangeDays })}
						labels={chartLabels}
						points={health.jobs.failuresPerDay}
						decimals={0}
						color="#C42B3A"
					/>
				</div>

				<Card>
					<SectionTitle
						title={t("jobs.failuresTitle")}
						description={t("jobs.failuresDescription")}
					/>
					{health.jobs.recentFailures.length === 0 ? (
						<EmptyState
							icon={CheckCircle2}
							title={t("jobs.noFailuresTitle")}
							description={t("jobs.noFailuresDescription")}
						/>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full min-w-[40rem] text-sm">
								<caption className="sr-only">{t("jobs.failuresCaption")}</caption>
								<thead>
									<tr className="border-b border-gray-100 bg-[#F4F7F6]">
										<th
											scope="col"
											className="px-5 py-3 text-left text-[10px] font-black tracking-wider text-[#3D5568] uppercase"
										>
											{t("jobs.columnFinished")}
										</th>
										<th
											scope="col"
											className="px-5 py-3 text-left text-[10px] font-black tracking-wider text-[#3D5568] uppercase"
										>
											{t("jobs.columnType")}
										</th>
										<th
											scope="col"
											className="px-5 py-3 text-left text-[10px] font-black tracking-wider text-[#3D5568] uppercase"
										>
											{t("jobs.columnAttempts")}
										</th>
										<th
											scope="col"
											className="px-5 py-3 text-left text-[10px] font-black tracking-wider text-[#3D5568] uppercase"
										>
											{t("jobs.columnError")}
										</th>
									</tr>
								</thead>
								<tbody>
									{health.jobs.recentFailures.map((job) => (
										<tr key={job.id} className="border-b border-gray-50 align-top last:border-0">
											<td className="px-5 py-3 text-xs whitespace-nowrap text-[#3D5568]">
												{lastSeen(job.finishedAt ?? job.createdAt)}
											</td>
											<td className="px-5 py-3 text-xs font-bold text-[#0A3D62]">{job.type}</td>
											<td className="px-5 py-3 text-xs tabular-nums text-[#3D5568]">
												{job.attempts}
											</td>
											<td className="px-5 py-3 text-xs break-words text-[#C42B3A]">
												{job.error ?? tCommon("none")}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</Card>
			</section>

			<section aria-labelledby="ops-cron" className="space-y-3">
				<h2 id="ops-cron" className="text-lg font-black text-[#0A3D62]">
					{t("cron.title")}
				</h2>
				<Card className="p-5">
					<p className="text-xs text-[#3D5568]">{t("cron.description")}</p>
					<ul className="mt-4 space-y-4">
						{cronJobs.map((row) => (
							<li
								key={row.job}
								className="flex flex-col gap-1 border-b border-gray-100 pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
							>
								<div className="min-w-0">
									<p className="text-sm font-black text-[#0A3D62]">{t(`cron.jobs.${row.job}`)}</p>
									<p className="mt-0.5 text-[11px] text-[#3D5568]">
										{t(`cron.inferred.${row.job}`)}
										{row.eventType ? ` · ${row.eventType}` : ""}
									</p>
								</div>
								<Badge tone={row.lastActivityAt ? "success" : "neutral"} icon={Clock}>
									{row.lastActivityAt ? lastSeen(row.lastActivityAt) : t("cron.noActivity")}
								</Badge>
							</li>
						))}
					</ul>
				</Card>
			</section>

			<section aria-labelledby="ops-devices" className="space-y-3">
				<div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
					<div>
						<h2 id="ops-devices" className="text-lg font-black text-[#0A3D62]">
							{t("devices.title")}
						</h2>
						<p className="mt-1 text-xs text-[#3D5568]">
							{t("devices.description", {
								count: health.devices.length,
								limit: HEALTH_DEVICE_LIMIT,
							})}
						</p>
					</div>
					<nav aria-label={t("devices.sortLabel")} className="flex flex-wrap items-center gap-1">
						<span className="text-[10px] font-black tracking-wider text-[#3D5568] uppercase">
							{t("devices.sortBy")}
						</span>
						{SORT_FIELDS.map((candidate) => (
							<Link
								key={candidate}
								href={sortHref(candidate)}
								aria-current={sortField === candidate ? "true" : undefined}
								className={cn(
									SECONDARY_BUTTON,
									sortField === candidate && "border-[#0A3D62] bg-[#F4F7F6]",
								)}
							>
								{t(`devices.sort.${candidate}`)}
								<span aria-hidden="true"> {sortMarker(candidate)}</span>
							</Link>
						))}
					</nav>
				</div>

				{health.devicesTruncated && (
					<Card className="p-4">
						<p className="text-xs font-bold text-[#B45309]">
							{t("devices.truncated", { limit: HEALTH_DEVICE_LIMIT })}
						</p>
					</Card>
				)}

				{devices.length === 0 ? (
					<Card>
						<EmptyState
							icon={Cpu}
							title={t("devices.emptyTitle")}
							description={t("devices.emptyDescription")}
						/>
					</Card>
				) : (
					<ListView
						pageKey="superadmin-operations-devices"
						listLabel={tCommon("viewToggle.list")}
						cardsLabel={tCommon("viewToggle.cards")}
						toggleLabel={tCommon("viewToggle.label")}
					>
						<ItemCardGrid label={t("devices.caption")}>
							{devices.map((device) => {
								const offline = isDeviceOffline(device.lastSeenAt, now);
								return (
									<MobileCard key={device.id}>
										<div className="flex items-start justify-between gap-2">
											<div className="min-w-0">
												<p className="truncate font-black text-[#0A3D62]">{device.label}</p>
												<p className="truncate font-mono text-[11px] font-bold text-[#3D5568]">
													{device.mac}
												</p>
											</div>
											<Badge tone={offline ? "danger" : "success"}>
												{offline ? tCommon("offline") : tCommon("online")}
											</Badge>
										</div>
										<dl className="grid grid-cols-2 gap-2">
											<MetaPair label={tCommon("pond")}>
												{device.pondName ?? tCommon("unassigned")}
											</MetaPair>
											<MetaPair label={t("devices.lastIngest")}>
												{lastSeen(device.lastSeenAt)}
											</MetaPair>
										</dl>
									</MobileCard>
								);
							})}
						</ItemCardGrid>

						<TableFrame
							className="hidden md:block"
							label={t("devices.caption")}
							minWidth="min-w-[46rem]"
							columns={[
								{ key: "device", label: t("devices.columnDevice") },
								{ key: "mac", label: t("devices.columnMac") },
								{ key: "pond", label: tCommon("pond") },
								{ key: "lastIngest", label: t("devices.lastIngest") },
								{ key: "status", label: t("devices.columnStatus") },
							]}
						>
							{devices.map((device) => {
								const offline = isDeviceOffline(device.lastSeenAt, now);
								return (
									<tr
										key={device.id}
										className={cn(
											"border-b border-gray-50 align-middle last:border-0",
											offline ? "bg-[#FDE8EA]/40" : "hover:bg-[#F4F7F6]/50",
										)}
									>
										<td className="px-6 py-3 font-black text-[#0A3D62]">{device.label}</td>
										<td className="px-6 py-3 font-mono text-xs font-bold text-[#3D5568]">
											{device.mac}
										</td>
										<td className="px-6 py-3 text-xs font-bold text-[#3D5568]">
											{device.pondName ?? tCommon("unassigned")}
										</td>
										<td className="px-6 py-3 text-xs text-[#3D5568]">
											{lastSeen(device.lastSeenAt)}
										</td>
										<td className="px-6 py-3">
											<Badge tone={offline ? "danger" : "success"}>
												{offline ? tCommon("offline") : tCommon("online")}
											</Badge>
										</td>
									</tr>
								);
							})}
						</TableFrame>
					</ListView>
				)}
			</section>

			<Card className={cn(CARD, "flex items-start gap-3 p-5")}>
				<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#B45309]" aria-hidden="true" />
				<p className="text-xs text-[#3D5568]">{t("health.note")}</p>
			</Card>
		</div>
	);
}
