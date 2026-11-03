import { Badge } from "@/components/superadmin/ui";
import { formatDateTimeLocal } from "@/lib/date-local";
import type { OtaConfirmationState, OtaPolicyStatus } from "@/lib/settings/ota-policy";
import { getTranslations } from "next-intl/server";

/**
 * What the fleet reports back about the OTA policy (issue #660).
 *
 * The form above writes; this card is the evidence. Firmware 1.7.0+ echoes one
 * `config_rev` for the whole config it applied plus a `config_source`, so the
 * card can say whether a unit echoed a config after the last policy change and
 * whether it is running the server config, its own NVS copy or the compiled
 * defaults. It cannot show per-key device values, because the firmware never
 * sends them; the note at the bottom states that instead of implying more.
 */

const STATE_TONE: Record<OtaConfirmationState, "success" | "warning" | "neutral"> = {
	applied: "success",
	pending: "warning",
	reported: "neutral",
	never_reported: "neutral",
};

const STATE_LABEL: Record<OtaConfirmationState, string> = {
	applied: "state.applied",
	pending: "state.pending",
	reported: "state.reported",
	never_reported: "state.never_reported",
};

export async function OtaPolicyStatusCard({ status }: { status: OtaPolicyStatus }) {
	const [t, tDates] = await Promise.all([
		getTranslations("superadmin.settings.otaPolicy"),
		getTranslations("dates"),
	]);

	const when = (value: Date) => formatDateTimeLocal(value, tDates).full;

	return (
		<div className="mt-4 rounded-2xl border border-gray-200 dark:border-[#24304A] bg-[#F4F7F6] dark:bg-[#0B1220] p-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<h3 className="text-sm font-black text-[#0A3D62] dark:text-slate-100">
						{t("statusTitle")}
					</h3>
					<p className="mt-1 max-w-2xl text-xs text-[#3D5568] dark:text-slate-400">
						{t("statusDescription")}
					</p>
				</div>
				{status.changedAt && (
					<Badge tone="brand">{t("statusChangedAt", { when: when(status.changedAt) })}</Badge>
				)}
			</div>

			{!status.available ? (
				<p className="mt-3 text-xs font-bold text-[#B45309] dark:text-amber-300">
					{t("statusUnavailable")}
				</p>
			) : (
				<>
					<p className="mt-3 text-sm font-bold text-[#0A3D62] dark:text-slate-100">
						{status.changedAt
							? t("statusSummary", { applied: status.appliedCount, total: status.total })
							: t("statusNoChange")}
					</p>

					<div className="mt-2 flex flex-wrap gap-2">
						<Badge tone="success">{t("counts.applied", { count: status.appliedCount })}</Badge>
						<Badge tone="warning">{t("counts.pending", { count: status.pendingCount })}</Badge>
						<Badge tone="neutral">{t("counts.reported", { count: status.reportedCount })}</Badge>
						<Badge tone="neutral">
							{t("counts.never_reported", { count: status.neverReportedCount })}
						</Badge>
					</div>

					{status.devices.length === 0 ? (
						<p className="mt-3 text-xs text-[#3D5568] dark:text-slate-400">{t("statusEmpty")}</p>
					) : (
						<ul className="mt-3 divide-y divide-gray-200 dark:divide-[#24304A]">
							{status.devices.map((device) => (
								<li
									key={device.id}
									className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs"
								>
									<div className="min-w-0">
										<p className="truncate font-black text-[#0A3D62] dark:text-slate-100">
											{device.label}
										</p>
										<p className="text-[#3D5568] dark:text-slate-400">
											{t("rowMeta", {
												rev:
													device.reportedRev === null
														? t("revNone")
														: t("revValue", { rev: device.reportedRev }),
												source:
													device.configSource === "server"
														? t("sourceServer")
														: device.configSource === "nvs"
															? t("sourceNvs")
															: device.configSource === "default"
																? t("sourceDefault")
																: t("sourceUnknown"),
												confirmed: device.reportedAt
													? t("confirmedAt", { when: when(device.reportedAt) })
													: t("neverConfirmed"),
											})}
										</p>
									</div>
									<Badge tone={STATE_TONE[device.state]}>{t(STATE_LABEL[device.state])}</Badge>
								</li>
							))}
						</ul>
					)}

					{status.total > status.devices.length && (
						<p className="mt-2 text-[11px] text-[#3D5568] dark:text-slate-400">
							{t("statusAttention")}
						</p>
					)}
					{status.devicesTruncated && (
						<p className="mt-1 text-[11px] font-bold text-[#B45309] dark:text-amber-300">
							{t("statusTruncated")}
						</p>
					)}
				</>
			)}

			<p className="mt-3 text-[11px] text-[#3D5568] dark:text-slate-400">{t("statusNote")}</p>
		</div>
	);
}
