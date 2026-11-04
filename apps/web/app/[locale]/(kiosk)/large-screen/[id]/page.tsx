import { FeederViewerLazy } from "@/components/feeder/feeder-viewer-lazy";
import { Link } from "@/i18n/routing";
import { getDeviceDetail } from "@/lib/feeder/detail";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

export const revalidate = 0;
export const dynamic = "force-dynamic";

/**
 * Full-bleed live view for a wall display (#616).
 *
 * It sits outside the dashboard route group, so it has no sidebar, header or
 * bottom bar: only the pond, the feeder and the live readings. It needs no
 * interaction to read — the 3D scene opens on the isometric view where the
 * component labels live, and every value is also text in the strip below it.
 *
 * Scoping is the same guarded read as the device page: a device outside the
 * caller's organization is a 404, never a blank display.
 */
export default async function LargeScreenPage({
	params,
}: {
	params: Promise<{ locale: string; id: string }>;
}) {
	const { id } = await params;
	const detail = await getDeviceDetail(id);
	if (!detail) notFound();

	const t = await getTranslations("dashboard.feederViewer");

	return (
		<main className="flex min-h-dvh flex-col bg-[#071a2a] text-white">
			<header className="flex flex-wrap items-end justify-between gap-4 px-6 py-5 lg:px-10">
				<div className="min-w-0">
					<p className="text-xs font-black uppercase tracking-[0.2em] text-[#8fc0ea]">
						{detail.pond.name}
					</p>
					<h1 className="mt-1 truncate text-3xl font-black lg:text-4xl">{detail.label}</h1>
					{/*
					 * No status here on purpose (#666): the viewer below owns the live
					 * status badge and refreshes it every 15 s. A second, server-rendered
					 * copy would contradict it after the feeder changes state.
					 */}
				</div>
				<Link
					href={`/dashboard/devices/${detail.id}`}
					className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/20 px-4 text-sm font-bold text-white/80 transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
				>
					<ArrowLeft className="size-4" aria-hidden="true" />
					{t("back")}
				</Link>
			</header>

			<div className="flex-1 px-6 pb-6 lg:px-10 lg:pb-10">
				<FeederViewerLazy
					deviceId={detail.id}
					label={detail.label}
					initialStatus={detail.status}
					initialLevel={detail.feedLevelPercent}
					initialLastFedAt={detail.lastFedAt?.toISOString() ?? null}
					initialWaterTempOk={detail.waterTempUpdatedAt ? detail.waterTempOk : null}
					initialWaterTempC={detail.waterTempC}
					initialWaterTempUpdatedAt={detail.waterTempUpdatedAt?.toISOString() ?? null}
					initialRtcOk={detail.rtcOk}
					initialLastSeenAt={detail.lastSeenAt?.toISOString() ?? null}
					initialSignalDbm={detail.signalDbm}
					initialFirmwareVersion={detail.firmwareVersion}
					initialFeedLevelUpdatedAt={detail.feedLevelUpdatedAt?.toISOString() ?? null}
					initialSensorOffline={detail.sensorOffline}
					staleAfterMs={detail.staleAfterMs}
					kiosk
				/>
			</div>
		</main>
	);
}
