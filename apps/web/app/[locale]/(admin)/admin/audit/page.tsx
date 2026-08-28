import { getAuditLog } from "@/lib/actions/admin";
import { FileText } from "lucide-react";

export default async function AdminAuditPage() {
	const events = await getAuditLog();

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-black text-[#0A3D62]">Audit Log</h1>
				<p className="text-sm text-[#3D5568] mt-1">Recent system-wide events from all devices.</p>
			</div>

			<div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-gray-100 bg-[#F4F7F6]">
								<th className="text-left px-6 py-3 font-black text-[#3D5568] uppercase text-[10px] tracking-wider">
									Time
								</th>
								<th className="text-left px-6 py-3 font-black text-[#3D5568] uppercase text-[10px] tracking-wider">
									Device
								</th>
								<th className="text-left px-6 py-3 font-black text-[#3D5568] uppercase text-[10px] tracking-wider">
									Event
								</th>
								<th className="text-left px-6 py-3 font-black text-[#3D5568] uppercase text-[10px] tracking-wider">
									Source
								</th>
								<th className="text-left px-6 py-3 font-black text-[#3D5568] uppercase text-[10px] tracking-wider">
									Actor
								</th>
							</tr>
						</thead>
						<tbody>
							{events.map((event) => (
								<tr
									key={event.id}
									className="border-b border-gray-50 hover:bg-[#F4F7F6]/50 transition-colors"
								>
									<td className="px-6 py-3 text-xs text-[#3D5568] whitespace-nowrap">
										{event.createdAt.toLocaleString()}
									</td>
									<td className="px-6 py-3 text-xs font-bold text-[#0A3D62]">
										{event.device.label}
									</td>
									<td className="px-6 py-3">
										<span className="inline-flex px-2.5 py-1 rounded-full bg-[#0A3D62]/10 text-[10px] font-black uppercase tracking-wider text-[#0A3D62]">
											{event.eventType}
										</span>
									</td>
									<td className="px-6 py-3 text-xs text-[#3D5568]">{event.source}</td>
									<td className="px-6 py-3 text-xs text-[#3D5568]">{event.actorId || "—"}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				{events.length === 0 && (
					<div className="text-center py-12 text-[#3D5568]">
						<FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
						<p className="font-bold">No events recorded yet.</p>
					</div>
				)}
			</div>
		</div>
	);
}
