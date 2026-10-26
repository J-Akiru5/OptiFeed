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
import { getLocale } from "next-intl/server";

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

	const [ponds, locale] = await Promise.all([listAllPonds({ query, page }), getLocale()]);
	const pageCount = Math.max(1, Math.ceil(ponds.total / ponds.pageSize));

	const pageHref = (target: number) => ({
		pathname: "/superadmin/ponds" as const,
		query: { ...(query ? { q: query } : {}), page: String(target) },
	});

	return (
		<div className="space-y-6">
			<PageHeader
				title="Ponds"
				description={`${ponds.total} pond${ponds.total !== 1 ? "s" : ""} across every tenant`}
				actions={
					<Badge tone="neutral" icon={Lock}>
						Read-only
					</Badge>
				}
			/>

			<ListToolbar
				id="ponds"
				action={getPathname({ href: "/superadmin/ponds", locale })}
				query={query}
				label="Search ponds by name, owner farm ID or owner name"
				placeholder="Search pond, farm ID or owner"
			/>

			{ponds.rows.length === 0 ? (
				<Card>
					<EmptyState
						icon={Droplets}
						title={query ? `No pond matches “${query}”.` : "No ponds registered."}
						description={
							query
								? "Try a different pond name, farm ID or owner name."
								: "Ponds appear here as soon as a farmer creates one in the tenant console."
						}
						action={
							query ? (
								<Link href="/superadmin/ponds" className={SECONDARY_BUTTON}>
									Clear search
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
											{pond.ownerName ?? "(unknown)"}
										</p>
										<p className="truncate font-mono text-[11px] text-[#3D5568]">
											{pond.ownerFarmId}
										</p>
									</div>
									<Badge tone={statusBadge[pond.status] ?? "neutral"}>{pond.status}</Badge>
								</div>

								<div>
									<p className="text-[9px] font-black uppercase tracking-wider text-[#3D5568]">
										Organizations
									</p>
									{pond.orgs.length === 0 ? (
										<p className="mt-1 text-[11px] italic text-[#3D5568]">—</p>
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
						label="Ponds across every tenant"
						minWidth="min-w-[52rem]"
						columns={[
							{ key: "pond", label: "Pond" },
							{ key: "owner", label: "Owner" },
							{ key: "orgs", label: "Organizations" },
							{ key: "status", label: "Status" },
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
									<p className="font-bold text-[#0A3D62]">{pond.ownerName ?? "(unknown)"}</p>
									<p className="font-mono text-[11px] text-[#3D5568]">{pond.ownerFarmId}</p>
								</td>
								<td className="px-6 py-4">
									{pond.orgs.length === 0 ? (
										<span className="text-[11px] italic text-[#3D5568]">—</span>
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
									<Badge tone={statusBadge[pond.status] ?? "neutral"}>{pond.status}</Badge>
								</td>
							</tr>
						))}
					</TableFrame>
				</>
			)}

			<ListPagination
				label="Pond pages"
				page={ponds.page}
				pageCount={pageCount}
				previousHref={ponds.page > 1 ? pageHref(ponds.page - 1) : null}
				nextHref={ponds.page < pageCount ? pageHref(ponds.page + 1) : null}
			/>

			<p className="text-[11px] text-[#3D5568]">
				Pond edits, scheduling and device controls live in the tenant&apos;s own admin console.
			</p>
		</div>
	);
}
