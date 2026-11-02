// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { create, checkIssueReportRateLimit, getClientIp } = vi.hoisted(() => ({
	create: vi.fn(),
	checkIssueReportRateLimit: vi.fn(),
	getClientIp: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: { issueReport: { create } } }));
vi.mock("@/lib/rate-limit", () => ({ checkIssueReportRateLimit }));
vi.mock("@/lib/client-ip", () => ({ getClientIp }));

import { POST } from "@/app/api/reports/route";

const VALID_PAYLOAD = {
	category: "BUG",
	message: "The footer link on the landing page is broken.",
	email: "jane@example.com",
	pagePath: "/en",
	locale: "en",
	website: "",
};

function submit(body: unknown) {
	return POST(
		new Request("http://test.local/api/reports", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: typeof body === "string" ? body : JSON.stringify(body),
		}),
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	create.mockResolvedValue({ id: "report_123" });
	checkIssueReportRateLimit.mockResolvedValue({ success: true, remaining: 4 });
	getClientIp.mockResolvedValue("203.0.113.9");
});

describe("POST /api/reports", () => {
	it("creates a report and answers 201 with { ok: true }", async () => {
		const response = await submit(VALID_PAYLOAD);

		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({ ok: true });
		expect(getClientIp).toHaveBeenCalledTimes(1);
		expect(checkIssueReportRateLimit).toHaveBeenCalledWith("203.0.113.9");
		expect(create).toHaveBeenCalledWith({
			data: {
				category: "BUG",
				message: VALID_PAYLOAD.message,
				email: VALID_PAYLOAD.email,
				pagePath: "/en",
				locale: "en",
				source: "PUBLIC",
				reporterUserId: null,
			},
			select: { id: true },
		});
	});

	it("answers 429 when the per-IP limiter denies", async () => {
		checkIssueReportRateLimit.mockResolvedValue({ success: false, remaining: 0 });

		const response = await submit(VALID_PAYLOAD);

		expect(response.status).toBe(429);
		expect(create).not.toHaveBeenCalled();
	});

	it("answers a generic 400 when the honeypot is filled", async () => {
		const response = await submit({ ...VALID_PAYLOAD, website: "https://spam.example" });

		expect(response.status).toBe(400);
		expect(create).not.toHaveBeenCalled();
		const body = await response.text();
		expect(body).not.toContain("honeypot");
		expect(body).not.toContain("website");
	});

	it("answers 400 for a message that is too short", async () => {
		const response = await submit({ ...VALID_PAYLOAD, message: "too short" });

		expect(response.status).toBe(400);
		expect(create).not.toHaveBeenCalled();
	});

	it("answers 400 for malformed JSON without echoing the parse error", async () => {
		const response = await submit("{not json");

		expect(response.status).toBe(400);
		expect(create).not.toHaveBeenCalled();
	});

	it("answers 500 without a body echo when the store fails", async () => {
		create.mockRejectedValueOnce(new Error("db down"));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const response = await submit(VALID_PAYLOAD);

		expect(response.status).toBe(500);
		const body = await response.text();
		expect(body).not.toContain(VALID_PAYLOAD.message);
		expect(body).not.toContain("db down");
		errorSpy.mockRestore();
	});
});
