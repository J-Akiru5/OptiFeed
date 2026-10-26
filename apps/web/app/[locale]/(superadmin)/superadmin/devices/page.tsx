import { RegisterDeviceForm } from "@/components/superadmin/register-device-form";
import { RotateDeviceToken } from "@/components/superadmin/rotate-device-token";
import { Link, getPathname } from "@/i18n/routing";
import { getOrgPondOptions, listPlatformDevices } from "@/lib/actions/platform/devices";
import { OFFLINE_THRESHOLD_MS } from "@/lib/constants";
import { Cpu, Printer, Search } from "lucide-react";
import { getLocale } from "next-intl/server";

const LABELS_HREF = "/superadmin/devices/labels";
const LABEL_FORM_ID = "platform-device-label-form";

function first(param: string | string[] | undefined): string | undefined {
	return Array.isArray(param) ? param[0] : param;
}

/**
 * Platform device registry (plan v2, M3F): every feeder on the platform,
 * registration with org + pond (T15), token rotation, and sticker printing.
 *
 * Inventory only: nothing here feeds, schedules or controls a feeder. Farm
 * operations stay in the tenant console.
 */
export default async function SuperadminDevicesPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const params = await searchParams;
	const query = first(params.q)?.trim() ?? "";
	const page = Number.parseInt(first(params.page) ?? "1", 10) || 1;

	const [devices, options, locale] = await Promise.all([
		listPlatformDevices({ query, page }),
		getOrgPondOptions(),
		getLocale(),
	]);
	const pageCount = Math.max(1, Math.ceil(devices.total / devices.pageSize));
	const now = Date.now();

	const pageHref = (target: number) => ({
		pathname: "/superadmin/devices",
		query: { ...(query ? { q: query } : {}), page: String(target) },
	});

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-black text-[#0A3D62]">Devices</h1>
				<p className="text-sm text-[#3D5568] mt-1">
					{devices.total} device{devices.total !== 1 ? "s" : ""} on the platform. Register units,
					rotate tokens and print stickers. Feeding stays in each tenant&apos;s console.
				</p>
			</div>

			<RegisterDeviceForm options={options} />

			<div className="flex flex-wrap items-center justify-between gap-3">
				<form
					action={getPathname({ href: "/superadmin/devices", locale })}
					method="get"
					className="flex items-center gap-2"
				>
					<input
						name="q"
						defaultValue={query}
						placeholder="Search MAC or label"
						aria-label="Search devices by MAC or label"
						className="w-64 px-3 py-2 bg-white text-[#0A3D62] border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
					/>
					<button
						type="submit"
						className="inline-flex items-center gap-1.5 rounded-xl border border-[#0A3D62]/20 bg-white px-3 py-2 text-xs font-black text-[#0A3D62] hover:bg-[#F4F7F6]"
					>
						<Search className="w-3.5 h-3.5" />
						Search
					</button>
				</form>

				{devices.rows.length > 0 && (
					// Row checkboxes join this GET form through their `form` attribute,
					// so selection needs no client JS and no form nests the row actions.
					<form id={LABEL_FORM_ID} action={getPathname({ href: LABELS_HREF, locale })} method="get">
						<button
							type="submit"
							className="inline-flex items-center gap-2 rounded-xl border border-[#0A3D62]/20 bg-white px-4 py-2 text-xs font-black text-[#0A3D62] hover:bg-[#F4F7F6]"
						>
							<Printer className="w-4 h-4" />
							Print selected stickers
						</button>
					</form>
				)}
			</div>

			<div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-gray-100 bg-[#F4F7F6]">
								{["", "Device", "Chip MAC", "Organization", "Pond", "Last seen", "Actions"].map(
									(h, i) => (
										<th
											key={h || `col-${i}`}
											className="text-left px-6 py-3 font-black text-[#3D5568] uppercase text-[10px] tracking-wider"
										>
											{h}
										</th>
									),
								)}
							</tr>
						</thead>
						<tbody>
							{devices.rows.map((device) => {
								const offline =
									!device.lastSeenAt || now - device.lastSeenAt.getTime() > OFFLINE_THRESHOLD_MS;
								return (
									<tr
										key={device.id}
										className="border-b border-gray-50 align-top hover:bg-[#F4F7F6]/50 transition-colors"
									>
										<td className="px-6 py-4">
											<input
												type="checkbox"
												form={LABEL_FORM_ID}
												name="id"
												value={device.id}
												aria-label={`Select ${device.label} for sticker printing`}
												className="h-4 w-4 accent-[#0A3D62]"
											/>
										</td>
										<td className="px-6 py-4">
											<div className="flex items-center gap-3">
												<div className="w-9 h-9 rounded-xl bg-[#0A3D62] flex items-center justify-center text-white">
													<Cpu className="w-4 h-4" />
												</div>
												<p className="font-black text-[#0A3D62]">{device.label}</p>
											</div>
										</td>
										<td className="px-6 py-4 font-mono text-xs font-bold text-[#3D5568]">
											{device.mac}
										</td>
										<td className="px-6 py-4 text-xs font-bold text-[#3D5568]">
											{device.orgs.length > 0 ? device.orgs.map((o) => o.name).join(", ") : "—"}
										</td>
										<td className="px-6 py-4 text-xs font-bold text-[#3D5568]">
											{device.pond?.name ?? "Unassigned"}
										</td>
										<td className="px-6 py-4 text-xs">
											<span
												className={
													offline ? "text-[#C42B3A] font-bold" : "text-[#1E7B34] font-bold"
												}
											>
												{device.lastSeenAt ? device.lastSeenAt.toLocaleString() : "Never"}
											</span>
										</td>
										<td className="px-6 py-4">
											<div className="flex flex-col items-start gap-2">
												<Link
													href={{ pathname: LABELS_HREF, query: { id: device.id } }}
													className="inline-flex items-center gap-1.5 rounded-xl border border-[#0A3D62]/20 px-3 py-2 text-xs font-black text-[#0A3D62] hover:bg-[#F4F7F6]"
												>
													<Printer className="w-3.5 h-3.5" />
													Print sticker
												</Link>
												<RotateDeviceToken deviceId={device.id} mac={device.mac} />
											</div>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>

				{devices.rows.length === 0 && (
					<p className="p-6 text-sm text-[#3D5568]">
						{query ? `No device matches “${query}”.` : "No devices registered yet."}
					</p>
				)}
			</div>

			{pageCount > 1 && (
				<nav aria-label="Device pages" className="flex items-center gap-3 text-xs font-black">
					{devices.page > 1 && (
						<Link href={pageHref(devices.page - 1)} className="text-[#0A3D62] hover:underline">
							← Previous
						</Link>
					)}
					<span className="text-[#3D5568]">
						Page {devices.page} of {pageCount}
					</span>
					{devices.page < pageCount && (
						<Link href={pageHref(devices.page + 1)} className="text-[#0A3D62] hover:underline">
							Next →
						</Link>
					)}
				</nav>
			)}
		</div>
	);
}
