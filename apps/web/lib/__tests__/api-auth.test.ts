import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// session.ts (and therefore with-auth.ts) pulls in next-intl, which cannot
// load under vitest. Mock only the i18n leaves so the real auth logic runs.
vi.mock("@/i18n/routing", () => ({ redirect: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "en") }));

vi.mock("@/lib/supabase/server", () => {
	const auth = { getUser: vi.fn(async () => ({ data: { user: null } })) };
	return { createClient: vi.fn(async () => ({ auth })) };
});

vi.mock("@/lib/prisma", () => ({
	default: {
		user: { findUnique: vi.fn() },
		pond: { findMany: vi.fn(), findFirst: vi.fn() },
	},
}));

vi.mock("@/lib/rate-limit", () => ({
	checkApiRateLimit: vi.fn(() => ({ success: true })),
}));

vi.mock("@/lib/chat/context", () => ({ buildChatContext: vi.fn(async () => ({})) }));
vi.mock("@/lib/chat/fallback", () => ({
	createNamespaceTranslator: vi.fn(() => (k: string) => k),
	runFallbackIntent: vi.fn(async () => "ok"),
}));
vi.mock("@/lib/chat/prompt", () => ({
	buildSystemPrompt: vi.fn(() => ""),
	enforcePromptLimit: vi.fn((s: string) => s),
	sanitizeInput: vi.fn((s: string) => s),
}));
vi.mock("@/lib/gemini", () => ({
	geminiDebugInfo: vi.fn(() => ({ model: "t" })),
	isGeminiEnabled: vi.fn(() => false),
	isGeminiQuotaError: vi.fn(() => false),
	streamGemini: vi.fn(async function* () {}),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { POST as chatPOST } from "@/app/api/chat/route";
import { GET as batchGET } from "@/app/api/export/batch/route";
import { GET as exportGET } from "@/app/api/export/route";
import { POST as confirmPOST } from "@/app/api/import/confirm/route";
import { POST as importPOST } from "@/app/api/import/route";
import prisma from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

type AuthUser = { id: string; email: string } | null;

async function setAuthUser(user: AuthUser) {
	const client = await createClient();
	client.auth.getUser = vi.fn(async () => ({ data: { user } })) as never;
}

const findUnique = vi.mocked(prisma.user.findUnique);
const pondFindMany = vi.mocked(prisma.pond.findMany);

// The lookalike: local part matches a real farm, domain does not.
const EVIL: AuthUser = { id: "sb-1", email: "demo-farmer-1@evil.com" };
const GOOD: AuthUser = { id: "sb-1", email: "demo-farmer-1@pond.optifeed.local" };
const ROW = { farmId: "demo-farmer-1", supabaseId: "sb-1", role: "ADMIN" };

function req(url: string, init?: RequestInit) {
	return new Request(url, init) as never;
}

describe("API routes reject lookalike-domain sessions (F-002)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("GET /api/export returns 401 for demo-farmer-1@evil.com", async () => {
		await setAuthUser(EVIL);
		findUnique.mockResolvedValue(ROW as never);
		const res = await exportGET(req("http://t.local/api/export?type=biomass_logs"));
		expect(res.status).toBe(401);
	});

	it("GET /api/export/batch returns 401 for demo-farmer-1@evil.com", async () => {
		await setAuthUser(EVIL);
		findUnique.mockResolvedValue(ROW as never);
		const res = await batchGET(req("http://t.local/api/export/batch"));
		expect(res.status).toBe(401);
	});

	it("POST /api/import returns 401 for demo-farmer-1@evil.com", async () => {
		await setAuthUser(EVIL);
		findUnique.mockResolvedValue(ROW as never);
		const res = await importPOST(req("http://t.local/api/import", { method: "POST" }));
		expect(res.status).toBe(401);
	});

	it("POST /api/import/confirm returns 401 for demo-farmer-1@evil.com", async () => {
		await setAuthUser(EVIL);
		findUnique.mockResolvedValue(ROW as never);
		const res = await confirmPOST(req("http://t.local/api/import/confirm", { method: "POST" }));
		expect(res.status).toBe(401);
	});

	it("POST /api/chat returns 401 for demo-farmer-1@evil.com", async () => {
		await setAuthUser(EVIL);
		findUnique.mockResolvedValue(ROW as never);
		const res = await chatPOST(req("http://t.local/api/chat", { method: "POST" }));
		expect(res.status).toBe(401);
	});
});

describe("API routes accept a valid pond-email session (F-002/F-005)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		pondFindMany.mockResolvedValue([
			{ id: "p1", ownerId: "demo-farmer-1", status: "ACTIVE" },
		] as never);
	});

	it("POST /api/import returns 200 for a valid session", async () => {
		await setAuthUser(GOOD);
		findUnique.mockResolvedValue(ROW as never);
		const res = await importPOST(
			req("http://t.local/api/import", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ type: "biomass_logs", csvData: "sampleWeightKg,sampleCount\n10,5" }),
			}),
		);
		expect(res.status).toBe(200);
	});

	it("POST /api/chat returns 200 for a valid session", async () => {
		await setAuthUser(GOOD);
		findUnique.mockResolvedValue(ROW as never);
		const res = await chatPOST(
			req("http://t.local/api/chat", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ locale: "en", history: [{ role: "user", content: "hi" }] }),
			}),
		);
		expect(res.status).toBe(200);
	});
});

// ─── Static route-authorization sweep ────────────────────────────────────────
//
// The tests above exercise a handful of routes; this sweep asserts the
// invariant for the whole tree — every app/api route handler authenticates via
// withAuth/withCronAuth, a device token, or an explicit allowlist entry.

const API_DIR = join(process.cwd(), "app", "api");

function routeFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) return routeFiles(full);
		return entry.name === "route.ts" ? [full] : [];
	});
}

const WRAPPED_HANDLER = /export const (GET|POST|PUT|PATCH|DELETE)\s*=\s*(withAuth|withCronAuth)\(/;

// Device endpoints authenticate with a provisioning token instead of a session.
const DEVICE_TOKEN_ROUTES = new Set([
	"ingest/route.ts",
	"feed-command/route.ts",
	"schedule-sync/route.ts",
]);

// Unauthenticated by design: liveness probe, no tenant data.
const ALLOWLIST = new Set(["health/route.ts"]);

describe("every API route is authenticated or explicitly allowlisted (static)", () => {
	const routes = routeFiles(API_DIR).map((file) => ({
		path: relative(API_DIR, file).split(sep).join("/"),
		source: readFileSync(file, "utf8"),
	}));

	it("finds the route tree", () => {
		expect(routes.length).toBeGreaterThan(0);
	});

	it("wraps each handler with withAuth/withCronAuth, device auth, or allowlists it", () => {
		const unguarded = routes
			.filter((route) => {
				if (ALLOWLIST.has(route.path)) return false;
				if (WRAPPED_HANDLER.test(route.source)) return false;
				if (DEVICE_TOKEN_ROUTES.has(route.path)) {
					return !route.source.includes("verifyDeviceToken");
				}
				return true;
			})
			.map((route) => route.path);

		expect(unguarded).toEqual([]);
	});
});
