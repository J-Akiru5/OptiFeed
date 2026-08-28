import { getPonds } from "@/lib/actions/admin";
import { Cpu, Droplets } from "lucide-react";

export default async function AdminPondsPage() {
	const ponds = await getPonds();

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-black text-[#0A3D62]">Pond Management</h1>
				<p className="text-sm text-[#3D5568] mt-1">
					{ponds.length} pond{ponds.length !== 1 ? "s" : ""} registered
				</p>
			</div>

			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
				{ponds.map((pond) => (
					<div
						key={pond.id}
						className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4"
					>
						<div className="flex items-start justify-between">
							<div>
								<h3 className="font-black text-[#0A3D62] text-lg">{pond.name}</h3>
								<p className="text-[11px] text-[#3D5568] font-mono mt-0.5">
									ID: {pond.id.slice(0, 12)}...
								</p>
							</div>
							<div className="w-10 h-10 rounded-xl bg-[#0A3D62]/10 flex items-center justify-center">
								<Droplets className="w-5 h-5 text-[#0A3D62]" />
							</div>
						</div>

						<div className="grid grid-cols-2 gap-3 text-xs">
							<div className="rounded-xl bg-[#F4F7F6] p-2.5">
								<p className="font-black uppercase text-[#3D5568] text-[10px]">Owner</p>
								<p className="font-bold text-[#0A3D62] mt-0.5">
									{pond.owner?.displayName || pond.ownerId}
								</p>
							</div>
							<div className="rounded-xl bg-[#F4F7F6] p-2.5">
								<p className="font-black uppercase text-[#3D5568] text-[10px]">Feeds/Day</p>
								<p className="font-bold text-[#0A3D62] mt-0.5">{pond.feedsPerDay}</p>
							</div>
							<div className="rounded-xl bg-[#F4F7F6] p-2.5">
								<p className="font-black uppercase text-[#3D5568] text-[10px]">Devices</p>
								<p className="font-bold text-[#0A3D62] mt-0.5 flex items-center gap-1">
									<Cpu className="w-3 h-3" />
									{pond.energyDevices.length}
								</p>
							</div>
							<div className="rounded-xl bg-[#F4F7F6] p-2.5">
								<p className="font-black uppercase text-[#3D5568] text-[10px]">Logs</p>
								<p className="font-bold text-[#0A3D62] mt-0.5">{pond._count.biomassLogs}</p>
							</div>
						</div>
					</div>
				))}

				{ponds.length === 0 && (
					<div className="col-span-full text-center py-12 text-[#3D5568]">
						<Droplets className="w-12 h-12 mx-auto mb-3 text-gray-300" />
						<p className="font-bold">No ponds registered yet.</p>
					</div>
				)}
			</div>
		</div>
	);
}
