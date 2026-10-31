// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The import preview is the one validation path for CSV and workbook uploads
 * (I-107). These tests drive the route with real multipart requests and the
 * real reader, mapper and writer; only auth, rate limiting and the cap lookup
 * are stubbed.
 */

const { requireWriteAccess, checkApiRateLimit, checkScheduleAgainstCap } = vi.hoisted(() => ({
	requireWriteAccess: vi.fn(),
	checkApiRateLimit: vi.fn(),
	checkScheduleAgainstCap: vi.fn(),
}));

vi.mock("@/lib/auth/with-auth", () => ({
	withAuth:
		(handler: (request: Request, context: unknown) => Promise<Response>) => (request: Request) =>
			handler(request, { ownerId: "farm-1", user: { id: "user-1", email: "u@example.com" } }),
}));
vi.mock("@/lib/auth/session", () => ({ requireWriteAccess }));
vi.mock("@/lib/rate-limit", () => ({ checkApiRateLimit }));
vi.mock("@/lib/schedule/sheet", () => ({ checkScheduleAgainstCap }));

import { POST } from "@/app/api/import-prepare/route";
import { buildWorkbookBuffer } from "@/lib/xlsx/writer";

interface Prepared {
	validRows: number;
	csvData: string;
	structural: string | null;
	mapping: Record<string, string>;
	schedule: { scheduleStart: string; scheduleEnd: string; feedsPerDay: number } | null;
	capCheck: unknown;
}

function upload(fields: Record<string, string | File>) {
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.set(key, value);
	return new Request("http://test.local/api/import-prepare", {
		method: "POST",
		body: form,
	}) as never;
}

const csvFile = (text: string, name = "data.csv") => new File([text], name, { type: "text/csv" });

async function prepared(res: Response): Promise<Prepared> {
	return (await res.json()).data as Prepared;
}

beforeEach(() => {
	vi.clearAllMocks();
	requireWriteAccess.mockResolvedValue(undefined);
	checkApiRateLimit.mockResolvedValue({ success: true, remaining: 30 });
	checkScheduleAgainstCap.mockResolvedValue({
		feedsPerDay: 3,
		dailyG: 450,
		capG: 1000,
		overCap: false,
	});
});

describe("POST /api/import-prepare guards", () => {
	it("needs write access", async () => {
		requireWriteAccess.mockRejectedValue(new Error("viewer"));

		const res = await POST(upload({ type: "biomass_logs", file: csvFile("a\n1") }));

		expect(res.status).toBe(403);
	});

	it("is rate limited", async () => {
		checkApiRateLimit.mockResolvedValue({ success: false, remaining: 0 });

		const res = await POST(upload({ type: "biomass_logs", file: csvFile("a\n1") }));

		expect(res.status).toBe(429);
	});

	it("rejects a body that is not a multipart form", async () => {
		const res = await POST(
			new Request("http://test.local/api/import-prepare", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{}",
			}) as never,
		);

		expect(res.status).toBe(400);
	});

	it("rejects an unknown type and a missing file", async () => {
		expect((await POST(upload({ type: "ponds", file: csvFile("a\n1") }))).status).toBe(400);
		expect((await POST(upload({ type: "biomass_logs" }))).status).toBe(400);
		expect((await POST(upload({ type: "biomass_logs", file: csvFile("") }))).status).toBe(400);
	});

	it("refuses macro workbooks and other extensions", async () => {
		const macro = await POST(upload({ type: "biomass_logs", file: csvFile("x", "x.xlsm") }));
		const text = await POST(upload({ type: "biomass_logs", file: csvFile("x", "x.txt") }));

		expect(macro.status).toBe(400);
		expect(text.status).toBe(400);
		expect((await text.json()).error.message).toBe("Upload a .csv or .xlsx file.");
	});

	it("refuses a file over the 5 MB limit", async () => {
		const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.csv", { type: "text/csv" });

		const res = await POST(upload({ type: "biomass_logs", file: big }));

		expect(res.status).toBe(413);
	});

	it("refuses a corrupt workbook with a readable message", async () => {
		const res = await POST(
			upload({
				type: "biomass_logs",
				file: new File([new Uint8Array([1, 2, 3, 4])], "bad.xlsx"),
			}),
		);

		expect(res.status).toBe(400);
	});
});

describe("POST /api/import-prepare previews", () => {
	it("maps the headers of a CSV and returns canonical CSV for the confirm step", async () => {
		const res = await POST(
			upload({
				type: "biomass_logs",
				file: csvFile("Sample Weight (kg),Sample_Count\n10,5\n12,6"),
			}),
		);

		expect(res.status).toBe(200);
		const body = await prepared(res);
		expect(body.validRows).toBe(2);
		expect(body.structural).toBeNull();
		expect(body.csvData).toContain("sampleWeightKg");
		expect(body.capCheck).toBeNull();
	});

	it("honours a hand-picked column mapping and ignores a broken mapping string", async () => {
		const file = csvFile("Total kg,Fish\n10,5");

		const mapped = await prepared(
			await POST(
				upload({
					type: "biomass_logs",
					file,
					mapping: JSON.stringify({ sampleWeightKg: "Total kg", sampleCount: "Fish" }),
				}),
			),
		);
		const broken = await prepared(
			await POST(upload({ type: "biomass_logs", file, mapping: "{nope" })),
		);

		expect(mapped.validRows).toBe(1);
		expect(mapped.mapping).toMatchObject({ sampleWeightKg: "Total kg", sampleCount: "Fish" });
		expect(broken.structural).toBe("missingColumns");
		for (const bad of ["[]", "3", '{"sampleWeightKg":3}']) {
			const res = await POST(upload({ type: "biomass_logs", file, mapping: bad }));
			expect((await prepared(res)).structural).toBe("missingColumns");
		}
	});

	it("reads a workbook the app wrote", async () => {
		const buffer = await buildWorkbookBuffer([
			{ type: "biomass_logs", rows: [{ sampleWeightKg: 10, sampleCount: 5 }] },
		]);

		const res = await POST(
			upload({ type: "biomass_logs", file: new File([buffer], "export.xlsx") }),
		);

		expect(res.status).toBe(200);
		expect((await prepared(res)).validRows).toBe(1);
	});

	it("derives the schedule from evenly spaced times and returns the cap check", async () => {
		const res = await POST(
			upload({
				type: "feeding_schedule",
				file: csvFile("time,grams,enabled\n06:00,150,TRUE\n12:00,150,TRUE\n18:00,150,TRUE"),
			}),
		);

		const body = await prepared(res);
		expect(body.schedule).toEqual({ scheduleStart: "06:00", scheduleEnd: "18:00", feedsPerDay: 3 });
		expect(checkScheduleAgainstCap).toHaveBeenCalledWith("farm-1", 3);
		expect(body.capCheck).toMatchObject({ overCap: false });
	});
});
