import { ListPagination, ListToolbar } from "@/components/superadmin/list-chrome";
import { RegisterDeviceForm } from "@/components/superadmin/register-device-form";
import { RemoteFeederControl } from "@/components/superadmin/remote-feeder-control";
import { RotateDeviceToken } from "@/components/superadmin/rotate-device-token";
import {
	Badge,
	Card,
	EmptyState,
	MetaPair,
	MobileCard,
	PageHeader,
	SECONDARY_BUTTON,
	TableFrame,
} from "@/components/superadmin/ui";
import { Link, getPathname } from "@/i18n/routing";
import { getOrgPondOptions, listPlatformDevices } from "@/lib/actions/platform/devices";
import { OFFLINE_THRESHOLD_MS } from "@/lib/constants";
import { formatDateTimeLocal } from "@/lib/date-local";
import { Cpu, Printer, Wifi, WifiOff } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

const LABELS_HREF = "/superadmin/devices/labels";
const LABEL_FORM_ID = "platform-device-label-form";

function first(param: string | string[] | undefined): string | undefined {
	return Array.isArray(param) ? param[0] : param;
}

/**
 * Platform device registry (plan v2, M3F) with god-mode remote control (M5.2,
 * decision D1): every feeder on the platform, registration with org + pond
 * (T15), token rotation, sticker printing, and manual feed / pause / resume.
 *
 * Remote commands go through the tenant command implementation, so the §6
 * server caps apply and there is no force flag.
 */
export default async function SuperadminDevicesPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const params = await searchParams;
	const query = first(params.q)?.trim() ?? "";
	const page = Number.parseInt(first(params.page) ?? "1", 10) || 1;

	const [devices, options, locale, tDates] = await Promise.all([
		listPlatformDevices({ query, page }),
		getOrgPondOptions(),
		getLocale(),
		getTranslations("dates"),
	]);
	const pageCount = Math.max(1, Math.ceil(devices.total / devices.pageSize));
	const now = Date.now();
	const hasRows = devices.rows.length > 0;

	const pageHref = (target: number) => ({
		pathname: "/superadmin/devices" as const,
		query: { ...(query ? { q: query } : {}), page: String(target) },
	});

	const lastSeen = (value: Date | null) =>
		value ? formatDateTimeLocal(value, tDates).full : "Never";

	return (
		<div className="space-y-6">
			<PageHeader
				title="Devices"
				description={`${devices.total} device${devices.total !== 1 ? "s" : ""} on the platform. Register units, rotate tokens, print stickers, and control any feeder remotely. Remote commands use the same server caps and audit trail as the tenant console.`}
			/>

			<RegisterDeviceForm options={options} />

			<ListToolbar
				id="devices"
				action={getPathname({ href: "/superadmin/devices", locale })}
				query={query}
				label="Search devices by MAC or label"
				placeholder="Search MAC or label"
			>
				{hasRows && (
					// Row checkboxes join this GET form through their `form` attribute,
					// so selection needs no client JS and no form nests the row actions.
					<form id={LABEL_FORM_ID} action={getPathname({ href: LABELS_HREF, locale })} method="get">
						<button type="submit" className={SECONDARY_BUTTON}>
							<Printer className="h-4 w-4" aria-hidden="true" />
							Print selected stickers
						</button>
					</form>
				)}
			</ListToolbar>

			{devices.rows.length === 0 ? (
				<Card>
					<EmptyState
						icon={Cpu}
						title={query ? `No device matches “${query}”.` : "No devices registered yet."}
						description={
							query
								? "Try a different MAC address or label."
								: "Register the first unit above with its chip MAC and the pond it serves."
						}
						action={
							query ? (
								<Link href="/superadmin/devices" className={SECONDARY_BUTTON}>
									Clear search
								</Link>
							) : undefined
						}
					/>
				</Card>
			) : (
				<>
					<ul className="space-y-3 md:hidden">
						{devices.rows.map((device) => {
							const offline =
								!device.lastSeenAt || now - device.lastSeenAt.getTime() > OFFLINE_THRESHOLD_MS;
							return (
								<MobileCard key={device.id}>
									<div className="flex items-start gap-3">
										<input
											type="checkbox"
											form={LABEL_FORM_ID}
											name="id"
											value={device.id}
											aria-label={`Select ${device.label} for sticker printing`}
											className="mt-1 h-4 w-4 shrink-0 accent-[#0A3D62]"
										/>
										<div className="flex min-w-0 flex-1 items-start justify-between gap-2">
											<div className="min-w-0">
												<p className="truncate font-black text-[#0A3D62]">{device.label}</p>
												<p className="truncate font-mono text-[11px] font-bold text-[#3D5568]">
													{device.mac}
												</p>
											</div>
											<Badge tone={offline ? "danger" : "success"} icon={offline ? WifiOff : Wifi}>
												{offline ? "Offline" : "Online"}
											</Badge>
										</div>
									</div>

									<dl className="grid grid-cols-2 gap-2">
										<MetaPair label="Organization">
											{device.orgs.length > 0 ? device.orgs.map((o) => o.name).join(", ") : "—"}
										</MetaPair>
										<MetaPair label="Pond">{device.pond?.name ?? "Unassigned"}</MetaPair>
									</dl>
									<p className="text-[11px] text-[#3D5568]">
										Last seen:{" "}
										<span className="font-bold text-[#0A3D62]">{lastSeen(device.lastSeenAt)}</span>
									</p>

									<div className="flex flex-col items-start gap-2">
										<Link
											href={{ pathname: LABELS_HREF, query: { id: device.id } }}
											className={SECONDARY_BUTTON}
										>
											<Printer className="h-3.5 w-3.5" aria-hidden="true" />
											Print sticker
										</Link>
										<RotateDeviceToken deviceId={device.id} mac={device.mac} />
										<RemoteFeederControl
											deviceId={device.id}
											label={device.label}
											isPaused={device.isPaused}
										/>
									</div>
								</MobileCard>
							);
						})}
					</ul>

					<TableFrame
						className="hidden md:block"
						label="Platform device registry"
						minWidth="min-w-[64rem]"
						columns={[
							{ key: "select", label: "Select" },
							{ key: "device", label: "Device" },
							{ key: "mac", label: "Chip MAC" },
							{ key: "org", label: "Organization" },
							{ key: "pond", label: "Pond" },
							{ key: "seen", label: "Last seen" },
							{ key: "actions", label: "Actions" },
						]}
					>
						{devices.rows.map((device) => {
							const offline =
								!device.lastSeenAt || now - device.lastSeenAt.getTime() > OFFLINE_THRESHOLD_MS;
							return (
								<tr
									key={device.id}
									className="border-b border-gray-50 align-top transition-colors last:border-0 hover:bg-[#F4F7F6]/50"
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
											<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0A3D62] text-white">
												<Cpu className="h-4 w-4" aria-hidden="true" />
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
									<td className="px-6 py-4">
										<div className="space-y-1">
											<Badge tone={offline ? "danger" : "success"} icon={offline ? WifiOff : Wifi}>
												{offline ? "Offline" : "Online"}
											</Badge>
											<p className="text-[11px] text-[#3D5568]">{lastSeen(device.lastSeenAt)}</p>
										</div>
									</td>
									<td className="px-6 py-4">
										<div className="flex flex-col items-start gap-2">
											<Link
												href={{ pathname: LABELS_HREF, query: { id: device.id } }}
												className={SECONDARY_BUTTON}
											>
												<Printer className="h-3.5 w-3.5" aria-hidden="true" />
												Print sticker
											</Link>
											<RotateDeviceToken deviceId={device.id} mac={device.mac} />
											<RemoteFeederControl
												deviceId={device.id}
												label={device.label}
												isPaused={device.isPaused}
											/>
										</div>
									</td>
								</tr>
							);
						})}
					</TableFrame>
				</>
			)}

			<ListPagination
				label="Device pages"
				page={devices.page}
				pageCount={pageCount}
				previousHref={devices.page > 1 ? pageHref(devices.page - 1) : null}
				nextHref={devices.page < pageCount ? pageHref(devices.page + 1) : null}
			/>
		</div>
	);
}
