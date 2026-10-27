import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { pathname } = vi.hoisted(() => ({ pathname: { current: "/superadmin" } }));

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
			children?: React.ReactNode;
		}) => react.createElement("a", { href, ...rest }, children),
		usePathname: () => pathname.current,
	};
});

import { SuperadminBottomNav } from "@/components/superadmin-bottom-nav";
import { Badge, EmptyState, PageHeader, StatCard, TableFrame } from "@/components/superadmin/ui";

describe("platform console primitives (T-09c)", () => {
	it("PageHeader renders exactly one h1, a lede and the actions slot", () => {
		const html = renderToStaticMarkup(
			<PageHeader title="All Users" description="2 accounts" actions={<a href="/new">New</a>} />,
		);

		expect(html.split("<h1").length - 1).toBe(1);
		expect(html).toContain(">All Users</h1>");
		expect(html).toContain("2 accounts");
		expect(html).toContain('href="/new"');
	});

	it("TableFrame gives the table a caption and scoped column headers", () => {
		const html = renderToStaticMarkup(
			<TableFrame
				label="All platform users"
				columns={[
					{ key: "name", label: "User" },
					{ key: "role", label: "Role" },
				]}
			>
				<tr>
					<td>Juan</td>
					<td>ADMIN</td>
				</tr>
			</TableFrame>,
		);

		expect(html).toContain('<caption class="sr-only">All platform users</caption>');
		expect(html.split('scope="col"').length - 1).toBe(2);
		expect(html).toContain("overflow-x-auto");
	});

	it("EmptyState renders an accessible title, explanation and action", () => {
		const html = renderToStaticMarkup(
			<EmptyState
				title="No users registered."
				description="Create the first account."
				action={<a href="/superadmin/users/create">New Account</a>}
			/>,
		);

		expect(html).toContain("No users registered.");
		expect(html).toContain("Create the first account.");
		expect(html).toContain("New Account");
	});

	it("Badge maps a tone to the console palette", () => {
		expect(renderToStaticMarkup(<Badge tone="success">Online</Badge>)).toContain(
			"bg-[#E8F5EC] text-[#1E7B34]",
		);
		expect(renderToStaticMarkup(<Badge tone="danger">Offline</Badge>)).toContain(
			"bg-[#FDE8EA] text-[#C42B3A]",
		);
	});

	it("StatCard keeps the value in tabular figures", () => {
		const html = renderToStaticMarkup(<StatCard label="Users" value={1234} hint="All tenants" />);
		expect(html).toContain("tabular-nums");
		expect(html).toContain("1234");
	});
});

describe("platform console mobile navigation (T-09c, E26)", () => {
	it("keeps four primary sections plus More, all at 44 px or more", () => {
		pathname.current = "/superadmin";
		const html = renderToStaticMarkup(<SuperadminBottomNav />);

		// Four links plus the More control: nine columns at 375 px left 41 px per
		// target, below the 44 px minimum (E26).
		expect(html.split("<a ").length - 1).toBe(4);
		expect(html.split('data-mobile-trigger="more"').length - 1).toBe(1);
		expect(html.split('aria-current="page"').length - 1).toBe(1);
		expect(html).toContain('href="/superadmin"');
		expect(html).toContain('href="/superadmin/calendar"');
		expect(html).toContain('href="/superadmin/devices"');
		expect(html).toContain('href="/superadmin/orgs"');
		expect(html.split("min-h-14").length - 1).toBeGreaterThanOrEqual(5);
	});

	it("reaches every section from More, with the full name", () => {
		pathname.current = "/superadmin";
		render(<SuperadminBottomNav />);
		fireEvent.click(screen.getByRole("button", { name: "More sections" }));

		const dialog = screen.getByRole("dialog", { name: "Quick menu" });
		expect(dialog).toBeTruthy();
		for (const label of [
			"Overview",
			"Calendar",
			"Users",
			"Organizations",
			"Ponds",
			"Devices",
			"Operations",
			"AI Providers",
			"Settings",
		]) {
			expect(screen.getAllByText(label).length).toBeGreaterThan(0);
		}
	});

	it("marks the active section wherever you are", () => {
		pathname.current = "/superadmin/devices";
		const html = renderToStaticMarkup(<SuperadminBottomNav />);
		const activeTag = html.match(/<a [^>]*aria-current="page"[^>]*>/)?.[0] ?? "";
		expect(activeTag).toContain('href="/superadmin/devices"');
		expect(activeTag).toContain('aria-label="Devices"');
	});

	it("marks More when the current page is not one of the primary tabs", () => {
		pathname.current = "/superadmin/operations/audit";
		const html = renderToStaticMarkup(<SuperadminBottomNav />);
		expect(html).not.toContain('aria-current="page"');
		const more = html.match(/<button [^>]*data-mobile-trigger="more"[^>]*>/)?.[0] ?? "";
		// The muted class is the inactive state, so its absence is what proves the
		// tab is marked rather than merely present.
		expect(more).not.toContain("text-white/75");
		expect(more).toContain("text-white");
	});
});
