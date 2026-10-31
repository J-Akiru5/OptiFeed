import { actorContext, requestOrigin } from "@/lib/actions/platform/audit";
import { fail } from "@/lib/api/envelope";
import { ApiError, badRequest, forbidden, rateLimited, unauthorized } from "@/lib/api/errors";
import { withApi } from "@/lib/api/instrumentation";
import { isCurrentPlatformAdmin } from "@/lib/auth/require-platform-admin";
import { getCurrentUser, getVerifiedSession } from "@/lib/auth/session";
import { STEP_UP_REQUIRED_CODE, isStepUpRequiredError, requireStepUp } from "@/lib/auth/step-up";
import { isViewingAs } from "@/lib/auth/view-as";
import {
	BackupExportTooLargeError,
	createBackupExportResponse,
	prepareBackupExport,
} from "@/lib/backup/export";
import { checkBackupExportRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 500;

function readReason(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (trimmed.length < MIN_REASON_LENGTH || trimmed.length > MAX_REASON_LENGTH) return null;
	return trimmed;
}

/**
 * Full-database SQL export (issue #353, brief I-106).
 *
 * Platform admin only, behind a fresh step-up re-authentication, a mandatory
 * reason and a per-user rate limit — the same treatment as revealing a device
 * token. The audit row records who, when, scope, row counts, size, checksum and
 * outcome, never row data.
 */
export const POST = withApi(
	async (request) => {
		const session = await getVerifiedSession();
		if (!session) return fail(unauthorized());

		const user = await getCurrentUser();
		if (!user) return fail(unauthorized());
		if (user.mustChangePassword) {
			return fail(forbidden("Change your temporary password before exporting data."));
		}
		if (!(await isCurrentPlatformAdmin())) {
			return fail(forbidden("Platform access is required."));
		}
		if (await isViewingAs()) {
			return fail(
				forbidden("A read-only view-as session cannot export data. Exit view-as and try again."),
			);
		}

		let stepUpAt: Date;
		try {
			stepUpAt = await requireStepUp();
		} catch (error) {
			if (isStepUpRequiredError(error)) {
				return fail(
					new ApiError(403, "FORBIDDEN", error.message, {
						details: { code: STEP_UP_REQUIRED_CODE },
					}),
				);
			}
			throw error;
		}

		const limit = await checkBackupExportRateLimit(user.id);
		if (!limit.success) {
			return fail(
				rateLimited("Export limit reached: 5 exports per hour per user. Try again later.", 3600),
			);
		}

		const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
		const reason = readReason(body.reason);
		if (!reason) {
			return fail(
				badRequest(
					`A reason of ${MIN_REASON_LENGTH}–${MAX_REASON_LENGTH} characters is required for a full database export.`,
				),
			);
		}

		const actor = await actorContext();

		try {
			const prepared = await prepareBackupExport({ kind: "platform" });
			return createBackupExportResponse(
				{
					scope: { kind: "platform" },
					actorUserId: user.id,
					actorLabel: user.displayName || user.email || user.farmId,
					reason,
					stepUpAt,
					temporaryGrant: actor.temporaryGrant,
					origin: await requestOrigin(),
				},
				prepared,
			);
		} catch (error) {
			if (error instanceof BackupExportTooLargeError) {
				return fail(new ApiError(413, "PAYLOAD_TOO_LARGE", error.message));
			}
			throw error;
		}
	},
	{
		route: "POST /api/superadmin/backup/export",
		shape: "passthrough",
		timeoutMs: 30_000,
		slowMs: 5_000,
		violationMs: 30_000,
	},
);
