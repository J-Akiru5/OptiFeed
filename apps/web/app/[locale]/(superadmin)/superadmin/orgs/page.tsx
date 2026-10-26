import { CreateOrgForm } from "@/components/superadmin/create-org-form";
import { Link, getPathname } from "@/i18n/routing";
import { listOrgs } from "@/lib/actions/superadmin";
import { FolderTree, Search } from "lucide-react";
import { getLocale } from "next-intl/server";

const typeBadge: Record<string, string> = {
	INDIVIDUAL: "bg-gray-200 text-[#3D5568]",
	COOPERATIVE: "bg-[#0A3D62] text-white",
	COMPANY: "bg-[#0A3D62] text-white",
	LGU: "bg-[#E85A2A] text-white",
	ACADEMIC: "bg-[#E85A2A] text-white",
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

	const [orgs, locale] = await Promise.all([listOrgs({ query, page }), getLocale()]);
	const pageCount = Math.max(1, Math.ceil(orgs.total / orgs.pageSize));

	const pageHref = (target: number) => ({
		pathname: "/superadmin/orgs",
		query: { ...(query ? { q: query } : {}), page: String(target) },
	});

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-black text-[#0A3D62]">Organizations</h1>
				<p className="text-sm text-[#3D5568] mt-1">
					{orgs.total} tenant{orgs.total !== 1 ? "s" : ""}. Memberships define what each account can
					see in the admin console.
				</p>
			</div>

			<CreateOrgForm />

			<form
				action={getPathname({ href: "/superadmin/orgs", locale })}
				method="get"
				className="flex items-center gap-2"
			>
				<input
					name="q"
					defaultValue={query}
					placeholder="Search organization name"
					aria-label="Search organizations by name"
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
								{["Organization", "Type", "Status", "Members", "Ponds", "Created"].map((h) => (
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
							{orgs.rows.map((org) => (
								<tr
									key={org.id}
									className="border-b border-gray-50 hover:bg-[#F4F7F6]/50 transition-colors"
								>
									<td className="px-6 py-4">
										<div className="flex items-center gap-3">
											<div className="w-9 h-9 rounded-xl bg-[#0A3D62] flex items-center justify-center text-white">
												<FolderTree className="w-4 h-4" />
											</div>
											<p className="font-black text-[#0A3D62]">{org.name}</p>
										</div>
									</td>
									<td className="px-6 py-4">
										<span
											className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${typeBadge[org.type] ?? "bg-gray-200 text-[#3D5568]"}`}
										>
											{org.type}
										</span>
									</td>
									<td className="px-6 py-4 text-xs font-bold text-[#3D5568]">{org.status}</td>
									<td className="px-6 py-4 tabular-nums font-black text-[#0A3D62]">
										{org.memberCount}
									</td>
									<td className="px-6 py-4 tabular-nums font-black text-[#0A3D62]">
										{org.pondCount}
									</td>
									<td className="px-6 py-4 text-xs text-[#3D5568]">
										{org.createdAt.toLocaleDateString()}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				{orgs.rows.length === 0 && (
					<p className="p-6 text-sm text-[#3D5568]">
						{query
							? `No organization matches “${query}”.`
							: "No organizations yet. Create one below — tenant admins and farmers are added to an organization."}
					</p>
				)}
			</div>

			{pageCount > 1 && (
				<nav aria-label="Organization pages" className="flex items-center gap-3 text-xs font-black">
					{orgs.page > 1 && (
						<Link href={pageHref(orgs.page - 1)} className="text-[#0A3D62] hover:underline">
							← Previous
						</Link>
					)}
					<span className="text-[#3D5568]">
						Page {orgs.page} of {pageCount}
					</span>
					{orgs.page < pageCount && (
						<Link href={pageHref(orgs.page + 1)} className="text-[#0A3D62] hover:underline">
							Next →
						</Link>
					)}
				</nav>
			)}
		</div>
	);
}
