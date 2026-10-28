import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Renders the settings pages that changed in T-09d.
 *
 * Focus is on what a reader sees: one translated heading, labelled fields with
 * their units, empty states instead of blank cards, the read-only note that
 * also covers read-only view-as, and the setup AP name still derived from the
 * device MAC.
 */

vi.mock("next-intl/server", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		getTranslations: async (namespace: string) => createTranslator(namespace),
		getLocale: async () => "en",
	};
});

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace),
		useLocale: () => "en",
	};
});

vi.mock("@/i18n/routing", () => ({
	Link: ({
		href,
		children,
		...rest
	}: {
		href: string | { pathname?: string };
		children?: ReactNode;
	} & Record<string, unknown>) => (
		<a href={typeof href === "string" ? href : (href?.pathname ?? "#")} {...rest}>
			{children}
		</a>
	),
	getPathname: ({ href }: { href: string }) => href,
	usePathname: () => "/dashboard/settings",
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
	redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/auth/session", () => ({
	canWrite: vi.fn(async () => true),
	getCurrentUser: vi.fn(async () => ({ farmId: "farm-1", role: "ADMIN" })),
}));

vi.mock("@/lib/pond-selection", () => ({
	getActivePond: vi.fn(async () => ({
		id: "pond-1",
		name: "Pond 1",
		ownerId: "farm-1",
		isFallow: false,
		devices: [{ id: "dev-1" }],
		feedingRatePct: 3,
		feedsPerDay: 3,
		scheduleStart: new Date(Date.UTC(1970, 0, 1, 8)),
		scheduleEnd: new Date(Date.UTC(1970, 0, 1, 16)),
		sampleIntervalDays: 15,
		population: 1000,
		notificationPrefs: { areaM2: 500, averageDepthM: 1.5, feedPricePerKg: 30 },
	})),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		energyDevice: {
			findFirst: vi.fn(async () => ({
				id: "dev-1",
				mac: "AA:BB:CC:DD:AB:CD",
				label: "Feeder 1",
				lastSeenAt: new Date(),
				feedLevelPercent: 62,
				feedLevelUpdatedAt: new Date(),
				hopperFullCm: 5,
				hopperEmptyCm: 30,
				hopperCapacityG: 7000,
				gramsPerSecond: 12.5,
				gramsPerFeeding: 500,
				isPaused: false,
				lastCalibratedAt: null,
				recalibrationIntervalDays: 30,
				tempOffsetC: -0.5,
				waterTempC: 28.5,
				waterTempOk: true,
				waterTempUpdatedAt: new Date(),
			})),
		},
		calibrationRun: {
			count: vi.fn(async () => 0),
			groupBy: vi.fn(async () => []),
			findMany: vi.fn(async () => []),
		},
		feedEvent: {
			findMany: vi.fn(async () => []),
			aggregate: vi.fn(async () => ({ _sum: { grams: 0 } })),
		},
		deviceStateEvent: { findFirst: vi.fn(async () => null) },
		biomassLog: { findFirst: vi.fn(async () => null) },
		fcrReport: { findFirst: vi.fn(async () => null) },
		feedLevelLog: { findMany: vi.fn(async () => []) },
		cropCycle: { findFirst: vi.fn(async () => null) },
		user: { findMany: vi.fn(async () => []) },
	},
}));

vi.mock("@/lib/actions/farm", () => ({
	getFarmOverview: vi.fn(async () => ({
		ownerId: "farm-1",
		name: "Farm One",
		ponds: [{ id: "pond-1", name: "Pond 1" }],
	})),
	renameFarm: vi.fn(),
}));

vi.mock("@/lib/actions/settings", () => ({ updatePondSettings: vi.fn() }));
vi.mock("@/lib/actions/energy", () => ({
	saveHopperCalibration: vi.fn(),
	saveTemperatureCalibration: vi.fn(),
	saveDurationCalibration: vi.fn(),
}));
vi.mock("@/lib/actions/calibration", () => ({
	getCalibrationTestStatus: vi.fn(),
	runCalibrationTest: vi.fn(),
	runTargetCheck: vi.fn(),
	saveCalibrationFromTest: vi.fn(),
	submitTargetCheck: vi.fn(),
	saveRecalibrationInterval: vi.fn(),
}));
vi.mock("@/lib/actions/notifications", () => ({ updateNotificationPrefs: vi.fn() }));
vi.mock("@/lib/actions/password", () => ({ changeOwnPassword: vi.fn() }));
vi.mock("@/lib/schedule/resolve-current", () => ({
	resolveCurrentSchedule: vi.fn(async () => null),
}));

vi.mock("@/lib/supabase/server", () => ({
	createClient: async () => ({
		auth: {
			getUser: async () => ({ data: { user: { email: "juan@example.com" } } }),
		},
	}),
}));
vi.mock("@/lib/supabase/client", () => ({
	createClient: () => ({ auth: { signOut: vi.fn() } }),
}));

vi.mock("@/components/chat/chat-widget-provider", () => ({
	useChatWidget: () => ({ clearMessages: vi.fn() }),
}));
vi.mock("@/components/chat/chat-storage", () => ({ clearChatHistory: vi.fn() }));
vi.mock("@/lib/offline/db", () => ({ clearOfflineData: vi.fn() }));
vi.mock("@/lib/pwa/snapshot", () => ({ clearDashboardSnapshot: vi.fn() }));

vi.mock("@/lib/api-client", () => ({
	ApiClientError: class extends Error {},
	apiPost: vi.fn(),
}));
vi.mock("@/lib/jobs/client", () => ({
	fetchJobArtifact: vi.fn(),
	waitForJob: vi.fn(),
}));

import DataSettingsPage from "@/app/[locale]/(dashboard)/dashboard/settings/data/page";
import HardwareSettingsPage from "@/app/[locale]/(dashboard)/dashboard/settings/hardware/page";
import SettingsPage from "@/app/[locale]/(dashboard)/dashboard/settings/page";
import PondSettingsPage from "@/app/[locale]/(dashboard)/dashboard/settings/pond/page";
import ProfileSettingsPage from "@/app/[locale]/(dashboard)/dashboard/settings/profile/page";
import { canWrite } from "@/lib/auth/session";

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(canWrite).mockResolvedValue(true);
});

function expectReadOnlyNote(html: string) {
	expect(html).toContain('role="note"');
	expect(html).toContain("View only");
	expect(html).toContain("Controls are disabled instead of failing after a tap.");
}

describe("settings index", () => {
	it("renders one heading, the farm card and linked section cards", async () => {
		const html = renderToStaticMarkup(await SettingsPage());

		expect(html.match(/<h1/g)).toHaveLength(1);
		expect(html).toContain("Settings");
		expect(html).toContain("Farm One");
		expect(html).toContain('aria-label="Settings sections"');
		expect(html).toContain('aria-label="Open Pond"');
		expect(html).toContain("Pond 1");
		expect(html).not.toContain('aria-label="Navigate"');
	});

	it("explains read-only mode instead of letting a tap fail", async () => {
		vi.mocked(canWrite).mockResolvedValueOnce(false);

		const html = renderToStaticMarkup(await SettingsPage());

		expectReadOnlyNote(html);
	});
});

describe("hardware settings page", () => {
	it("labels every calibration input with its unit", async () => {
		const html = renderToStaticMarkup(
			await HardwareSettingsPage({ searchParams: Promise.resolve({}) }),
		);

		expect(html.match(/<h1/g)).toHaveLength(1);
		expect(html).toContain("Full Distance (cm)");
		expect(html).toContain("Empty Distance (cm)");
		expect(html).toContain("Hopper Capacity (grams)");
		expect(html).toContain("Temperature Offset (°C)");
		expect(html).toContain("Current level");
		expect(html).toContain("62%");
	});

	it("still shows the setup AP name derived from the device MAC", async () => {
		const html = renderToStaticMarkup(
			await HardwareSettingsPage({ searchParams: Promise.resolve({}) }),
		);

		expect(html).toContain("PakaonAI-ABCD");
		expect(html).toContain("Device ID (MAC)");
	});

	it("explains read-only mode on the hardware controls", async () => {
		vi.mocked(canWrite).mockResolvedValueOnce(false);

		const html = renderToStaticMarkup(
			await HardwareSettingsPage({ searchParams: Promise.resolve({}) }),
		);

		expectReadOnlyNote(html);
	});
});

describe("pond settings page", () => {
	it("renders the pond form with units and the account card", async () => {
		const html = renderToStaticMarkup(await PondSettingsPage());

		expect(html.match(/<h1/g)).toHaveLength(1);
		expect(html).toContain("Sample Interval (days)");
		expect(html).toContain("Population (fish)");
		expect(html).toContain("Pond Area (m²)");
		expect(html).toContain("Sign Out");
		expect(html).toContain("min-h-11");
	});

	it("explains read-only mode on the pond form", async () => {
		vi.mocked(canWrite).mockResolvedValueOnce(false);

		const html = renderToStaticMarkup(await PondSettingsPage());

		expectReadOnlyNote(html);
	});
});

describe("profile settings page", () => {
	it("renders profile, security and notification sections", async () => {
		const html = renderToStaticMarkup(await ProfileSettingsPage());

		expect(html.match(/<h1/g)).toHaveLength(1);
		expect(html).toContain("Profile Information");
		expect(html).toContain("Security");
		expect(html).toContain("Notification Preferences");
		expect(html).toContain("juan@example.com");
	});

	it("explains read-only mode for view-as and viewers", async () => {
		vi.mocked(canWrite).mockResolvedValueOnce(false);

		const html = renderToStaticMarkup(await ProfileSettingsPage());

		expectReadOnlyNote(html);
	});
});

describe("data settings page", () => {
	it("renders the export and import cards", async () => {
		const html = renderToStaticMarkup(await DataSettingsPage());

		expect(html.match(/<h1/g)).toHaveLength(1);
		expect(html).toContain("Export Data");
		expect(html).toContain("Import Data");
	});

	it("explains read-only mode and disables import", async () => {
		vi.mocked(canWrite).mockResolvedValueOnce(false);

		const html = renderToStaticMarkup(await DataSettingsPage());

		expectReadOnlyNote(html);
		expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*Import Data/);
	});
});
