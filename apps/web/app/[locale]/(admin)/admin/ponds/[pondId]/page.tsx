import { AddFeederForm } from "@/components/admin/add-feeder-form";
import { adminButtonSecondary, adminSurface } from "@/components/admin/admin-classes";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { MoveDeviceForm, UnassignDeviceButton } from "@/components/admin/pond-device-actions";
import { PondStatusToggle } from "@/components/admin/pond-status-toggle";
import { FeedLevelDisplay } from "@/components/feed-level-display";
import { Link } from "@/i18n/routing";
import { getTenantRegistrationOptions } from "@/lib/actions/device-registration";
import { getPondDetail } from "@/lib/actions/ponds";
import { hasPermission } from "@/lib/auth/permissions";
import { daysBetween, todayDateOnly, utcDateToDateOnly } from "@/lib/crop-cycle/dates";
import { formatDateTimeLocal } from "@/lib/date-local";
import { isDeviceOffline } from "@/lib/feed-level-display";
import { ArrowLeft, Cpu, Droplets, Pencil, Printer, Trash2 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

const statusStyles: Record<string, string> = {
	ACTIVE: "bg-green-100 text-[#1E7B34] dark:bg-green-950/50 dark:text-green-300",
	ARCHIVED: "bg-gray-200 text-[#3D5568] dark:bg-gray-700 dark:text-gray-200",
};

function formatTime(date: Date): string {
	return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(
		2,
		"0",
	)}`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="rounded-xl bg-[#F4F7F6] p-3 dark:bg-gray-800">
			<dt className="text-[10px] font-black tracking-wider text-[#3D5568] uppercase dark:text-gray-400">
				{label}
			</dt>
			<dd className="mt-0.5 text-sm font-bold break-words text-[#0A3D62] dark:text-gray-100">
				{children}
			</dd>
		</div>
	);
}

/**
 * Full pond detail (#202 / decision E22).
 *
 * Presentation only: every read is scoped by `getPondDetail`, every device or
 * pond mutation is a guarded tenant action, and the add-feeder flow is the
 * existing org-policy-driven one with this pond preselected.
 */
export default async function PondDetailPage({
	params,
}: {
	params: Promise<{ pondId: string }>;
}) {
	const { pondId } = await params;
	const [detail, canClaim, canManage, t, tCommon, tDates] = await Promise.all([
		getPondDetail(pondId),
		hasPermission("claim_feeder"),
		hasPermission("manage_farms_ponds"),
		getTranslations("dashboard.adminPondDetail"),
		getTranslations("dashboard.adminCommon"),
		getTranslations("dates"),
	]);

	if (!detail) notFound();

	const { pond, movableDevices } = detail;
	const registrationOptions = canClaim ? await getTenantRegistrationOptions() : null;
	const cycle = pond.cropCycles[0] ?? null;
	const biomass = pond.biomassLogs[0] ?? null;
	const fcr = pond.fcrReports[0] ?? null;
	const ownerName = pond.owner?.displayName || pond.owner?.email || pond.ownerId;
	const labelsPath = "/admin/devices/labels";
	const cycleDay = cycle
		? Math.max(0, daysBetween(utcDateToDateOnly(cycle.stockingDate), todayDateOnly()) + 1)
		: null;

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<Link
					href="/admin/ponds"
					className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-bold text-[#3D5568] transition-colors hover:text-[#0A3D62] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:text-gray-300 dark:hover:text-white dark:focus-visible:outline-[#8fc0ea]"
				>
					<ArrowLeft aria-hidden="true" className="h-4 w-4" />
					{t("back")}
				</Link>
				{canManage && (
					<div className="flex flex-wrap items-center gap-2">
						<Link href={`/admin/ponds/${pond.id}/edit`} className={adminButtonSecondary}>
							<Pencil aria-hidden="true" className="h-3.5 w-3.5" />
							{t("edit")}
						</Link>
						<Link href={`/admin/ponds/${pond.id}/delete`} className={adminButtonSecondary}>
							<Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
							{t("delete")}
						</Link>
					</div>
				)}
			</div>

			<AdminPageHeader
				icon={Droplets}
				title={pond.name}
				description={t("subtitle", {
					farm: pond.farm?.name ?? t("notSet"),
					owner: ownerName,
				})}
				actions={canManage ? <PondStatusToggle pondId={pond.id} status={pond.status} /> : undefined}
			>
				<div className="mt-2 flex flex-wrap items-center gap-2">
					<span
						className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black tracking-wider uppercase ${
							statusStyles[pond.status] ?? statusStyles.ACTIVE
						}`}
					>
						{pond.status === "ARCHIVED" ? t("statusArchived") : t("statusActive")}
					</span>
					{pond.isFallow && (
						<span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black tracking-wider text-[#8A4B08] uppercase dark:bg-amber-950/40 dark:text-amber-300">
							{t("fallowTag")}
						</span>
					)}
					<span className="font-mono text-[11px] text-[#3D5568] dark:text-gray-400">
						{t("fieldId")}: {pond.id}
					</span>
				</div>
			</AdminPageHeader>

			<section aria-labelledby="pond-overview" className={`${adminSurface} p-4 sm:p-6`}>
				<h2 id="pond-overview" className="text-lg font-black text-[#0A3D62] dark:text-[#8fc0ea]">
					{t("overviewTitle")}
				</h2>
				<dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<Field label={t("fieldOwner")}>{ownerName}</Field>
					<Field label={t("fieldFarm")}>{pond.farm?.name ?? t("notSet")}</Field>
					<Field label={t("fieldFarmId")}>
						<span className="font-mono text-xs">{pond.farm?.ownerId ?? pond.ownerId}</span>
					</Field>
					<Field label={t("fieldCreated")}>
						{formatDateTimeLocal(pond.createdAt, tDates).fullDate}
					</Field>
					<Field label={t("fieldPopulation")}>
						{pond.population === null ? t("notSet") : pond.population.toLocaleString()}
					</Field>
					<Field label={t("fieldFeedingRate")}>{pond.feedingRatePct}%</Field>
					<Field label={t("fieldFeedsPerDay")}>{pond.feedsPerDay}</Field>
					<Field label={t("fieldSchedule")}>
						{`${formatTime(pond.scheduleStart)} – ${formatTime(pond.scheduleEnd)}`}
					</Field>
					<Field label={t("fieldSampleInterval")}>
						{t("sampleIntervalValue", { days: pond.sampleIntervalDays })}
					</Field>
					<Field label={t("fieldBiomassLogs")}>{pond._count.biomassLogs}</Field>
					<Field label={t("fieldFeedEvents")}>{detail.feedEventCount}</Field>
					<Field label={t("fieldDevices")}>{pond._count.energyDevices}</Field>
				</dl>
			</section>

			<div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
				<section
					aria-labelledby="pond-cycle"
					className={`${adminSurface} p-4 sm:p-6 xl:col-span-2`}
				>
					<h2 id="pond-cycle" className="text-lg font-black text-[#0A3D62] dark:text-[#8fc0ea]">
						{t("cycleTitle")}
					</h2>
					{cycle ? (
						<dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
							<Field label={t("cycleLabelLabel")}>{cycle.label ?? t("notSet")}</Field>
							<Field label={t("cycleDayLabel")}>
								{t("cycleDay", { day: cycleDay ?? 0, total: cycle.growOutDays })}
							</Field>
							<Field label={t("cycleStockingDate")}>
								{formatDateTimeLocal(cycle.stockingDate, tDates).fullDate}
							</Field>
							<Field label={t("cycleStockingCount")}>{cycle.stockingCount.toLocaleString()}</Field>
							<Field label={t("cycleStockingWeight")}>
								{cycle.stockingAvgWeightG === null ? t("notSet") : `${cycle.stockingAvgWeightG} g`}
							</Field>
							<Field label={t("cycleTargetDate")}>
								{formatDateTimeLocal(cycle.targetHarvestDate, tDates).fullDate}
							</Field>
							<Field label={t("cycleTargetWeight")}>
								{cycle.targetHarvestWeightG === null
									? t("notSet")
									: `${cycle.targetHarvestWeightG} g`}
							</Field>
							<Field label={t("cycleSurvival")}>
								{cycle.expectedSurvivalPct === null ? t("notSet") : `${cycle.expectedSurvivalPct}%`}
							</Field>
						</dl>
					) : (
						<p className="mt-3 text-sm text-[#3D5568] dark:text-gray-400">{t("cycleEmpty")}</p>
					)}
				</section>

				<section aria-labelledby="pond-sampling" className={`${adminSurface} space-y-4 p-4 sm:p-6`}>
					<div>
						<h2
							id="pond-sampling"
							className="text-lg font-black text-[#0A3D62] dark:text-[#8fc0ea]"
						>
							{t("biomassTitle")}
						</h2>
						{biomass ? (
							<dl className="mt-3 grid grid-cols-2 gap-3">
								<Field label={t("biomassDate")}>
									{formatDateTimeLocal(biomass.recordedAt, tDates).fullDate}
								</Field>
								<Field label={t("biomassAvgWeight")}>{biomass.avgWeightKg.toFixed(3)} kg</Field>
								<Field label={t("biomassSample")}>
									{biomass.sampleWeightKg} kg / {biomass.sampleCount}
								</Field>
							</dl>
						) : (
							<p className="mt-2 text-sm text-[#3D5568] dark:text-gray-400">{t("biomassEmpty")}</p>
						)}
					</div>
					<div className="border-t border-gray-100 pt-4 dark:border-gray-800">
						<h2 className="text-lg font-black text-[#0A3D62] dark:text-[#8fc0ea]">
							{t("fcrTitle")}
						</h2>
						{fcr ? (
							<dl className="mt-3 grid grid-cols-2 gap-3">
								<Field label={t("fcrValue")}>{fcr.fcrValue.toFixed(2)}</Field>
								<Field label={t("fcrPeriod")}>
									{`${formatDateTimeLocal(fcr.periodStart, tDates).fullDate} – ${
										formatDateTimeLocal(fcr.periodEnd, tDates).fullDate
									}`}
								</Field>
							</dl>
						) : (
							<p className="mt-2 text-sm text-[#3D5568] dark:text-gray-400">{t("fcrEmpty")}</p>
						)}
					</div>
				</section>
			</div>

			<section aria-labelledby="pond-devices" className={`${adminSurface} p-4 sm:p-6`}>
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h2 id="pond-devices" className="text-lg font-black text-[#0A3D62] dark:text-[#8fc0ea]">
						{t("devicesTitle")}
					</h2>
					<Link href="/admin/devices" className={adminButtonSecondary}>
						<Cpu aria-hidden="true" className="h-3.5 w-3.5" />
						{t("openDevices")}
					</Link>
				</div>

				{pond.energyDevices.length === 0 ? (
					<p className="mt-3 text-sm text-[#3D5568] dark:text-gray-400">{t("devicesEmpty")}</p>
				) : (
					<ul className="mt-4 space-y-3">
						{pond.energyDevices.map((device) => {
							const offline = isDeviceOffline(device.lastSeenAt);
							return (
								<li
									key={device.id}
									className="rounded-xl border border-gray-200 p-3 dark:border-gray-700/60"
								>
									<div className="flex flex-wrap items-start justify-between gap-3">
										<div className="min-w-0">
											<p className="font-black text-[#0A3D62] dark:text-gray-100">{device.label}</p>
											<p className="font-mono text-xs text-[#3D5568] dark:text-gray-400">
												{device.mac}
											</p>
											<p className="mt-1 text-[11px] font-bold text-[#3D5568] dark:text-gray-400">
												{t("deviceGrams", { grams: device.gramsPerFeeding })}
											</p>
											<p className="mt-1 text-[11px] text-[#3D5568] dark:text-gray-400">
												{t("deviceLastSeen")}:{" "}
												{device.lastSeenAt
													? formatDateTimeLocal(device.lastSeenAt, tDates).full
													: tCommon("never")}
											</p>
										</div>
										<div className="flex flex-wrap items-center gap-2">
											<span
												className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black tracking-wider uppercase ${
													offline
														? "bg-red-100 text-[#C42B3A] dark:bg-red-950/50 dark:text-red-300"
														: "bg-green-100 text-[#1E7B34] dark:bg-green-950/50 dark:text-green-300"
												}`}
											>
												{offline ? tCommon("offline") : tCommon("online")}
											</span>
											<span className="inline-flex rounded-full bg-[#0A3D62]/10 px-2.5 py-1 text-[10px] font-black tracking-wider text-[#0A3D62] uppercase dark:bg-white/10 dark:text-[#8fc0ea]">
												{t(`approval.${device.approvalStatus}`)}
											</span>
										</div>
									</div>
									<div className="mt-3 flex flex-wrap items-center justify-between gap-3">
										<FeedLevelDisplay
											levelPercent={device.feedLevelPercent}
											updatedAt={device.feedLevelUpdatedAt}
											isOffline={offline}
											size="sm"
										/>
										<div className="flex flex-wrap items-center gap-2">
											<Link
												href={{ pathname: labelsPath, query: { id: device.id } }}
												className={adminButtonSecondary}
											>
												<Printer aria-hidden="true" className="h-3.5 w-3.5" />
												{t("printLabel")}
											</Link>
											{canManage && (
												<UnassignDeviceButton deviceId={device.id} deviceLabel={device.label} />
											)}
										</div>
									</div>
								</li>
							);
						})}
					</ul>
				)}

				{canManage && (
					<div className="mt-5 grid grid-cols-1 gap-5 border-t border-gray-100 pt-5 lg:grid-cols-2 dark:border-gray-800">
						<div>
							<h3 className="text-sm font-black text-[#0A3D62] dark:text-[#8fc0ea]">
								{t("moveTitle")}
							</h3>
							<div className="mt-2">
								<MoveDeviceForm
									targetPondId={pond.id}
									devices={movableDevices.map((device) => ({
										id: device.id,
										label: device.label,
										mac: device.mac,
										pondName: device.pond?.name ?? null,
									}))}
								/>
							</div>
						</div>
						{registrationOptions && (
							<div>
								<h3 className="mb-2 text-sm font-black text-[#0A3D62] dark:text-[#8fc0ea]">
									{t("addTitle")}
								</h3>
								<AddFeederForm options={registrationOptions} defaultPondId={pond.id} />
							</div>
						)}
					</div>
				)}
			</section>

			<section aria-labelledby="pond-ownership" className={`${adminSurface} p-4 sm:p-6`}>
				<h2 id="pond-ownership" className="text-lg font-black text-[#0A3D62] dark:text-[#8fc0ea]">
					{t("ownershipTitle")}
				</h2>
				{pond.ownershipHistory.length === 0 ? (
					<p className="mt-3 text-sm text-[#3D5568] dark:text-gray-400">{t("ownershipEmpty")}</p>
				) : (
					<ul className="mt-4 space-y-2">
						{pond.ownershipHistory.map((event) => (
							<li
								key={event.id}
								className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#F4F7F6] px-3 py-2 text-xs dark:bg-gray-800"
							>
								<span className="font-bold text-[#0A3D62] dark:text-gray-100">
									{event.eventType === "TRANSFERRED"
										? t("ownershipTransferred")
										: t("ownershipCreated")}
								</span>
								<span className="font-mono text-[11px] text-[#3D5568] dark:text-gray-400">
									{event.farmId}
								</span>
								<span className="text-[11px] text-[#3D5568] dark:text-gray-400">
									{formatDateTimeLocal(event.createdAt, tDates).full}
								</span>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}
