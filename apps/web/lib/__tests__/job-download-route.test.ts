// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #728: the download route must not buffer an artifact it refuses to serve and
 * must stream the stored bytea in bounded chunks instead of loading the whole
 * blob into function memory.
 */

const { getJobForOwner, queryRaw } = vi.hoisted(() => ({
	getJobForOwner: vi.fn(),
	queryRaw: vi.fn(),
}));

vi.mock("@/lib/auth/with-auth", () => ({
	withAuth:
		(handler: (request: Request, auth: unknown, routeContext?: unknown) => Promise<Response>) =>
		(request: Request, routeContext?: unknown) =>
			handler(
				request,
				{ ownerId: "farm-1", user: { id: "user-1", email: "u@example.com" } },
				routeContext,
			),
}));
vi.mock("@/lib/jobs/service", () => ({ getJobForOwner }));
vi.mock("@/lib/prisma", () => ({ default: { $queryRaw: queryRaw } }));

import { GET } from "@/app/api/jobs/[id]/download/route";
import { MAX_JOB_ARTIFACT_BYTES } from "@/lib/constants";

const CONTEXT = { params: Promise.resolve({ id: "job-1" }) };
const META = { filename: "export.csv", contentType: "text/csv", size: 3 };

function downloadRequest() {
	return new Request("http://test.local/api/jobs/job-1/download") as never;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("GET /api/jobs/{id}/download", () => {
	it("refuses an oversized artifact from its size before reading bytes", async () => {
		getJobForOwner.mockResolvedValue({
			status: "succeeded",
			artifact: { ...META, size: MAX_JOB_ARTIFACT_BYTES + 1 },
		});

		const res = await GET(downloadRequest(), CONTEXT as never);

		expect(res.status).toBe(413);
		expect(queryRaw).not.toHaveBeenCalled();
		const body = (await res.json()) as { error: { message: string } };
		expect(body.error.message).toContain("25 MB");
	});

	it("streams the stored chunks with a Content-Length from the metadata", async () => {
		const bytes = new Uint8Array([1, 2, 3]);
		getJobForOwner.mockResolvedValue({
			status: "succeeded",
			artifact: { ...META, filename: 'my "export".csv', size: bytes.byteLength },
		});
		queryRaw.mockResolvedValue([{ chunk: bytes }]);

		const res = await GET(downloadRequest(), CONTEXT as never);

		expect(res.status).toBe(200);
		expect(res.headers.get("content-length")).toBe("3");
		expect(res.headers.get("content-type")).toBe("text/csv");
		expect(res.headers.get("content-disposition")).toContain("my _export_.csv");
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
		expect(queryRaw).toHaveBeenCalledTimes(1);
	});
});
