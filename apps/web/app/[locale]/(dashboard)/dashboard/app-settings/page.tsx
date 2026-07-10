import prisma from "@/lib/prisma";
import { Cpu, RefreshCw, Settings, Wifi } from "lucide-react";
import { getTranslations } from "next-intl/server";

export default async function AppSettingsPage() {
	const t = await getTranslations("dashboard.appSettings");

	let device = null;
	try {
		const pond = await prisma.pond.findFirst({
			where: { ownerId: "demo-farmer-1" },
			include: { devices: true },
		});
		if (pond && pond.devices.length > 0) {
			device = pond.devices[0];
		}
	} catch (err) {
		console.error("[AppSettingsPage] Prisma error:", err);
	}

	return (
		<div className="mx-auto max-w-4xl space-y-8">
			<div>
				<h1 className="flex items-center gap-2 text-3xl font-bold text-[var(--ofd-base)]">
					<Settings size={28} />
					{t("title")}
				</h1>
				<p className="mt-2 text-gray-500">{t("desc")}</p>
			</div>

			<div className="space-y-8">
				{/* Device Status */}
				<section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
					<div className="mb-6 border-b border-gray-100 pb-4">
						<h2 className="flex items-center gap-2 text-xl font-semibold text-gray-800">
							<Cpu size={20} />
							{t("deviceStatus")}
						</h2>
						<p className="mt-1 text-sm text-gray-500">{t("deviceStatusDesc")}</p>
					</div>

					{device ? (
						<div className="grid gap-4 md:grid-cols-2">
							<div className="rounded-xl bg-[#F4F7F6] p-4">
								<p className="text-xs font-bold uppercase tracking-wide text-[#3D5568]">
									{t("deviceId")}
								</p>
								<p className="mt-1 font-mono text-sm font-bold text-[#0A3D62]">{device.id}</p>
							</div>
							<div className="rounded-xl bg-[#F4F7F6] p-4">
								<p className="text-xs font-bold uppercase tracking-wide text-[#3D5568]">
									{t("connectionStatus")}
								</p>
								<p className="mt-1 text-sm font-bold text-[#1E7B34]">{t("online")}</p>
							</div>
							<div className="rounded-xl bg-[#F4F7F6] p-4">
								<p className="text-xs font-bold uppercase tracking-wide text-[#3D5568]">
									{t("hopperLevel")}
								</p>
								<p className="mt-1 text-sm font-bold text-[#0A3D62]">{device.hopperLevelPct}%</p>
							</div>
							<div className="rounded-xl bg-[#F4F7F6] p-4">
								<p className="text-xs font-bold uppercase tracking-wide text-[#3D5568]">
									{t("firmware")}
								</p>
								<p className="mt-1 font-mono text-sm font-bold text-[#0A3D62]">v1.4.2</p>
							</div>
						</div>
					) : (
						<p className="text-gray-500">{t("noDevice")}</p>
					)}
				</section>

				{/* Network Settings */}
				<section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
					<div className="mb-6 border-b border-gray-100 pb-4">
						<h2 className="flex items-center gap-2 text-xl font-semibold text-gray-800">
							<Wifi size={20} />
							{t("network")}
						</h2>
						<p className="mt-1 text-sm text-gray-500">{t("networkDesc")}</p>
					</div>

					<div className="space-y-4">
						<div className="flex flex-col gap-2">
							<label htmlFor="wifiSsid" className="text-sm font-medium text-gray-700">
								{t("wifiSsid")}
							</label>
							<input
								id="wifiSsid"
								type="text"
								defaultValue="OptiFeed-Farm-5G"
								className="rounded-lg border border-gray-200 px-4 py-2 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)]"
							/>
						</div>
						<div className="flex flex-col gap-2">
							<label htmlFor="wifiPassword" className="text-sm font-medium text-gray-700">
								{t("wifiPassword")}
							</label>
							<input
								id="wifiPassword"
								type="password"
								defaultValue="••••••••"
								className="rounded-lg border border-gray-200 px-4 py-2 outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)]"
							/>
						</div>
						<div className="flex flex-col gap-2">
							<label htmlFor="serverUrl" className="text-sm font-medium text-gray-700">
								{t("serverUrl")}
							</label>
							<input
								id="serverUrl"
								type="text"
								defaultValue="wss://optifeed.local:8080"
								className="rounded-lg border border-gray-200 px-4 py-2 font-mono text-sm outline-none focus:border-[var(--ofd-base)] focus:ring-1 focus:ring-[var(--ofd-base)]"
							/>
						</div>
					</div>

					<div className="mt-6">
						<button
							type="button"
							className="flex min-h-[var(--ofd-touch-min)] min-w-[120px] items-center justify-center rounded-lg bg-[var(--ofd-action)] px-6 font-medium text-white transition-opacity hover:opacity-90"
						>
							{t("saveNetwork")}
						</button>
					</div>
				</section>

				{/* Device Actions */}
				<section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
					<div className="mb-6 border-b border-gray-100 pb-4">
						<h2 className="flex items-center gap-2 text-xl font-semibold text-gray-800">
							<RefreshCw size={20} />
							{t("deviceActions")}
						</h2>
						<p className="mt-1 text-sm text-gray-500">{t("deviceActionsDesc")}</p>
					</div>

					<div className="space-y-3">
						<button
							type="button"
							className="flex min-h-[var(--ofd-touch-min)] w-full items-center justify-between rounded-xl border border-[#0A3D62]/10 bg-white px-4 font-bold text-[#0A3D62] transition hover:bg-[#F4F7F6]"
						>
							<span className="flex items-center gap-3">
								<RefreshCw className="h-5 w-5 text-[#E85A2A]" />
								{t("syncNow")}
							</span>
							<svg
								className="h-5 w-5 text-[#3D5568]"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								role="img"
								aria-label="Navigate"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M9 5l7 7-7 7"
								/>
							</svg>
						</button>
						<button
							type="button"
							className="flex min-h-[var(--ofd-touch-min)] w-full items-center justify-between rounded-xl border border-red-100 bg-red-50 px-4 font-bold text-[#C42B3A] transition hover:bg-red-100"
						>
							<span className="flex items-center gap-3">
								<Cpu className="h-5 w-5" />
								{t("restartDevice")}
							</span>
							<svg
								className="h-5 w-5"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								role="img"
								aria-label="Navigate"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M9 5l7 7-7 7"
								/>
							</svg>
						</button>
					</div>
				</section>
			</div>
		</div>
	);
}
