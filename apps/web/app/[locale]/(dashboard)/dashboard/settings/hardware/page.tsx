import { DurationCalibrationForm } from "@/components/DurationCalibrationForm";
import { HopperCalibrationForm } from "@/components/HopperCalibrationForm";
import { TemperatureCalibrationForm } from "@/components/TemperatureCalibrationForm";
import { canWrite } from "@/lib/auth/session";
import { OFFLINE_THRESHOLD_MS } from "@/lib/constants";
import { getActivePond } from "@/lib/pond-selection";
import prisma from "@/lib/prisma";
import { Cpu, RefreshCw, Ruler, Settings, Thermometer, Timer, Wifi } from "lucide-react";
import { getTranslations } from "next-intl/server";

// The setup panel is stricter than the 15-minute offline threshold: "WiFi is
// configured" is only claimed while the device is actively reporting.
const WIFI_ONLINE_WINDOW_MS = 5 * 60 * 1000;

// The firmware names its setup SoftAP `OptiFeed-XXXX` using the last four hex
// digits of the device MAC (see docs/wifi-provisioning-plan.md). Keep this in
// sync if the firmware naming ever changes.
function getSetupApName(mac: string | null | undefined): string | null {
	if (!mac) return null;
	const hex = mac.toUpperCase().replace(/[^0-9A-F]/g, "");
	return hex.length >= 4 ? `OptiFeed-${hex.slice(-4)}` : null;
}

export default async function HardwareSettingsPage() {
	const t = await getTranslations("dashboard.appSettings");
	const writeAccess = await canWrite();
	let device = null;
	let energyDevice = null;
	let pondIsFallow = false;
	try {
		const pond = await getActivePond({ devices: true });
		if (pond && pond.devices.length > 0) {
			device = pond.devices[0];
		}
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

	function formatOfflineDuration(lastSeenAt: Date | null): string {
		if (!lastSeenAt) return "";
		const ms = now.getTime() - lastSeenAt.getTime();
		const totalMinutes = Math.floor(ms / 60000);
		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;
		if (hours > 0) return `${hours}h ${minutes}m`;
		return `${minutes}m`;
	}

	return (
		<div className="mx-auto max-w-4xl space-y-8">
			<div>
				<h1 className="flex items-center gap-2 text-3xl font-bold text-[var(--ofd-base)]">
					<Settings size={28} />
					{t("title")}
				</h1>
				<p className="mt-2 text-gray-500">{t("desc")}</p>
			</div>

			<div className="space-y-8">
				{/* Device Status */}
				<section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
					<div className="mb-6 border-b border-gray-100 pb-4">
						<h2 className="flex items-center gap-2 text-xl font-semibold text-gray-800">
							<Cpu size={20} />
							{t("deviceStatus")}
						</h2>
						<p className="mt-1 text-sm text-gray-500">{t("deviceStatusDesc")}</p>
					</div>

					{device ? (
						<div className="grid gap-4 md:grid-cols-2">
							<div className="rounded-xl bg-[#F4F7F6] p-4">
								<p className="text-xs font-bold uppercase tracking-wide text-[#3D5568]">
									{t("deviceRecordId")}
								</p>
								<p className="mt-1 font-mono text-sm font-bold text-[#0A3D62]">{device.id}</p>
							</div>
							<div className="rounded-xl bg-[#F4F7F6] p-4">
								<p className="text-xs font-bold uppercase tracking-wide text-[#3D5568]">
									{t("connectionStatus")}
								</p>
								<p
									className={`mt-1 text-sm font-bold ${isDeviceOffline ? "text-[#C42B3A]" : "text-[#1E7B34]"}`}
								>
									{isDeviceOffline
										? `${t("offline")}${energyDevice?.lastSeenAt ? ` for ${formatOfflineDuration(energyDevice.lastSeenAt)}` : ""}`
										: t("online")}
								</p>
							</div>
							<div className="rounded-xl bg-[#F4F7F6] p-4">
								<p className="text-xs font-bold uppercase tracking-wide text-[#3D5568]">
									{t("hopperLevel")}
								</p>
								<p className="mt-1 text-sm font-bold text-[#0A3D62]">
									{energyDevice?.feedLevelPercent ?? 0}%
								</p>
							</div>
							<div className="rounded-xl bg-[#F4F7F6] p-4">
								<p className="text-xs font-bold uppercase tracking-wide text-[#3D5568]">
									{t("firmware")}
								</p>
								<p className="mt-1 font-mono text-sm font-bold text-[#0A3D62]">v1.4.2</p>
							</div>
						</div>
					) : (
						<p className="text-gray-500">{t("noDevice")}</p>
					)}
				</section>

				{/* WiFi Setup */}
				<section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm dark:border-gray-700/50 dark:bg-gray-900">
					<div className="mb-6 border-b border-gray-100 pb-4 dark:border-gray-700/50">
						<h2 className="flex items-center gap-2 text-xl font-semibold text-gray-800 dark:text-gray-100">
							<Wifi size={20} />
							{t("wifiSetup.title")}
						</h2>
						<p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("wifiSetup.desc")}</p>
					</div>

					<div className="rounded-xl bg-[#F4F7F6] p-4 dark:bg-gray-800/60">
						<div className="flex flex-wrap items-start justify-between gap-4">
							<div>
								<p className="text-xs font-bold uppercase tracking-wide text-[#3D5568] dark:text-gray-400">
									{t("wifiSetup.apName")}
								</p>
								{setupApName ? (
									<p className="mt-1 font-mono text-lg font-bold text-[#0A3D62] dark:text-gray-100">
										{setupApName}
									</p>
								) : (
									<p className="mt-1 text-sm font-medium text-gray-600 dark:text-gray-300">
										{energyDevice ? t("wifiSetup.apUnknown") : t("wifiSetup.noDevice")}
									</p>
								)}
								{energyDevice && (
									<p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
										{energyDevice.label}
									</p>
								)}
							</div>
							{energyDevice && (
								<div>
									<p className="text-xs font-bold uppercase tracking-wide text-[#3D5568] dark:text-gray-400">
										{t("wifiSetup.deviceId")}
									</p>
									<p className="mt-1 font-mono text-lg font-bold text-[#0A3D62] dark:text-gray-100">
										{energyDevice.mac}
									</p>
									<p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
										{t("wifiSetup.deviceIdHint")}
									</p>
								</div>
							)}
						</div>
					</div>

					{energyDevice &&
						(isWifiConfigured ? (
							<div className="mt-4 space-y-1 rounded-xl border border-[#1E7B34]/20 bg-[#1E7B34]/5 p-4 dark:border-green-900/50 dark:bg-green-900/20">
								<p className="text-sm font-semibold text-[#1E7B34] dark:text-green-300">
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
							<p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
								{t("wifiSetup.steps")}
							</p>
							<ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-gray-600 dark:text-gray-300">
								<li>{t("wifiSetup.step1")}</li>
								<li>{t("wifiSetup.step2")}</li>
								<li>{t("wifiSetup.step3")}</li>
								<li>{t("wifiSetup.step4")}</li>
								<li>{t("wifiSetup.step5")}</li>
							</ol>
							<p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
								{t("wifiSetup.credentialsNote")}
							</p>
							<p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
								{t("wifiSetup.tokenWarning")}
							</p>
						</div>
					)}

					{energyDevice && !isWifiConfigured && (
						<div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/60">
							<p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
								{t("wifiSetup.recoveryTitle")}
							</p>
							<p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
								{t("wifiSetup.recovery")}
							</p>
						</div>
					)}
				</section>

				{/* Hopper Calibration */}
				{energyDevice && (
					<section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
						<div className="mb-6 border-b border-gray-100 pb-4">
							<h2 className="flex items-center gap-2 text-xl font-semibold text-gray-800">
								<Ruler size={20} />
								{t("hopperCalibration")}
							</h2>
							<p className="mt-1 text-sm text-gray-500">{t("hopperCalibrationDesc")}</p>
						</div>

						<div className="mb-4 rounded-xl bg-blue-50 border border-blue-200 p-3">
							<p className="text-xs text-blue-700 font-medium">
								Current level: <strong>{energyDevice.feedLevelPercent ?? "—"}%</strong>
							</p>
						</div>

						<HopperCalibrationForm
							deviceId={energyDevice.id}
							hopperFullCm={energyDevice.hopperFullCm}
							hopperEmptyCm={energyDevice.hopperEmptyCm}
							hopperCapacityG={energyDevice.hopperCapacityG}
							canWrite={writeAccess}
						/>
					</section>
				)}

				{/* Duration Calibration */}
				{energyDevice && (
					<section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm dark:border-gray-700/50 dark:bg-gray-900">
						<div className="mb-6 border-b border-gray-100 pb-4 dark:border-gray-700/50">
							<h2 className="flex items-center gap-2 text-xl font-semibold text-gray-800 dark:text-gray-100">
								<Timer size={20} />
								{t("calibration.title")}
							</h2>
							<p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
								{t("calibration.desc")}
							</p>
						</div>

						<DurationCalibrationForm
							deviceId={energyDevice.id}
							currentGramsPerSecond={energyDevice.gramsPerSecond}
							currentGramsPerFeeding={energyDevice.gramsPerFeeding}
							canWrite={writeAccess}
							isOffline={isDeviceOffline}
							isFallow={pondIsFallow}
						/>
					</section>
				)}

				{/* Temperature Calibration */}
				{energyDevice && (
					<section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
						<div className="mb-6 border-b border-gray-100 pb-4">
							<h2 className="flex items-center gap-2 text-xl font-semibold text-gray-800">
								<Thermometer size={20} />
								Temperature Calibration
							</h2>
							<p className="mt-1 text-sm text-gray-500">
								Apply an offset to correct DS18B20 sensor readings
							</p>
						</div>

						<div className="mb-4 rounded-xl bg-sky-50 border border-sky-200 p-3">
							<p className="text-xs text-sky-700 font-medium">
								Current offset:{" "}
								<strong>
									{energyDevice.tempOffsetC >= 0 ? "+" : ""}
									{energyDevice.tempOffsetC}°C
								</strong>
								{energyDevice.waterTempC !== null && (
									<>
										{" "}
										&middot; Last reading: <strong>{energyDevice.waterTempC?.toFixed(1)}°C</strong>
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
					</section>
				)}

				{/* Device Actions */}
				<section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm dark:border-gray-700/50 dark:bg-gray-900">
					<div className="mb-6 border-b border-gray-100 pb-4 dark:border-gray-700/50">
						<h2 className="flex items-center gap-2 text-xl font-semibold text-gray-800 dark:text-gray-100">
							<RefreshCw size={20} />
							{t("deviceActions")}
						</h2>
						<p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
							{t("deviceActionsDesc")}
						</p>
					</div>

					<p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
						{t("actionsUnavailable")}
					</p>

					<div className="space-y-3">
						<button
							type="button"
							disabled
							className="flex min-h-[var(--ofd-touch-min)] w-full cursor-not-allowed items-center justify-between rounded-xl border border-[#0A3D62]/10 bg-white px-4 font-bold text-[#0A3D62] opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
						>
							<span className="flex items-center gap-3">
								<RefreshCw className="h-5 w-5 text-[#E85A2A]" />
								{t("syncNow")}
							</span>
							<svg
								className="h-5 w-5 text-[#3D5568]"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								role="img"
								aria-label="Navigate"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M9 5l7 7-7 7"
								/>
							</svg>
						</button>
						<button
							type="button"
							disabled
							className="flex min-h-[var(--ofd-touch-min)] w-full cursor-not-allowed items-center justify-between rounded-xl border border-red-100 bg-red-50 px-4 font-bold text-[#C42B3A] opacity-50 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300"
						>
							<span className="flex items-center gap-3">
								<Cpu className="h-5 w-5" />
								{t("restartDevice")}
							</span>
							<svg
								className="h-5 w-5"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								role="img"
								aria-label="Navigate"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M9 5l7 7-7 7"
								/>
							</svg>
						</button>
					</div>
				</section>
			</div>
		</div>
	);
}
