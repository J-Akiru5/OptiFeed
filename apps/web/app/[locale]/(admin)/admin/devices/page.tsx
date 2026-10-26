import { DeviceTokenReveal } from "@/components/admin/device-token-reveal";
import { Link, getPathname } from "@/i18n/routing";
import { getDevices } from "@/lib/actions/admin";
import { OFFLINE_THRESHOLD_MS } from "@/lib/constants";
import { Cpu, Printer, Wifi, WifiOff } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

const LABELS_HREF = "/admin/devices/labels";
const LABEL_FORM_ID = "device-label-form";

export default async function AdminDevicesPage() {
	const devices = await getDevices();
	const t = await getTranslations("dashboard.adminDevices");
	const locale = await getLocale();

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-black text-[#0A3D62]">Device Management</h1>
				<p className="text-sm text-[#3D5568] mt-1">
					{devices.length} device{devices.length !== 1 ? "s" : ""} registered
				</p>
			</div>

			{devices.length > 0 && (
				// Plain GET form: the row checkboxes join it through their `form`
				// attribute, so selection needs no client JS and the token-reveal
				// buttons are not nested inside a form.
				<form id={LABEL_FORM_ID} action={getPathname({ href: LABELS_HREF, locale })} method="get">
					<button
						type="submit"
						className="inline-flex items-center gap-2 rounded-xl border border-[#0A3D62]/20 bg-white px-4 py-2 text-xs font-black text-[#0A3D62] transition-colors hover:bg-[#F4F7F6]"
					>
						<Printer className="w-4 h-4" />
						{t("printSelected")}
					</button>
				</form>
			)}

			<div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-gray-100 bg-[#F4F7F6]">
								<th className="text-left px-6 py-3 font-black text-[#3D5568] uppercase text-[10px] tracking-wider">
									Device
								</th>
								<th className="text-left px-6 py-3 font-black text-[#3D5568] uppercase text-[10px] tracking-wider">
									{t("deviceIdMac")}
								</th>
								<th className="text-left px-6 py-3 font-black text-[#3D5568] uppercase text-[10px] tracking-wider">
									Status
								</th>
								<th className="text-left px-6 py-3 font-black text-[#3D5568] uppercase text-[10px] tracking-wider">
									Pond
								</th>
								<th className="text-left px-6 py-3 font-black text-[#3D5568] uppercase text-[10px] tracking-wider">
									Feed Level
								</th>
								<th className="text-left px-6 py-3 font-black text-[#3D5568] uppercase text-[10px] tracking-wider">
									Last Seen
								</th>
								<th className="text-left px-6 py-3 font-black text-[#3D5568] uppercase text-[10px] tracking-wider">
									{t("tokenColumn")}
								</th>
								<th className="text-left px-6 py-3 font-black text-[#3D5568] uppercase text-[10px] tracking-wider">
									{t("labelColumn")}
								</th>
							</tr>
						</thead>
						<tbody>
							{devices.map((device) => {
								const now = new Date();
								const isOffline =
									!device.lastSeenAt ||
									now.getTime() - device.lastSeenAt.getTime() > OFFLINE_THRESHOLD_MS;

								return (
									<tr
										key={device.id}
										className="border-b border-gray-50 hover:bg-[#F4F7F6]/50 transition-colors"
									>
										<td className="px-6 py-4">
											<div className="flex items-center gap-3">
												<div className="w-9 h-9 rounded-xl bg-[#0A3D62] flex items-center justify-center">
													<Cpu className="w-4 h-4 text-white" />
												</div>
												<div>
													<p className="font-black text-[#0A3D62]">{device.label}</p>
													<p className="text-[11px] text-[#3D5568]">
														{device.gramsPerFeeding}g/feeding
													</p>
												</div>
											</div>
										</td>
										<td className="px-6 py-4">
											<p className="font-mono text-xs font-bold text-[#3D5568]">{device.mac}</p>
											<p className="mt-0.5 text-[10px] text-[#3D5568]/80">{t("deviceIdMacHint")}</p>
										</td>
										<td className="px-6 py-4">
											<span
												className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
													isOffline ? "bg-red-100 text-[#C42B3A]" : "bg-green-100 text-[#1E7B34]"
												}`}
											>
												{isOffline ? <WifiOff className="w-3 h-3" /> : <Wifi className="w-3 h-3" />}
												{isOffline ? "Offline" : "Online"}
											</span>
										</td>
										<td className="px-6 py-4 text-xs font-bold text-[#3D5568]">
											{device.pond?.name || "Unassigned"}
										</td>
										<td className="px-6 py-4">
											<div className="flex items-center gap-2">
												<div className="w-16 bg-gray-200 h-1.5 rounded-full overflow-hidden">
													<div
														className={`h-full rounded-full ${
															(device.feedLevelPercent ?? 0) < 20 ? "bg-[#E85A2A]" : "bg-[#1E7B34]"
														}`}
														style={{ width: `${device.feedLevelPercent ?? 0}%` }}
													/>
												</div>
												<span className="text-[11px] font-bold text-[#3D5568]">
													{device.feedLevelPercent ?? 0}%
												</span>
											</div>
										</td>
										<td className="px-6 py-4 text-xs text-[#3D5568]">
											{device.lastSeenAt ? device.lastSeenAt.toLocaleString() : "Never"}
										</td>
										<td className="px-6 py-4">
											<DeviceTokenReveal deviceId={device.id} deviceLabel={device.label} />
										</td>
										<td className="px-6 py-4">
											<div className="flex items-center gap-3">
												<input
													type="checkbox"
													form={LABEL_FORM_ID}
													name="id"
													value={device.id}
													aria-label={t("selectForLabel", { label: device.label })}
													className="h-4 w-4 accent-[#0A3D62]"
												/>
												<Link
													href={{ pathname: LABELS_HREF, query: { id: device.id } }}
													className="inline-flex items-center gap-1.5 rounded-xl border border-[#0A3D62]/20 px-3 py-2 text-xs font-black text-[#0A3D62] transition-colors hover:bg-[#F4F7F6]"
												>
													<Printer className="w-3.5 h-3.5" />
													{t("printLabel")}
												</Link>
											</div>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>

				{devices.length === 0 && (
					<div className="text-center py-12 text-[#3D5568]">
						<Cpu className="w-12 h-12 mx-auto mb-3 text-gray-300" />
						<p className="font-bold">No devices registered yet.</p>
					</div>
				)}
			</div>
		</div>
	);
}
