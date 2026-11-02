import { CreateOrgForm } from "@/components/superadmin/create-org-form";
import { ListToolbar } from "@/components/superadmin/list-chrome";
import {
	Badge,
	type BadgeTone,
	Card,
	EmptyState,
	MetaPair,
	MobileCard,
	PageHeader,
	SECONDARY_BUTTON,
	TableFrame,
} from "@/components/superadmin/ui";
import { ViewAsControl } from "@/components/superadmin/view-as-control";
import { ItemCardGrid } from "@/components/ui/item-card";
import { Pagination } from "@/components/ui/pagination";
import { ListView } from "@/components/ui/view-toggle";
import { Link, getPathname } from "@/i18n/routing";
import { listOrgs } from "@/lib/actions/superadmin";
import { formatDateTimeLocal } from "@/lib/date-local";
import { FolderTree } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

const typeBadge: Record<string, BadgeTone> = {
	INDIVIDUAL: "neutral",
	COOPERATIVE: "brand",
	COMPANY: "brand",
	LGU: "accent",
	ACADEMIC: "accent",
};

const statusBadge: Record<string, BadgeTone> = {
	ACTIVE: "success",
	SUSPENDED: "danger",
	PENDING_DELETION: "warning",
	PURGED: "neutral",
};

function first(param: string | string[] | undefined): string | undefined {
	return Array.isArray(param) ? param[0] : param;
}

export default async function SuperadminOrgsPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const params = await searchParams;
	const query = first(params.q)?.trim() ?? "";
	const page = Number.parseInt(first(params.page) ?? "1", 10) || 1;

	const [orgs, locale, t, tCommon, tRoot, tDates] = await Promise.all([
		listOrgs({ query, page }),
		getLocale(),
		getTranslations("superadmin.orgs"),
		getTranslations("superadmin.common"),
		getTranslations("superadmin"),
		getTranslations("dates"),
	]);
	const pageCount = Math.max(1, Math.ceil(orgs.total / orgs.pageSize));
	const firstRow = orgs.total === 0 ? 0 : (orgs.page - 1) * orgs.pageSize + 1;
	const lastRow = Math.min(orgs.page * orgs.pageSize, orgs.total);

	const labelFor = (namespace: "orgTypes" | "orgStatuses", value: string) => {
		const key = `${namespace}.${value}`;
		return tRoot.has(key) ? tRoot(key) : value;
	};

	return (
		<div className="space-y-6">
			<PageHeader title={t("title")} description={t("description", { count: orgs.total })} />

			<CreateOrgForm />

			<ListToolbar
				id="orgs"
				action={getPathname({ href: "/superadmin/orgs", locale })}
				query={query}
				label={t("searchLabel")}
				placeholder={t("searchPlaceholder")}
				searchLabel={tCommon("search")}
			/>

			{orgs.rows.length === 0 ? (
				<Card>
					<EmptyState
						icon={FolderTree}
						title={query ? t("emptyQuery", { query }) : t("emptyTitle")}
						description={query ? t("emptyQueryDesc") : t("emptyDesc")}
						action={
							query ? (
								<Link href="/superadmin/orgs" className={SECONDARY_BUTTON}>
									{tCommon("clearSearch")}
								</Link>
							) : undefined
						}
					/>
				</Card>
			) : (
				<ListView
					pageKey="superadmin-orgs"
					listLabel={tCommon("viewToggle.list")}
					cardsLabel={tCommon("viewToggle.cards")}
					toggleLabel={tCommon("viewToggle.label")}
				>
					<ItemCardGrid label={t("caption")}>
						{orgs.rows.map((org) => (
							<MobileCard key={org.id}>
								<div className="flex items-start gap-3">
									<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0A3D62] text-white">
										<FolderTree className="h-4 w-4" aria-hidden="true" />
									</div>
									<div className="min-w-0">
										<Link
											href={`/superadmin/orgs/${org.id}`}
											className="font-black text-[#0A3D62] dark:text-slate-100 hover:underline"
										>
											{org.name}
										</Link>
										<div className="mt-1 flex flex-wrap items-center gap-1.5">
											<Badge tone={typeBadge[org.type] ?? "neutral"}>
												{labelFor("orgTypes", org.type)}
											</Badge>
											<Badge tone={statusBadge[org.status] ?? "neutral"}>
												{labelFor("orgStatuses", org.status)}
											</Badge>
										</div>
									</div>
								</div>

								<dl className="grid grid-cols-3 gap-2">
									<MetaPair label={tCommon("members")}>{org.memberCount}</MetaPair>
									<MetaPair label={tCommon("ponds")}>{org.pondCount}</MetaPair>
									<MetaPair label={tCommon("created")}>
										{formatDateTimeLocal(org.createdAt, tDates).date}
									</MetaPair>
								</dl>

								<div className="flex flex-wrap items-center gap-2">
									<Link
										href={`/superadmin/orgs/${org.id}`}
										data-help="superadmin-org-members"
										className={SECONDARY_BUTTON}
									>
										{t("manageMembers")}
									</Link>
									<ViewAsControl orgId={org.id} orgName={org.name} />
								</div>
							</MobileCard>
						))}
					</ItemCardGrid>

					<TableFrame
						className="hidden md:block"
						label={t("caption")}
						minWidth="min-w-[62rem]"
						columns={[
							{ key: "org", label: t("columnOrganization") },
							{ key: "type", label: t("columnType") },
							{ key: "status", label: t("columnStatus") },
							{ key: "members", label: t("columnMembers") },
							{ key: "ponds", label: t("columnPonds") },
							{ key: "created", label: t("columnCreated") },
							{ key: "actions", label: t("columnActions") },
						]}
					>
						{orgs.rows.map((org) => (
							<tr
								key={org.id}
								className="border-b border-gray-50 dark:border-[#1B2740] transition-colors last:border-0 hover:bg-[#F4F7F6] dark:hover:bg-[#162238]/50 dark:hover:bg-[#162238]/60"
							>
								<td className="px-6 py-4">
									<div className="flex items-center gap-3">
										<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0A3D62] text-white">
											<FolderTree className="h-4 w-4" aria-hidden="true" />
										</div>
										<p className="font-black text-[#0A3D62] dark:text-slate-100">
											<Link
												href={`/superadmin/orgs/${org.id}`}
												className="rounded hover:underline focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
											>
												{org.name}
											</Link>
										</p>
									</div>
								</td>
								<td className="px-6 py-4">
									<Badge tone={typeBadge[org.type] ?? "neutral"}>
										{labelFor("orgTypes", org.type)}
									</Badge>
								</td>
								<td className="px-6 py-4">
									<Badge tone={statusBadge[org.status] ?? "neutral"}>
										{labelFor("orgStatuses", org.status)}
									</Badge>
								</td>
								<td className="px-6 py-4 font-black tabular-nums text-[#0A3D62] dark:text-slate-100">
									{org.memberCount}
								</td>
								<td className="px-6 py-4 font-black tabular-nums text-[#0A3D62] dark:text-slate-100">
									{org.pondCount}
								</td>
								<td className="px-6 py-4 text-xs text-[#3D5568] dark:text-slate-400">
									{formatDateTimeLocal(org.createdAt, tDates).date}
								</td>
								<td className="px-6 py-4">
									<div className="flex flex-wrap items-center gap-2">
										<Link
											href={`/superadmin/orgs/${org.id}`}
											data-help="superadmin-org-members"
											className={SECONDARY_BUTTON}
										>
											{t("manageMembers")}
										</Link>
										<ViewAsControl orgId={org.id} orgName={org.name} />
									</div>
								</td>
							</tr>
						))}
					</TableFrame>
				</ListView>
			)}

			<Pagination
				basePath="/superadmin/orgs"
				params={{ q: query || undefined }}
				page={orgs.page}
				pageCount={pageCount}
				showing={tCommon("pagination.showing", {
					from: firstRow,
					to: lastRow,
					total: orgs.total,
				})}
				previousLabel={tCommon("previous")}
				nextLabel={tCommon("next")}
				label={tCommon("pagination.label")}
			/>
		</div>
	);
}
