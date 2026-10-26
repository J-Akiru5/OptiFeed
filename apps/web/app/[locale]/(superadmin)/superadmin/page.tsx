import { Card, PageHeader, StatCard } from "@/components/superadmin/ui";
import { getSuperadminStats } from "@/lib/actions/superadmin";
import { Droplets, FolderTree, ShieldCheck, Users } from "lucide-react";

export default async function SuperadminOverviewPage() {
	const stats = await getSuperadminStats();

	return (
		<div className="space-y-8">
			<PageHeader
				title="Platform Overview"
				description="Cross-tenant visibility. Accounts, organizations and read-only pond state."
			/>

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
				<StatCard label="Users" value={stats.userCount} hint="All tenants" icon={Users} />
				<StatCard label="Organizations" value={stats.orgCount} hint="Tenants" icon={FolderTree} />
				<StatCard label="Ponds" value={stats.pondCount} hint="Read-only" icon={Droplets} />
				<StatCard
					label="Platform Admins"
					value={stats.activePlatformAdminCount}
					hint={`${stats.platformAdminCount} grant(s) total`}
					icon={ShieldCheck}
				/>
			</div>

			<Card className="space-y-3 p-6">
				<h2 className="text-lg font-black text-[#0A3D62]">Scope of this console</h2>
				<ul className="list-disc space-y-1.5 pl-5 text-sm text-[#3D5568]">
					<li>Manage every user account, including tenant admins.</li>
					<li>Create organizations and register farmers.</li>
					<li>Inspect ponds across tenants — view only, no edits or scheduling.</li>
					<li>Grant or revoke platform admin access, with a recorded reason.</li>
				</ul>
			</Card>
		</div>
	);
}
