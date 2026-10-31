import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `types` is client-supplied. A non-array value used to be ignored, so asking
 * for `"types": "nonsense"` exported every dataset instead of failing.
 */

const { createJob } = vi.hoisted(() => ({
	createJob: vi.fn(async () => ({ id: "job-1", type: "export_zip", status: "queued" })),
}));

vi.mock("@/lib/auth/with-auth", () => ({
	withAuth:
		(handler: (request: Request, context: unknown) => Promise<Response>) => (request: Request) =>
			handler(request, { ownerId: "farm-1", user: { id: "user-1", email: "u@example.com" } }),
}));
vi.mock("@/lib/rate-limit", () => ({
	checkApiRateLimit: vi.fn(async () => ({ success: true, remaining: 30 })),
}));
vi.mock("@/lib/jobs/service", () => ({ createJob }));

import { POST } from "@/app/api/export-jobs/route";

function exportRequest(body: unknown) {
	return new Request("http://test.local/api/export-jobs", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	}) as never;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("POST /api/export-jobs", () => {
	it("rejects a non-array `types` instead of exporting everything", async () => {
		const res = await POST(exportRequest({ kind: "zip", types: "biomass_logs" }));

		expect(res.status).toBe(400);
		expect(createJob).not.toHaveBeenCalled();
	});

	it("rejects a list with no exportable type", async () => {
		const res = await POST(exportRequest({ kind: "zip", types: ["not_a_type"] }));

		expect(res.status).toBe(400);
		expect(createJob).not.toHaveBeenCalled();
	});

	it("keeps the documented default when `types` is omitted", async () => {
		const res = await POST(exportRequest({ kind: "zip" }));

		expect(res.status).toBe(202);
		expect(createJob).toHaveBeenCalledWith(
			expect.objectContaining({
				ownerId: "farm-1",
				type: "export_zip",
				payload: { types: expect.arrayContaining(["biomass_logs", "feed_events"]) },
			}),
		);
	});

	it("queues a workbook with every sheet by default, feeding schedule included", async () => {
		const res = await POST(exportRequest({ kind: "xlsx" }));

		expect(res.status).toBe(202);
		expect(createJob).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "export_xlsx",
				payload: {
					types: expect.arrayContaining(["biomass_logs", "fish_samples", "feeding_schedule"]),
				},
			}),
		);
	});

	it("rejects a workbook request with no exportable type", async () => {
		const res = await POST(exportRequest({ kind: "xlsx", types: ["not_a_type"] }));

		expect(res.status).toBe(400);
		expect(createJob).not.toHaveBeenCalled();
	});

	it("accepts the feeding schedule as a single CSV", async () => {
		const res = await POST(exportRequest({ kind: "csv", type: "feeding_schedule" }));

		expect(res.status).toBe(202);
		expect(createJob).toHaveBeenCalledWith(
			expect.objectContaining({ type: "export_csv", payload: { type: "feeding_schedule" } }),
		);
	});

	it("defaults the PDF to the pond summary and passes a named report through", async () => {
		await POST(exportRequest({ kind: "pdf" }));
		expect(createJob).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: "export_pdf", payload: { report: "summary" } }),
		);

		await POST(exportRequest({ kind: "pdf", report: "fcr" }));
		expect(createJob).toHaveBeenLastCalledWith(
			expect.objectContaining({ type: "export_pdf", payload: { report: "fcr" } }),
		);
	});

	it("rejects an unknown PDF report", async () => {
		const res = await POST(exportRequest({ kind: "pdf", report: "everything" }));

		expect(res.status).toBe(400);
		expect(createJob).not.toHaveBeenCalled();
	});
});
