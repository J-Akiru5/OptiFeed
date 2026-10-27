import { adminButtonPrimary, adminButtonSecondary } from "@/components/admin/admin-classes";
import { AdminEmptyState } from "@/components/admin/admin-empty-state";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import {
	AdminCard,
	AdminTHead,
	AdminTable,
	AdminTd,
	AdminTh,
	AdminTr,
} from "@/components/admin/admin-table";
import { PondStatusToggle } from "@/components/admin/pond-status-toggle";
import { ItemCardGrid } from "@/components/ui/item-card";
import { Pagination } from "@/components/ui/pagination";
import { ListView } from "@/components/ui/view-toggle";
import { Link } from "@/i18n/routing";
import { getPonds } from "@/lib/actions/admin";
import { parsePage } from "@/lib/pagination";
import { Cpu, Droplets, Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";

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
	searchParams: Promise<{ page?: string }>;
}) {
	const params = await searchParams;
	const page = parsePage(params.page);
	const [pondsPage, t, tCommon] = await Promise.all([
		getPonds({ page }),
		getTranslations("dashboard.adminPonds"),
		getTranslations("dashboard.adminCommon"),
	]);
	const ponds = pondsPage.rows;
	const pageCount = Math.max(1, Math.ceil(pondsPage.total / pondsPage.pageSize));
	const firstRow = pondsPage.total === 0 ? 0 : (pondsPage.page - 1) * pondsPage.pageSize + 1;
	const lastRow = Math.min(pondsPage.page * pondsPage.pageSize, pondsPage.total);

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
							{ponds.map((pond) => (
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
						{ponds.map((pond) => (
							<li
								key={pond.id}
								className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700/60 dark:bg-gray-900"
							>
								<div className="flex items-start justify-between gap-3">
									<div className="min-w-0">
										<div className="flex min-w-0 flex-wrap items-center gap-2">
											<h2 className="truncate text-lg font-black text-[#0A3D62] dark:text-gray-100">
												<Link
													href={`/admin/ponds/${pond.id}`}
													className="underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] dark:focus-visible:outline-[#8fc0ea]"
												>
													{pond.name}
												</Link>
											</h2>
											<span
												className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-black tracking-wider uppercase ${
													statusStyles[pond.status]?.bg ?? statusStyles.ACTIVE.bg
												} ${statusStyles[pond.status]?.text ?? statusStyles.ACTIVE.text}`}
											>
												{pond.status === "ARCHIVED" ? t("statusArchived") : t("statusActive")}
											</span>
										</div>
										<p className="mt-0.5 font-mono text-[11px] text-[#3D5568] dark:text-gray-400">
											{t("idLabel", { id: pond.id.slice(0, 12) })}
										</p>
									</div>
									<span
										aria-hidden="true"
										className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0A3D62]/10 dark:bg-white/10"
									>
										<Droplets className="h-5 w-5 text-[#0A3D62] dark:text-[#8fc0ea]" />
									</span>
								</div>

								<dl className="grid grid-cols-2 gap-3 text-xs">
									<div className="rounded-xl bg-[#F4F7F6] p-2.5 dark:bg-gray-800">
										<dt className="text-[10px] font-black tracking-wider text-[#3D5568] uppercase dark:text-gray-400">
											{tCommon("owner")}
										</dt>
										<dd className="mt-0.5 font-bold break-words text-[#0A3D62] dark:text-gray-100">
											{pond.owner?.displayName || pond.ownerId}
										</dd>
										{pond.farm && (
											<dd className="mt-0.5 text-[10px] text-[#3D5568] dark:text-gray-400">
												{tCommon("farm")}: {pond.farm.name}
											</dd>
										)}
									</div>
									<div className="rounded-xl bg-[#F4F7F6] p-2.5 dark:bg-gray-800">
										<dt className="text-[10px] font-black tracking-wider text-[#3D5568] uppercase dark:text-gray-400">
											{t("feedsPerDay")}
										</dt>
										<dd className="mt-0.5 font-bold text-[#0A3D62] tabular-nums dark:text-gray-100">
											{pond.feedsPerDay}
										</dd>
									</div>
									<div className="rounded-xl bg-[#F4F7F6] p-2.5 dark:bg-gray-800">
										<dt className="text-[10px] font-black tracking-wider text-[#3D5568] uppercase dark:text-gray-400">
											{tCommon("devices")}
										</dt>
										<dd className="mt-0.5 flex items-center gap-1 font-bold text-[#0A3D62] tabular-nums dark:text-gray-100">
											<Cpu aria-hidden="true" className="h-3 w-3" />
											{pond.energyDevices.length}
										</dd>
									</div>
									<div className="rounded-xl bg-[#F4F7F6] p-2.5 dark:bg-gray-800">
										<dt className="text-[10px] font-black tracking-wider text-[#3D5568] uppercase dark:text-gray-400">
											{t("logs")}
										</dt>
										<dd className="mt-0.5 font-bold text-[#0A3D62] tabular-nums dark:text-gray-100">
											{pond._count.biomassLogs}
										</dd>
									</div>
								</dl>

								<div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
									<p className="text-[11px] font-bold text-[#3D5568] dark:text-gray-400">
										{t("ownershipHistory", { count: pond._count.ownershipHistory })}
									</p>
									<div className="flex flex-wrap items-center gap-2">
										<Link href={`/admin/ponds/${pond.id}`} className={adminButtonSecondary}>
											{t("viewDetails")}
										</Link>
										<PondStatusToggle pondId={pond.id} status={pond.status} />
									</div>
								</div>
							</li>
						))}
					</ItemCardGrid>
				</ListView>
			)}

			{pondsPage.total > 0 && (
				<Pagination
					basePath="/admin/ponds"
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
