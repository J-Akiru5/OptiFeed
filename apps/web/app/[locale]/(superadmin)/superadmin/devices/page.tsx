import { DeviceSignalReading } from "@/components/device-signal";
import { FeedLevelDisplay } from "@/components/feed-level-display";
import { EntityCard } from "@/components/mobile/entity-card";
import { ListChips } from "@/components/mobile/list-chips";
import { StatusStrip } from "@/components/mobile/status-strip";
import { ListToolbar } from "@/components/superadmin/list-chrome";
import { RegisterDeviceForm } from "@/components/superadmin/register-device-form";
import {
	RemoteFeedProvider,
	RemoteFeederControl,
	RemoteFeederRow,
	RemoteFeederTrigger,
} from "@/components/superadmin/remote-feeder-control";
import { RotateDeviceToken } from "@/components/superadmin/rotate-device-token";
import {
	Badge,
	Card,
	EmptyState,
	PageHeader,
	SECONDARY_BUTTON,
	TableFrame,
} from "@/components/superadmin/ui";
import { ItemCardGrid } from "@/components/ui/item-card";
import { Pagination } from "@/components/ui/pagination";
import { ListView } from "@/components/ui/view-toggle";
import { Link, getPathname } from "@/i18n/routing";
import { getOrgPondOptions, listPlatformDevices } from "@/lib/actions/platform/devices";
import { formatDateTimeLocal } from "@/lib/date-local";
import { toHopperSnapshot } from "@/lib/device-hopper";
import {
	deviceListStatus,
	filterByStatus,
	isAttention,
	orderRows,
	parseAttention,
	parseDeviceStatusFilter,
	parseListOrder,
	summarizeStatuses,
} from "@/lib/mobile-list";
import { buildPageHref } from "@/lib/pagination";
import prisma from "@/lib/prisma";
import { getDeviceStatusPolicy } from "@/lib/settings/device-status";
import { Cpu, Printer, Signal, Wifi, WifiOff } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Fragment } from "react";

const LABELS_HREF = "/superadmin/devices/labels";
const LABEL_FORM_ID = "platform-device-label-form";

/** Columns in the device registry table; the expanded row spans all of them. */
const DEVICE_COLUMNS = 8;

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
	const status = parseDeviceStatusFilter(first(params.status));
	const order = parseListOrder(first(params.order));
	const attention = parseAttention(first(params.attention));

	const [devices, options, locale, t, tCommon, tMobile, tDates, statusPolicy] = await Promise.all([
		listPlatformDevices({ query, page }),
		getOrgPondOptions(),
		getLocale(),
		getTranslations("superadmin.devices"),
		getTranslations("superadmin.common"),
		getTranslations("dashboard.mobile"),
		getTranslations("dates"),
		getDeviceStatusPolicy(),
	]);
	const pageCount = Math.max(1, Math.ceil(devices.total / devices.pageSize));
	const firstRow = devices.total === 0 ? 0 : (devices.page - 1) * devices.pageSize + 1;
	const lastRow = Math.min(devices.page * devices.pageSize, devices.total);
	const now = Date.now();
	const hasRows = devices.rows.length > 0;

	// The allow-listed platform list select does not carry the hopper reading or
	// the reported signal, and this task must not change lib/actions. Read only
	// those fields for the devices on this page.
	const readings =
		devices.rows.length > 0
			? await prisma.energyDevice.findMany({
					where: { id: { in: devices.rows.map((device) => device.id) } },
					select: {
						id: true,
						feedLevelPercent: true,
						feedLevelUpdatedAt: true,
						wifiRssiDbm: true,
						wifiRssiUpdatedAt: true,
					},
				})
			: [];
	const feedLevelById = new Map(
		readings.map((row) => [
			row.id,
			{
				levelPercent: row.feedLevelPercent,
				updatedAt: row.feedLevelUpdatedAt,
				rssiDbm: row.wifiRssiDbm,
				rssiUpdatedAt: row.wifiRssiUpdatedAt,
			},
		]),
	);
	const hopperFor = (device: (typeof devices.rows)[number]) =>
		toHopperSnapshot(
			{
				id: device.id,
				lastSeenAt: device.lastSeenAt,
				feedLevelPercent: feedLevelById.get(device.id)?.levelPercent ?? null,
				feedLevelUpdatedAt: feedLevelById.get(device.id)?.updatedAt ?? null,
				wifiRssiDbm: feedLevelById.get(device.id)?.rssiDbm ?? null,
				wifiRssiUpdatedAt: feedLevelById.get(device.id)?.rssiUpdatedAt ?? null,
			},
			new Date(now),
			statusPolicy,
		);

	// Mobile status strip and chips (E26): grade the feeders on this page from
	// the heartbeat and the hopper reading, then filter and order them.
	const statusOf = (device: (typeof devices.rows)[number]) =>
		deviceListStatus(
			{
				lastSeenAt: device.lastSeenAt,
				feedLevelPercent: feedLevelById.get(device.id)?.levelPercent ?? null,
			},
			new Date(now),
			statusPolicy,
		);
	const counts = summarizeStatuses(devices.rows.map(statusOf));
	const visibleDevices = orderRows(
		filterByStatus(devices.rows, status, statusOf).filter(
			(device) => !attention || isAttention(statusOf(device)),
		),
		order,
		(device) => ({ name: device.label, status: statusOf(device) }),
		locale,
	);
	const statusLabels = {
		all: tMobile("status.all"),
		online: tMobile("status.online"),
		alarm: tMobile("status.alarm"),
		offline: tMobile("status.offline"),
	};
	const baseParams = {
		q: query || undefined,
		status: status === "all" ? undefined : status,
		order: order === "newest" ? undefined : order,
		attention: attention ? "1" : undefined,
	};

	const lastSeen = (value: Date | null) =>
		value ? formatDateTimeLocal(value, tDates).full : tCommon("never");

	return (
		<div className="space-y-6">
			<PageHeader
				title={t("title")}
				description={t("description", { count: devices.total })}
				actions={
					<Link href="/superadmin/fleet" className={SECONDARY_BUTTON}>
						{t("fleetMonitor")}
					</Link>
				}
			/>

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

			{hasRows && (
				<div className="space-y-2">
					<StatusStrip
						counts={counts}
						active={status}
						basePath="/superadmin/devices"
						params={baseParams}
						label={tMobile("status.label")}
						labels={statusLabels}
					/>
					<ListChips
						basePath="/superadmin/devices"
						params={baseParams}
						order={order}
						attention={attention}
						labels={{
							order: tMobile("order.label"),
							newest: tMobile("order.newest"),
							name: tMobile("order.name"),
							status: tMobile("order.status"),
							attention: tMobile("order.attention"),
							hint: tMobile("order.hint"),
						}}
					/>
				</div>
			)}

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
			) : visibleDevices.length === 0 ? (
				<Card>
					<EmptyState
						icon={Cpu}
						title={tMobile("status.emptyTitle")}
						description={tMobile("status.emptyDesc")}
						action={
							<Link
								href={buildPageHref("/superadmin/devices", { q: query || undefined }, 1)}
								className={SECONDARY_BUTTON}
							>
								{tMobile("status.clear")}
							</Link>
						}
					/>
				</Card>
			) : (
				<ListView
					pageKey="superadmin-devices"
					listLabel={tCommon("viewToggle.list")}
					cardsLabel={tCommon("viewToggle.cards")}
					toggleLabel={tCommon("viewToggle.label")}
				>
					<ItemCardGrid label={t("caption")}>
						{visibleDevices.map((device) => {
							const deviceStatus = statusOf(device);
							return (
								<EntityCard
									key={device.id}
									status={deviceStatus}
									statusLabel={statusLabels[deviceStatus]}
									title={device.label}
									subtitle={`${device.mac} · ${device.pond?.name ?? tCommon("unassigned")}`}
									icon={Cpu}
									metrics={[
										{
											label: t("columnFeedLevel"),
											value: (
												<FeedLevelDisplay
													levelPercent={hopperFor(device).levelPercent}
													updatedAt={hopperFor(device).levelUpdatedAt}
													isOffline={deviceStatus === "offline"}
													size="sm"
												/>
											),
										},
										{
											label: tCommon("organization"),
											value:
												device.orgs.length > 0
													? device.orgs.map((o) => o.name).join(", ")
													: tCommon("none"),
										},
										{
											label: t("columnSeen"),
											value: lastSeen(device.lastSeenAt),
										},
									]}
								>
									<label className="inline-flex items-center gap-2 text-[11px] font-bold text-[#3D5568] dark:text-slate-400">
										<input
											type="checkbox"
											form={LABEL_FORM_ID}
											name="id"
											value={device.id}
											aria-label={t("selectForSticker", { label: device.label })}
											className="h-4 w-4 accent-[#0A3D62]"
										/>
										{t("columnSelect")}
									</label>
									<Link
										href={{ pathname: LABELS_HREF, query: { id: device.id } }}
										data-help="superadmin-print-sticker"
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
								</EntityCard>
							);
						})}
					</ItemCardGrid>

					<RemoteFeedProvider>
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
							{visibleDevices.map((device) => {
								const hopper = hopperFor(device);
								const offline = hopper.isOffline;
								const weak = hopper.status === "weak";
								return (
									<Fragment key={device.id}>
										<tr className="border-b border-gray-50 dark:border-[#1B2740] align-top transition-colors last:border-0 hover:bg-[#F4F7F6] dark:hover:bg-[#162238]/50 dark:hover:bg-[#162238]/60">
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
													<p className="font-black text-[#0A3D62] dark:text-slate-100">
														{device.label}
													</p>
												</div>
											</td>
											<td className="px-6 py-4 font-mono text-xs font-bold text-[#3D5568] dark:text-slate-400">
												{device.mac}
											</td>
											<td className="px-6 py-4 text-xs font-bold text-[#3D5568] dark:text-slate-400">
												{device.orgs.length > 0
													? device.orgs.map((o) => o.name).join(", ")
													: tCommon("none")}
											</td>
											<td className="px-6 py-4 text-xs font-bold text-[#3D5568] dark:text-slate-400">
												{device.pond?.name ?? tCommon("unassigned")}
											</td>
											<td className="px-6 py-4">
												<FeedLevelDisplay
													levelPercent={hopperFor(device).levelPercent}
													updatedAt={hopperFor(device).levelUpdatedAt}
													isOffline={offline}
													size="sm"
												/>
											</td>
											<td className="px-6 py-4">
												<div className="space-y-1">
													<Badge
														tone={offline ? "danger" : weak ? "warning" : "success"}
														icon={offline ? WifiOff : weak ? Signal : Wifi}
													>
														{offline
															? tCommon("offline")
															: weak
																? tCommon("weak")
																: tCommon("online")}
													</Badge>
													<DeviceSignalReading
														rssiDbm={hopper.rssiDbm}
														className="text-[11px] font-bold text-[#3D5568] dark:text-slate-400"
													/>
													<p className="text-[11px] text-[#3D5568] dark:text-slate-400">
														{lastSeen(device.lastSeenAt)}
													</p>
												</div>
											</td>
											<td className="px-6 py-4">
												<div className="flex flex-col items-start gap-2">
													<Link
														href={{ pathname: LABELS_HREF, query: { id: device.id } }}
														data-help="superadmin-print-sticker"
														className={SECONDARY_BUTTON}
													>
														<Printer className="h-3.5 w-3.5" aria-hidden="true" />
														{t("printSticker")}
													</Link>
													<RotateDeviceToken deviceId={device.id} mac={device.mac} />
													{/* The panel opens in the full-width row below, so no
													    wide form ever sits in this cell (#213). */}
													<RemoteFeederTrigger deviceId={device.id} label={device.label} />
												</div>
											</td>
										</tr>
										<RemoteFeederRow
											deviceId={device.id}
											label={device.label}
											isPaused={device.isPaused}
											colSpan={DEVICE_COLUMNS}
										/>
									</Fragment>
								);
							})}
						</TableFrame>
					</RemoteFeedProvider>
				</ListView>
			)}

			<Pagination
				basePath="/superadmin/devices"
				params={baseParams}
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
