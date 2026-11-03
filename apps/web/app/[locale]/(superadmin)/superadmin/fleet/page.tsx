import { DeviceSignalReading } from "@/components/device-signal";
import { FeedLevelDisplay } from "@/components/feed-level-display";
import {
	Badge,
	type BadgeTone,
	Card,
	EmptyState,
	MetaPair,
	PageHeader,
	SECONDARY_BUTTON,
	TableFrame,
} from "@/components/superadmin/ui";
import { Link } from "@/i18n/routing";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { formatDateTimeLocal } from "@/lib/date-local";
import type { DeviceConnectionState } from "@/lib/device-status";
import { getFleetMonitor } from "@/lib/platform/fleet-health";
import type { DeviceTelemetryRow, ReadingFreshness } from "@/lib/platform/fleet-health-rules";
import { worstDevices } from "@/lib/platform/fleet-health-rules";
import type { BandState } from "@/lib/platform/status-band-rules";
import { cn } from "@/lib/utils";
import {
	AlertTriangle,
	CheckCircle2,
	HelpCircle,
	type LucideIcon,
	OctagonAlert,
	Radio,
	ShieldAlert,
	ShieldCheck,
	Signal,
	Wifi,
	WifiOff,
} from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

/**
 * Fleet monitor (issue #479, M3C.4 and M3C.4b).
 *
 * The device registry lists units; this page answers the operator's question
 * across tenants: whose fleet is degraded or unmeasured, and why. Every state
 * comes from `lib/platform/fleet-health.ts`, which reuses the connectivity rule
 * and thresholds used by the status bands — this page owns no threshold and no
 * health score of its own.
 *
 * M3C.4b adds the per-unit evidence: heartbeat, signal, firmware, last feed and
 * the freshness of the hopper and water readings, plus faults and safe mode.
 * Missing telemetry keeps its own word (`Not reported`, `Unknown`, `Never`) and
 * never becomes a zero or a green value; a reading is only shown while the
 * configured `device.status` window still covers it.
 *
 * Server-rendered with no client state and no polling, so a screenshot carries
 * the "checked at" time and reads as stale when it is stale. The only client
 * components below are the two shared reading surfaces the tenant pages already
 * use (`DeviceSignalReading`, `FeedLevelDisplay`), so the signal ladder and the
 * hopper treatment cannot drift between consoles.
 */

const TONE: Record<BandState, "success" | "warning" | "danger" | "neutral"> = {
	ok: "success",
	degraded: "warning",
	critical: "danger",
	unknown: "neutral",
};

const ICON: Record<BandState, LucideIcon> = {
	ok: CheckCircle2,
	degraded: AlertTriangle,
	critical: OctagonAlert,
	unknown: HelpCircle,
};

const ICON_TONE: Record<BandState, string> = {
	ok: "text-[#1E7B34]",
	degraded: "text-[#B45309]",
	critical: "text-[#C42B3A]",
	unknown: "text-[#3D5568] dark:text-gray-400",
};

/** The connectivity state is a status, so it owns the status colours. */
const CONNECTION_TONE: Record<DeviceConnectionState, BadgeTone> = {
	online: "success",
	weak: "warning",
	offline: "danger",
};

const CONNECTION_ICON: Record<DeviceConnectionState, LucideIcon> = {
	online: Wifi,
	weak: Signal,
	offline: WifiOff,
};

const MUTED = "text-[#3D5568] dark:text-slate-400";
const STRONG = "text-[#0A3D62] dark:text-slate-100";

const MINUTE_MS = 60 * 1000;

/**
 * Units rendered on one screen. The loader already bounds the fleet at
 * `FLEET_DEVICE_LIMIT`; this bounds the HTML a single render can produce, and
 * because the list is worst-first the cut only ever drops the healthiest units.
 */
const TELEMETRY_ROW_LIMIT = 200;

export default async function SuperadminFleetPage() {
	await requirePlatformAdmin();

	const [fleet, t, tBands, tCommon, tDates, locale] = await Promise.all([
		getFleetMonitor(),
		getTranslations("superadmin.fleet"),
		getTranslations("superadmin.statusBands"),
		getTranslations("superadmin.common"),
		getTranslations("dates"),
		getLocale(),
	]);

	const number = (value: number) =>
		new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);

	const States = ICON[fleet.summary.state];

	const columns = [
		{ key: "tenant", label: t("columnTenant") },
		{ key: "devices", label: t("columnDevices") },
		{ key: "reporting", label: t("columnReporting") },
		{ key: "offline", label: t("columnOffline") },
		{ key: "heartbeat", label: t("columnHeartbeat") },
		{ key: "state", label: t("columnState") },
	];

	const deviceColumns = [
		{ key: "device", label: t("columnDevice") },
		{ key: "state", label: t("columnState") },
		{ key: "heartbeat", label: t("columnHeartbeat") },
		{ key: "signal", label: t("columnSignal") },
		{ key: "firmware", label: t("columnFirmware") },
		{ key: "lastFeed", label: t("columnLastFeed") },
		{ key: "feedLevel", label: t("columnFeedLevel") },
		{ key: "waterTemp", label: t("columnWaterTemp") },
		{ key: "health", label: t("columnHealth") },
	];

	const time = (value: Date) => formatDateTimeLocal(value, tDates).time;
	const full = (value: Date) => formatDateTimeLocal(value, tDates).full;

	/** One freshness line: when the reading was taken, or that it is stale. */
	const freshnessNote = (freshness: ReadingFreshness, at: Date | null) => {
		if (freshness === "fresh" && at) return t("freshAt", { time: time(at) });
		if (freshness === "stale" && at) return t("staleAt", { time: time(at) });
		return t("notReported");
	};

	const units = worstDevices(fleet.rows);
	const shownUnits = units.slice(0, TELEMETRY_ROW_LIMIT);

	/**
	 * The health cell: icon plus words, never colour alone, and never "clear"
	 * for a unit that has not reported health at all.
	 */
	const healthCell = (row: DeviceTelemetryRow) => {
		if (row.health === null) {
			return <span className={cn("text-[11px] font-bold", MUTED)}>{t("notReported")}</span>;
		}

		const { safeMode, faults, since } = row.health;
		return (
			<div className="space-y-1">
				{safeMode ? (
					<Badge tone="danger" icon={ShieldAlert}>
						{t("safeModeOn")}
					</Badge>
				) : (
					<span className={cn("inline-flex items-center gap-1.5 text-[11px] font-bold", MUTED)}>
						<ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
						{t("safeModeOff")}
					</span>
				)}
				{faults.length === 0 ? (
					<span className={cn("flex items-start gap-1.5 text-[11px] font-bold", MUTED)}>
						<CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
						{t("noFaults")}
					</span>
				) : (
					<span className="flex items-start gap-1.5 text-[11px] font-bold text-[#B45309] dark:text-amber-300">
						<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
						{t("faultsLabel", {
							faults: faults.map((fault) => t(`faults.${fault}`)).join(", "),
						})}
					</span>
				)}
				<p className={cn("text-[10px]", MUTED)}>{t("stateSince", { time: time(since) })}</p>
			</div>
		);
	};

	/** Water temperature: the number only while the reading is still current. */
	const waterCell = (row: DeviceTelemetryRow) => {
		if (row.waterTemp === null) {
			return <span className={cn("text-[11px] font-bold", MUTED)}>{t("notReported")}</span>;
		}

		const { celsius, at, freshness, probeOk } = row.waterTemp;
		return (
			<div className="space-y-1">
				{probeOk === false ? (
					<span className={cn("flex items-start gap-1.5 text-[11px] font-bold", MUTED)}>
						<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
						{t("probeNotDetected")}
					</span>
				) : (
					<span className={cn("text-sm font-bold tabular-nums", STRONG)}>
						{`${number(celsius)} °C`}
					</span>
				)}
				<p className={cn("text-[10px]", MUTED)}>{freshnessNote(freshness, at)}</p>
			</div>
		);
	};

	/** The one line every unit row shares: what the unit is and where it lives. */
	const whereLine = (row: DeviceTelemetryRow) =>
		[row.pondName ?? tCommon("unassigned"), row.tenantName ?? t("unassigned")].join(" · ");

	return (
		<div className="space-y-6">
			<PageHeader
				title={t("title")}
				description={t("description", { count: fleet.totalDevices })}
				actions={
					<>
						<Link href="/superadmin/incidents" className={SECONDARY_BUTTON}>
							{t("viewIncidents")}
						</Link>
						<Link href="/superadmin/devices" className={SECONDARY_BUTTON}>
							{t("viewDevices")}
						</Link>
					</>
				}
			/>

			<section aria-label={t("summaryLabel")} className="grid grid-cols-1 gap-4 lg:grid-cols-3">
				<Card className="flex flex-col gap-2 p-5">
					<span className="text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568] dark:text-gray-400">
						{t("fleetState")}
					</span>
					<div className="flex items-center gap-2">
						<States
							className={cn("h-5 w-5 shrink-0", ICON_TONE[fleet.summary.state])}
							aria-hidden="true"
						/>
						<span className="text-2xl font-black text-[#0A3D62] dark:text-gray-100">
							{tBands(`states.${fleet.summary.state}`)}
						</span>
						<Badge tone={TONE[fleet.summary.state]} icon={States}>
							{tBands(`states.${fleet.summary.state}`)}
						</Badge>
					</div>
					<p className="text-[11px] text-[#3D5568] dark:text-gray-400">
						{t("checkedAt", { time: formatDateTimeLocal(fleet.checkedAt, tDates).full })}
					</p>
					<p className="text-[11px] text-[#3D5568] dark:text-gray-400">{t("unknownRule")}</p>
				</Card>

				<Card className="flex flex-col gap-2 p-5">
					<span className="text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568] dark:text-gray-400">
						{t("tenantsByState")}
					</span>
					<ul className="space-y-1 text-[11px] font-bold text-[#3D5568] dark:text-gray-400">
						{(["critical", "degraded", "unknown", "ok"] as const).map((state) => (
							<li key={state} className="flex items-center justify-between gap-2">
								<span className="flex items-center gap-1.5">
									{(() => {
										const Icon = ICON[state];
										return (
											<Icon
												className={cn("h-3 w-3 shrink-0", ICON_TONE[state])}
												aria-hidden="true"
											/>
										);
									})()}
									{tBands(`states.${state}`)}
								</span>
								<span className="tabular-nums text-[#0A3D62] dark:text-gray-100">
									{number(fleet.summary.counts[state])}
								</span>
							</li>
						))}
					</ul>
				</Card>

				<Card className="flex flex-col gap-2 p-5">
					<span className="text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568] dark:text-gray-400">
						{t("policyTitle")}
					</span>
					{fleet.policy ? (
						<p className="text-[11px] font-bold text-[#0A3D62] dark:text-gray-100">
							{t("policyLine", {
								offline: number(Math.round(fleet.policy.offlineAfterMs / MINUTE_MS)),
								weak: number(Math.round(fleet.policy.weakAfterMs / MINUTE_MS)),
								grace: number(Math.round(fleet.policy.graceMs / MINUTE_MS)),
							})}
						</p>
					) : (
						<p className="text-[11px] font-bold text-[#3D5568] dark:text-gray-400">
							{t("policyUnavailable")}
						</p>
					)}
					<p className="text-[11px] text-[#3D5568] dark:text-gray-400">{t("policySource")}</p>
				</Card>
			</section>

			{fleet.sourceError && (
				<div
					role="alert"
					className="flex items-start gap-2 rounded-xl border border-console-critical-content/30 bg-console-critical-surface px-4 py-3 text-xs font-bold text-console-critical-content"
				>
					<OctagonAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
					<div>
						<p>{t("sourceErrorTitle")}</p>
						<p className="mt-1 font-semibold">{t("sourceErrorBody")}</p>
					</div>
				</div>
			)}

			{fleet.truncated && (
				<p className="text-[11px] font-bold text-[#3D5568] dark:text-gray-400">
					{t("truncated", { count: fleet.totalDevices })}
				</p>
			)}

			{fleet.rows.length === 0 ? (
				<Card>
					<EmptyState icon={Radio} title={t("emptyTitle")} description={t("emptyDescription")} />
				</Card>
			) : (
				<>
					<TableFrame
						className="hidden md:block"
						label={t("tableLabel")}
						columns={columns}
						minWidth="min-w-[52rem]"
					>
						{fleet.rows.map((row) => {
							const RowIcon = ICON[row.state];
							return (
								<tr
									key={row.tenantId ?? "__unassigned__"}
									className="border-b border-gray-100 last:border-0"
								>
									<th
										scope="row"
										className="px-6 py-3 text-left text-sm font-bold text-[#0A3D62] dark:text-gray-100"
									>
										{row.tenantName ?? t("unassigned")}
									</th>
									<td className="px-6 py-3 text-sm tabular-nums text-[#3D5568] dark:text-gray-400">
										{number(row.total)}
									</td>
									<td className="px-6 py-3 text-sm tabular-nums text-[#3D5568] dark:text-gray-400">
										{row.reporting === 0 ? t("neverReported") : number(row.reporting)}
									</td>
									<td className="px-6 py-3 text-sm tabular-nums text-[#3D5568] dark:text-gray-400">
										{row.offlinePct === null ? t("notReported") : `${number(row.offlinePct)}%`}
									</td>
									<td className="px-6 py-3 text-sm text-[#3D5568] dark:text-gray-400">
										{row.lastHeartbeatAt
											? formatDateTimeLocal(row.lastHeartbeatAt, tDates).full
											: t("never")}
									</td>
									<td className="px-6 py-3">
										<Badge tone={TONE[row.state]} icon={RowIcon}>
											{tBands(`states.${row.state}`)}
										</Badge>
									</td>
								</tr>
							);
						})}
					</TableFrame>

					{/* Mobile: the same rows as cards, no horizontal scrolling. */}
					<ul className="space-y-3 md:hidden">
						{fleet.rows.map((row) => {
							const RowIcon = ICON[row.state];
							return (
								<li
									key={row.tenantId ?? "__unassigned__"}
									className="rounded-2xl border border-gray-200 dark:border-[#24304A] bg-white dark:bg-[#111A2C] p-4 shadow-sm"
								>
									<div className="flex items-start justify-between gap-2">
										<p className="text-sm font-bold text-[#0A3D62] dark:text-gray-100">
											{row.tenantName ?? t("unassigned")}
										</p>
										<Badge tone={TONE[row.state]} icon={RowIcon}>
											{tBands(`states.${row.state}`)}
										</Badge>
									</div>
									<dl className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
										<div>
											<dt className="text-[9px] font-black uppercase tracking-wider text-[#3D5568] dark:text-gray-400">
												{t("columnDevices")}
											</dt>
											<dd className="font-bold text-[#0A3D62] dark:text-gray-100">
												{number(row.total)}
											</dd>
										</div>
										<div>
											<dt className="text-[9px] font-black uppercase tracking-wider text-[#3D5568] dark:text-gray-400">
												{t("columnOffline")}
											</dt>
											<dd className="font-bold text-[#0A3D62] dark:text-gray-100">
												{row.offlinePct === null ? t("notReported") : `${number(row.offlinePct)}%`}
											</dd>
										</div>
										<div className="col-span-2">
											<dt className="text-[9px] font-black uppercase tracking-wider text-[#3D5568] dark:text-gray-400">
												{t("columnHeartbeat")}
											</dt>
											<dd className="font-bold text-[#0A3D62] dark:text-gray-100">
												{row.lastHeartbeatAt
													? formatDateTimeLocal(row.lastHeartbeatAt, tDates).full
													: t("never")}
											</dd>
										</div>
									</dl>
								</li>
							);
						})}
					</ul>
				</>
			)}

			{/* M3C.4b: the evidence behind the tenant verdict, one row per unit. */}
			{shownUnits.length > 0 && (
				<section aria-label={t("devicesLabel")} className="space-y-3">
					<div>
						<h2 className="font-black text-[#0A3D62] dark:text-slate-100">{t("devicesTitle")}</h2>
						<p className={cn("mt-1 max-w-3xl text-xs", MUTED)}>{t("devicesHint")}</p>
					</div>

					{units.length > shownUnits.length && (
						<p className={cn("text-[11px] font-bold", MUTED)}>
							{t("devicesTruncated", { shown: shownUnits.length, total: units.length })}
						</p>
					)}

					<TableFrame label={t("devicesLabel")} columns={deviceColumns} minWidth="min-w-[76rem]">
						{shownUnits.map((row) => {
							const ConnectionIcon = CONNECTION_ICON[row.connection];
							return (
								<tr key={row.id} className="border-b border-gray-100 align-top last:border-0">
									<th
										scope="row"
										className="px-6 py-3 text-left text-sm font-bold text-[#0A3D62] dark:text-slate-100"
									>
										<span className="block">{row.label}</span>
										<span className={cn("mt-0.5 block font-mono text-[11px] font-bold", MUTED)}>
											{row.mac}
										</span>
										<span className={cn("mt-0.5 block text-[11px] font-normal", MUTED)}>
											{whereLine(row)}
										</span>
									</th>
									<td className="px-6 py-3">
										<Badge tone={CONNECTION_TONE[row.connection]} icon={ConnectionIcon}>
											{tCommon(row.connection)}
										</Badge>
									</td>
									<td className={cn("px-6 py-3 text-sm", MUTED)}>
										{row.lastHeartbeatAt ? full(row.lastHeartbeatAt) : t("never")}
									</td>
									<td className={cn("px-6 py-3 text-sm font-bold", MUTED)}>
										{row.rssiDbm === null ? (
											<div className="space-y-1">
												<span>{t("notReported")}</span>
												{row.rssiFreshness === "stale" && row.rssiAt && (
													<p className="text-[10px] font-normal">
														{t("staleAt", { time: time(row.rssiAt) })}
													</p>
												)}
											</div>
										) : (
											<DeviceSignalReading rssiDbm={row.rssiDbm} />
										)}
									</td>
									<td className={cn("px-6 py-3 text-sm", MUTED)}>
										<span className={cn("block font-bold", STRONG)}>
											{row.firmware.version ?? t("unknown")}
										</span>
										<span className="block text-[10px]">
											{row.firmware.at
												? t("reportedAt", { time: time(row.firmware.at) })
												: t("firmwareNone")}
										</span>
									</td>
									<td className={cn("px-6 py-3 text-sm", MUTED)}>
										{row.lastFeedAt ? full(row.lastFeedAt) : t("never")}
									</td>
									<td className="px-6 py-3">
										<FeedLevelDisplay
											levelPercent={row.feedLevel.percent}
											updatedAt={row.feedLevel.at}
											isOffline={row.feedLevel.freshness !== "fresh"}
											size="sm"
										/>
									</td>
									<td className="px-6 py-3 text-[#3D5568] dark:text-slate-400">{waterCell(row)}</td>
									<td className="px-6 py-3">{healthCell(row)}</td>
								</tr>
							);
						})}
					</TableFrame>

					{/* Mobile: one card per unit, worst first, with the same values. */}
					<ul className="space-y-3 md:hidden">
						{shownUnits.map((row) => {
							const ConnectionIcon = CONNECTION_ICON[row.connection];
							return (
								<li
									key={row.id}
									className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-[#24304A] dark:bg-[#111A2C]"
								>
									<div className="flex items-start justify-between gap-2">
										<div className="min-w-0">
											<p className={cn("text-sm font-bold", STRONG)}>{row.label}</p>
											<p className={cn("font-mono text-[11px]", MUTED)}>{row.mac}</p>
											<p className={cn("text-[11px]", MUTED)}>{whereLine(row)}</p>
										</div>
										<Badge tone={CONNECTION_TONE[row.connection]} icon={ConnectionIcon}>
											{tCommon(row.connection)}
										</Badge>
									</div>
									<dl className="mt-3 grid grid-cols-2 gap-2">
										<MetaPair label={t("columnHeartbeat")}>
											{row.lastHeartbeatAt ? full(row.lastHeartbeatAt) : t("never")}
										</MetaPair>
										<MetaPair label={t("columnLastFeed")}>
											{row.lastFeedAt ? full(row.lastFeedAt) : t("never")}
										</MetaPair>
										<MetaPair label={t("columnSignal")}>
											{row.rssiDbm === null ? (
												t("notReported")
											) : (
												<DeviceSignalReading rssiDbm={row.rssiDbm} />
											)}
										</MetaPair>
										<MetaPair label={t("columnFirmware")}>
											{row.firmware.version ?? t("unknown")}
										</MetaPair>
										<div className="min-w-0">
											<dt className="text-[9px] font-black uppercase tracking-wider text-[#3D5568] dark:text-slate-400">
												{t("columnFeedLevel")}
											</dt>
											<dd className="mt-0.5">
												<FeedLevelDisplay
													levelPercent={row.feedLevel.percent}
													updatedAt={row.feedLevel.at}
													isOffline={row.feedLevel.freshness !== "fresh"}
													size="sm"
												/>
											</dd>
										</div>
										<div className="min-w-0">
											<dt className="text-[9px] font-black uppercase tracking-wider text-[#3D5568] dark:text-slate-400">
												{t("columnWaterTemp")}
											</dt>
											<dd className="mt-0.5">{waterCell(row)}</dd>
										</div>
										<div className="col-span-2">
											<dt className="text-[9px] font-black uppercase tracking-wider text-[#3D5568] dark:text-slate-400">
												{t("columnHealth")}
											</dt>
											<dd className="mt-1">{healthCell(row)}</dd>
										</div>
									</dl>
								</li>
							);
						})}
					</ul>
				</section>
			)}
		</div>
	);
}
