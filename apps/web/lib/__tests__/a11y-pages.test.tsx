import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * axe-core coverage for the key authenticated and public surfaces (ISO 25010
 * usability / W9).
 *
 * The gate is **zero serious/critical violations** per surface. What is covered
 * here and how:
 *
 *   login            /login, the real client page, rendered in jsdom
 *   dashboard shell  the shared page shell components every dashboard page uses
 *   growth           the growth-plan card with a full, realistic plan
 *   hardware         /dashboard/settings/hardware, the real server page
 *   admin devices    /admin/devices, the real server page with rows, the
 *                    pending-approval queue and the add-feeder form
 *   admin settings   /admin/settings, the real server page with the settings
 *                    grid and the members card (table + card list)
 *
 * Server pages are rendered with `renderToStaticMarkup()` and mounted into a
 * real jsdom document, so axe sees the markup a browser would parse; effects do
 * not run, which is fine for structural rules. Interaction and focus order are
 * covered in `keyboard-navigation.test.tsx`, and the chat widget (a client
 * surface with its own palette) in `a11y-chat.test.tsx`.
 *
 * Nothing is excluded from the run: `helpers/axe.ts` runs the whole default rule
 * set and only sets the pass threshold at serious/critical.
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
	usePathname: () => "/dashboard",
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
	redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock("@/components/theme-provider", () => ({
	useTheme: () => ({ theme: "light", resolvedTheme: "light", setTheme: vi.fn() }),
}));

vi.mock("@/components/chat/chat-widget-provider", () => ({
	useChatWidget: () => ({ isOpen: false, open: vi.fn(), close: vi.fn(), toggle: vi.fn() }),
}));
vi.mock("@/components/chat/chat-storage", () => ({ clearChatHistory: vi.fn() }));

vi.mock("@/lib/actions/auth", () => ({ loginWithPassword: vi.fn() }));
vi.mock("@/lib/actions/pond-selection", () => ({ switchPond: vi.fn() }));
vi.mock("@/lib/actions/growth-plan", () => ({ applyGrowthPlan: vi.fn() }));
vi.mock("@/lib/actions/growth-target", () => ({ clearGrowthTarget: vi.fn() }));
vi.mock("@/lib/actions/settings", () => ({
	updatePondSettings: vi.fn(),
	updateDeviceDailyCap: vi.fn(),
}));
vi.mock("@/lib/actions/energy", () => ({
	requestFeed: vi.fn(),
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
vi.mock("@/lib/actions/device-registration", () => ({
	getTenantRegistrationOptions: vi.fn(async () => ({
		orgId: "org-1",
		orgName: "Farm One",
		mode: "ADMIN_APPROVAL",
		ponds: [
			{ id: "pond-1", name: "Pond A" },
			{ id: "pond-2", name: "Pond B" },
		],
	})),
	addTenantDevice: vi.fn(),
	approveTenantDevice: vi.fn(),
	rejectTenantDevice: vi.fn(),
}));
vi.mock("@/lib/actions/admin", () => ({
	getUsers: vi.fn(),
	getDevices: vi.fn(),
	getPendingDevices: vi.fn(async () => []),
	getPonds: vi.fn(),
	getAllFarmHierarchies: vi.fn(),
	getAdminStats: vi.fn(),
	getAuditLog: vi.fn(),
	listTenantMembers: vi.fn(),
	createPondWithFarmer: vi.fn(),
	revealDeviceToken: vi.fn(),
	setPondStatus: vi.fn(),
	getUserPermissionState: vi.fn(),
	setUserPermission: vi.fn(),
	changeMemberRole: vi.fn(),
	inviteMember: vi.fn(),
	revokeMember: vi.fn(),
}));
vi.mock("@/lib/actions/admin-overview", () => ({ getAdminOverview: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({
	canWrite: vi.fn(async () => true),
	getCurrentUser: vi.fn(async () => ({
		id: "user-self",
		displayName: "Nong Juan",
		farmId: "farm-1",
		role: "ADMIN",
	})),
	getCurrentPondOwnerId: vi.fn(async () => "farm-1"),
	assertPasswordChanged: vi.fn(async () => undefined),
	requirePasswordChanged: vi.fn(async () => ({ id: "user-self" })),
}));

vi.mock("@/lib/auth/org-scope", () => ({
	resolveOrgScope: vi.fn(async () => ({
		orgIds: ["org-1"],
		memberUserIds: ["user-self"],
		farmIds: ["farm-self"],
		pondIds: [],
	})),
}));

vi.mock("@/lib/auth/permissions", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/auth/permissions")>();
	return { ...actual, hasPermission: vi.fn(async () => true) };
});

vi.mock("@/lib/pond-selection", () => ({
	getActivePond: vi.fn(async () => ({
		id: "pond-1",
		name: "Pond A",
		ownerId: "farm-1",
		population: 1200,
		feedsPerDay: 3,
		feedingRatePct: 3,
		scheduleStart: new Date("2026-10-27T06:00:00Z"),
		scheduleEnd: new Date("2026-10-27T18:00:00Z"),
		isFallow: false,
		sampleIntervalDays: 14,
		devices: [{ id: "dev-1" }],
		energyDevices: [{ id: "dev-1", label: "Feeder 1" }],
		notificationPrefs: { areaM2: 500, averageDepthM: 1.5, feedPricePerKg: 30 },
	})),
	getActivePondId: vi.fn(async () => "pond-1"),
	listSelectablePonds: vi.fn(async () => [
		{
			id: "pond-1",
			name: "Pond A",
			ownerId: "farm-1",
			population: 1200,
			feedsPerDay: 3,
			feedingRatePct: 3,
			scheduleStart: new Date("2026-10-27T06:00:00Z"),
			scheduleEnd: new Date("2026-10-27T18:00:00Z"),
			isFallow: false,
		},
	]),
}));

vi.mock("@/lib/schedule/resolve-current", () => ({
	resolveCurrentSchedule: vi.fn(async () => null),
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
			// #403: the page loads the selected feeder by id.
			findUnique: vi.fn(async () => ({
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
			findMany: vi.fn(async () => [
				{ id: "dev-1", feedLevelUpdatedAt: new Date() },
				{ id: "dev-2", feedLevelUpdatedAt: null },
			]),
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
		user: { findMany: vi.fn(async () => []) },
		orgSetting: { findUnique: vi.fn(async () => null) },
		platformSetting: { findUnique: vi.fn(async () => null) },
	},
}));

vi.mock("@/lib/supabase/client", () => ({
	createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock("@/lib/supabase/server", () => ({
	createClient: async () => ({
		auth: { getUser: async () => ({ data: { user: { email: "juan@example.com" } } }) },
	}),
}));
vi.mock("@/lib/offline/db", () => ({ clearOfflineData: vi.fn() }));
vi.mock("@/lib/pwa/snapshot", () => ({ clearDashboardSnapshot: vi.fn() }));

import AdminDevicesPage from "@/app/[locale]/(admin)/admin/devices/page";
import AdminSettingsPage from "@/app/[locale]/(admin)/admin/settings/page";
import HardwareSettingsPage from "@/app/[locale]/(dashboard)/dashboard/settings/hardware/page";
import LoginPage from "@/app/[locale]/login/page";
import { DashboardContentShell } from "@/components/chat/dashboard-content-shell";
import {
	DashboardEmptyState,
	DashboardPageHeader,
	DashboardSection,
	ReadOnlyNotice,
} from "@/components/dashboard/dashboard-ui";
import { GrowthPlanCard } from "@/components/growth/GrowthPlanCard";
import { getDevices, getPendingDevices, listTenantMembers } from "@/lib/actions/admin";
import { buildGrowthPlan } from "@/lib/growth-plan";
import { Activity, CalendarClock, Scale } from "lucide-react";
import { expectNoSeriousOrCriticalViolations } from "./helpers/axe";

/**
 * A complete growth plan (cycle, two samples, calculator target) so the card
 * renders its figures, trajectory and apply affordance rather than an empty
 * state — the dark surface and dense grid are where a11y regressions hide.
 */
function growthPlan(savedTargetWeightG: number) {
	return buildGrowthPlan({
		cycle: {
			id: "cycle-1",
			label: "Batch 2026-A",
			stockingDate: "2026-01-01",
			stockingCount: 1000,
			stockingAvgWeightG: 10,
			growOutDays: 120,
			targetHarvestDate: "2026-05-01",
			targetHarvestWeightG: 330,
			expectedSurvivalPct: 90,
		},
		latestSample: { id: "sample-2", date: "2026-03-02", avgWeightG: 120, sampleCount: 30 },
		previousSample: { id: "sample-1", date: "2026-02-01", avgWeightG: 100, sampleCount: 30 },
		population: 1000,
		feedingRatePct: 3,
		feedsPerDay: 3,
		currentGramsPerFeeding: 1000,
		// The device must be able to serve the recommended ration, otherwise the
		// card renders its "device cap" warning instead of the apply block and the
		// confirm affordance is not exercised.
		deviceMaxGramsPerFeeding: 3000,
		latestFcr: 1.5,
		lastAdjustmentAt: null,
		today: "2026-03-02",
		pond: { areaM2: 100, averageDepthM: 1.5, feedPricePerKg: 30 },
		savedTarget: { targetWeightG: savedTargetWeightG, cycleId: "cycle-1", population: 1000 },
	});
}

// jsdom does not implement matchMedia; the login page reads it once at mount to
// decide whether to pre-focus the farm-id field. A desktop, light, non-touch
// match makes the page take its default branch.
beforeAll(() => {
	Object.defineProperty(window, "matchMedia", {
		writable: true,
		configurable: true,
		value: (query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			addListener: vi.fn(),
			removeListener: vi.fn(),
			dispatchEvent: vi.fn(() => false),
		}),
	});
});

beforeEach(() => {
	vi.clearAllMocks();
	localStorage.clear();
});

afterEach(() => {
	cleanup();
	document.body.innerHTML = "";
});

/** Mount server-rendered markup so axe can walk a real document tree. */
function mountStaticPage(markup: string): HTMLElement {
	const host = document.createElement("div");
	host.innerHTML = markup;
	document.body.append(host);
	return host;
}

describe("login page", () => {
	it("has no serious or critical violations", async () => {
		const { container } = render(<LoginPage />);

		// The form's own affordances are why this page is in the gate.
		expect(container.querySelector("#farmId")).not.toBeNull();
		expect(container.querySelector("#password")).not.toBeNull();

		await expectNoSeriousOrCriticalViolations(container);
	});
});

describe("dashboard page shell", () => {
	it("composes the shared header, sections, empty state and read-only note cleanly", async () => {
		const { container } = render(
			<main>
				<DashboardPageHeader
					title="Dashboard"
					description="Today's feeding at a glance."
					icon={Activity}
					actions={<button type="button">Log sample</button>}
					summary="Next feeding at 6:00 PM"
				/>
				<DashboardSection title="Feeding" description="Today's schedule" icon={CalendarClock}>
					<p className="text-sm">Three feedings are scheduled.</p>
				</DashboardSection>
				<DashboardSection title="Samples" icon={Scale}>
					<DashboardEmptyState
						icon={Scale}
						title="No samples yet"
						description="Log a sample to start tracking growth."
						action={<button type="button">Log sample</button>}
					/>
				</DashboardSection>
				<ReadOnlyNotice
					title="View only"
					description="Controls are disabled instead of failing after a tap."
				/>
				<DashboardContentShell>
					<div>Pond canvas</div>
				</DashboardContentShell>
			</main>,
		);

		// One page heading, two section headings: the hierarchy axe checks.
		expect(container.querySelectorAll("h1")).toHaveLength(1);
		expect(container.querySelectorAll("h2")).toHaveLength(2);

		await expectNoSeriousOrCriticalViolations(container);
	});
});

describe("growth page card", () => {
	it("has no serious or critical violations with a full plan", async () => {
		const { container } = render(
			<GrowthPlanCard plan={growthPlan(400)} pondId="pond-1" canWrite />,
		);

		// The apply/confirm affordance must be present or the surface is not
		// actually exercised. This plan has no prior adjustment, so the card shows
		// its initial-feed block rather than "Next adjustment".
		expect(screen.getByRole("button", { name: /Set initial/ })).toBeInTheDocument();

		await expectNoSeriousOrCriticalViolations(container);
	});
});

describe("hardware settings page", () => {
	it("has no serious or critical violations across the calibration forms", async () => {
		const host = mountStaticPage(
			renderToStaticMarkup(await HardwareSettingsPage({ searchParams: Promise.resolve({}) })),
		);

		// Every calibration field is labelled with its unit; if this fails the
		// page changed shape and the axe run is no longer meaningful.
		expect(host.textContent).toContain("Full Distance (cm)");
		expect(host.textContent).toContain("Tank Diameter (cm)");

		await expectNoSeriousOrCriticalViolations(host);
	});
});

describe("admin devices page", () => {
	beforeEach(() => {
		vi.mocked(getDevices).mockResolvedValue({
			rows: [
				{
					id: "dev-1",
					label: "Feeder 1",
					mac: "A4:CF:12:7E:3B:09",
					pondId: "pond-1",
					lastSeenAt: new Date(),
					feedLevelPercent: 42,
					gramsPerFeeding: 120,
					approvalStatus: "APPROVED",
					pond: { id: "pond-1", name: "Pond A" },
				},
				{
					id: "dev-2",
					label: "Feeder 2",
					mac: "A4:CF:12:7E:3B:0A",
					pondId: null,
					lastSeenAt: null,
					feedLevelPercent: null,
					gramsPerFeeding: 90,
					approvalStatus: "APPROVED",
					pond: null,
				},
			],
			total: 2,
			page: 1,
			pageSize: 20,
		} as unknown as Awaited<ReturnType<typeof getDevices>>);
		vi.mocked(getPendingDevices).mockResolvedValue([
			{
				id: "dev-pending",
				label: "Feeder Pending",
				mac: "A4:CF:12:7E:3B:0B",
				pondId: "pond-1",
				lastSeenAt: null,
				feedLevelPercent: null,
				gramsPerFeeding: 100,
				approvalStatus: "PENDING",
				pond: { id: "pond-1", name: "Pond A" },
			},
		] as unknown as Awaited<ReturnType<typeof getPendingDevices>>);
	});

	it("has no serious or critical violations in the table, cards, queue and add form", async () => {
		const host = mountStaticPage(
			renderToStaticMarkup(await AdminDevicesPage({ searchParams: Promise.resolve({}) })),
		);

		// The table caption, the mobile card list, the approval queue and the
		// add-feeder form are all in this one run.
		expect(host.querySelector("caption")).not.toBeNull();
		expect(host.textContent).toContain("Feeder Pending");
		expect(host.textContent).toContain("Add feeder");

		await expectNoSeriousOrCriticalViolations(host);
	});
});

describe("admin settings page", () => {
	beforeEach(() => {
		vi.mocked(listTenantMembers).mockResolvedValue({
			rows: [
				{
					membershipId: "m-1",
					userId: "user-1",
					orgId: "org-1",
					orgName: "Miguel Farm",
					displayName: "Juan Miguel",
					farmId: "juan-miguel",
					email: "juan@example.com",
					avatarUrl: null,
					role: "OWNER",
					callerRole: "OWNER",
					permissions: [],
					joinedAt: new Date("2026-07-08T16:19:00"),
					isSelf: true,
					isPlatformAdmin: false,
					isLastOwner: true,
				},
			],
			total: 1,
			page: 1,
			pageSize: 20,
			orgOptions: [{ id: "org-1", name: "Miguel Farm", callerRole: "OWNER" }],
		} as unknown as Awaited<ReturnType<typeof listTenantMembers>>);
	});

	it("has no serious or critical violations across the settings and members sections", async () => {
		const host = mountStaticPage(
			renderToStaticMarkup(await AdminSettingsPage({ searchParams: Promise.resolve({}) })),
		);

		// Both sections carry a heading of their own; the members card renders
		// the desktop table and the mobile card list in the same markup.
		expect(host.querySelector("#general-settings-title")?.textContent).toBe("General Settings");
		expect(host.querySelector("#members-title")?.textContent).toBe("Members");
		expect(host.querySelector(".data-list-table")).not.toBeNull();
		expect(host.querySelector(".data-list-cards")).not.toBeNull();

		await expectNoSeriousOrCriticalViolations(host);
	});
});
