import { DurationCalibrationForm } from "@/components/DurationCalibrationForm";
import { HopperCalibrationForm } from "@/components/HopperCalibrationForm";
import { TemperatureCalibrationForm } from "@/components/TemperatureCalibrationForm";
import {
	DashboardEmptyState,
	DashboardPageHeader,
	DashboardSection,
	ReadOnlyNotice,
} from "@/components/dashboard/dashboard-ui";
import { canWrite } from "@/lib/auth/session";
import { OFFLINE_THRESHOLD_MS } from "@/lib/constants";
import { getActivePond } from "@/lib/pond-selection";
import prisma from "@/lib/prisma";
import { AP_PREFIX } from "@/lib/provisioning-ap";
import { Cpu, RefreshCw, Ruler, Settings, Thermometer, Timer, Wifi } from "lucide-react";
import { getTranslations } from "next-intl/server";

// The setup panel is stricter than the 15-minute offline threshold: "WiFi is
// configured" is only claimed while the device is actively reporting.
const WIFI_ONLINE_WINDOW_MS = 5 * 60 * 1000;

// The firmware names its setup SoftAP `<AP_PREFIX>XXXX` using the last four hex
// digits of the device MAC (see docs/wifi-provisioning-plan.md). The prefix is
// shared with the firmware and the admin sticker via lib/provisioning-ap.ts.
function getSetupApName(mac: string | null | undefined): string | null {
	if (!mac) return null;
	const hex = mac.toUpperCase().replace(/[^0-9A-F]/g, "");
	return hex.length >= 4 ? `${AP_PREFIX}${hex.slice(-4)}` : null;
}

export default async function HardwareSettingsPage() {
	const [t, tCommon] = await Promise.all([
		getTranslations("dashboard.appSettings"),
		getTranslations("dashboard.common"),
	]);
	const writeAccess = await canWrite();
	let energyDevice = null;
	let pondIsFallow = false;
	try {
		const pond = await getActivePond();
		if (pond) {
			pondIsFallow = Boolean(pond.isFallow);
			energyDevice = await prisma.energyDevice.findFirst({
				where: { pondId: pond.id },
				orderBy: { createdAt: "asc" },
				select: {
					id: true,
					mac: true,
					label: true,
					lastSeenAt: true,
					feedLevelPercent: true,
					hopperFullCm: true,
					hopperEmptyCm: true,
					hopperCapacityG: true,
					gramsPerSecond: true,
					gramsPerFeeding: true,
					tempOffsetC: true,
					waterTempC: true,
				},
			});
		}
	} catch (err) {
		console.error("[HardwareSettingsPage] Prisma error:", err);
	}

	const now = new Date();
	const isDeviceOffline =
		!energyDevice?.lastSeenAt ||
		now.getTime() - energyDevice.lastSeenAt.getTime() > OFFLINE_THRESHOLD_MS;
	const isWifiConfigured =
		!!energyDevice?.lastSeenAt &&
		now.getTime() - energyDevice.lastSeenAt.getTime() <= WIFI_ONLINE_WINDOW_MS;
	const setupApName = getSetupApName(energyDevice?.mac);

	function formatOfflineDuration(lastSeenAt: Date): string {
		const totalMinutes = Math.floor((now.getTime() - lastSeenAt.getTime()) / 60000);
		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;
		if (hours > 0) return t("durationHoursMinutes", { hours, minutes });
		return t("durationMinutes", { minutes });
	}

	const connectionLabel = isDeviceOffline
		? energyDevice?.lastSeenAt
			? t("offlineFor", { duration: formatOfflineDuration(energyDevice.lastSeenAt) })
			: t("offline")
		: t("online");

	const statLabel = "text-xs font-bold uppercase tracking-wide text-[#3D5568] dark:text-gray-400";
	const statTile = "rounded-xl bg-[#F4F7F6] p-4 dark:bg-gray-800/60";
	const statValue = "mt-1 text-sm font-bold text-[#0A3D62] dark:text-gray-100";

	return (
		<div className="mx-auto max-w-4xl space-y-6 pb-20">
			<DashboardPageHeader title={t("title")} description={t("desc")} icon={Settings} />

			{!writeAccess && (
				<ReadOnlyNotice title={tCommon("readOnlyTitle")} description={tCommon("readOnlyDesc")} />
			)}

			{/* Device Status */}
			<DashboardSection title={t("deviceStatus")} description={t("deviceStatusDesc")} icon={Cpu}>
				{energyDevice ? (
					<dl className="grid gap-4 md:grid-cols-2">
						<div className={statTile}>
							<dt className={statLabel}>{t("deviceRecordId")}</dt>
							<dd className={`${statValue} break-all font-mono`}>{energyDevice.id}</dd>
						</div>
						<div className={statTile}>
							<dt className={statLabel}>{t("connectionStatus")}</dt>
							<dd
								className={`mt-1 text-sm font-bold ${isDeviceOffline ? "text-[#C42B3A] dark:text-red-300" : "text-[#1E7B34] dark:text-green-300"}`}
							>
								{connectionLabel}
							</dd>
						</div>
						<div className={statTile}>
							<dt className={statLabel}>{t("hopperLevel")}</dt>
							<dd className={statValue}>
								{energyDevice?.feedLevelPercent === null ||
								energyDevice?.feedLevelPercent === undefined
									? "—"
									: t("currentLevelValue", { percent: energyDevice.feedLevelPercent })}
							</dd>
						</div>
						<div className={statTile}>
							<dt className={statLabel}>{t("firmware")}</dt>
							<dd className={`${statValue} font-mono`}>v1.4.2</dd>
						</div>
					</dl>
				) : (
					<DashboardEmptyState icon={Cpu} title={t("noDevice")} description={t("noDeviceDesc")} />
				)}
			</DashboardSection>

			{/* WiFi Setup */}
			<DashboardSection title={t("wifiSetup.title")} description={t("wifiSetup.desc")} icon={Wifi}>
				<div className="rounded-xl bg-[#F4F7F6] p-4 dark:bg-gray-800/60">
					<div className="flex flex-wrap items-start justify-between gap-4">
						<div className="min-w-0">
							<p className={statLabel}>{t("wifiSetup.apName")}</p>
							{setupApName ? (
								<p className="mt-1 break-all font-mono text-lg font-bold text-[#0A3D62] dark:text-gray-100">
									{setupApName}
								</p>
							) : (
								<p className="mt-1 text-sm font-medium text-[#3D5568] dark:text-gray-300">
									{energyDevice ? t("wifiSetup.apUnknown") : t("wifiSetup.noDevice")}
								</p>
							)}
							{energyDevice && (
								<p className="mt-1 text-xs text-[#3D5568] dark:text-gray-400">
									{energyDevice.label}
								</p>
							)}
						</div>
						{energyDevice && (
							<div className="min-w-0">
								<p className={statLabel}>{t("wifiSetup.deviceId")}</p>
								<p className="mt-1 break-all font-mono text-lg font-bold text-[#0A3D62] dark:text-gray-100">
									{energyDevice.mac}
								</p>
								<p className="mt-1 text-xs text-[#3D5568] dark:text-gray-400">
									{t("wifiSetup.deviceIdHint")}
								</p>
							</div>
						)}
					</div>
				</div>

				{energyDevice &&
					(isWifiConfigured ? (
						<div className="mt-4 space-y-1 rounded-xl border border-[#1E7B34]/20 bg-[#1E7B34]/5 p-4 dark:border-green-900/50 dark:bg-green-900/20">
							<p className="text-sm font-bold text-[#1E7B34] dark:text-green-300">
								{t("wifiSetup.connected")}
							</p>
							<p className="text-xs text-[#3D5568] dark:text-gray-300">{t("wifiSetup.apOff")}</p>
						</div>
					) : (
						<div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-900/20">
							<p className="text-xs font-medium text-amber-800 dark:text-amber-300">
								{t("wifiSetup.needsSetup")}
							</p>
						</div>
					))}

				{energyDevice && (
					<div className="mt-6">
						<p className="text-sm font-bold text-[#0A3D62] dark:text-gray-200">
							{t("wifiSetup.steps")}
						</p>
						<ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-[#3D5568] dark:text-gray-300">
							<li>{t("wifiSetup.step1")}</li>
							<li>{t("wifiSetup.step2")}</li>
							<li>{t("wifiSetup.step3")}</li>
							<li>{t("wifiSetup.step4")}</li>
							<li>{t("wifiSetup.step5")}</li>
						</ol>
						<p className="mt-3 text-xs text-[#3D5568] dark:text-gray-400">
							{t("wifiSetup.credentialsNote")}
						</p>
						<p className="mt-1 text-xs text-[#3D5568] dark:text-gray-400">
							{t("wifiSetup.tokenWarning")}
						</p>
					</div>
				)}

				{energyDevice && !isWifiConfigured && (
					<div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/60">
						<p className="text-sm font-bold text-[#0A3D62] dark:text-gray-200">
							{t("wifiSetup.recoveryTitle")}
						</p>
						<p className="mt-1 text-xs text-[#3D5568] dark:text-gray-400">
							{t("wifiSetup.recovery")}
						</p>
					</div>
				)}
			</DashboardSection>

			{/* Hopper Calibration */}
			{energyDevice && (
				<DashboardSection
					title={t("hopperCalibration")}
					description={t("hopperCalibrationDesc")}
					icon={Ruler}
				>
					<div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-3 dark:border-blue-900/50 dark:bg-blue-900/20">
						<p className="text-xs font-medium text-blue-800 dark:text-blue-200">
							{t("currentLevelLabel")}:{" "}
							<strong>
								{energyDevice.feedLevelPercent === null
									? "—"
									: t("currentLevelValue", { percent: energyDevice.feedLevelPercent })}
							</strong>
						</p>
					</div>

					<HopperCalibrationForm
						deviceId={energyDevice.id}
						hopperFullCm={energyDevice.hopperFullCm}
						hopperEmptyCm={energyDevice.hopperEmptyCm}
						hopperCapacityG={energyDevice.hopperCapacityG}
						canWrite={writeAccess}
					/>
				</DashboardSection>
			)}

			{/* Duration Calibration */}
			{energyDevice && (
				<DashboardSection
					title={t("calibration.title")}
					description={t("calibration.desc")}
					icon={Timer}
				>
					<DurationCalibrationForm
						deviceId={energyDevice.id}
						currentGramsPerSecond={energyDevice.gramsPerSecond}
						currentGramsPerFeeding={energyDevice.gramsPerFeeding}
						canWrite={writeAccess}
						isOffline={isDeviceOffline}
						isFallow={pondIsFallow}
					/>
				</DashboardSection>
			)}

			{/* Temperature sensor calibration */}
			{energyDevice && (
				<DashboardSection
					title={t("temperatureCalibration")}
					description={t("temperatureCalibrationDesc")}
					icon={Thermometer}
				>
					<div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-3 dark:border-sky-900/50 dark:bg-sky-900/20">
						<p className="text-xs font-medium text-sky-800 dark:text-sky-200">
							{t("currentOffset")}:{" "}
							<strong>
								{energyDevice.tempOffsetC >= 0 ? "+" : ""}
								{energyDevice.tempOffsetC}°C
							</strong>
							{energyDevice.waterTempC !== null && (
								<>
									{" · "}
									{t("lastReading")}: <strong>{energyDevice.waterTempC.toFixed(1)}°C</strong>
								</>
							)}
						</p>
					</div>

					<TemperatureCalibrationForm
						deviceId={energyDevice.id}
						currentTempOffsetC={energyDevice.tempOffsetC}
						currentTempC={energyDevice.waterTempC}
						canWrite={writeAccess}
					/>
				</DashboardSection>
			)}

			{/* Device Actions */}
			<DashboardSection
				title={t("deviceActions")}
				description={t("deviceActionsDesc")}
				icon={RefreshCw}
			>
				<p
					id="device-actions-unavailable"
					className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300"
				>
					{t("actionsUnavailable")}
				</p>

				<div className="space-y-3">
					<button
						type="button"
						disabled
						aria-describedby="device-actions-unavailable"
						className="flex min-h-11 w-full cursor-not-allowed items-center justify-between rounded-xl border border-[#0A3D62]/10 bg-white px-4 font-bold text-[#0A3D62] opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
					>
						<span className="flex items-center gap-3">
							<RefreshCw aria-hidden="true" className="h-5 w-5 text-[#E85A2A]" />
							{t("syncNow")}
						</span>
					</button>
					<button
						type="button"
						disabled
						aria-describedby="device-actions-unavailable"
						className="flex min-h-11 w-full cursor-not-allowed items-center justify-between rounded-xl border border-red-100 bg-red-50 px-4 font-bold text-[#C42B3A] opacity-50 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300"
					>
						<span className="flex items-center gap-3">
							<Cpu aria-hidden="true" className="h-5 w-5" />
							{t("restartDevice")}
						</span>
					</button>
				</div>
			</DashboardSection>
		</div>
	);
}
