import { getSuperadminStats } from "@/lib/actions/superadmin";

const cardClass = "bg-white rounded-2xl border border-gray-200 shadow-sm p-6 flex flex-col gap-1";

function StatCard({
	label,
	value,
	hint,
}: {
	label: string;
	value: number;
	hint?: string;
}) {
	return (
		<div className={cardClass}>
			<span className="text-[10px] uppercase font-extrabold tracking-wider text-[#3D5568]">
				{label}
			</span>
			<span className="text-3xl font-black text-[#0A3D62] tabular-nums">{value}</span>
			{hint && <span className="text-[11px] text-[#3D5568]">{hint}</span>}
		</div>
	);
}

export default async function SuperadminOverviewPage() {
	const stats = await getSuperadminStats();

	return (
		<div className="space-y-8">
			<div>
				<h1 className="text-2xl font-black text-[#0A3D62]">Platform Overview</h1>
				<p className="text-sm text-[#3D5568] mt-1">
					Cross-tenant visibility. Accounts, organizations and read-only pond state.
				</p>
			</div>

			<div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
				<StatCard label="Users" value={stats.userCount} hint="All tenants" />
				<StatCard label="Organizations" value={stats.orgCount} hint="Tenants" />
				<StatCard label="Ponds" value={stats.pondCount} hint="Read-only" />
				<StatCard
					label="Platform Admins"
					value={stats.activePlatformAdminCount}
					hint={`${stats.platformAdminCount} grant(s) total`}
				/>
			</div>

			<div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-3">
				<h2 className="text-lg font-black text-[#0A3D62]">Scope of this console</h2>
				<ul className="text-sm text-[#3D5568] space-y-1.5 list-disc pl-5">
					<li>Manage every user account, including tenant admins.</li>
					<li>Create organizations and register farmers.</li>
					<li>Inspect ponds across tenants — view only, no edits or scheduling.</li>
					<li>Grant or revoke platform admin access, with a recorded reason.</li>
				</ul>
			</div>
		</div>
	);
}
