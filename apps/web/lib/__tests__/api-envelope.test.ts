import { cachedOk, created, fail, noContent, ok, paginated } from "@/lib/api/envelope";
import { ApiError, notFound, validationFailed } from "@/lib/api/errors";
import { describe, expect, it } from "vitest";

function json(response: Response) {
	return response.json() as Promise<Record<string, unknown>>;
}

describe("response envelope (§4)", () => {
	it("wraps success data in { data, meta } and sets the JSON content type", async () => {
		const response = ok({ id: "p_1" }, { requestId: "req-12345678" });

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
		expect(await json(response)).toEqual({
			data: { id: "p_1" },
			meta: { request_id: "req-12345678" },
		});
	});

	it("uses 201 with a Location header for creates", () => {
		const response = created({ id: "p_2" }, "/api/v1/payments/p_2", { requestId: "req-12345678" });

		expect(response.status).toBe(201);
		expect(response.headers.get("location")).toBe("/api/v1/payments/p_2");
	});

	it("returns 204 with no body", async () => {
		const response = noContent();

		expect(response.status).toBe(204);
		expect(await response.text()).toBe("");
	});

	it("serializes list pagination in meta.page", async () => {
		const response = paginated(
			[{ id: "a" }],
			{
				limit: 50,
				next_cursor: "eyJpZCI6ImEi",
				has_more: true,
			},
			{ requestId: "req-12345678" },
		);

		expect(await json(response)).toEqual({
			data: [{ id: "a" }],
			meta: {
				request_id: "req-12345678",
				page: { limit: 50, next_cursor: "eyJpZCI6ImEi", has_more: true },
			},
		});
	});

	it("maps an ApiError to the error envelope with a stable code", async () => {
		const response = fail(validationFailed("Bad amount.", { amount: "must be > 0" }), {
			requestId: "req-12345678",
		});

		expect(response.status).toBe(422);
		expect(await json(response)).toEqual({
			error: {
				code: "VALIDATION_FAILED",
				message: "Bad amount.",
				details: { amount: "must be > 0" },
				request_id: "req-12345678",
			},
		});
	});

	it("never exposes an unexpected error message", async () => {
		const response = fail(
			new ApiError(500, "INTERNAL_ERROR", "password=hunter2", { expose: false }),
			{
				requestId: "req-12345678",
			},
		);
		const body = (await json(response)) as { error: { message: string } };

		expect(body.error.message).toBe("An unexpected error occurred.");
		expect(JSON.stringify(body)).not.toContain("hunter2");
	});

	it("keeps Retry-After on 429", () => {
		const response = fail(
			new ApiError(429, "RATE_LIMITED", "Slow down.", { headers: { "Retry-After": "30" } }),
			{ requestId: "req-12345678" },
		);

		expect(response.headers.get("retry-after")).toBe("30");
	});

	it("emits ETag and honours If-None-Match with 304", async () => {
		const request = new Request("http://local/api/v1/reference-years");
		const first = cachedOk({ years: [2025, 2026] }, request, { maxAgeSeconds: 300 });
		const etag = first.headers.get("etag");

		expect(first.status).toBe(200);
		expect(etag).toBeTruthy();
		expect(first.headers.get("cache-control")).toBe("public, max-age=300");

		const conditional = new Request("http://local/api/v1/reference-years", {
			headers: { "If-None-Match": etag ?? "" },
		});
		const second = cachedOk({ years: [2025, 2026] }, conditional, { maxAgeSeconds: 300 });

		expect(second.status).toBe(304);
		expect(second.headers.get("etag")).toBe(etag);
		expect(await second.text()).toBe("");
	});

	it("marks user-specific cache entries private and Vary: Cookie", () => {
		const response = cachedOk({ role: "ADMIN" }, new Request("http://local/api/v1/user-role"), {
			maxAgeSeconds: 60,
			private: true,
		});

		expect(response.headers.get("cache-control")).toBe("private, max-age=60");
		expect(response.headers.get("vary")).toBe("Cookie");
	});

	it("provides a 404 helper that carries a stable code", () => {
		expect(notFound().status).toBe(404);
		expect(notFound().code).toBe("NOT_FOUND");
	});
});
