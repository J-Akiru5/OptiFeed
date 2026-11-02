import { requestOrigin } from "@/lib/actions/platform/audit";
import { fail } from "@/lib/api/envelope";
import { ApiError, badRequest, forbidden, rateLimited, unauthorized } from "@/lib/api/errors";
import { withApi } from "@/lib/api/instrumentation";
import { getCurrentUser, getVerifiedSession } from "@/lib/auth/session";
import { isCurrentTenantAdmin } from "@/lib/auth/tenant-admin";
import { isViewingAs } from "@/lib/auth/view-as";
import {
	BackupExportTooLargeError,
	createBackupExportResponse,
	prepareBackupExport,
} from "@/lib/backup/export";
import { MAX_BACKUP_REASON_LENGTH, readOptionalBackupReason } from "@/lib/backup/reason";
import { isEmptyTenantScope, resolveTenantExportScope } from "@/lib/backup/scope";
import { checkBackupExportRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const DEFAULT_TENANT_REASON = "Tenant SQL export requested from the admin Backup page.";

/**
 * Tenant SQL export (issue #353, brief I-106).
 *
 * POST so the reason never lands in a URL or an access log, and so a cross-site
 * GET cannot start a full-tenant read. Authorisation is the same membership
 * chain the tenant console uses: `resolveOrgScope()` is the only source of
 * ids, so the file contains exactly the caller's organizations' rows and
 * nothing else. No step-up: this is the tenant's own data and the brief
 * reserves step-up for the platform export.
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
		if (!(await isCurrentTenantAdmin())) {
			return fail(forbidden("An organization owner or admin may export this data."));
		}
		if (await isViewingAs()) {
			return fail(
				forbidden("A read-only view-as session cannot export data. Exit view-as and try again."),
			);
		}

		const limit = await checkBackupExportRateLimit(user.id);
		if (!limit.success) {
			return fail(
				rateLimited("Export limit reached: 5 exports per hour per user. Try again later.", 3600),
			);
		}

		const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
		const parsedReason = readOptionalBackupReason(body.reason);
		if (!parsedReason.ok) {
			return fail(
				badRequest(`The reason must be a single line of at most ${MAX_BACKUP_REASON_LENGTH}.`),
			);
		}
		const reason = parsedReason.value;

		const scope = await resolveTenantExportScope();
		if (isEmptyTenantScope(scope)) {
			return fail(
				forbidden("You do not administer an active organization, so there is no data to export."),
			);
		}

		try {
			const prepared = await prepareBackupExport(scope);
			return createBackupExportResponse(
				{
					scope,
					actorUserId: user.id,
					actorLabel: user.displayName || user.email || user.farmId,
					reason: reason ?? DEFAULT_TENANT_REASON,
					stepUpAt: null,
					temporaryGrant: false,
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
		route: "POST /api/admin/backup/export",
		shape: "passthrough",
		timeoutMs: 30_000,
		slowMs: 5_000,
		violationMs: 30_000,
	},
);
