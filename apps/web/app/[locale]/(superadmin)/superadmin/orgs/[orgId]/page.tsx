import { OrgMembersPanel } from "@/components/superadmin/org-members";
import { Link } from "@/i18n/routing";
import { getOrgDetail } from "@/lib/actions/platform/members";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ArrowLeft, CalendarClock, FolderTree, Hash, Users } from "lucide-react";
import { notFound } from "next/navigation";

const typeBadge: Record<string, string> = {
	INDIVIDUAL: "bg-gray-200 text-[#3D5568]",
	COOPERATIVE: "bg-[#0A3D62] text-white",
	COMPANY: "bg-[#0A3D62] text-white",
	LGU: "bg-[#E85A2A] text-white",
	ACADEMIC: "bg-[#E85A2A] text-white",
};

const statusBadge: Record<string, string> = {
	ACTIVE: "bg-[#E8F5EC] text-[#1E7B34]",
	SUSPENDED: "bg-[#FDE8EA] text-[#C42B3A]",
	PENDING_DELETION: "bg-[#FFF3E8] text-[#B45309]",
	PURGED: "bg-gray-200 text-[#3D5568]",
};

/**
 * Platform organization detail: the organization's active members, with the
 * same management surface as tenant Settings → Members plus the god-mode
 * guardrails (required reason, step-up, one audit row per mutation).
 */
export default async function SuperadminOrgDetailPage({
	params,
}: {
	params: Promise<{ orgId: string }>;
}) {
	const { orgId } = await params;
	const detail = await getOrgDetail(orgId);
	if (!detail) notFound();

	const { org, members } = detail;

	return (
		<div className="space-y-6">
			<Link
				href="/superadmin/orgs"
				className="inline-flex items-center gap-1.5 text-xs font-black text-[#0A3D62] hover:underline"
			>
				<ArrowLeft className="h-3.5 w-3.5" />
				Back to organizations
			</Link>

			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="flex items-start gap-3">
					<div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0A3D62] text-white">
						<FolderTree className="h-5 w-5" />
					</div>
					<div>
						<div className="flex flex-wrap items-center gap-2">
							<h1 className="text-2xl font-black text-[#0A3D62]">{org.name}</h1>
							<span
								className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${
									typeBadge[org.type] ?? "bg-gray-200 text-[#3D5568]"
								}`}
							>
								{org.type}
							</span>
							<span
								className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${
									statusBadge[org.status] ?? "bg-gray-200 text-[#3D5568]"
								}`}
							>
								{org.status}
							</span>
						</div>
						<p className="mt-1 text-sm text-[#3D5568]">
							God-mode member management. Every change requires a reason, a fresh password check,
							and writes one platform audit row.
						</p>
					</div>
				</div>

				<div className="grid grid-cols-3 gap-3 text-center">
					<div className="rounded-xl border border-gray-200 bg-white px-4 py-2">
						<Users className="mx-auto h-4 w-4 text-[#0A3D62]" />
						<p className="mt-1 text-lg font-black tabular-nums text-[#0A3D62]">{members.length}</p>
						<p className="text-[9px] font-black uppercase tracking-wider text-[#3D5568]">Members</p>
					</div>
					<div className="rounded-xl border border-gray-200 bg-white px-4 py-2">
						<CalendarClock className="mx-auto h-4 w-4 text-[#0A3D62]" />
						<p className="mt-1 text-xs font-black text-[#0A3D62]">
							{org.createdAt.toLocaleDateString()}
						</p>
						<p className="text-[9px] font-black uppercase tracking-wider text-[#3D5568]">Created</p>
					</div>
					<div className="rounded-xl border border-gray-200 bg-white px-4 py-2">
						<Hash className="mx-auto h-4 w-4 text-[#0A3D62]" />
						<p className="mt-1 max-w-[7rem] truncate font-mono text-[10px] text-[#3D5568]">
							{org.id}
						</p>
						<p className="text-[9px] font-black uppercase tracking-wider text-[#3D5568]">Org ID</p>
					</div>
				</div>
			</div>

			<div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
				<OrgMembersPanel orgId={org.id} members={members} permissions={PERMISSIONS} />
			</div>
		</div>
	);
}
