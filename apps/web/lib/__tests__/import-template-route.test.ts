// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkApiRateLimit } = vi.hoisted(() => ({ checkApiRateLimit: vi.fn() }));

vi.mock("@/lib/auth/with-auth", () => ({
	withAuth:
		(handler: (request: Request, context: unknown) => Promise<Response>) => (request: Request) =>
			handler(request, { ownerId: "farm-1", user: { id: "user-1", email: "u@example.com" } }),
}));
vi.mock("@/lib/rate-limit", () => ({ checkApiRateLimit }));

import { GET } from "@/app/api/import-template/route";

const get = (query: string) =>
	GET(new Request(`http://test.local/api/import-template?${query}`) as never);

beforeEach(() => {
	vi.clearAllMocks();
	checkApiRateLimit.mockResolvedValue({ success: true, remaining: 30 });
});

describe("GET /api/import-template", () => {
	it("serves the CSV template with its note lines, header and example row", async () => {
		const res = await get("type=biomass_logs");

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/csv");
		expect(res.headers.get("content-disposition")).toBe(
			'attachment; filename="pakaonai_template_biomass_logs.csv"',
		);
		expect(res.headers.get("cache-control")).toBe("private, no-store");
		const text = await res.text();
		expect(text.startsWith("# ")).toBe(true);
		expect(text).toContain("sampleWeightKg");
	});

	it("serves a workbook template for the feeding schedule", async () => {
		const res = await get("type=feeding_schedule&format=xlsx");

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("spreadsheetml.sheet");
		expect(res.headers.get("content-disposition")).toContain(
			"pakaonai_template_feeding_schedule.xlsx",
		);
		const bytes = new Uint8Array(await res.arrayBuffer());
		expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
	});

	it("rejects an unknown type and is rate limited", async () => {
		expect((await get("type=ponds")).status).toBe(400);
		expect((await get("")).status).toBe(400);

		checkApiRateLimit.mockResolvedValue({ success: false, remaining: 0 });
		expect((await get("type=biomass_logs")).status).toBe(429);
	});
});
