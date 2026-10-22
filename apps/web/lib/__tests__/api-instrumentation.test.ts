import { ok } from "@/lib/api/envelope";
import { ApiError, forbidden } from "@/lib/api/errors";
import { withApi } from "@/lib/api/instrumentation";
import { recordQuery } from "@/lib/api/request-context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function request(
	path = "http://local/api/v1/students/ckq1w2e3r4t5y6u7i8o9p0",
	headers?: HeadersInit,
) {
	return new Request(path, { headers });
}

describe("request instrumentation (§9)", () => {
	beforeEach(() => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("adds Server-Timing and X-Request-Id to a success response", async () => {
		const handler = withApi(async () => ok({ id: "1" }), { route: "GET /api/v1/students/{id}" });
		const response = await handler(request());

		expect(response.status).toBe(200);
		expect(response.headers.get("x-request-id")).toMatch(/[A-Za-z0-9._:-]{8,}/);
		const timing = response.headers.get("server-timing") ?? "";
		expect(timing).toMatch(/total;dur=\d/);
		expect(timing).toMatch(/db;dur=\d/);
		expect(timing).toMatch(/app;dur=\d/);
		expect(timing).toMatch(/queries;desc=0/);
	});

	it("accepts a safe client request id and echoes it in the envelope", async () => {
		const handler = withApi(async () => ok({ id: "1" }), { route: "GET /api/v1/x" });
		const response = await handler(
			request("http://local/api/v1/x", { "x-request-id": "client-abc-123" }),
		);

		expect(response.headers.get("x-request-id")).toBe("client-abc-123");
		expect(await response.json()).toMatchObject({ meta: { request_id: "client-abc-123" } });
	});

	it("rejects an unsafe client request id and generates one", async () => {
		const handler = withApi(async () => ok({ id: "1" }), { route: "GET /api/v1/x" });
		const response = await handler(
			request("http://local/api/v1/x", { "x-request-id": "bad id with spaces" }),
		);

		expect(response.headers.get("x-request-id")).not.toBe("bad id with spaces");
	});

	it("derives a low-cardinality route template from the pathname", async () => {
		const { routeTemplate } = await import("@/lib/api/request-context");

		expect(routeTemplate("/api/v1/students/ckq1w2e3r4t5y6u7i8o9p0")).toBe("/api/v1/students/{id}");
		expect(routeTemplate("/api/v1/students/123e4567-e89b-42d3-a456-426614174000/payments")).toBe(
			"/api/v1/students/{id}/payments",
		);
		expect(routeTemplate("/api/v1/reference-years")).toBe("/api/v1/reference-years");
	});

	it("normalizes a non-envelope error response to §4.2", async () => {
		const handler = withApi(async () => Response.json({ error: "Nope" }, { status: 403 }), {
			route: "GET /api/v1/forbidden",
		});
		const response = await handler(request("http://local/api/v1/forbidden"));
		const body = (await response.json()) as {
			error: { code: string; message: string; request_id: string };
		};

		expect(response.status).toBe(403);
		expect(body.error.code).toBe("FORBIDDEN");
		expect(body.error.message).toBe("Nope");
		expect(body.error.request_id).toBe(response.headers.get("x-request-id"));
		expect(response.headers.get("server-timing")).toBeTruthy();
	});

	it("turns a thrown ApiError into the error envelope", async () => {
		const handler = withApi(
			async () => {
				throw forbidden("No entry.");
			},
			{ route: "GET /api/v1/denied" },
		);
		const response = await handler(request("http://local/api/v1/denied"));
		const body = (await response.json()) as { error: { code: string; message: string } };

		expect(response.status).toBe(403);
		expect(body.error).toEqual({
			code: "FORBIDDEN",
			message: "No entry.",
			request_id: expect.any(String),
		});
		expect(response.headers.get("x-request-id")).toBeTruthy();
	});

	it("turns an unknown exception into a generic 500 and logs it", async () => {
		const handler = withApi(
			async () => {
				throw new Error("secret stack detail");
			},
			{ route: "GET /api/v1/boom" },
		);
		const response = await handler(request("http://local/api/v1/boom"));
		const body = (await response.json()) as { error: { code: string; message: string } };

		expect(response.status).toBe(500);
		expect(body.error.code).toBe("INTERNAL_ERROR");
		expect(body.error.message).toBe("An unexpected error occurred.");
		expect(JSON.stringify(body)).not.toContain("secret stack detail");
	});

	it("returns 504 when the handler exceeds its budget", async () => {
		const handler = withApi(
			async () => {
				await new Promise((resolve) => setTimeout(resolve, 200));
				return ok({ too: "late" });
			},
			{ route: "GET /api/v1/slow", timeoutMs: 20 },
		);
		const response = await handler(request("http://local/api/v1/slow"));
		const body = (await response.json()) as { error: { code: string } };

		expect(response.status).toBe(504);
		expect(body.error.code).toBe("TIMEOUT");
		expect(response.headers.get("server-timing")).toBeTruthy();
	});

	it("counts data-layer round-trips and reports them in Server-Timing", async () => {
		const handler = withApi(
			async () => {
				await Promise.resolve();
				recordQuery(12);
				recordQuery(8);
				return ok({ id: "1" });
			},
			{ route: "GET /api/v1/count" },
		);
		const response = await handler(request("http://local/api/v1/count"));

		expect(response.headers.get("server-timing")).toContain("queries;desc=2");
	});

	it("keeps passthrough bodies untouched on error, but still instruments them", async () => {
		const handler = withApi(async () => new Response("Unauthorized", { status: 401 }), {
			route: "GET /api/v1/device",
			shape: "passthrough",
		});
		const response = await handler(request("http://local/api/v1/device"));

		expect(response.status).toBe(401);
		expect(await response.text()).toBe("Unauthorized");
		expect(response.headers.get("server-timing")).toBeTruthy();
		expect(response.headers.get("x-request-id")).toBeTruthy();
	});

	it("adds Deprecation and Sunset to a legacy dual-served path", async () => {
		const handler = withApi(async () => ok({ id: "1" }), {
			route: "GET /api/x",
			sunset: "2027-06-30",
		});
		const response = await handler(request("http://local/api/x"));

		expect(response.headers.get("deprecation")).toBe("true");
		expect(response.headers.get("sunset")).toContain("2027");
	});

	it("preserves error-specific headers such as Retry-After", async () => {
		const handler = withApi(
			async () => {
				throw new ApiError(429, "RATE_LIMITED", "Slow down.", { headers: { "Retry-After": "5" } });
			},
			{ route: "GET /api/v1/limited" },
		);
		const response = await handler(request("http://local/api/v1/limited"));

		expect(response.headers.get("retry-after")).toBe("5");
	});
});
