/**
 * API regulation toolkit (see /API_REGULATION.md).
 *
 * Route handlers should compose these in one direction only:
 *
 *   export const GET = withApi(withAuth(async (request, { ownerId }) => {
 *     const rows = await repo.list(ownerId);
 *     return ok(rows);
 *   }), { route: "GET /api/user-role", sunset: LEGACY_SUNSET });
 */
export {
	badRequest,
	conflict,
	forbidden,
	notFound,
	rateLimited,
	timeout,
	unauthorized,
	validationFailed,
} from "./errors";
export { ApiError, codeForStatus, toApiError } from "./errors";
export type { ApiErrorCode } from "./errors";
export { cachedOk, created, accepted, fail, noContent, ok, paginated } from "./envelope";
export type { ErrorEnvelope, PageMeta, SuccessEnvelope } from "./envelope";
export { withApi } from "./instrumentation";
export type { ApiRouteConfig } from "./instrumentation";
export { getRequestMetrics, recordPhase, recordQuery } from "./request-context";
