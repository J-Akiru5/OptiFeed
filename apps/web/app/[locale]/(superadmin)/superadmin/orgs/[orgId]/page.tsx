import { OrgMembersPanel } from "@/components/superadmin/org-members";
import { OrgStatusControl } from "@/components/superadmin/org-status-control";
import { ScopeBanner } from "@/components/superadmin/scope-banner";
import { Badge, type BadgeTone, Card } from "@/components/superadmin/ui";
import { Link } from "@/i18n/routing";
import { getOrgDetail } from "@/lib/actions/platform/members";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { formatDateTimeLocal } from "@/lib/date-local";
import { ArrowLeft, CalendarClock, FolderTree, Hash, Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

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
	const [detail, t, tCommon, tRoot, tDates, tShell] = await Promise.all([
		getOrgDetail(orgId),
		getTranslations("superadmin.orgDetail"),
		getTranslations("superadmin.common"),
		getTranslations("superadmin"),
		getTranslations("dates"),
		getTranslations("superadmin.shell"),
	]);
	if (!detail) notFound();

	const labelFor = (namespace: "orgTypes" | "orgStatuses", value: string) => {
		const key = `${namespace}.${value}`;
		return tRoot.has(key) ? tRoot(key) : value;
	};

	const { org, members } = detail;

	// Joined dates are formatted on the server, so the client panel renders the
	// same string as the server and cannot hydrate into a different locale.
	const joinedLabels: Record<string, string> = {};
	for (const member of members) {
		joinedLabels[member.membershipId] = formatDateTimeLocal(member.joinedAt, tDates).date;
	}

	return (
		<div className="space-y-6">
			{/* This page names a record, so it draws its own scope path; the layout's
			    banner steps aside for it (pageOwnsScope). */}
			<ScopeBanner
				label={tShell("scope.label")}
				crumbs={[
					{ level: "global", label: tShell("scope.global") },
					{ level: "organization", label: tShell("scope.organization", { name: org.name }) },
				]}
			/>

			<Link
				href="/superadmin/orgs"
				className="inline-flex items-center gap-1.5 rounded text-xs font-black text-[#0A3D62] dark:text-slate-100 hover:underline focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
			>
				<ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
				{t("back")}
			</Link>

			<div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
				<div className="flex min-w-0 items-start gap-3">
					<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#0A3D62] text-white">
						<FolderTree className="h-5 w-5" aria-hidden="true" />
					</div>
					<div className="min-w-0">
						<div className="flex flex-wrap items-center gap-2">
							<h1 className="text-2xl font-black text-[#0A3D62] dark:text-slate-100">{org.name}</h1>
							<Badge tone={typeBadge[org.type] ?? "neutral"}>
								{labelFor("orgTypes", org.type)}
							</Badge>
							<Badge tone={statusBadge[org.status] ?? "neutral"}>
								{labelFor("orgStatuses", org.status)}
							</Badge>
						</div>
						<p className="mt-1 max-w-2xl text-sm text-[#3D5568] dark:text-slate-400">
							{t("description")}
						</p>
					</div>
				</div>

				<dl className="grid w-full grid-cols-3 gap-3 text-center lg:w-auto">
					<div className="rounded-xl border border-gray-200 dark:border-[#24304A] bg-white dark:bg-[#111A2C] px-4 py-2">
						<Users
							className="mx-auto h-4 w-4 text-[#0A3D62] dark:text-slate-100"
							aria-hidden="true"
						/>
						<dt className="mt-1 text-[9px] font-black uppercase tracking-wider text-[#3D5568] dark:text-slate-400">
							{tCommon("members")}
						</dt>
						<dd className="text-lg font-black tabular-nums text-[#0A3D62] dark:text-slate-100">
							{members.length}
						</dd>
					</div>
					<div className="rounded-xl border border-gray-200 dark:border-[#24304A] bg-white dark:bg-[#111A2C] px-4 py-2">
						<CalendarClock
							className="mx-auto h-4 w-4 text-[#0A3D62] dark:text-slate-100"
							aria-hidden="true"
						/>
						<dt className="mt-1 text-[9px] font-black uppercase tracking-wider text-[#3D5568] dark:text-slate-400">
							{tCommon("created")}
						</dt>
						<dd className="text-xs font-black text-[#0A3D62] dark:text-slate-100">
							{formatDateTimeLocal(org.createdAt, tDates).date}
						</dd>
					</div>
					<div className="rounded-xl border border-gray-200 dark:border-[#24304A] bg-white dark:bg-[#111A2C] px-4 py-2">
						<Hash
							className="mx-auto h-4 w-4 text-[#0A3D62] dark:text-slate-100"
							aria-hidden="true"
						/>
						<dt className="mt-1 text-[9px] font-black uppercase tracking-wider text-[#3D5568] dark:text-slate-400">
							{t("orgId")}
						</dt>
						<dd
							className="truncate font-mono text-[10px] text-[#3D5568] dark:text-slate-400"
							title={org.id}
						>
							{org.id}
						</dd>
					</div>
				</dl>
			</div>

			<OrgStatusControl orgId={org.id} orgName={org.name} status={org.status} />

			<Card className="p-4 sm:p-6">
				<OrgMembersPanel
					orgId={org.id}
					members={members}
					permissions={PERMISSIONS}
					joinedLabels={joinedLabels}
				/>
			</Card>
		</div>
	);
}
