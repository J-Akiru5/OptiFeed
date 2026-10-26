import { Link, getPathname } from "@/i18n/routing";
import { listAllPonds } from "@/lib/actions/superadmin";
import { Eye, Lock, Search } from "lucide-react";
import { getLocale } from "next-intl/server";

const statusBadge: Record<string, string> = {
	ACTIVE: "bg-green-50 text-[#1E7B34] border-green-200",
	MAINTENANCE: "bg-amber-50 text-amber-700 border-amber-200",
	ARCHIVED: "bg-gray-100 text-[#3D5568] border-gray-200",
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
		pathname: "/superadmin/ponds",
		query: { ...(query ? { q: query } : {}), page: String(target) },
	});

	return (
		<div className="space-y-6">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-black text-[#0A3D62]">Ponds</h1>
					<p className="text-sm text-[#3D5568] mt-1">
						{ponds.total} pond{ponds.total !== 1 ? "s" : ""} across every tenant
					</p>
				</div>
				<span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#F4F7F6] border border-gray-200 text-[10px] font-black uppercase tracking-wider text-[#3D5568]">
					<Lock className="w-3 h-3" />
					Read-only
				</span>
			</div>

			<form
				action={getPathname({ href: "/superadmin/ponds", locale })}
				method="get"
				className="flex items-center gap-2"
			>
				<input
					name="q"
					defaultValue={query}
					placeholder="Search pond, farm ID or owner"
					aria-label="Search ponds by name, owner farm ID or owner name"
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

			<div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-gray-100 bg-[#F4F7F6]">
								{["Pond", "Owner", "Organizations", "Status"].map((h) => (
									<th
										key={h}
										className="text-left px-6 py-3 font-black text-[#3D5568] uppercase text-[10px] tracking-wider"
									>
										{h}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{ponds.rows.map((pond) => (
								<tr
									key={pond.id}
									className="border-b border-gray-50 hover:bg-[#F4F7F6]/50 transition-colors"
								>
									<td className="px-6 py-4">
										<p className="font-black text-[#0A3D62]">{pond.name}</p>
									</td>
									<td className="px-6 py-4">
										<p className="font-bold text-[#0A3D62]">{pond.ownerName ?? "(unknown)"}</p>
										<p className="text-[11px] font-mono text-[#3D5568]">{pond.ownerFarmId}</p>
									</td>
									<td className="px-6 py-4">
										{pond.orgs.length === 0 ? (
											<span className="text-[11px] italic text-[#3D5568]">—</span>
										) : (
											<div className="flex flex-wrap gap-1.5">
												{pond.orgs.map((name) => (
													<span
														key={name}
														className="inline-flex px-2 py-0.5 rounded-lg bg-[#F4F7F6] border border-gray-200 text-[10px] font-bold text-[#0A3D62]"
													>
														{name}
													</span>
												))}
											</div>
										)}
									</td>
									<td className="px-6 py-4">
										<span
											className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${statusBadge[pond.status] ?? "bg-gray-100 text-[#3D5568] border-gray-200"}`}
										>
											<Eye className="w-3 h-3" />
											{pond.status}
										</span>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				{ponds.rows.length === 0 && (
					<p className="p-6 text-sm text-[#3D5568]">
						{query ? `No pond matches “${query}”.` : "No ponds registered."}
					</p>
				)}
			</div>

			{pageCount > 1 && (
				<nav aria-label="Pond pages" className="flex items-center gap-3 text-xs font-black">
					{ponds.page > 1 && (
						<Link href={pageHref(ponds.page - 1)} className="text-[#0A3D62] hover:underline">
							← Previous
						</Link>
					)}
					<span className="text-[#3D5568]">
						Page {ponds.page} of {pageCount}
					</span>
					{ponds.page < pageCount && (
						<Link href={pageHref(ponds.page + 1)} className="text-[#0A3D62] hover:underline">
							Next →
						</Link>
					)}
				</nav>
			)}

			<p className="text-[11px] text-[#3D5568]">
				Pond edits, scheduling and device controls live in the tenant's own admin console.
			</p>
		</div>
	);
}
