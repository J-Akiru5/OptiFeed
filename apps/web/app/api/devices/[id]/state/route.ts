import { ok } from "@/lib/api/envelope";
import { notFound } from "@/lib/api/errors";
import { withApi } from "@/lib/api/instrumentation";
import { withAuth } from "@/lib/auth/with-auth";
import { LEGACY_API_SUNSET } from "@/lib/constants";
import { getDeviceDetail } from "@/lib/feeder/detail";

export const dynamic = "force-dynamic";

interface RouteContext {
	params: Promise<{ id: string }>;
}

/**
 * Live status DTO for the device detail viewer (plan v1.1.0).
 *
 * Polled only while the tab is visible. Scoping is the same guarded read as
 * the page: a device outside the caller's organization/farm is a 404.
 */
export const GET = withApi(
	withAuth(async (_request, _context, routeContext) => {
		const { id } = await (routeContext as RouteContext).params;
		const detail = await getDeviceDetail(id);
		if (!detail) throw notFound("Device not found.");

		return ok(
			{
				deviceId: detail.id,
				status: detail.status,
				lastSeenAt: detail.lastSeenAt,
				lastFedAt: detail.lastFedAt,
				lastFedGrams: detail.lastFedGrams,
				feedLevelPercent: detail.feedLevelPercent,
				hopperCapacityG: detail.hopperCapacityG,
				gramsPerFeeding: detail.gramsPerFeeding,
				rtcOk: detail.rtcOk,
				isPaused: detail.isPaused,
			},
			{ headers: { "Cache-Control": "no-store" } },
		);
	}),
	{ route: "GET /api/devices/{id}/state", timeoutMs: 5_000, sunset: LEGACY_API_SUNSET },
);
