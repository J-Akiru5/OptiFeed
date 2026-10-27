import { FeedLevelDisplay } from "@/components/feed-level-display";
import { ListToolbar } from "@/components/superadmin/list-chrome";
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
import { Pagination } from "@/components/ui/pagination";
import { Link, getPathname } from "@/i18n/routing";
import { getOrgPondOptions, listPlatformDevices } from "@/lib/actions/platform/devices";
import { OFFLINE_THRESHOLD_MS } from "@/lib/constants";
import { formatDateTimeLocal } from "@/lib/date-local";
import prisma from "@/lib/prisma";
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

	const [devices, options, locale, t, tCommon, tDates] = await Promise.all([
		listPlatformDevices({ query, page }),
		getOrgPondOptions(),
		getLocale(),
		getTranslations("superadmin.devices"),
		getTranslations("superadmin.common"),
		getTranslations("dates"),
	]);
	const pageCount = Math.max(1, Math.ceil(devices.total / devices.pageSize));
	const firstRow = devices.total === 0 ? 0 : (devices.page - 1) * devices.pageSize + 1;
	const lastRow = Math.min(devices.page * devices.pageSize, devices.total);
	const now = Date.now();
	const hasRows = devices.rows.length > 0;

	// The allow-listed platform list select does not carry the hopper reading,
	// and this task must not change lib/actions. Read only those fields for the
	// devices on this page.
	const readings =
		devices.rows.length > 0
			? await prisma.energyDevice.findMany({
					where: { id: { in: devices.rows.map((device) => device.id) } },
					select: { id: true, feedLevelPercent: true, feedLevelUpdatedAt: true },
				})
			: [];
	const feedLevelById = new Map(
		readings.map((row) => [
			row.id,
			{ levelPercent: row.feedLevelPercent, updatedAt: row.feedLevelUpdatedAt },
		]),
	);

	const lastSeen = (value: Date | null) =>
		value ? formatDateTimeLocal(value, tDates).full : tCommon("never");

	return (
		<div className="space-y-6">
			<PageHeader title={t("title")} description={t("description", { count: devices.total })} />

			<RegisterDeviceForm options={options} />

			<ListToolbar
				id="devices"
				action={getPathname({ href: "/superadmin/devices", locale })}
				query={query}
				label={t("searchLabel")}
				placeholder={t("searchPlaceholder")}
				searchLabel={tCommon("search")}
			>
				{hasRows && (
					// Row checkboxes join this GET form through their `form` attribute,
					// so selection needs no client JS and no form nests the row actions.
					<form id={LABEL_FORM_ID} action={getPathname({ href: LABELS_HREF, locale })} method="get">
						<button type="submit" className={SECONDARY_BUTTON}>
							<Printer className="h-4 w-4" aria-hidden="true" />
							{t("printSelected")}
						</button>
					</form>
				)}
			</ListToolbar>

			{devices.rows.length === 0 ? (
				<Card>
					<EmptyState
						icon={Cpu}
						title={query ? t("emptyQuery", { query }) : t("emptyTitle")}
						description={query ? t("emptyQueryDesc") : t("emptyDesc")}
						action={
							query ? (
								<Link href="/superadmin/devices" className={SECONDARY_BUTTON}>
									{tCommon("clearSearch")}
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
											aria-label={t("selectForSticker", { label: device.label })}
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
												{offline ? tCommon("offline") : tCommon("online")}
											</Badge>
										</div>
									</div>

									<dl className="grid grid-cols-2 gap-2">
										<MetaPair label={tCommon("organization")}>
											{device.orgs.length > 0
												? device.orgs.map((o) => o.name).join(", ")
												: tCommon("none")}
										</MetaPair>
										<MetaPair label={tCommon("pond")}>
											{device.pond?.name ?? tCommon("unassigned")}
										</MetaPair>
										<MetaPair label={t("columnFeedLevel")}>
											<FeedLevelDisplay
												levelPercent={feedLevelById.get(device.id)?.levelPercent ?? null}
												updatedAt={feedLevelById.get(device.id)?.updatedAt ?? null}
												isOffline={offline}
												size="sm"
											/>
										</MetaPair>
									</dl>
									<p className="text-[11px] text-[#3D5568]">
										{t("lastSeen", { time: lastSeen(device.lastSeenAt) })}
									</p>

									<div className="flex flex-col items-start gap-2">
										<Link
											href={{ pathname: LABELS_HREF, query: { id: device.id } }}
											className={SECONDARY_BUTTON}
										>
											<Printer className="h-3.5 w-3.5" aria-hidden="true" />
											{t("printSticker")}
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
						label={t("caption")}
						minWidth="min-w-[64rem]"
						columns={[
							{ key: "select", label: t("columnSelect") },
							{ key: "device", label: t("columnDevice") },
							{ key: "mac", label: t("columnMac") },
							{ key: "org", label: t("columnOrg") },
							{ key: "pond", label: t("columnPond") },
							{ key: "feed", label: t("columnFeedLevel") },
							{ key: "seen", label: t("columnSeen") },
							{ key: "actions", label: t("columnActions") },
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
											aria-label={t("selectForSticker", { label: device.label })}
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
										{device.orgs.length > 0
											? device.orgs.map((o) => o.name).join(", ")
											: tCommon("none")}
									</td>
									<td className="px-6 py-4 text-xs font-bold text-[#3D5568]">
										{device.pond?.name ?? tCommon("unassigned")}
									</td>
									<td className="px-6 py-4">
										<FeedLevelDisplay
											levelPercent={feedLevelById.get(device.id)?.levelPercent ?? null}
											updatedAt={feedLevelById.get(device.id)?.updatedAt ?? null}
											isOffline={offline}
											size="sm"
										/>
									</td>
									<td className="px-6 py-4">
										<div className="space-y-1">
											<Badge tone={offline ? "danger" : "success"} icon={offline ? WifiOff : Wifi}>
												{offline ? tCommon("offline") : tCommon("online")}
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
												{t("printSticker")}
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

			<Pagination
				basePath="/superadmin/devices"
				params={{ q: query || undefined }}
				page={devices.page}
				pageCount={pageCount}
				showing={tCommon("pagination.showing", {
					from: firstRow,
					to: lastRow,
					total: devices.total,
				})}
				previousLabel={tCommon("previous")}
				nextLabel={tCommon("next")}
				label={tCommon("pagination.label")}
			/>
		</div>
	);
}
