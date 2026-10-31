import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
	DEVICE_TOKEN_ROUTES,
	PLATFORM_ADMIN_ROUTES,
	PUBLIC_ROUTES,
	TENANT_ADMIN_ROUTES,
	analyzeRoute,
	exportedHandlers,
} from "../../../scripts/api/auth-check.mjs";

/**
 * `scripts/api/auth-check.mjs` (#332) must assert the guard is in the exported
 * handler's call path, not merely imported. The fixtures below are the negative
 * proof: an import-only route, a guard called from a helper, a handler wrapped
 * in the wrong guard, and a missing import all fail.
 */

function failures(path: string, source: string): string[] {
	return analyzeRoute(path, source).failures;
}

const SESSION_IMPORT = 'import { withAuth } from "@/lib/auth/with-auth";';
const CRON_IMPORT = 'import { withCronAuth } from "@/lib/auth/with-auth";';
const DEVICE_IMPORT = 'import { verifyDeviceToken } from "@/lib/device-auth";';
const PLATFORM_IMPORTS = [
	'import { getVerifiedSession } from "@/lib/auth/verify-session";',
	'import { isCurrentPlatformAdmin } from "@/lib/auth/require-platform-admin";',
].join("\n");

describe("exportedHandlers", () => {
	it("reads a const handler through nested calls and template literals", () => {
		const source = `
			export const GET = withApi(
				withAuth(async () => {
					const label = \`a ) } literal\`;
					return Response.json({ label });
				}),
				{ route: "GET /x" },
			);
			export const dynamic = "force-dynamic";
		`;

		const handlers = exportedHandlers(source);
		expect([...handlers.keys()]).toEqual(["GET"]);
		expect(handlers.get("GET")).toContain("withAuth(async () =>");
		expect(handlers.get("GET")).not.toContain("force-dynamic");
	});

	it("reads an exported function handler body", () => {
		const handlers = exportedHandlers(
			"export async function POST(request: Request) { return new Response(null); }",
		);
		expect(handlers.get("POST")).toContain("return new Response(null)");
	});
});

describe("session routes", () => {
	it("passes when withAuth wraps the exported handler", () => {
		const source = `${SESSION_IMPORT}
			import { withApi } from "@/lib/api/instrumentation";
			export const GET = withApi(withAuth(async () => Response.json({ ok: true })));`;

		expect(failures("user-role/route.ts", source)).toEqual([]);
	});

	it("passes when withAuth is applied directly", () => {
		const source = `${SESSION_IMPORT}
			export const POST = withAuth(async () => Response.json({ ok: true }));`;

		expect(failures("chat/route.ts", source)).toEqual([]);
	});

	it("fails an import-only route whose handler is not wrapped (negative fixture)", () => {
		const source = `${SESSION_IMPORT}
			export const GET = async () => Response.json({ ok: true });`;

		expect(failures("user-role/route.ts", source)).toEqual([
			"GET: handler is not wrapped in withAuth()",
		]);
	});

	it("fails when the guard is only called from a helper outside the handler", () => {
		const source = `${SESSION_IMPORT}
			async function guard() { return withAuth(async () => Response.json({ ok: true })); }
			export const GET = async () => Response.json({ ok: true });`;

		expect(failures("user-role/route.ts", source)).toContain(
			"GET: handler is not wrapped in withAuth()",
		);
	});

	it("fails when the guard is not imported from the auth module", () => {
		const source = `import { withAuth } from "./local-auth";
			export const GET = withAuth(async () => Response.json({ ok: true }));`;

		expect(failures("user-role/route.ts", source)).toEqual([
			"GET: withAuth is not imported from @/lib/auth/with-auth",
		]);
	});

	it("checks every exported method, not just the first", () => {
		const source = `${SESSION_IMPORT}
			export const GET = withAuth(async () => Response.json({ ok: true }));
			export const POST = async () => Response.json({ ok: true });`;

		expect(failures("user-role/route.ts", source)).toEqual([
			"POST: handler is not wrapped in withAuth()",
		]);
	});

	it("fails a file with no exported handler", () => {
		expect(failures("user-role/route.ts", "export const dynamic = 'force-dynamic';")).toEqual([
			"no exported HTTP handler (GET/POST/...) found",
		]);
	});
});

describe("cron and device-token routes", () => {
	it("requires withCronAuth on a cron route", () => {
		const guarded = `${CRON_IMPORT}
			export const GET = withApi(withCronAuth(async () => Response.json({ ok: true })));`;
		expect(failures("cron/device-watch/route.ts", guarded)).toEqual([]);

		const wrongGuard = `${SESSION_IMPORT}
			export const GET = withApi(withAuth(async () => Response.json({ ok: true })));`;
		expect(failures("cron/device-watch/route.ts", wrongGuard)).toEqual([
			"GET: handler is not wrapped in withCronAuth()",
			"GET: withCronAuth is not imported from @/lib/auth/with-auth",
		]);
	});

	it("requires a verifyDeviceToken call inside the device handler", () => {
		const guarded = `${DEVICE_IMPORT}
			export const POST = withApi(async (request: Request) => {
				const device = await verifyDeviceToken(request.headers.get("x-device-token") ?? "");
				return new Response(device ? "ok" : "no");
			});`;
		expect(failures("ingest/route.ts", guarded)).toEqual([]);

		const importOnly = `${DEVICE_IMPORT}
			export const POST = withApi(async () => new Response("ok"));`;
		expect(failures("ingest/route.ts", importOnly)).toEqual([
			"POST: handler does not call verifyDeviceToken()",
		]);
	});
});

describe("tenant-admin routes", () => {
	const TENANT_IMPORTS = [
		'import { getVerifiedSession } from "@/lib/auth/session";',
		'import { isCurrentTenantAdmin } from "@/lib/auth/tenant-admin";',
	].join("\n");

	it("requires the session and the tenant-admin check inside the handler", () => {
		const guarded = `${TENANT_IMPORTS}
			export const POST = withApi(async () => {
				const session = await getVerifiedSession();
				if (!session || !(await isCurrentTenantAdmin())) return new Response(null, { status: 403 });
				return new Response("ok");
			});`;
		expect(failures("admin/backup/export/route.ts", guarded)).toEqual([]);

		const unguarded = `${TENANT_IMPORTS}
			export const POST = withApi(async () => new Response("ok"));`;
		expect(failures("admin/backup/export/route.ts", unguarded)).toEqual([
			"POST: handler does not call getVerifiedSession()",
			"POST: handler does not call isCurrentTenantAdmin()",
		]);
	});
});

describe("platform-admin and public routes", () => {
	it("requires both platform checks inside the handler", () => {
		const guarded = `${PLATFORM_IMPORTS}
			export const GET = withApi(async () => {
				const session = await getVerifiedSession();
				if (!session || !(await isCurrentPlatformAdmin())) return new Response(null, { status: 403 });
				return new Response("ok");
			});`;
		expect(failures("platform/audit/export/route.ts", guarded)).toEqual([]);

		const halfGuarded = `${PLATFORM_IMPORTS}
			export const GET = withApi(async () => {
				const session = await getVerifiedSession();
				return new Response(session ? "ok" : "no");
			});`;
		expect(failures("platform/audit/export/route.ts", halfGuarded)).toEqual([
			"GET: handler does not call isCurrentPlatformAdmin()",
		]);
	});

	it("rejects a session guard on the public health probe", () => {
		const source = `${SESSION_IMPORT}
			export const GET = withApi(withAuth(async () => Response.json({ status: "ok" })));`;

		expect(failures("health/route.ts", source)).toEqual([
			"GET: public route must not use a session/device guard",
		]);
	});

	it("accepts the documented re-export 404 hub", () => {
		const source = `const handler = withApi(async () => new Response(null, { status: 404 }));
			export { handler as GET, handler as POST };`;

		expect(failures("[...fallback]/route.ts", source)).toEqual([]);
	});
});

describe("the real route tree", () => {
	const API_DIR = join(process.cwd(), "app", "api");

	function routeFiles(dir: string): string[] {
		return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) return routeFiles(full);
			return entry.name === "route.ts" ? [full] : [];
		});
	}

	const routes = routeFiles(API_DIR).map((file) => ({
		path: relative(API_DIR, file).split(sep).join("/"),
		source: readFileSync(file, "utf8"),
	}));

	it("passes the check for every route file", () => {
		expect(routes.length).toBeGreaterThan(0);

		const failed = routes.flatMap((route) =>
			analyzeRoute(route.path, route.source).failures.map(
				(failure: string) => `${route.path}: ${failure}`,
			),
		);
		expect(failed).toEqual([]);
	});

	it("keeps every allow-list entry pointing at a real route", () => {
		const paths = new Set(routes.map((route) => route.path));
		for (const path of [
			...PUBLIC_ROUTES.keys(),
			...DEVICE_TOKEN_ROUTES.keys(),
			...PLATFORM_ADMIN_ROUTES.keys(),
			...TENANT_ADMIN_ROUTES.keys(),
		]) {
			expect(existsSync(join(API_DIR, path)), `${path} is allow-listed but missing`).toBe(true);
			expect(paths.has(path), `${path} is allow-listed but not a route file`).toBe(true);
		}
	});

	it("keeps the public allow-list explicit and small", () => {
		// A reviewer sees exactly which routes may skip a guard.
		expect([...PUBLIC_ROUTES.keys()].sort()).toEqual(["[...fallback]/route.ts", "health/route.ts"]);
	});
});
