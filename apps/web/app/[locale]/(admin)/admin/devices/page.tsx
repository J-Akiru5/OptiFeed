import { adminButtonSecondary } from "@/components/admin/admin-classes";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import {
	AdminCard,
	AdminCardList,
	AdminCardRow,
	AdminTHead,
	AdminTable,
	AdminTd,
	AdminTh,
	AdminTr,
} from "@/components/admin/admin-table";
import { DeviceTokenReveal } from "@/components/admin/device-token-reveal";
import { Link, getPathname } from "@/i18n/routing";
import { getDevices } from "@/lib/actions/admin";
import { OFFLINE_THRESHOLD_MS } from "@/lib/constants";
import { formatDateTimeLocal } from "@/lib/date-local";
import { Cpu, Printer, Wifi, WifiOff } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

const LABELS_HREF = "/admin/devices/labels";
const LABEL_FORM_ID = "device-label-form";

export default async function AdminDevicesPage() {
	const [devices, t, tCommon, tDates, locale] = await Promise.all([
		getDevices(),
		getTranslations("dashboard.adminDevices"),
		getTranslations("dashboard.adminCommon"),
		getTranslations("dates"),
		getLocale(),
	]);

	const lastSeen = (date: Date | null) =>
		date ? formatDateTimeLocal(date, tDates).full : tCommon("never");

	return (
		<div className="space-y-6">
			<AdminPageHeader
				icon={Cpu}
				title={t("title")}
				description={t("desc", { count: devices.length })}
				actions={
					devices.length > 0 ? (
						// Plain GET form: the row checkboxes join it through their `form`
						// attribute, so selection needs no client JS and the token-reveal
						// buttons are not nested inside a form.
						<form
							id={LABEL_FORM_ID}
							action={getPathname({ href: LABELS_HREF, locale })}
							method="get"
						>
							<button type="submit" className={adminButtonSecondary}>
								<Printer aria-hidden="true" className="h-4 w-4" />
								{t("printSelected")}
							</button>
						</form>
					) : undefined
				}
			/>

			{devices.length === 0 ? (
				<AdminEmptyState icon={Cpu} title={t("emptyTitle")} description={t("emptyDesc")} />
			) : (
				<>
					<AdminTable caption={t("caption")} minWidth="min-w-[64rem]">
						<AdminTHead>
							<AdminTh>{t("columnDevice")}</AdminTh>
							<AdminTh>{t("deviceIdMac")}</AdminTh>
							<AdminTh>{t("columnStatus")}</AdminTh>
							<AdminTh>{t("columnPond")}</AdminTh>
							<AdminTh>{t("columnFeedLevel")}</AdminTh>
							<AdminTh>{t("columnLastSeen")}</AdminTh>
							<AdminTh>{t("tokenColumn")}</AdminTh>
							<AdminTh>{t("labelColumn")}</AdminTh>
						</AdminTHead>
						<tbody>
							{devices.map((device) => {
								const now = new Date();
								const isOffline =
									!device.lastSeenAt ||
									now.getTime() - device.lastSeenAt.getTime() > OFFLINE_THRESHOLD_MS;
								const feedLevel = device.feedLevelPercent ?? 0;

								return (
									<AdminTr key={device.id}>
										<AdminTd>
											<div className="flex items-center gap-3">
												<div
													aria-hidden="true"
													className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0A3D62]"
												>
													<Cpu className="h-4 w-4 text-white" />
												</div>
												<div className="min-w-0">
													<p className="font-black text-[#0A3D62] dark:text-gray-100">
														{device.label}
													</p>
													<p className="text-[11px] text-[#3D5568] dark:text-gray-400">
														{t("perFeeding", { grams: device.gramsPerFeeding })}
													</p>
												</div>
											</div>
										</AdminTd>
										<AdminTd>
											<p className="font-mono text-xs font-bold text-[#3D5568] dark:text-gray-300">
												{device.mac}
											</p>
											<p className="mt-0.5 text-[10px] text-[#3D5568] dark:text-gray-400">
												{t("deviceIdMacHint")}
											</p>
										</AdminTd>
										<AdminTd>
											<span
												className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black tracking-wider uppercase ${
													isOffline
														? "bg-red-100 text-[#C42B3A] dark:bg-red-950/50 dark:text-red-300"
														: "bg-green-100 text-[#1E7B34] dark:bg-green-950/50 dark:text-green-300"
												}`}
											>
												{isOffline ? (
													<WifiOff aria-hidden="true" className="h-3 w-3" />
												) : (
													<Wifi aria-hidden="true" className="h-3 w-3" />
												)}
												{isOffline ? tCommon("offline") : tCommon("online")}
											</span>
										</AdminTd>
										<AdminTd className="text-xs font-bold text-[#3D5568] dark:text-gray-300">
											{device.pond?.name || t("unassigned")}
										</AdminTd>
										<AdminTd>
											<div className="flex items-center gap-2">
												<div
													aria-hidden="true"
													className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
												>
													<div
														className={`h-full rounded-full ${
															feedLevel < 20 ? "bg-[#E85A2A]" : "bg-[#1E7B34]"
														}`}
														style={{ width: `${feedLevel}%` }}
													/>
												</div>
												<span className="text-[11px] font-bold text-[#3D5568] tabular-nums dark:text-gray-300">
													{feedLevel}%
												</span>
											</div>
										</AdminTd>
										<AdminTd className="text-xs whitespace-nowrap text-[#3D5568] dark:text-gray-400">
											{lastSeen(device.lastSeenAt)}
										</AdminTd>
										<AdminTd>
											<DeviceTokenReveal deviceId={device.id} deviceLabel={device.label} />
										</AdminTd>
										<AdminTd>
											<div className="flex items-center gap-3">
												<input
													type="checkbox"
													form={LABEL_FORM_ID}
													name="id"
													value={device.id}
													aria-label={t("selectForLabel", { label: device.label })}
													className="h-4 w-4 accent-[#0A3D62] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea]"
												/>
												<Link
													href={{ pathname: LABELS_HREF, query: { id: device.id } }}
													className={adminButtonSecondary}
												>
													<Printer aria-hidden="true" className="h-3.5 w-3.5" />
													{t("printLabel")}
												</Link>
											</div>
										</AdminTd>
									</AdminTr>
								);
							})}
						</tbody>
					</AdminTable>

					<AdminCardList>
						{devices.map((device) => {
							const now = new Date();
							const isOffline =
								!device.lastSeenAt ||
								now.getTime() - device.lastSeenAt.getTime() > OFFLINE_THRESHOLD_MS;
							const feedLevel = device.feedLevelPercent ?? 0;

							return (
								<AdminCard key={device.id}>
									<div className="flex items-start justify-between gap-3">
										<div className="min-w-0">
											<p className="truncate font-black text-[#0A3D62] dark:text-gray-100">
												{device.label}
											</p>
											<p className="text-[11px] text-[#3D5568] dark:text-gray-400">
												{t("perFeeding", { grams: device.gramsPerFeeding })}
											</p>
										</div>
										<span
											className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black tracking-wider uppercase ${
												isOffline
													? "bg-red-100 text-[#C42B3A] dark:bg-red-950/50 dark:text-red-300"
													: "bg-green-100 text-[#1E7B34] dark:bg-green-950/50 dark:text-green-300"
											}`}
										>
											{isOffline ? (
												<WifiOff aria-hidden="true" className="h-3 w-3" />
											) : (
												<Wifi aria-hidden="true" className="h-3 w-3" />
											)}
											{isOffline ? tCommon("offline") : tCommon("online")}
										</span>
									</div>

									<div className="mt-3 border-t border-gray-100 pt-2 dark:border-gray-800">
										<AdminCardRow label={t("deviceIdMac")}>
											<span className="font-mono">{device.mac}</span>
										</AdminCardRow>
										<AdminCardRow label={t("columnPond")}>
											{device.pond?.name || t("unassigned")}
										</AdminCardRow>
										<AdminCardRow label={t("columnFeedLevel")}>{feedLevel}%</AdminCardRow>
										<AdminCardRow label={t("columnLastSeen")}>
											{lastSeen(device.lastSeenAt)}
										</AdminCardRow>
									</div>

									<div className="mt-3 space-y-3">
										<DeviceTokenReveal deviceId={device.id} deviceLabel={device.label} />
										<div className="flex flex-wrap items-center gap-3">
											<label className="inline-flex items-center gap-2 text-[11px] font-bold text-[#3D5568] dark:text-gray-300">
												<input
													type="checkbox"
													form={LABEL_FORM_ID}
													name="id"
													value={device.id}
													aria-label={t("selectForLabel", { label: device.label })}
													className="h-4 w-4 accent-[#0A3D62] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea]"
												/>
												{t("labelColumn")}
											</label>
											<Link
												href={{ pathname: LABELS_HREF, query: { id: device.id } }}
												className={adminButtonSecondary}
											>
												<Printer aria-hidden="true" className="h-3.5 w-3.5" />
												{t("printLabel")}
											</Link>
										</div>
									</div>
								</AdminCard>
							);
						})}
					</AdminCardList>
				</>
			)}
		</div>
	);
}
