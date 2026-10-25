import { apiGet } from "@/lib/api-client";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("apiGet caller abort", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("does not retry a deliberate caller abort", async () => {
		const controller = new AbortController();
		let calls = 0;

		vi.stubGlobal(
			"fetch",
			vi.fn((_url: string, init: RequestInit) => {
				calls += 1;
				return new Promise((_resolve, reject) => {
					init.signal?.addEventListener(
						"abort",
						() => reject(new DOMException("Aborted", "AbortError")),
						{ once: true },
					);
				});
			}),
		);

		const request = apiGet("/api/test", { signal: controller.signal });
		controller.abort();

		await expect(request).rejects.toMatchObject({ code: "CLIENT_ABORTED" });
		expect(calls).toBe(1);
	});
});
