import { KpiTile } from "@/components/superadmin/monitor/primitives/kpi-tile";
import { MonitorPanel } from "@/components/superadmin/monitor/primitives/monitor-panel";
import type {
	ConnectivityTrendPoint,
	PlatformConnectivity,
} from "@/lib/platform/connectivity-rules";
import { Activity, Percent, Radio } from "lucide-react";

/**
 * Registered-versus-active and the 90-day connectivity trend (#479, M3C.10).
 *
 * Presentational and synchronous: the numbers arrive from
 * `getPlatformAnalytics().connectivity`, every string from the page's
 * `superadmin.connectivity` translator. No client polling and no chart
 * library: the daily bars are a server-rendered SVG, and the hidden table
 * repeats every plotted value.
 *
 * The one rule this panel enforces visually is O24: a day with no stored rollup
 * has **no bar**. A bar is positioned by its real day index in the 90-day
 * window, so missing days leave a visible hole instead of being joined into an
 * estimated line or turned into a zero.
 */

const CHART_WIDTH = 720;
const CHART_HEIGHT = 168;
const PADDING = { top: 10, right: 8, bottom: 22, left: 36 };
const GRID_LINES = [0, 50, 100] as const;

export interface ConnectivityPanelProps {
	data: PlatformConnectivity;
	t: (key: string, values?: Record<string, string | number>) => string;
	/** Locale for number and date formatting only; copy comes from `t`. */
	locale: string;
}

function formatDay(day: string, locale: string): string {
	return new Intl.DateTimeFormat(locale, {
		day: "numeric",
		month: "short",
		timeZone: "UTC",
	}).format(new Date(`${day}T00:00:00.000Z`));
}

export function ConnectivityPanel({ data, t, locale }: ConnectivityPanelProps) {
	const number = (value: number, decimals = 0) =>
		new Intl.NumberFormat(locale, { maximumFractionDigits: decimals }).format(value);

	const activeSince = new Intl.DateTimeFormat(locale, {
		day: "numeric",
		month: "short",
		year: "numeric",
		timeZone: "UTC",
	}).format(data.activeCutoff);

	const plottable = data.trend.filter(
		(point): point is ConnectivityTrendPoint & { onlineSharePct: number } =>
			point.onlineSharePct !== null,
	);
	const slot = slotWidth(data.windowDays);
	const observedMinutes = plottable.reduce((total, point) => total + point.observedMinutes, 0);
	const onlineMinutes = plottable.reduce((total, point) => total + point.onlineMinutes, 0);
	const averageShare =
		observedMinutes > 0 ? Math.round((onlineMinutes / observedMinutes) * 1000) / 10 : null;

	const hasStoredDays = data.trend.length > 0;
	const hasBars = plottable.length > 0;

	const meta = t("trendDaysWithData", {
		days: number(data.trend.length),
		window: number(data.windowDays.length),
	});

	const summary =
		averageShare === null
			? meta
			: t("trendSummary", {
					days: number(data.trend.length),
					window: number(data.windowDays.length),
					share: number(averageShare, 1),
				});

	return (
		<section aria-label={t("sectionLabel")} className="space-y-3">
			<div className="flex items-center gap-2">
				<Activity className="h-4 w-4 text-[#E85A2A] dark:text-[#FF8A5C]" aria-hidden="true" />
				<h2 className="text-lg font-black text-[#0A3D62] dark:text-slate-100">{t("title")}</h2>
			</div>
			<p className="max-w-3xl text-sm text-[#3D5568] dark:text-slate-400">
				{t("description", {
					activeWindowDays: number(data.activeWindowDays),
					days: number(data.windowDays.length),
				})}
			</p>

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
				<KpiTile
					label={t("registered")}
					value={number(data.registered)}
					hint={t("registeredHint")}
					icon={Radio}
				/>
				<KpiTile
					label={t("active", { days: number(data.activeWindowDays) })}
					value={number(data.active30d)}
					hint={t("activeHint", { date: activeSince })}
					icon={Activity}
				/>
				<KpiTile
					label={t("activeShare")}
					value={data.activePct === null ? t("notMeasured") : `${number(data.activePct, 1)}%`}
					hint={
						data.activePct === null
							? t("activeShareNone")
							: t("activeShareHint", {
									active: number(data.active30d),
									registered: number(data.registered),
								})
					}
					icon={Percent}
				/>
			</div>

			<MonitorPanel title={t("trendTitle")} description={t("trendDescription")} meta={meta}>
				{!hasStoredDays ? (
					<p className="py-6 text-center text-sm font-bold text-[#3D5568] dark:text-slate-400">
						{t("trendEmpty")}
					</p>
				) : !hasBars ? (
					<p className="py-6 text-center text-sm font-bold text-[#3D5568] dark:text-slate-400">
						{t("trendNoShare")}
					</p>
				) : (
					<>
						<div role="img" aria-label={summary}>
							<svg
								viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
								className="h-44 w-full"
								aria-hidden="true"
							>
								{GRID_LINES.map((line) => {
									const y = shareY(line);
									return (
										<g key={line}>
											<line
												x1={PADDING.left}
												x2={CHART_WIDTH - PADDING.right}
												y1={y}
												y2={y}
												className="stroke-[#E6ECE9] dark:stroke-[#24304A]"
												strokeWidth={1}
											/>
											<text
												x={PADDING.left - 6}
												y={y + 3}
												textAnchor="end"
												className="fill-[#3D5568] text-[9px] font-bold dark:fill-slate-400"
											>
												{line}%
											</text>
										</g>
									);
								})}

								{plottable.map((point) => {
									const index = data.windowDays.indexOf(point.day);
									if (index < 0) return null;
									const barWidth = Math.max(2, slot - 2);
									const x = PADDING.left + index * slot + (slot - barWidth) / 2;
									const y = shareY(point.onlineSharePct);
									return (
										<rect
											key={point.day}
											x={x}
											y={y}
											width={barWidth}
											height={Math.max(0, CHART_HEIGHT - PADDING.bottom - y)}
											rx={1}
											className="fill-[#C2410C] dark:fill-[#FF8A5C]"
										>
											<title>
												{t("dayTooltip", {
													day: point.day,
													share: number(point.onlineSharePct, 1),
													devices: number(point.devicesReporting),
													minutes: number(point.observedMinutes),
												})}
											</title>
										</rect>
									);
								})}

								{axisDays(data.windowDays).map(({ day, index, anchor }) => (
									<text
										key={day}
										x={PADDING.left + (index + 0.5) * slot}
										y={CHART_HEIGHT - 6}
										textAnchor={anchor}
										className="fill-[#3D5568] text-[9px] font-bold dark:fill-slate-400"
									>
										{formatDay(day, locale)}
									</text>
								))}
							</svg>
						</div>
						<p className="mt-2 text-xs font-bold text-[#3D5568] dark:text-slate-400">{summary}</p>
					</>
				)}

				<p className="mt-3 text-[11px] leading-snug text-[#3D5568] dark:text-slate-400">
					{t("utcNote")}
				</p>

				{hasStoredDays && (
					<table className="sr-only">
						<caption>{summary}</caption>
						<thead>
							<tr>
								<th scope="col">{t("columnDay")}</th>
								<th scope="col">{t("columnShare")}</th>
								<th scope="col">{t("columnDevices")}</th>
								<th scope="col">{t("columnObserved")}</th>
							</tr>
						</thead>
						<tbody>
							{data.trend.map((point) => (
								<tr key={point.day}>
									<th scope="row">{point.day}</th>
									<td>
										{point.onlineSharePct === null
											? t("notMeasured")
											: `${number(point.onlineSharePct, 1)}%`}
									</td>
									<td>{number(point.devicesReporting)}</td>
									<td>{number(point.observedMinutes)}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</MonitorPanel>
		</section>
	);
}

/** Bar top for an online share, 0 % at the baseline and 100 % at the top. */
function shareY(share: number): number {
	const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;
	return PADDING.top + (1 - Math.min(100, Math.max(0, share)) / 100) * plotHeight;
}

/** Width of one day slot in the window. */
function slotWidth(windowDays: readonly string[]): number {
	return (CHART_WIDTH - PADDING.left - PADDING.right) / Math.max(1, windowDays.length);
}

/**
 * Three axis labels only: first day, middle day, last day. The middle label is
 * centred so it cannot spill past the plot on a narrow viewport.
 */
function axisDays(
	windowDays: readonly string[],
): { day: string; index: number; anchor: "start" | "middle" | "end" }[] {
	if (windowDays.length === 0) return [];
	const last = windowDays.length - 1;
	const middle = Math.floor(last / 2);
	const entries: { day: string; index: number; anchor: "start" | "middle" | "end" }[] = [
		{ day: windowDays[0], index: 0, anchor: "start" },
		{ day: windowDays[last], index: last, anchor: "end" },
	];
	if (middle > 0 && middle < last) {
		entries.splice(1, 0, { day: windowDays[middle], index: middle, anchor: "middle" });
	}
	return entries;
}
