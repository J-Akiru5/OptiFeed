import { getDevices } from "@/lib/actions/admin";
import { Cpu, Wifi, WifiOff } from "lucide-react";

export default async function AdminDevicesPage() {
	const devices = await getDevices();

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-black text-[#0A3D62]">Device Management</h1>
				<p className="text-sm text-[#3D5568] mt-1">
					{devices.length} device{devices.length !== 1 ? "s" : ""} registered
				</p>
			</div>

			<div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-gray-100 bg-[#F4F7F6]">
								<th className="text-left px-6 py-3 font-black text-[#3D5568] uppercase text-[10px] tracking-wider">
									Device
								</th>
								<th className="text-left px-6 py-3 font-black text-[#3D5568] uppercase text-[10px] tracking-wider">
									MAC Address
								</th>
								<th className="text-left px-6 py-3 font-black text-[#3D5568] uppercase text-[10px] tracking-wider">
									Status
								</th>
								<th className="text-left px-6 py-3 font-black text-[#3D5568] uppercase text-[10px] tracking-wider">
									Pond
								</th>
								<th className="text-left px-6 py-3 font-black text-[#3D5568] uppercase text-[10px] tracking-wider">
									Feed Level
								</th>
								<th className="text-left px-6 py-3 font-black text-[#3D5568] uppercase text-[10px] tracking-wider">
									Last Seen
								</th>
							</tr>
						</thead>
						<tbody>
							{devices.map((device) => {
								const now = new Date();
								const isOffline =
									!device.lastSeenAt ||
									now.getTime() - device.lastSeenAt.getTime() > 15 * 60 * 1000;

								return (
									<tr
										key={device.id}
										className="border-b border-gray-50 hover:bg-[#F4F7F6]/50 transition-colors"
									>
										<td className="px-6 py-4">
											<div className="flex items-center gap-3">
												<div className="w-9 h-9 rounded-xl bg-[#0A3D62] flex items-center justify-center">
													<Cpu className="w-4 h-4 text-white" />
												</div>
												<div>
													<p className="font-black text-[#0A3D62]">{device.label}</p>
													<p className="text-[11px] text-[#3D5568]">
														{device.gramsPerFeeding}g/feeding
													</p>
												</div>
											</div>
										</td>
										<td className="px-6 py-4 font-mono text-xs font-bold text-[#3D5568]">
											{device.mac}
										</td>
										<td className="px-6 py-4">
											<span
												className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
													isOffline ? "bg-red-100 text-[#C42B3A]" : "bg-green-100 text-[#1E7B34]"
												}`}
											>
												{isOffline ? <WifiOff className="w-3 h-3" /> : <Wifi className="w-3 h-3" />}
												{isOffline ? "Offline" : "Online"}
											</span>
										</td>
										<td className="px-6 py-4 text-xs font-bold text-[#3D5568]">
											{device.pond?.name || "Unassigned"}
										</td>
										<td className="px-6 py-4">
											<div className="flex items-center gap-2">
												<div className="w-16 bg-gray-200 h-1.5 rounded-full overflow-hidden">
													<div
														className={`h-full rounded-full ${
															(device.feedLevelPercent ?? 0) < 20 ? "bg-[#E85A2A]" : "bg-[#1E7B34]"
														}`}
														style={{ width: `${device.feedLevelPercent ?? 0}%` }}
													/>
												</div>
												<span className="text-[11px] font-bold text-[#3D5568]">
													{device.feedLevelPercent ?? 0}%
												</span>
											</div>
										</td>
										<td className="px-6 py-4 text-xs text-[#3D5568]">
											{device.lastSeenAt ? device.lastSeenAt.toLocaleString() : "Never"}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>

				{devices.length === 0 && (
					<div className="text-center py-12 text-[#3D5568]">
						<Cpu className="w-12 h-12 mx-auto mb-3 text-gray-300" />
						<p className="font-bold">No devices registered yet.</p>
					</div>
				)}
			</div>
		</div>
	);
}
