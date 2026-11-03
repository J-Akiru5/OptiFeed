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
/**
 * The plot box, in CSS pixels. The SVG draws in this coordinate space and is
 * stretched horizontally only (`preserveAspectRatio="none"`), so the bars use
 * the full width while the axis text stays HTML at a fixed 10 px. A viewBox that
 * also scaled its own text made a 9 px label ~4 px wide at 390 px (#631).
 */
const PLOT_HEIGHT = 144;
const PADDING = { top: 8, right: 2, bottom: 8, left: 2 };
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
				<Activity className="h-4 w-4 text-console-accent" aria-hidden="true" />
				<h2 className="text-lg font-black text-console-content">{t("title")}</h2>
			</div>
			<p className="max-w-3xl text-sm text-console-content-muted">
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
					<p className="py-6 text-center text-sm font-bold text-console-content-muted">
						{t("trendEmpty")}
					</p>
				) : !hasBars ? (
					<p className="py-6 text-center text-sm font-bold text-console-content-muted">
						{t("trendNoShare")}
					</p>
				) : (
					<>
						<div role="img" aria-label={summary} className="flex gap-2">
							{/* The axis text is HTML, not SVG: a viewBox scales its own text
							    down with the plot, which made a 9 px label ~4 px wide at
							    390 px (#631). */}
							<div
								aria-hidden="true"
								className="relative w-8 shrink-0 text-[10px] font-bold leading-none text-console-content-muted"
								style={{ height: PLOT_HEIGHT }}
							>
								{GRID_LINES.map((line) => (
									<span
										key={line}
										className="absolute right-0 -translate-y-1/2 tabular-nums"
										style={{ top: shareY(line) }}
									>
										{line}%
									</span>
								))}
							</div>

							<div className="min-w-0 flex-1">
								<svg
									viewBox={`0 0 ${CHART_WIDTH} ${PLOT_HEIGHT}`}
									preserveAspectRatio="none"
									className="block w-full"
									style={{ height: PLOT_HEIGHT }}
									aria-hidden="true"
								>
									{GRID_LINES.map((line) => {
										const y = shareY(line);
										return (
											<line
												key={line}
												x1={PADDING.left}
												x2={CHART_WIDTH - PADDING.right}
												y1={y}
												y2={y}
												className="stroke-console-border"
												strokeWidth={1}
											/>
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
												height={Math.max(0, PLOT_HEIGHT - PADDING.bottom - y)}
												rx={1}
												className="fill-console-accent"
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
								</svg>

								<div
									aria-hidden="true"
									className="mt-1 flex justify-between gap-2 text-[10px] font-bold leading-none text-console-content-muted"
								>
									{axisDays(data.windowDays).map(({ day, anchor }) => (
										<span
											key={day}
											className={
												anchor === "start"
													? "text-left"
													: anchor === "end"
														? "text-right"
														: "text-center"
											}
										>
											{formatDay(day, locale)}
										</span>
									))}
								</div>
							</div>
						</div>
						<p className="mt-2 text-xs font-bold text-console-content-muted">{summary}</p>
					</>
				)}

				<p className="mt-3 text-[11px] leading-snug text-console-content-muted">{t("utcNote")}</p>

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
	const plotHeight = PLOT_HEIGHT - PADDING.top - PADDING.bottom;
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
