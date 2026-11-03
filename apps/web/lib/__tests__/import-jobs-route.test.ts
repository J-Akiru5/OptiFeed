// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The queued import must carry the pond that was selected at preview time.
 * Without it the worker resolved whatever pond was active when it ran, so a
 * pond switch between preview and confirm retargeted every row (#743).
 */

const { requireWriteAccess, checkApiRateLimit, createJob, resolveActivePond } = vi.hoisted(() => ({
	requireWriteAccess: vi.fn(),
	checkApiRateLimit: vi.fn(),
	createJob: vi.fn(),
	resolveActivePond: vi.fn(),
}));

vi.mock("@/lib/auth/with-auth", () => ({
	withAuth:
		(handler: (request: Request, context: unknown) => Promise<Response>) => (request: Request) =>
			handler(request, { ownerId: "farm-1", user: { id: "user-1", email: "u@example.com" } }),
}));
vi.mock("@/lib/auth/session", () => ({ requireWriteAccess }));
vi.mock("@/lib/auth/pond-access", () => ({ resolveActivePond }));
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/rate-limit", () => ({ checkApiRateLimit }));
vi.mock("@/lib/jobs/service", () => ({ createJob }));

import { POST } from "@/app/api/import-jobs/route";

const CSV = "sampleWeightKg,sampleCount\n10,5";

function post(body: Record<string, unknown>, headers: Record<string, string> = {}) {
	return new Request("http://test.local/api/import-jobs", {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: JSON.stringify(body),
	}) as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	requireWriteAccess.mockResolvedValue(undefined);
	checkApiRateLimit.mockResolvedValue({ success: true, remaining: 30 });
	resolveActivePond.mockResolvedValue({ id: "pond-2", name: "Pond B" });
	createJob.mockResolvedValue({ id: "job-1", type: "import_confirm", status: "queued" });
});

describe("POST /api/import-jobs", () => {
	it("queues the import with its target pond and returns the status URL", async () => {
		const res = await POST(post({ type: "biomass_logs", csvData: CSV, pondId: "pond-2" }));

		expect(res.status).toBe(202);
		expect(resolveActivePond).toHaveBeenCalledWith("farm-1", "pond-2");
		expect(createJob).toHaveBeenCalledWith({
			ownerId: "farm-1",
			requestedBy: "user-1",
			type: "import_confirm",
			payload: { type: "biomass_logs", csvData: CSV, pondId: "pond-2" },
		});
		const body = await res.json();
		expect(body.data).toMatchObject({ id: "job-1", status_url: "/api/v1/jobs/job-1" });
	});

	it("passes the Idempotency-Key header into the job payload", async () => {
		await POST(
			post({ type: "biomass_logs", csvData: CSV, pondId: "pond-2" }, { "Idempotency-Key": "k-1" }),
		);

		expect(createJob).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: expect.objectContaining({ idempotencyKey: "k-1" }),
			}),
		);
	});

	it("refuses a job with no target pond instead of resolving the active one later", async () => {
		const res = await POST(post({ type: "biomass_logs", csvData: CSV }));

		expect(res.status).toBe(400);
		expect(createJob).not.toHaveBeenCalled();
	});

	it("refuses a pond the caller does not own before queueing", async () => {
		resolveActivePond.mockResolvedValue(null);

		const res = await POST(post({ type: "biomass_logs", csvData: CSV, pondId: "pond-foreign" }));

		expect(res.status).toBe(404);
		expect(createJob).not.toHaveBeenCalled();
	});

	it("refuses the export-only audit-event type (#744)", async () => {
		const res = await POST(post({ type: "audit_events", csvData: CSV, pondId: "pond-2" }));

		expect(res.status).toBe(400);
		expect(createJob).not.toHaveBeenCalled();
	});

	it("refuses an oversized CSV before queueing", async () => {
		const res = await POST(
			post({ type: "biomass_logs", csvData: "x".repeat(5 * 1024 * 1024 + 1), pondId: "pond-2" }),
		);

		expect(res.status).toBe(413);
		expect(createJob).not.toHaveBeenCalled();
	});
});
