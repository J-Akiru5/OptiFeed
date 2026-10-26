import { ListPagination, ListToolbar } from "@/components/superadmin/list-chrome";
import {
	Badge,
	type BadgeTone,
	Card,
	EmptyState,
	MobileCard,
	PageHeader,
	SECONDARY_BUTTON,
	TableFrame,
} from "@/components/superadmin/ui";
import { Link, getPathname } from "@/i18n/routing";
import { listAllPonds } from "@/lib/actions/superadmin";
import { Droplets, Lock } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

const statusBadge: Record<string, BadgeTone> = {
	ACTIVE: "success",
	MAINTENANCE: "warning",
	ARCHIVED: "neutral",
};

function first(param: string | string[] | undefined): string | undefined {
	return Array.isArray(param) ? param[0] : param;
}

/**
 * Read-only pond inventory across every tenant.
 *
 * Deliberately renders no edit, schedule, device, or status controls: the
 * platform console observes farmer work but never interferes with it.
 */
export default async function SuperadminPondsPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const params = await searchParams;
	const query = first(params.q)?.trim() ?? "";
	const page = Number.parseInt(first(params.page) ?? "1", 10) || 1;

	const [ponds, locale, t, tCommon, tRoot] = await Promise.all([
		listAllPonds({ query, page }),
		getLocale(),
		getTranslations("superadmin.ponds"),
		getTranslations("superadmin.common"),
		getTranslations("superadmin"),
	]);
	const pageCount = Math.max(1, Math.ceil(ponds.total / ponds.pageSize));

	const statusLabel = (status: string) => {
		const key = `pondStatuses.${status}`;
		return tRoot.has(key) ? tRoot(key) : status;
	};

	const pageHref = (target: number) => ({
		pathname: "/superadmin/ponds" as const,
		query: { ...(query ? { q: query } : {}), page: String(target) },
	});

	return (
		<div className="space-y-6">
			<PageHeader
				title={t("title")}
				description={t("description", { count: ponds.total })}
				actions={
					<Badge tone="neutral" icon={Lock}>
						{tCommon("readOnly")}
					</Badge>
				}
			/>

			<ListToolbar
				id="ponds"
				action={getPathname({ href: "/superadmin/ponds", locale })}
				query={query}
				label={t("searchLabel")}
				placeholder={t("searchPlaceholder")}
				searchLabel={tCommon("search")}
			/>

			{ponds.rows.length === 0 ? (
				<Card>
					<EmptyState
						icon={Droplets}
						title={query ? t("emptyQuery", { query }) : t("emptyTitle")}
						description={query ? t("emptyQueryDesc") : t("emptyDesc")}
						action={
							query ? (
								<Link href="/superadmin/ponds" className={SECONDARY_BUTTON}>
									{tCommon("clearSearch")}
								</Link>
							) : undefined
						}
					/>
				</Card>
			) : (
				<>
					<ul className="space-y-3 md:hidden">
						{ponds.rows.map((pond) => (
							<MobileCard key={pond.id}>
								<div className="flex items-start justify-between gap-3">
									<div className="min-w-0">
										<p className="truncate font-black text-[#0A3D62]">{pond.name}</p>
										<p className="mt-0.5 truncate text-xs font-bold text-[#0A3D62]">
											{pond.ownerName ?? tCommon("unknown")}
										</p>
										<p className="truncate font-mono text-[11px] text-[#3D5568]">
											{pond.ownerFarmId}
										</p>
									</div>
									<Badge tone={statusBadge[pond.status] ?? "neutral"}>
										{statusLabel(pond.status)}
									</Badge>
								</div>

								<div>
									<p className="text-[9px] font-black uppercase tracking-wider text-[#3D5568]">
										{t("columnOrgs")}
									</p>
									{pond.orgs.length === 0 ? (
										<p className="mt-1 text-[11px] italic text-[#3D5568]">{tCommon("none")}</p>
									) : (
										<div className="mt-1 flex flex-wrap gap-1.5">
											{pond.orgs.map((name) => (
												<span
													key={name}
													className="inline-flex rounded-lg border border-gray-200 bg-[#F4F7F6] px-2 py-0.5 text-[10px] font-bold text-[#0A3D62]"
												>
													{name}
												</span>
											))}
										</div>
									)}
								</div>
							</MobileCard>
						))}
					</ul>

					<TableFrame
						className="hidden md:block"
						label={t("caption")}
						minWidth="min-w-[52rem]"
						columns={[
							{ key: "pond", label: t("columnPond") },
							{ key: "owner", label: t("columnOwner") },
							{ key: "orgs", label: t("columnOrgs") },
							{ key: "status", label: t("columnStatus") },
						]}
					>
						{ponds.rows.map((pond) => (
							<tr
								key={pond.id}
								className="border-b border-gray-50 transition-colors last:border-0 hover:bg-[#F4F7F6]/50"
							>
								<td className="px-6 py-4">
									<p className="font-black text-[#0A3D62]">{pond.name}</p>
								</td>
								<td className="px-6 py-4">
									<p className="font-bold text-[#0A3D62]">{pond.ownerName ?? tCommon("unknown")}</p>
									<p className="font-mono text-[11px] text-[#3D5568]">{pond.ownerFarmId}</p>
								</td>
								<td className="px-6 py-4">
									{pond.orgs.length === 0 ? (
										<span className="text-[11px] italic text-[#3D5568]">{tCommon("none")}</span>
									) : (
										<div className="flex flex-wrap gap-1.5">
											{pond.orgs.map((name) => (
												<span
													key={name}
													className="inline-flex rounded-lg border border-gray-200 bg-[#F4F7F6] px-2 py-0.5 text-[10px] font-bold text-[#0A3D62]"
												>
													{name}
												</span>
											))}
										</div>
									)}
								</td>
								<td className="px-6 py-4">
									<Badge tone={statusBadge[pond.status] ?? "neutral"}>
										{statusLabel(pond.status)}
									</Badge>
								</td>
							</tr>
						))}
					</TableFrame>
				</>
			)}

			<ListPagination
				label={t("pagerLabel")}
				pageLabel={tCommon("pageOf", { page: ponds.page, count: pageCount })}
				previousLabel={tCommon("previous")}
				nextLabel={tCommon("next")}
				pageCount={pageCount}
				previousHref={ponds.page > 1 ? pageHref(ponds.page - 1) : null}
				nextHref={ponds.page < pageCount ? pageHref(ponds.page + 1) : null}
			/>

			<p className="text-[11px] text-[#3D5568]">{t("footer")}</p>
		</div>
	);
}
