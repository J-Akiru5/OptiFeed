// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ default: { issueReport: { create } } }));

import { createIssueReport, issueReportInputSchema } from "../reports/store";

const LONG_MESSAGE = "The footer link on the landing page is broken.";

beforeEach(() => {
	create.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("createIssueReport", () => {
	it("validates, stores the report and returns the new id", async () => {
		create.mockResolvedValue({ id: "report_123" });

		const result = await createIssueReport({
			category: "BUG",
			message: `  ${LONG_MESSAGE}  `,
			email: "  jane@example.com ",
			pagePath: "/en",
			locale: "en",
		});

		expect(result).toEqual({ ok: true, id: "report_123" });
		expect(create).toHaveBeenCalledTimes(1);
		expect(create).toHaveBeenCalledWith({
			data: {
				category: "BUG",
				message: LONG_MESSAGE,
				email: "jane@example.com",
				pagePath: "/en",
				locale: "en",
				source: "PUBLIC",
				reporterUserId: null,
			},
			select: { id: true },
		});
	});

	it("defaults the category to OTHER and blank optional fields to null", async () => {
		create.mockResolvedValue({ id: "report_456" });

		const result = await createIssueReport({ message: LONG_MESSAGE, email: "", locale: "" });

		expect(result).toEqual({ ok: true, id: "report_456" });
		expect(create.mock.calls[0][0].data).toMatchObject({
			category: "OTHER",
			email: null,
			locale: null,
			source: "PUBLIC",
		});
	});

	it("rejects a message shorter than 10 characters without touching the database", async () => {
		const result = await createIssueReport({ message: "short" });

		expect(result).toEqual({ ok: false, error: "invalid" });
		expect(create).not.toHaveBeenCalled();
	});

	it("rejects a malformed email without touching the database", async () => {
		const result = await createIssueReport({
			message: LONG_MESSAGE,
			email: "not-an-email",
		});

		expect(result).toEqual({ ok: false, error: "invalid" });
		expect(create).not.toHaveBeenCalled();
	});

	it("never logs the report body when the write fails", async () => {
		const secret = "my pond password is hunter2";
		create.mockRejectedValueOnce(new Error("relation does not exist"));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const result = await createIssueReport({ message: `Please check this: ${secret}` });

		expect(result).toEqual({ ok: false, error: "unavailable" });
		const logged = errorSpy.mock.calls.flat().map(String).join(" ");
		expect(logged).toContain("issue-reports");
		expect(logged).not.toContain(secret);
		expect(logged).not.toContain("hunter2");
	});

	it("exposes the schema for the route and other writers", () => {
		const parsed = issueReportInputSchema.safeParse({ message: LONG_MESSAGE });
		expect(parsed.success).toBe(true);
		if (parsed.success) expect(parsed.data.source).toBe("PUBLIC");
	});
});
