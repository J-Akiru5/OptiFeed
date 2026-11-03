import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	gate: vi.fn(),
	queue: vi.fn(),
	detail: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: {} }));

vi.mock("@/lib/auth/require-platform-admin", () => ({
	requirePlatformAdmin: mocks.gate,
}));

vi.mock("@/lib/platform/incidents", () => ({
	getIncidentQueue: mocks.queue,
}));

vi.mock("@/lib/platform/incident-lifecycle", () => ({
	getPlatformIncidentDetail: mocks.detail,
}));

vi.mock("@/components/superadmin/incident-detail-actions", async () => {
	const react = await import("react");
	return {
		IncidentDetailActions: ({ incidentId }: { incidentId: string }) =>
			react.createElement("div", { "data-incident-actions": incidentId }, "actions-stub"),
	};
});

vi.mock("next-intl/server", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		getLocale: async () => "en",
		getTranslations: async (namespace: string) => createTranslator(namespace),
	};
});

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("@/i18n/routing", async () => {
	const react = await import("react");
	return {
		Link: ({ href, children, ...rest }: { href: unknown; children?: React.ReactNode }) =>
			react.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
		getPathname: ({ href }: { href: string }) => href,
		usePathname: () => "/superadmin/incidents",
		useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
	};
});

vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("NEXT_NOT_FOUND");
	},
}));

import SuperadminIncidentDetailPage from "@/app/[locale]/(superadmin)/superadmin/incidents/[incidentId]/page";
import SuperadminIncidentsPage from "@/app/[locale]/(superadmin)/superadmin/incidents/page";

const NOW = new Date("2026-11-02T12:00:00.000Z");

function trackedRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "inc-1",
		dedupeKey: "device_offline:dev-1",
		source: "DEVICE_OFFLINE",
		severity: "CRITICAL",
		status: "ESCALATED",
		title: "Feeder A is offline",
		summary: null,
		orgName: "Alpha",
		pondName: "Pond 1",
		deviceLabel: "Feeder A",
		ownerId: "admin-2",
		ownerName: "Ana Admin",
		openedAt: new Date(NOW.getTime() - 90 * 60 * 1000),
		acknowledgedAt: null,
		resolvedAt: null,
		escalatedAt: new Date(NOW.getTime() - 40 * 60 * 1000),
		ackDueAt: new Date(NOW.getTime() - 10 * 60 * 1000),
		lastSeenAt: new Date(NOW.getTime() - 2 * 60 * 1000),
		ageMs: 90 * 60 * 1000,
		ackOverdue: true,
		fault: null,
		jobType: null,
		metadata: {},
		...overrides,
	};
}

function queue(overrides: Record<string, unknown> = {}) {
	return {
		checkedAt: NOW,
		incidents: [],
		summary: {
			state: "ok",
			open: 0,
			counts: { critical: 0, warning: 0, info: 0 },
			failedSources: [],
		},
		truncated: false,
		policyAvailable: true,
		sourceStates: { device: true, notification: true, error: true, job: true },
		tracked: {
			available: true,
			rows: [
				trackedRow(),
				trackedRow({
					id: "inc-2",
					status: "RESOLVED",
					ackDueAt: null,
					ackOverdue: false,
					resolvedAt: NOW,
				}),
			],
			summary: { open: 1, escalated: 1, overdue: 1, resolved: 1, counts: {} },
			totalOpen: 1,
			truncated: false,
		},
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.gate.mockResolvedValue(undefined);
	mocks.queue.mockResolvedValue(queue());
	mocks.detail.mockResolvedValue(null);
});

describe("/superadmin/incidents", () => {
	it("renders tracked incidents with status, severity, owner and an overdue ack target", async () => {
		const html = renderToStaticMarkup(await SuperadminIncidentsPage());

		expect(html).toContain("Tracked incidents");
		expect(html).toContain("Feeder A is offline");
		expect(html).toContain("Ana Admin");
		expect(html).toContain("Overdue");
		expect(html).toContain("Escalated");
		expect(html).toContain('href="/superadmin/incidents/inc-1"');
		expect(html).toContain("Derived conditions");
	});

	it("hides both wide tables below md and renders their rows as cards", async () => {
		mocks.queue.mockResolvedValue(
			queue({
				incidents: [
					{
						key: "device:pond-1",
						title: "Pond link lost",
						tenantName: "Alpha",
						pondName: "Pond 1",
						severity: "critical",
						since: NOW,
						count: 1,
						href: null,
						detail: null,
						sources: ["device"],
					},
				],
			}),
		);

		const html = renderToStaticMarkup(await SuperadminIncidentsPage());

		// Tracked incidents and the derived-condition table each pair a hidden
		// table with a card list; a phone must not get both at once (#631).
		expect(html.split("hidden md:block").length - 1).toBe(2);
		expect(html.split("md:hidden").length - 1).toBe(2);
	});

	it("announces escalated incidents to the platform-admin role in-app", async () => {
		const html = renderToStaticMarkup(await SuperadminIncidentsPage());

		expect(html).toContain("Escalated to the platform-admin role");
		expect(html).toContain("no email, chat or pager is sent");
	});

	it("says the lifecycle read failed instead of showing an empty board", async () => {
		mocks.queue.mockResolvedValue(
			queue({
				tracked: {
					available: false,
					rows: [],
					summary: { open: 0, escalated: 0, overdue: 0, resolved: 0, counts: {} },
					totalOpen: 0,
					truncated: false,
				},
			}),
		);

		const html = renderToStaticMarkup(await SuperadminIncidentsPage());

		expect(html).toContain("Tracked incidents could not be read.");
		expect(html).not.toContain("No tracked incidents");
	});

	it("denies a caller without an active PlatformAdmin row before loading data", async () => {
		mocks.gate.mockRejectedValue(new Error("NEXT_REDIRECT"));

		await expect(SuperadminIncidentsPage()).rejects.toThrow("NEXT_REDIRECT");
		expect(mocks.queue).not.toHaveBeenCalled();
	});
});

describe("/superadmin/incidents/[incidentId]", () => {
	function page() {
		return SuperadminIncidentDetailPage({ params: Promise.resolve({ incidentId: "inc-1" }) });
	}

	it("renders the incident facts, actions and its timeline", async () => {
		mocks.detail.mockResolvedValue({
			incident: trackedRow(),
			events: [
				{
					id: "evt-1",
					type: "AUTO_OPENED",
					fromStatus: null,
					toStatus: "NEW",
					actorId: null,
					actorName: null,
					note: "Opened automatically by the device watch.",
					metadata: {},
					createdAt: new Date(NOW.getTime() - 90 * 60 * 1000),
				},
				{
					id: "evt-2",
					type: "ESCALATED",
					fromStatus: "NEW",
					toStatus: "ESCALATED",
					actorId: "admin-2",
					actorName: "Ana Admin",
					note: "Escalated to the on-call admin",
					metadata: {},
					createdAt: new Date(NOW.getTime() - 40 * 60 * 1000),
				},
			],
			eventsAvailable: true,
			owners: [{ id: "admin-2", label: "Ana Admin" }],
			ownersAvailable: true,
		});

		const html = renderToStaticMarkup(await page());

		expect(html).toContain("Feeder A is offline");
		expect(html).toContain("Incident facts");
		expect(html).toContain("Ana Admin");
		expect(html).toContain("Timeline");
		expect(html).toContain("Opened automatically");
		expect(html).toContain("Opened automatically by the device watch.");
		expect(html).toContain("System");
		expect(html).toContain("New → Escalated");
		expect(html).toContain('data-incident-actions="inc-1"');
	});

	it("flags a failed timeline read", async () => {
		mocks.detail.mockResolvedValue({
			incident: trackedRow(),
			events: [],
			eventsAvailable: false,
			owners: [],
			ownersAvailable: false,
		});

		const html = renderToStaticMarkup(await page());

		expect(html).toContain("The timeline could not be read.");
	});

	it("renders the not-found boundary for an unknown id", async () => {
		mocks.detail.mockResolvedValue(null);
		await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
	});
});
