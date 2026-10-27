import { adminButtonPrimary, adminButtonSecondary } from "@/components/admin/admin-classes";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminTHead, AdminTable, AdminTd, AdminTh, AdminTr } from "@/components/admin/admin-table";
import { PondStatusToggle } from "@/components/admin/pond-status-toggle";
import { EntityCard } from "@/components/mobile/entity-card";
import { ListChips } from "@/components/mobile/list-chips";
import { StatusStrip } from "@/components/mobile/status-strip";
import { ItemCardGrid } from "@/components/ui/item-card";
import { Pagination } from "@/components/ui/pagination";
import { ListView } from "@/components/ui/view-toggle";
import { Link } from "@/i18n/routing";
import { getPonds } from "@/lib/actions/admin";
import {
	filterByStatus,
	isAttention,
	orderRows,
	parseAttention,
	parseDeviceStatusFilter,
	parseListOrder,
	pondListStatus,
	summarizeStatuses,
} from "@/lib/mobile-list";
import { buildPageHref, parsePage } from "@/lib/pagination";
import { Cpu, Droplets, Plus } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

const statusStyles: Record<string, { bg: string; text: string }> = {
	ACTIVE: {
		bg: "bg-green-100 dark:bg-green-950/50",
		text: "text-green-700 dark:text-green-300",
	},
	ARCHIVED: {
		bg: "bg-gray-200 dark:bg-gray-700",
		text: "text-[#3D5568] dark:text-gray-200",
	},
};

export default async function AdminPondsPage({
	searchParams,
}: {
	searchParams: Promise<{ page?: string; status?: string; order?: string; attention?: string }>;
}) {
	const params = await searchParams;
	const page = parsePage(params.page);
	const status = parseDeviceStatusFilter(params.status);
	const order = parseListOrder(params.order);
	const attention = parseAttention(params.attention);

	const [pondsPage, t, tCommon, tMobile, locale] = await Promise.all([
		getPonds({ page }),
		getTranslations("dashboard.adminPonds"),
		getTranslations("dashboard.adminCommon"),
		getTranslations("dashboard.mobile"),
		getLocale(),
	]);
	const ponds = pondsPage.rows;
	const pageCount = Math.max(1, Math.ceil(pondsPage.total / pondsPage.pageSize));
	const firstRow = pondsPage.total === 0 ? 0 : (pondsPage.page - 1) * pondsPage.pageSize + 1;
	const lastRow = Math.min(pondsPage.page * pondsPage.pageSize, pondsPage.total);

	// Mobile status strip (E26). A pond is graded by its feeders, so the strip
	// answers "which ponds need me?" rather than repeating the archive flag.
	const statusOf = (pond: (typeof ponds)[number]) =>
		pondListStatus(pond.energyDevices, new Date(), pond.status === "ARCHIVED");
	const counts = summarizeStatuses(ponds.map(statusOf));
	const visiblePonds = orderRows(
		filterByStatus(ponds, status, statusOf).filter(
			(pond) => !attention || isAttention(statusOf(pond)),
		),
		order,
		(pond) => ({ name: pond.name, status: statusOf(pond) }),
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

	return (
		<div className="space-y-6">
			<AdminPageHeader
				icon={Droplets}
				title={t("title")}
				description={t("desc", { count: pondsPage.total })}
				actions={
					<Link href="/admin/ponds/new" className={adminButtonPrimary}>
						<Plus aria-hidden="true" className="h-4 w-4" />
						{t("addPond")}
					</Link>
				}
			/>

			{ponds.length > 0 && (
				<div className="space-y-2">
					<StatusStrip
						counts={counts}
						active={status}
						basePath="/admin/ponds"
						params={baseParams}
						label={tMobile("status.label")}
						labels={statusLabels}
					/>
					<ListChips
						basePath="/admin/ponds"
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

			{ponds.length === 0 ? (
				<AdminEmptyState
					icon={Droplets}
					title={t("emptyTitle")}
					description={t("emptyDesc")}
					action={
						<Link href="/admin/ponds/new" className={adminButtonPrimary}>
							{t("emptyAction")}
						</Link>
					}
				/>
			) : visiblePonds.length === 0 ? (
				<div className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center dark:border-gray-700 dark:bg-gray-900">
					<p className="text-sm font-black text-[#0A3D62] dark:text-gray-100">
						{tMobile("status.emptyTitle")}
					</p>
					<p className="mt-1 text-xs text-[#3D5568] dark:text-gray-400">
						{tMobile("status.emptyDesc")}
					</p>
					<Link
						href={buildPageHref("/admin/ponds", {}, 1)}
						className={`${adminButtonSecondary} mt-4`}
					>
						{tMobile("status.clear")}
					</Link>
				</div>
			) : (
				<ListView
					pageKey="admin-ponds"
					listLabel={tCommon("viewToggle.list")}
					cardsLabel={tCommon("viewToggle.cards")}
					toggleLabel={tCommon("viewToggle.label")}
				>
					<AdminTable caption={t("caption")} minWidth="min-w-[52rem]">
						<AdminTHead>
							<AdminTh>{t("columnPond")}</AdminTh>
							<AdminTh>{tCommon("owner")}</AdminTh>
							<AdminTh>{t("feedsPerDay")}</AdminTh>
							<AdminTh>{tCommon("devices")}</AdminTh>
							<AdminTh>{t("logs")}</AdminTh>
							<AdminTh>{tCommon("actions")}</AdminTh>
						</AdminTHead>
						<tbody>
							{visiblePonds.map((pond) => (
								<AdminTr key={pond.id}>
									<AdminTd>
										<Link
											href={`/admin/ponds/${pond.id}`}
											className="font-black text-[#0A3D62] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:text-gray-100 dark:focus-visible:outline-[#8fc0ea]"
										>
											{pond.name}
										</Link>
										<p className="mt-0.5 font-mono text-[11px] text-[#3D5568] dark:text-gray-400">
											{t("idLabel", { id: pond.id.slice(0, 12) })}
										</p>
										<span
											className={`mt-1.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-black tracking-wider uppercase ${
												statusStyles[pond.status]?.bg ?? statusStyles.ACTIVE.bg
											} ${statusStyles[pond.status]?.text ?? statusStyles.ACTIVE.text}`}
										>
											{pond.status === "ARCHIVED" ? t("statusArchived") : t("statusActive")}
										</span>
									</AdminTd>
									<AdminTd>
										<p className="text-xs font-black text-[#0A3D62] dark:text-gray-100">
											{pond.owner?.displayName || pond.ownerId}
										</p>
										<p className="text-[11px] text-[#3D5568] dark:text-gray-400">
											{pond.farm ? `${tCommon("farm")}: ${pond.farm.name}` : pond.ownerId}
										</p>
									</AdminTd>
									<AdminTd className="text-xs font-bold text-[#0A3D62] tabular-nums dark:text-gray-100">
										{pond.feedsPerDay}
									</AdminTd>
									<AdminTd className="text-xs font-bold text-[#0A3D62] tabular-nums dark:text-gray-100">
										{pond.energyDevices.length}
									</AdminTd>
									<AdminTd>
										<p className="text-xs font-bold text-[#0A3D62] tabular-nums dark:text-gray-100">
											{pond._count.biomassLogs}
										</p>
										<p className="text-[10px] text-[#3D5568] dark:text-gray-400">
											{t("ownershipHistory", { count: pond._count.ownershipHistory })}
										</p>
									</AdminTd>
									<AdminTd>
										<div className="flex flex-wrap items-center gap-2">
											<Link href={`/admin/ponds/${pond.id}`} className={adminButtonSecondary}>
												{t("viewDetails")}
											</Link>
											<PondStatusToggle pondId={pond.id} status={pond.status} />
										</div>
									</AdminTd>
								</AdminTr>
							))}
						</tbody>
					</AdminTable>

					<ItemCardGrid label={t("caption")}>
						{visiblePonds.map((pond) => {
							const pondStatus = statusOf(pond);
							return (
								<EntityCard
									key={pond.id}
									status={pondStatus}
									statusLabel={statusLabels[pondStatus]}
									title={pond.name}
									subtitle={
										<>
											{pond.owner?.displayName || pond.ownerId}
											{pond.farm ? ` · ${pond.farm.name}` : ""}
										</>
									}
									href={`/admin/ponds/${pond.id}`}
									icon={Droplets}
									metrics={[
										{ label: tCommon("devices"), value: pond.energyDevices.length },
										{ label: t("feedsPerDay"), value: pond.feedsPerDay },
										{ label: t("logs"), value: pond._count.biomassLogs },
									]}
								>
									<span
										className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-black tracking-wider uppercase ${
											statusStyles[pond.status]?.bg ?? statusStyles.ACTIVE.bg
										} ${statusStyles[pond.status]?.text ?? statusStyles.ACTIVE.text}`}
									>
										{pond.status === "ARCHIVED" ? t("statusArchived") : t("statusActive")}
									</span>
									<Link
										href={`/admin/ponds/${pond.id}`}
										className={`${adminButtonSecondary} ml-auto`}
									>
										{t("viewDetails")}
									</Link>
									<PondStatusToggle pondId={pond.id} status={pond.status} />
								</EntityCard>
							);
						})}
					</ItemCardGrid>
				</ListView>
			)}

			{pondsPage.total > 0 && (
				<Pagination
					basePath="/admin/ponds"
					params={baseParams}
					page={pondsPage.page}
					pageCount={pageCount}
					showing={tCommon("pagination.showing", {
						from: firstRow,
						to: lastRow,
						total: pondsPage.total,
					})}
					previousLabel={tCommon("pagination.previous")}
					nextLabel={tCommon("pagination.next")}
					label={tCommon("pagination.label")}
				/>
			)}
		</div>
	);
}
