import { DashboardPageHeader } from "@/components/dashboard/dashboard-ui";
import { FeederViewerLazy } from "@/components/feeder/feeder-viewer-lazy";
import { formatFarmDateTime } from "@/lib/date-local";
import { getDeviceDetail } from "@/lib/feeder/detail";
import { Cpu, Gauge, Radio, Ruler, Wheat } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

export const revalidate = 0;

export default async function DeviceDetailPage({
	params,
}: {
	params: Promise<{ locale: string; id: string }>;
}) {
	const { id } = await params;
	const detail = await getDeviceDetail(id);
	if (!detail) notFound();

	const [t, tDates] = await Promise.all([
		getTranslations("dashboard.feederViewer"),
		getTranslations("dates"),
	]);
	const lastFed = detail.lastFedAt
		? formatFarmDateTime(detail.lastFedAt, tDates).full
		: t("noReading");
	const statusKey = `status${detail.status.charAt(0).toUpperCase()}${detail.status.slice(1)}`;
	const rows = [
		{
			icon: Gauge,
			label: t("hopperLevel"),
			value: detail.feedLevelPercent === null ? "—" : `${Math.round(detail.feedLevelPercent)}%`,
		},
		{ icon: Wheat, label: t("perFeeding"), value: `${detail.gramsPerFeeding} g` },
		{ icon: Radio, label: t("rtc"), value: detail.rtcOk ? t("rtcOk") : t("rtcUnknown") },
		{ icon: Ruler, label: t("deviceMac"), value: detail.mac },
	];

	return (
		<div className="mx-auto w-full max-w-6xl min-w-0 space-y-6 pb-20 [contain:inline-size]">
			<DashboardPageHeader
				icon={Cpu}
				title={detail.label}
				description={t("desc", { pond: detail.pond.name })}
			/>

			<div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
				<FeederViewerLazy
					deviceId={detail.id}
					label={detail.label}
					initialStatus={detail.status}
					initialLevel={detail.feedLevelPercent}
					initialLastFedAt={detail.lastFedAt?.toISOString() ?? null}
				/>

				<aside
					aria-label={t("detailsLabel")}
					className="min-w-0 space-y-3 rounded-3xl border border-[#0A3D62]/10 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900"
				>
					<div className="flex items-center justify-between gap-2">
						<p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#3D5568] dark:text-gray-400">
							{t("detailsLabel")}
						</p>
						<span className="rounded-full bg-[#0A3D62]/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-[#0A3D62] dark:bg-white/10 dark:text-[#8fc0ea]">
							{t(statusKey)}
						</span>
					</div>
					<dl className="divide-y divide-gray-100 dark:divide-gray-800">
						{rows.map((row) => (
							<div key={row.label} className="flex items-start gap-3 py-3">
								<row.icon
									aria-hidden="true"
									className="mt-0.5 size-4 shrink-0 text-[#3D5568] dark:text-gray-400"
								/>
								<div className="min-w-0 flex-1">
									<dt className="text-[10px] font-black uppercase tracking-wider text-[#3D5568] dark:text-gray-400">
										{row.label}
									</dt>
									<dd className="mt-0.5 break-words text-sm font-bold text-[#0A3D62] dark:text-gray-100">
										{row.value}
									</dd>
								</div>
							</div>
						))}
						<div className="py-3">
							<dt className="text-[10px] font-black uppercase tracking-wider text-[#3D5568] dark:text-gray-400">
								{t("lastFed")}
							</dt>
							<dd className="mt-0.5 text-sm font-bold text-[#0A3D62] dark:text-gray-100">
								{lastFed}
							</dd>
						</div>
					</dl>
				</aside>
			</div>
		</div>
	);
}
