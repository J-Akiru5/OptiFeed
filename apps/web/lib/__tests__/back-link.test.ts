import { shouldShowGlobalBackLink } from "@/lib/navigation/back-link";
import { describe, expect, it } from "vitest";

describe("shouldShowGlobalBackLink", () => {
	it("hides the global back link on the dashboard itself", () => {
		expect(shouldShowGlobalBackLink("/dashboard")).toBe(false);
		expect(shouldShowGlobalBackLink(null)).toBe(false);
	});

	it("shows the global back link on top-level dashboard pages", () => {
		expect(shouldShowGlobalBackLink("/dashboard/schedule")).toBe(true);
		expect(shouldShowGlobalBackLink("/dashboard/log-sample")).toBe(true);
		expect(shouldShowGlobalBackLink("/dashboard/settings/pond")).toBe(true);
	});

	it("hides the global back link where the page renders its own parent link", () => {
		expect(shouldShowGlobalBackLink("/dashboard/log-sample/batches")).toBe(false);
		expect(shouldShowGlobalBackLink("/dashboard/log-sample/batches/unlabeled")).toBe(false);
		expect(shouldShowGlobalBackLink("/dashboard/growth/history")).toBe(false);
	});

	it("does not hide a lookalike route that only shares a text prefix", () => {
		expect(shouldShowGlobalBackLink("/dashboard/log-sample/batches-archive")).toBe(true);
		expect(shouldShowGlobalBackLink("/dashboard/growth/history-detail")).toBe(true);
	});
});
