import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Operations → Background jobs (issue #590).
 *
 * The dead-letter list is the operator's only view of a job that stopped
 * retrying. These tests pin what it must show — type, farm, attempts and the
 * last error — and the empty state when nothing has failed.
 */

const mocks = vi.hoisted(() => ({
	listDeadLetterJobs: vi.fn(),
	getJobMetrics: vi.fn(),
	requirePlatformAdmin: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth/require-platform-admin", () => ({
	requirePlatformAdmin: mocks.requirePlatformAdmin,
}));
vi.mock("@/lib/platform/dead-letter-jobs", () => ({
	listDeadLetterJobs: mocks.listDeadLetterJobs,
}));
vi.mock("@/lib/jobs/service", () => ({
	JOB_MAX_ATTEMPTS: 5,
	getJobMetrics: mocks.getJobMetrics,
}));
vi.mock("@/lib/date-local", () => ({
	formatFarmDateTime: () => ({ full: "Nov 2, 2026 10:00 AM" }),
}));
vi.mock("@/components/superadmin/ops-nav", async () => {
	const react = await import("react");
	return { OpsNav: () => react.createElement("nav", { "data-testid": "ops-nav" }) };
});
vi.mock("next-intl/server", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		getLocale: async () => "en",
		getTranslations: async (namespace: string) => createTranslator(namespace),
	};
});

import OperationsJobsPage from "@/app/[locale]/(superadmin)/superadmin/operations/jobs/page";
import { createTranslator } from "./helpers/messages";

const t = createTranslator("superadmin.operations.jobs");

const FAILED = {
	id: "job-1",
	type: "import_confirm",
	ownerId: "farm-alpha",
	attempts: 5,
	lastError: "The transaction exceeded the attempt budget.",
	finishedAt: "2026-11-02T02:00:00.000Z",
	createdAt: "2026-11-02T01:00:00.000Z",
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getJobMetrics.mockResolvedValue({
		queued: 3,
		running: 1,
		succeeded24h: 9,
		failed24h: 1,
		oldestQueuedAgeMs: 120_000,
		artifactBytes: 0,
	});
});

describe("OperationsJobsPage", () => {
	it("lists a dead-lettered job with its farm, attempts and last error", async () => {
		mocks.listDeadLetterJobs.mockResolvedValue([FAILED]);

		const html = renderToStaticMarkup(await OperationsJobsPage());

		expect(html).toContain(t("title"));
		expect(html).toContain("import_confirm");
		expect(html).toContain("farm-alpha");
		expect(html).toContain("5");
		expect(html).toContain("The transaction exceeded the attempt budget.");
		expect(html).toContain(t("columnOwner"));
	});

	it("shows the queue depth next to the list", async () => {
		mocks.listDeadLetterJobs.mockResolvedValue([FAILED]);

		const html = renderToStaticMarkup(await OperationsJobsPage());

		expect(html).toContain("3 queued");
		expect(html).toContain("1 running");
		expect(html).toContain("1 failed");
	});

	it("renders the empty state when nothing has failed", async () => {
		mocks.listDeadLetterJobs.mockResolvedValue([]);
		mocks.getJobMetrics.mockResolvedValue({
			queued: 0,
			running: 0,
			succeeded24h: 4,
			failed24h: 0,
			oldestQueuedAgeMs: null,
			artifactBytes: 0,
		});

		const html = renderToStaticMarkup(await OperationsJobsPage());

		expect(html).toContain(t("noFailuresTitle"));
		expect(html).not.toContain("farm-alpha");
	});
});
