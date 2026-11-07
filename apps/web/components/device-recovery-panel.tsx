import type { DeviceRecoveryPlan, ResetCauseClass } from "@/lib/device-recovery-model";
import { cn } from "@/lib/utils";
import { Activity, AlertTriangle, Clock, HelpCircle, ShieldCheck, Wrench } from "lucide-react";

/**
 * Step-by-step hardware recovery panel (M2).
 *
 * Read-only on purpose. Safe mode is cleared in firmware — by the 30-minute
 * quiet window, or by the GPIO 17 Wi-Fi reset hold where the enclosure has that
 * button wired. The dashboard cannot clear it remotely, so this panel never
 * offers a button that would pretend to. It shows what the unit reported, what
 * has to happen, and whether dose testing is available.
 *
 * Synchronous on purpose: the page already awaits its translator, and an async
 * child would suspend when the page is rendered to static markup in tests.
 */

/** The slice of next-intl's translator this panel needs. */
export type RecoveryTranslator = (key: string, values?: Record<string, string | number>) => string;

const CAUSE_KEYS: Record<ResetCauseClass, string> = {
	power: "causePower",
	controller: "causeController",
	watchdog: "causeWatchdog",
	software: "causeSoftware",
	external: "causeExternal",
	power_on: "causePowerOn",
	deep_sleep: "causeDeepSleep",
	sdio: "causeSdio",
	unknown: "causeUnknown",
};

const CHECK_KEYS = {
	heartbeat: "verifyHeartbeat",
	connectivity: "verifyConnectivity",
	sensors: "verifySensors",
	firmware: "verifyFirmware",
} as const;

const CHECK_STATUS_KEYS = {
	pass: "checkPass",
	fail: "checkFail",
	unknown: "checkUnknown",
} as const;

const STATE_KEYS = {
	HEALTHY: "stateHealthy",
	SAFE_MODE: "stateSafeMode",
	RECOVERING: "stateRecovering",
	OFFLINE: "stateOffline",
	FAULT: "stateFault",
	MAINTENANCE: "stateMaintenance",
} as const;

const CALIBRATION_KEYS = {
	safe_mode: "calibrationSafeMode",
	recovering: "calibrationRecovering",
	fault: "calibrationFault",
	offline: "calibrationOffline",
	maintenance: "calibrationMaintenance",
	allowed: "calibrationAllowed",
} as const;

const STATE_TONES = {
	HEALTHY:
		"border-[#1E7B34]/25 bg-[#1E7B34]/10 text-[#1E7B34] dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-300",
	SAFE_MODE:
		"border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300",
	RECOVERING:
		"border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300",
	OFFLINE:
		"border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300",
	FAULT:
		"border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200",
	MAINTENANCE:
		"border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300",
} as const;

const CHECK_TONES = {
	pass: "text-[#1E7B34] dark:text-green-300",
	fail: "text-[#C42B3A] dark:text-red-300",
	unknown: "text-[#9A3412] dark:text-amber-300",
} as const;

function formatUptime(t: RecoveryTranslator, seconds: number | null): string | null {
	if (seconds === null) return null;
	const totalMinutes = Math.floor(seconds / 60);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return hours > 0 ? t("uptimeHours", { hours, minutes }) : t("uptimeValue", { minutes });
}

export function DeviceRecoveryPanel({
	plan,
	t,
}: {
	plan: DeviceRecoveryPlan;
	t: RecoveryTranslator;
}) {
	if (plan.state === null) {
		return (
			<div
				className="rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/50 dark:bg-amber-950/30"
				data-testid="device-recovery-panel"
				data-recovery-state="unavailable"
			>
				<p className="flex items-center gap-2 text-sm font-black text-amber-800 dark:text-amber-300">
					<HelpCircle className="size-4 shrink-0" aria-hidden="true" />
					{t("title")}
				</p>
				<p className="mt-2 text-sm font-bold text-amber-800 dark:text-amber-300">
					{t("unavailableTitle")}
				</p>
				<p className="mt-1 text-xs font-semibold text-amber-800 dark:text-amber-300">
					{t("unavailableBody")}
				</p>
			</div>
		);
	}

	const state = plan.state;
	const uptime = formatUptime(t, plan.diagnosis.uptimeS);
	const remainingMinutes = Math.ceil(plan.quiet.remainingMs / 60_000);
	const requiredMinutes = Math.round(plan.quiet.requiredMs / 60_000);
	const calibrationKey = plan.calibration.code === null ? "allowed" : plan.calibration.code;

	return (
		<section
			className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-[#24304A] dark:bg-[#111A2C]"
			aria-labelledby="device-recovery-title"
			data-testid="device-recovery-panel"
			data-recovery-state={state}
		>
			<header className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2
						id="device-recovery-title"
						className="flex items-center gap-2 text-sm font-black text-[#0A3D62] dark:text-gray-100"
					>
						<Wrench className="size-4 shrink-0 text-[#E85A2A]" aria-hidden="true" />
						{t("title")}
					</h2>
					<p className="mt-1 text-xs font-medium text-[#3D5568] dark:text-gray-400">{t("desc")}</p>
				</div>
				<p className={cn("rounded-full border px-3 py-1 text-xs font-black", STATE_TONES[state])}>
					{t(STATE_KEYS[state])}
				</p>
			</header>

			<dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				<div className="rounded-xl bg-[#F4F7F6] p-3 dark:bg-gray-800/60">
					<dt className="text-[10px] font-bold uppercase tracking-wide text-[#3D5568] dark:text-gray-400">
						{t("causeTitle")}
					</dt>
					<dd className="mt-1 text-xs font-bold text-[#0A3D62] dark:text-gray-100">
						{plan.diagnosis.causes.length === 0
							? t("causeNone")
							: plan.diagnosis.causes.map((cause) => t(CAUSE_KEYS[cause])).join(" ")}
					</dd>
				</div>
				<div className="rounded-xl bg-[#F4F7F6] p-3 dark:bg-gray-800/60">
					<dt className="text-[10px] font-bold uppercase tracking-wide text-[#3D5568] dark:text-gray-400">
						{t("uptimeLabel")}
					</dt>
					<dd className="mt-1 text-xs font-bold text-[#0A3D62] dark:text-gray-100">
						{uptime ?? "—"}
					</dd>
				</div>
				<div className="rounded-xl bg-[#F4F7F6] p-3 dark:bg-gray-800/60">
					<dt className="text-[10px] font-bold uppercase tracking-wide text-[#3D5568] dark:text-gray-400">
						{t("abnormalLabel")}
					</dt>
					<dd className="mt-1 text-xs font-bold text-[#0A3D62] dark:text-gray-100">
						{plan.diagnosis.abnormalResets ?? "—"}
					</dd>
				</div>
				<div className="rounded-xl bg-[#F4F7F6] p-3 dark:bg-gray-800/60">
					<dt className="text-[10px] font-bold uppercase tracking-wide text-[#3D5568] dark:text-gray-400">
						{t("safeModeLabel")}
					</dt>
					<dd className="mt-1 text-xs font-bold text-[#0A3D62] dark:text-gray-100">
						{plan.diagnosis.safeMode ? t("on") : t("off")}
					</dd>
				</div>
			</dl>

			{plan.repeatReset?.abnormalSince ? (
				<div
					role="alert"
					className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/30"
					data-testid="device-recovery-repeat"
				>
					<p className="flex items-center gap-2 text-sm font-black text-red-800 dark:text-red-300">
						<AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
						{t("repeatTitle")}
					</p>
					<p className="mt-1 text-xs font-semibold text-red-800 dark:text-red-300">
						{t("repeatBody")}
					</p>
				</div>
			) : null}

			<div className="mt-4 grid gap-4 lg:grid-cols-2">
				<div>
					<p className="flex items-center gap-2 text-xs font-black text-[#0A3D62] dark:text-gray-100">
						<Clock className="size-4 shrink-0 text-[#E85A2A]" aria-hidden="true" />
						{t("quietTitle")}
					</p>
					<p className="mt-1 text-xs font-semibold text-[#3D5568] dark:text-gray-300">
						{plan.quiet.basis === "unknown"
							? t("quietUnknown")
							: plan.quiet.satisfied
								? t("quietDone", { required: requiredMinutes })
								: t("quietRemaining", {
										minutes: remainingMinutes,
										required: requiredMinutes,
									})}
					</p>
					<p
						className={cn(
							"mt-2 text-xs font-black",
							plan.safeToRecover
								? "text-[#1E7B34] dark:text-green-300"
								: "text-[#9A3412] dark:text-amber-300",
						)}
					>
						{plan.safeToRecover ? t("safeToRecover") : t("notSafeToRecover")}
					</p>
				</div>

				<div>
					<p className="flex items-center gap-2 text-xs font-black text-[#0A3D62] dark:text-gray-100">
						<ShieldCheck className="size-4 shrink-0 text-[#E85A2A]" aria-hidden="true" />
						{t("verifyTitle")}
					</p>
					<ul className="mt-1 space-y-1">
						{plan.checks.map((check) => (
							<li
								key={check.id}
								className="flex items-center justify-between gap-3 text-xs font-semibold"
								data-check={check.id}
								data-check-status={check.status}
							>
								<span className="text-[#3D5568] dark:text-gray-300">{t(CHECK_KEYS[check.id])}</span>
								<span className={cn("font-black", CHECK_TONES[check.status])}>
									{t(CHECK_STATUS_KEYS[check.status])}
								</span>
							</li>
						))}
					</ul>
				</div>
			</div>

			<div className="mt-4 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
				<p className="text-xs font-black text-[#0A3D62] dark:text-gray-100">{t("clearTitle")}</p>
				<dl className="mt-2 space-y-2">
					<div>
						<dt className="text-xs font-bold text-[#3D5568] dark:text-gray-300">
							{t("clearQuiet")}
						</dt>
						<dd className="mt-0.5 text-xs font-medium text-[#3D5568] dark:text-gray-400">
							{t("clearQuietBody", { required: requiredMinutes })}
						</dd>
					</div>
					<div>
						<dt className="text-xs font-bold text-[#3D5568] dark:text-gray-300">
							{t("clearHold")}
						</dt>
						<dd className="mt-0.5 text-xs font-medium text-[#3D5568] dark:text-gray-400">
							{t("clearHoldBody")}
						</dd>
						<dd className="mt-1 text-xs font-medium text-[#9A3412] dark:text-amber-300">
							{t("clearHoldUnknown")}
						</dd>
					</div>
				</dl>
			</div>

			<p
				className={cn(
					"mt-4 flex items-center gap-2 rounded-xl border px-4 py-3 text-xs font-bold",
					plan.calibration.allowed
						? "border-[#1E7B34]/25 bg-[#1E7B34]/10 text-[#1E7B34] dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-300"
						: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300",
				)}
				data-testid="device-recovery-calibration"
			>
				<Activity className="size-4 shrink-0" aria-hidden="true" />
				<span className="font-black">{t("calibrationTitle")}: </span>
				{t(CALIBRATION_KEYS[calibrationKey])}
			</p>
		</section>
	);
}
