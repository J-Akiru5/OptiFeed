import { ApiClientError, apiGet, apiPost, rawFetch } from "@/lib/api-client";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The browser client is the only path dashboard code uses to talk to the API,
 * so its envelope unwrapping, error mapping and retry policy are asserted here:
 * a GET may be retried, a write may not unless it carries an Idempotency-Key,
 * and a deliberate caller abort must never be retried.
 */

function jsonResponse(body: unknown, init: { status?: number; requestId?: string } = {}) {
	const status = init.status ?? 200;
	const headers = new Headers({ "content-type": "application/json" });
	if (init.requestId) headers.set("x-request-id", init.requestId);
	return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

function stubFetch(implementation: (url: string, init: RequestInit) => Promise<Response>) {
	const fetchMock = vi.fn(implementation);
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("envelope handling", () => {
	it("unwraps the data field of a successful read", async () => {
		stubFetch(async () => jsonResponse({ data: { ponds: 2 } }));

		await expect(apiGet<{ ponds: number }>("/api/v1/ponds")).resolves.toEqual({ ponds: 2 });
	});

	it("returns the body as-is when the server does not use an envelope", async () => {
		stubFetch(async () => jsonResponse({ status: "ok" }));

		await expect(apiGet("/api/health")).resolves.toEqual({ status: "ok" });
	});

	it("returns undefined for a 204 with no body to parse", async () => {
		stubFetch(async () => new Response(null, { status: 204 }));

		await expect(apiGet("/api/v1/ping")).resolves.toBeUndefined();
	});

	it("sends a JSON content type and body for a write", async () => {
		const fetchMock = stubFetch(async () => jsonResponse({ data: { id: "x" } }));

		await apiPost("/api/v1/ponds", { name: "Pond" });

		const init = fetchMock.mock.calls[0][1];
		expect(init.method).toBe("POST");
		expect(init.body).toBe(JSON.stringify({ name: "Pond" }));
		expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
		expect(init.credentials).toBe("same-origin");
	});

	it("omits the body and content type when a write has no payload", async () => {
		const fetchMock = stubFetch(async () => jsonResponse({ data: true }));

		await apiPost("/api/v1/replay");

		const init = fetchMock.mock.calls[0][1];
		expect(init.body).toBeUndefined();
		expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
	});
});

describe("error mapping", () => {
	it("maps a structured error envelope and its request id", async () => {
		stubFetch(async () =>
			jsonResponse(
				{
					error: {
						code: "FORBIDDEN",
						message: "You cannot do that.",
						details: { field: "pondId" },
					},
				},
				{ status: 403, requestId: "req-9" },
			),
		);

		const error = await apiGet("/api/v1/ponds").catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(ApiClientError);
		expect(error).toMatchObject({
			status: 403,
			code: "FORBIDDEN",
			message: "You cannot do that.",
			details: { field: "pondId" },
			requestId: "req-9",
		});
	});

	it("uses a plain string error body as the message but keeps the status code", async () => {
		stubFetch(async () => jsonResponse({ error: "Rate limited" }, { status: 429 }));

		const error = await apiGet("/api/v1/ponds").catch((thrown: unknown) => thrown);

		expect(error).toMatchObject({ status: 429, code: "HTTP_429", message: "Rate limited" });
	});

	it("falls back to the status text for a non-JSON error body", async () => {
		stubFetch(async () => new Response("<html>bad gateway</html>", { status: 502 }));

		const error = await apiGet("/api/v1/ponds").catch((thrown: unknown) => thrown);

		expect(error).toMatchObject({ status: 502, code: "HTTP_502" });
		expect((error as ApiClientError).requestId).toBeNull();
	});

	it("maps a transport failure to NETWORK_ERROR", async () => {
		stubFetch(async () => {
			throw new TypeError("Failed to fetch");
		});

		await expect(apiGet("/api/v1/ponds")).rejects.toMatchObject({
			status: 0,
			code: "NETWORK_ERROR",
		});
	});

	it("maps a request that exceeds its budget to CLIENT_TIMEOUT", async () => {
		stubFetch(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					init.signal?.addEventListener(
						"abort",
						() => reject(new DOMException("Aborted", "AbortError")),
						{ once: true },
					);
				}),
		);

		await expect(apiGet("/api/v1/slow", { timeoutMs: 5 })).rejects.toMatchObject({
			status: 0,
			code: "CLIENT_TIMEOUT",
		});
	});

	it("does not retry a client error", async () => {
		const fetchMock = stubFetch(async () =>
			jsonResponse({ error: { code: "BAD_REQUEST", message: "Nope" } }, { status: 400 }),
		);

		await expect(apiGet("/api/v1/ponds")).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

describe("retry policy", () => {
	it("retries a GET on a server error and returns the eventual success", async () => {
		let calls = 0;
		const fetchMock = stubFetch(async () => {
			calls += 1;
			return calls === 1
				? jsonResponse({ error: { code: "INTERNAL" } }, { status: 500 })
				: jsonResponse({ data: "ok" });
		});

		await expect(apiGet("/api/v1/ponds")).resolves.toBe("ok");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("stops after two retries and rethrows the last error", async () => {
		const fetchMock = stubFetch(async () =>
			jsonResponse({ error: { code: "INTERNAL" } }, { status: 500 }),
		);

		await expect(apiGet("/api/v1/ponds")).rejects.toMatchObject({ status: 500 });
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("honours an explicit retry count", async () => {
		const fetchMock = stubFetch(async () =>
			jsonResponse({ error: { code: "INTERNAL" } }, { status: 500 }),
		);

		await expect(apiGet("/api/v1/ponds", { retries: 0 })).rejects.toMatchObject({
			status: 500,
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("retries a rate-limited read", async () => {
		let calls = 0;
		const fetchMock = stubFetch(async () => {
			calls += 1;
			return calls === 1
				? jsonResponse({ error: { code: "RATE_LIMITED" } }, { status: 429 })
				: jsonResponse({ data: true });
		});

		await expect(apiGet("/api/v1/ponds")).resolves.toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("never retries a write that has no Idempotency-Key", async () => {
		const fetchMock = stubFetch(async () =>
			jsonResponse({ error: { code: "INTERNAL" } }, { status: 500 }),
		);

		await expect(apiPost("/api/v1/ponds", { name: "Pond" })).rejects.toMatchObject({
			status: 500,
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("retries an idempotent write when a retry budget is given, keeping the key", async () => {
		let calls = 0;
		const fetchMock = stubFetch(async () => {
			calls += 1;
			return calls === 1
				? jsonResponse({ error: { code: "INTERNAL" } }, { status: 500 })
				: jsonResponse({ data: { saved: true } });
		});

		await expect(
			apiPost("/api/v1/ponds", { name: "Pond" }, { idempotencyKey: "key-1", retries: 2 }),
		).resolves.toEqual({ saved: true });

		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("attempts an idempotent write once when no retry budget is given", async () => {
		// Writes default to zero retries; only GET gets retries by default. The
		// key makes a retry safe, it does not schedule one.
		const fetchMock = stubFetch(async () =>
			jsonResponse({ error: { code: "INTERNAL" } }, { status: 500 }),
		);

		await expect(
			apiPost("/api/v1/ponds", { name: "Pond" }, { idempotencyKey: "key-1" }),
		).rejects.toMatchObject({ status: 500 });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

describe("raw requests", () => {
	it("returns the unparsed response for a file download", async () => {
		const response = new Response("csv,data", { status: 200 });
		stubFetch(async () => response);

		const result = await rawFetch("/api/v1/export?type=feed_events");

		expect(result).toBe(response);
		await expect(result.text()).resolves.toBe("csv,data");
	});

	it("keeps streamed responses raw and asks for any content type", async () => {
		const fetchMock = stubFetch(async () => new Response("event", { status: 200 }));

		await rawFetch("/api/v1/stream", { headers: { Accept: "text/event-stream" } });

		const init = fetchMock.mock.calls[0][1];
		expect(init.credentials).toBe("same-origin");
		expect((init.headers as Record<string, string>).Accept).toBe("text/event-stream");
	});
});

describe("header merging", () => {
	it("accepts a Headers instance", async () => {
		const fetchMock = stubFetch(async () => jsonResponse({ data: 1 }));

		await apiGet("/api/v1/ponds", { headers: new Headers({ "x-trace": "abc" }) });

		expect((fetchMock.mock.calls[0][1].headers as Record<string, string>)["x-trace"]).toBe("abc");
	});

	it("accepts an array of header pairs", async () => {
		const fetchMock = stubFetch(async () => jsonResponse({ data: 1 }));

		await apiGet("/api/v1/ponds", { headers: [["x-trace", "abc"]] });

		expect((fetchMock.mock.calls[0][1].headers as Record<string, string>)["x-trace"]).toBe("abc");
	});
});
