import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #819: the sidebar footer must render the dashboard's alerts as real links.
 *
 * These checks cover the two failure modes the shell can introduce:
 *  - an alert that renders as text with no destination;
 *  - a footer that leaks onto a console route that is not the dashboard.
 */

const { pathname } = vi.hoisted(() => ({ pathname: { current: "/dashboard" } }));

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("@/i18n/routing", async () => {
	const react = await import("react");
	return {
		Link: ({
			href,
			children,
			...rest
		}: {
			href: string;
			children?: ReactNode;
		} & Record<string, unknown>) => react.createElement("a", { href, ...rest }, children),
		usePathname: () => pathname.current,
	};
});

import {
	DashboardAlertsProvider,
	DashboardAlertsSync,
} from "@/components/dashboard/alerts/dashboard-alerts-context";
import { SidebarAlertList, SidebarAlerts } from "@/components/dashboard/alerts/sidebar-alerts";
import type { DashboardAlert } from "@/lib/dashboard/alerts";
import type { DeviceHealthView } from "@/lib/device-health-model";
import { expectNoSeriousOrCriticalViolations } from "./helpers/axe";

const alerts: DashboardAlert[] = [
	{
		id: "offline",
		tone: "danger",
		title: "Feeder offline for 2h 5m",
		detail: "Feeder 1 has not sent a heartbeat.",
		href: "/dashboard/settings/hardware?device=dev-1&tab=network#wifi-setup",
		linkLabel: "Open hardware settings",
	},
	{
		id: "hopper-low",
		tone: "warning",
		title: "Hopper low: 12%",
		detail: "Refill before the next feeding.",
		href: "/dashboard/settings/pond",
		linkLabel: "Open feed settings",
	},
];

const safeMode: DeviceHealthView = {
	safeMode: true,
	faults: [],
	abnormalResets: 3,
	resetReasons: "brownout",
	since: new Date("2026-11-04T01:00:00Z"),
	lastRefusal: null,
};

beforeEach(() => {
	pathname.current = "/dashboard";
});

describe("sidebar alerts (#819)", () => {
	it("renders every alert as a real link with a discernible name", async () => {
		const { container } = render(
			<SidebarAlertList
				alerts={alerts}
				health={null}
				hardwareHref="/dashboard/settings/hardware?device=dev-1#device-status"
				collapsed={false}
			/>,
		);

		const offline = screen.getByRole("link", { name: /Feeder offline for 2h 5m/ });
		expect(offline).toHaveAttribute(
			"href",
			"/dashboard/settings/hardware?device=dev-1&tab=network#wifi-setup",
		);
		expect(offline.textContent).toContain("Open hardware settings");

		const hopper = screen.getByRole("link", { name: /Hopper low: 12%/ });
		expect(hopper).toHaveAttribute("href", "/dashboard/settings/pond");
		expect(hopper.textContent).toContain("Open feed settings");

		await expectNoSeriousOrCriticalViolations(container);
	});

	it("keeps the destination reachable when the sidebar is collapsed", async () => {
		const { container } = render(
			<SidebarAlertList alerts={alerts} health={null} hardwareHref={null} collapsed />,
		);

		const link = screen.getByRole("link", {
			name: "Feeder offline for 2h 5m. Open hardware settings",
		});
		expect(link).toHaveAttribute(
			"href",
			"/dashboard/settings/hardware?device=dev-1&tab=network#wifi-setup",
		);

		await expectNoSeriousOrCriticalViolations(container);
	});

	it("links the health card to the hardware page", async () => {
		const { container } = render(
			<SidebarAlertList
				alerts={[]}
				health={safeMode}
				hardwareHref="/dashboard/settings/hardware?device=dev-1#device-status"
				collapsed={false}
			/>,
		);

		expect(screen.getByText("Safe mode: doses are refused")).toBeTruthy();
		const link = screen.getByRole("link", { name: /Open hardware settings/ });
		expect(link).toHaveAttribute("href", "/dashboard/settings/hardware?device=dev-1#device-status");

		await expectNoSeriousOrCriticalViolations(container);
	});

	it("keeps the health destination reachable when the sidebar is collapsed", () => {
		render(
			<SidebarAlertList
				alerts={[]}
				health={safeMode}
				hardwareHref="/dashboard/settings/hardware?device=dev-1#device-status"
				collapsed
			/>,
		);

		const link = screen.getByRole("link", {
			name: "Safe mode: doses are refused. Open hardware settings",
		});
		expect(link).toHaveAttribute("href", "/dashboard/settings/hardware?device=dev-1#device-status");
	});

	it("shows an all-clear line only after the dashboard published an empty list", () => {
		render(<SidebarAlertList alerts={[]} health={null} hardwareHref={null} collapsed={false} />);
		expect(screen.getByText("Nothing needs attention")).toBeTruthy();
	});
});

describe("sidebar alert route gating (#819)", () => {
	it("publishes on the dashboard and disappears on another console page", async () => {
		const { rerender } = render(
			<DashboardAlertsProvider>
				<DashboardAlertsSync alerts={alerts} health={null} hardwareHref={null} />
				<SidebarAlerts collapsed={false} />
			</DashboardAlertsProvider>,
		);

		expect(await screen.findByTestId("sidebar-alerts")).toBeTruthy();

		pathname.current = "/dashboard/history";
		rerender(
			<DashboardAlertsProvider>
				<DashboardAlertsSync alerts={alerts} health={null} hardwareHref={null} />
				<SidebarAlerts collapsed={false} />
			</DashboardAlertsProvider>,
		);

		expect(screen.queryByTestId("sidebar-alerts")).toBeNull();
	});
});
