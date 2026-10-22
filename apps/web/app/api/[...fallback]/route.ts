import { fail } from "@/lib/api/envelope";
import { notFound } from "@/lib/api/errors";
import { withApi } from "@/lib/api/instrumentation";

/**
 * Unknown `/api/*` paths must 404 with the §4.2 error envelope, not an empty
 * framework response. `[..., /api/v1/...]` is rewritten to this tree before
 * matching, so one handler covers both the versioned and legacy surfaces.
 */
const handler = withApi(
	async (request: Request) => {
		const url = new URL(request.url);
		return fail(notFound(`No API route matches ${request.method} ${url.pathname}.`));
	},
	{ route: "ANY /api/{fallback}", cacheControl: "no-store" },
);

export {
	handler as DELETE,
	handler as GET,
	handler as HEAD,
	handler as OPTIONS,
	handler as PATCH,
	handler as POST,
	handler as PUT,
};
