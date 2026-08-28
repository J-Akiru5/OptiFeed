import { Settings } from "lucide-react";

export default function AdminSettingsPage() {
	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-black text-[#0A3D62]">System Settings</h1>
				<p className="text-sm text-[#3D5568] mt-1">System-wide configuration and administration.</p>
			</div>

			<div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
				<div className="flex items-center gap-3 mb-6">
					<div className="w-10 h-10 rounded-xl bg-[#0A3D62]/10 flex items-center justify-center">
						<Settings className="w-5 h-5 text-[#0A3D62]" />
					</div>
					<div>
						<h2 className="font-black text-[#0A3D62]">General Settings</h2>
						<p className="text-xs text-[#3D5568]">Coming soon</p>
					</div>
				</div>

				<div className="space-y-4">
					<div className="rounded-xl bg-[#F4F7F6] p-4 border border-gray-200">
						<p className="text-xs font-black uppercase text-[#3D5568] tracking-wider mb-2">
							Default Feeding Rate
						</p>
						<p className="text-sm text-[#0A3D62]">
							System-wide default feeding rate percentage for new ponds.
						</p>
						<p className="text-xs text-[#3D5568] mt-2 italic">
							Configuration coming in future update.
						</p>
					</div>

					<div className="rounded-xl bg-[#F4F7F6] p-4 border border-gray-200">
						<p className="text-xs font-black uppercase text-[#3D5568] tracking-wider mb-2">
							Notification Settings
						</p>
						<p className="text-sm text-[#0A3D62]">
							Configure global notification thresholds and alert recipients.
						</p>
						<p className="text-xs text-[#3D5568] mt-2 italic">
							Configuration coming in future update.
						</p>
					</div>

					<div className="rounded-xl bg-[#F4F7F6] p-4 border border-gray-200">
						<p className="text-xs font-black uppercase text-[#3D5568] tracking-wider mb-2">
							Device Registration
						</p>
						<p className="text-sm text-[#0A3D62]">
							Allow new device self-registration or require admin approval.
						</p>
						<p className="text-xs text-[#3D5568] mt-2 italic">
							Configuration coming in future update.
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}
