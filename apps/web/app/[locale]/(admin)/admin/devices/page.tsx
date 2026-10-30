import { AddFeederForm } from "@/components/admin/add-feeder-form";
import { adminButtonSecondary } from "@/components/admin/admin-classes";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminTHead, AdminTable, AdminTd, AdminTh, AdminTr } from "@/components/admin/admin-table";
import { DeviceTokenReveal } from "@/components/admin/device-token-reveal";
import { PendingDeviceApprovals } from "@/components/admin/pending-device-approvals";
import { FeedLevelDisplay } from "@/components/feed-level-display";
import { EntityCard } from "@/components/mobile/entity-card";
import { ListChips } from "@/components/mobile/list-chips";
import { StatusStrip } from "@/components/mobile/status-strip";
import { ItemCardGrid } from "@/components/ui/item-card";
import { Pagination } from "@/components/ui/pagination";
import { ListView } from "@/components/ui/view-toggle";
import { Link, getPathname } from "@/i18n/routing";
import { getDevices, getPendingDevices } from "@/lib/actions/admin";
import { getTenantRegistrationOptions } from "@/lib/actions/device-registration";
import { hasPermission } from "@/lib/auth/permissions";
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
import { buildPageHref, parsePage } from "@/lib/pagination";
import prisma from "@/lib/prisma";
import { getDeviceStatusPolicy } from "@/lib/settings/device-status";
import { Cpu, Eye, Printer, Signal, Wifi, WifiOff } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

const LABELS_HREF = "/admin/devices/labels";
const LABEL_FORM_ID = "device-label-form";

export default async function AdminDevicesPage({
	searchParams,
}: {
	searchParams: Promise<{ page?: string; status?: string; order?: string; attention?: string }>;
}) {
	const params = await searchParams;
	const page = parsePage(params.page);
	const status = parseDeviceStatusFilter(params.status);
	const order = parseListOrder(params.order);
	const attention = parseAttention(params.attention);
	const [devicesPage, canClaim, t, tCommon, tMobile, tDates, locale, statusPolicy] =
		await Promise.all([
			getDevices({ page }),
			hasPermission("claim_feeder"),
			getTranslations("dashboard.adminDevices"),
			getTranslations("dashboard.adminCommon"),
			getTranslations("dashboard.mobile"),
			getTranslations("dates"),
			getLocale(),
			getDeviceStatusPolicy(),
		]);
	const devices = devicesPage.rows;
	const pageCount = Math.max(1, Math.ceil(devicesPage.total / devicesPage.pageSize));
	const firstRow = devicesPage.total === 0 ? 0 : (devicesPage.page - 1) * devicesPage.pageSize + 1;
	const lastRow = Math.min(devicesPage.page * devicesPage.pageSize, devicesPage.total);

	// Registration options are only read for a member who may actually add a
	// feeder; the action re-checks the same guard.
	const registrationOptions = canClaim ? await getTenantRegistrationOptions() : null;
	// The table query excludes pending units; the approval queue reads them
	// separately so its rows and the pager totals cannot disagree.
	const pendingDevices = canClaim ? await getPendingDevices() : [];

	// Mobile status strip (E26): grade the feeders on this page, then filter and
	// order them. The pending queue above stays unaffected.
	const now = new Date();
	const statusOf = (device: (typeof devices)[number]) =>
		deviceListStatus(device, now, statusPolicy);
	const counts = summarizeStatuses(devices.map(statusOf));
	const visibleDevices = orderRows(
		filterByStatus(devices, status, statusOf).filter(
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
		status: status === "all" ? undefined : status,
		order: order === "newest" ? undefined : order,
		attention: attention ? "1" : undefined,
	};

	const lastSeen = (date: Date | null) =>
		date ? formatDateTimeLocal(date, tDates).full : tCommon("never");

	// `getDevices` is an allow-listed display select without the reading
	// timestamp, so read only that one field for the page's devices here.
	const readingTimes =
		devices.length > 0
			? await prisma.energyDevice.findMany({
					where: { id: { in: devices.map((device) => device.id) } },
					select: { id: true, feedLevelUpdatedAt: true },
				})
			: [];
	const feedLevelUpdatedAt = new Map(readingTimes.map((row) => [row.id, row.feedLevelUpdatedAt]));

	return (
		<div className="space-y-6" data-help="admin-devices-list">
			<AdminPageHeader
				icon={Cpu}
				title={t("title")}
				description={t("desc", { count: devicesPage.total })}
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

			{devices.length > 0 && (
				<div className="space-y-2">
					<StatusStrip
						counts={counts}
						active={status}
						basePath="/admin/devices"
						params={baseParams}
						label={tMobile("status.label")}
						labels={statusLabels}
					/>
					<ListChips
						basePath="/admin/devices"
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

			{registrationOptions && (
				<div id="add-feeder" className="scroll-mt-24">
					<AddFeederForm options={registrationOptions} />
				</div>
			)}

			{canClaim && (
				<PendingDeviceApprovals
					devices={pendingDevices.map((device) => ({
						id: device.id,
						label: device.label,
						mac: device.mac,
						pondName: device.pond?.name ?? null,
					}))}
				/>
			)}

			{devices.length === 0 && pendingDevices.length === 0 && (
				<AdminEmptyState icon={Cpu} title={t("emptyTitle")} description={t("emptyDesc")} />
			)}

			{devices.length > 0 && visibleDevices.length === 0 && (
				<div className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center dark:border-gray-700 dark:bg-gray-900">
					<p className="text-sm font-black text-[#0A3D62] dark:text-gray-100">
						{tMobile("status.emptyTitle")}
					</p>
					<p className="mt-1 text-xs text-[#3D5568] dark:text-gray-400">
						{tMobile("status.emptyDesc")}
					</p>
					<Link
						href={buildPageHref("/admin/devices", {}, 1)}
						className={`${adminButtonSecondary} mt-4`}
					>
						{tMobile("status.clear")}
					</Link>
				</div>
			)}

			{visibleDevices.length > 0 && (
				<ListView
					pageKey="admin-devices"
					listLabel={tCommon("viewToggle.list")}
					cardsLabel={tCommon("viewToggle.cards")}
					toggleLabel={tCommon("viewToggle.label")}
				>
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
							{visibleDevices.map((device) => {
								const now = new Date();
								const hopper = toHopperSnapshot(
									{
										...device,
										feedLevelUpdatedAt: feedLevelUpdatedAt.get(device.id) ?? null,
									},
									now,
									statusPolicy,
								);
								const isOffline = hopper.isOffline;
								const isWeak = hopper.status === "weak";

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
													{device.approvalStatus === "REJECTED" && (
														<p className="mt-1 inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-black tracking-wider text-[#C42B3A] uppercase dark:bg-red-950/50 dark:text-red-300">
															{t("rejectedBadge")}
														</p>
													)}
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
														: isWeak
															? "bg-amber-100 text-[#9A3412] dark:bg-amber-950/50 dark:text-amber-300"
															: "bg-green-100 text-[#1E7B34] dark:bg-green-950/50 dark:text-green-300"
												}`}
											>
												{isOffline ? (
													<WifiOff aria-hidden="true" className="h-3 w-3" />
												) : isWeak ? (
													<Signal aria-hidden="true" className="h-3 w-3" />
												) : (
													<Wifi aria-hidden="true" className="h-3 w-3" />
												)}
												{isOffline
													? tCommon("offline")
													: isWeak
														? tCommon("weak")
														: tCommon("online")}
											</span>
										</AdminTd>
										<AdminTd className="text-xs font-bold text-[#3D5568] dark:text-gray-300">
											{device.pond?.name || t("unassigned")}
										</AdminTd>
										<AdminTd>
											<FeedLevelDisplay
												levelPercent={hopper.levelPercent}
												updatedAt={hopper.levelUpdatedAt}
												isOffline={hopper.isOffline}
												size="sm"
											/>
										</AdminTd>
										<AdminTd className="text-xs whitespace-nowrap text-[#3D5568] dark:text-gray-400">
											{lastSeen(device.lastSeenAt)}
										</AdminTd>
										<AdminTd>
											{device.approvalStatus === "APPROVED" ? (
												<DeviceTokenReveal deviceId={device.id} deviceLabel={device.label} />
											) : (
												<span className="text-xs font-bold text-[#3D5568] dark:text-gray-400">
													{t("rejectedBadge")}
												</span>
											)}
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
													data-help="print-label"
													className={adminButtonSecondary}
												>
													<Printer aria-hidden="true" className="h-3.5 w-3.5" />
													{t("printLabel")}
												</Link>
												<Link
													href={`/dashboard/devices/${device.id}`}
													className={adminButtonSecondary}
												>
													<Eye aria-hidden="true" className="h-3.5 w-3.5" />
													{t("view3d")}
												</Link>
											</div>
										</AdminTd>
									</AdminTr>
								);
							})}
						</tbody>
					</AdminTable>

					<ItemCardGrid label={t("caption")}>
						{visibleDevices.map((device) => {
							const deviceStatus = statusOf(device);
							const hopper = toHopperSnapshot(
								{
									...device,
									feedLevelUpdatedAt: feedLevelUpdatedAt.get(device.id) ?? null,
								},
								new Date(),
								statusPolicy,
							);

							return (
								<EntityCard
									key={device.id}
									status={deviceStatus}
									statusLabel={statusLabels[deviceStatus]}
									title={device.label}
									subtitle={`${device.mac} · ${device.pond?.name || t("unassigned")}`}
									icon={Cpu}
									metrics={[
										{
											label: t("columnFeedLevel"),
											value: (
												<FeedLevelDisplay
													levelPercent={hopper.levelPercent}
													updatedAt={hopper.levelUpdatedAt}
													isOffline={deviceStatus === "offline"}
													size="sm"
												/>
											),
										},
										{
											label: t("columnLastSeen"),
											value: lastSeen(device.lastSeenAt),
										},
										{
											label: t("perFeedingLabel"),
											value: device.gramsPerFeeding,
										},
									]}
								>
									{device.approvalStatus === "APPROVED" ? (
										<DeviceTokenReveal deviceId={device.id} deviceLabel={device.label} />
									) : (
										<p className="text-xs font-bold text-[#3D5568] dark:text-gray-400">
											{t("rejectedBadge")}
										</p>
									)}
									<label className="ml-auto inline-flex items-center gap-2 text-[11px] font-bold text-[#3D5568] dark:text-gray-300">
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
										data-help="print-label"
										className={adminButtonSecondary}
									>
										<Printer aria-hidden="true" className="h-3.5 w-3.5" />
										{t("printLabel")}
									</Link>
									<Link href={`/dashboard/devices/${device.id}`} className={adminButtonSecondary}>
										<Eye aria-hidden="true" className="h-3.5 w-3.5" />
										{t("view3d")}
									</Link>
								</EntityCard>
							);
						})}
					</ItemCardGrid>
				</ListView>
			)}

			{devicesPage.total > 0 && (
				<Pagination
					basePath="/admin/devices"
					params={baseParams}
					page={devicesPage.page}
					pageCount={pageCount}
					showing={tCommon("pagination.showing", {
						from: firstRow,
						to: lastRow,
						total: devicesPage.total,
					})}
					previousLabel={tCommon("pagination.previous")}
					nextLabel={tCommon("pagination.next")}
					label={tCommon("pagination.label")}
				/>
			)}
		</div>
	);
}
