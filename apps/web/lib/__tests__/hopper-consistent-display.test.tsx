import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("@/i18n/routing", () => ({
	Link: ({ href, children }: { href: string; children?: React.ReactNode }) => (
		<a href={href}>{children}</a>
	),
	usePathname: () => "/dashboard",
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import { FeedLevelCard } from "@/components/FeedLevelCard";
import { FeedLevelDisplay } from "@/components/feed-level-display";
import { Sidebar } from "@/components/sidebar";
import { toHopperSnapshot } from "@/lib/device-hopper";
import { getFeedLevelDisplay } from "@/lib/feed-level";

const snapshot = toHopperSnapshot({
	id: "dev-1",
	feedLevelPercent: 30,
	feedLevelUpdatedAt: new Date("2026-10-28T09:00:00+08:00"),
	lastSeenAt: new Date(),
	hopperCapacityG: 22_190,
	gramsPerFeeding: 350,
});

function sidebarHtml(levelPercent = snapshot.levelPercent) {
	return renderToStaticMarkup(
		<Sidebar
			hopperLevelPct={levelPercent}
			hopperLevelUpdatedAt={snapshot.levelUpdatedAt}
			hopperCapacityG={snapshot.hopperCapacityG}
			gramsPerFeeding={snapshot.gramsPerFeeding}
			feedsPerDay={3}
			isOffline={snapshot.isOffline}
		/>,
	);
}

function cardHtml(props: {
	levelPercent: number | null;
	isOffline: boolean;
}) {
	return renderToStaticMarkup(
		<FeedLevelCard
			levelPercent={props.levelPercent}
			updatedAt={snapshot.levelUpdatedAt}
			hopperCapacityG={snapshot.hopperCapacityG}
			gramsPerFeeding={snapshot.gramsPerFeeding ?? 350}
			feedsPerDay={3}
			isDeviceOffline={props.isOffline}
		/>,
	);
}

describe("one hopper reading, every surface (#263)", () => {
	it("renders the same level in the sidebar and the dashboard card", () => {
		const sidebar = sidebarHtml(42);
		const card = cardHtml({ levelPercent: 42, isOffline: false });

		expect(sidebar).toContain("42%");
		expect(card).toContain("42%");
		// kg remaining and feedings left come from the device capacity and dose,
		// not the old hard-coded 22.19 kg / 0.35 kg.
		expect(sidebar).toContain("9.3kg");
		expect(sidebar).toContain("26");
	});

	it("estimates remaining feed from the same inputs as the card", () => {
		const display = getFeedLevelDisplay({
			levelPercent: 30,
			hopperCapacityG: 22_190,
			gramsPerFeeding: 350,
			feedsPerDay: 3,
			isDeviceOffline: false,
		});

		expect(display.remainingGrams).toBeCloseTo(6_657, 0);
		expect(display.feedingsRemaining).toBe(19);
		expect(display.daysRemaining).toBe(6);
	});
});

describe("low hopper display (#259)", () => {
	it("turns red and says 'refill soon' at exactly 30 %", () => {
		const card = cardHtml({ levelPercent: 30, isOffline: false });
		const sidebar = sidebarHtml(30);

		expect(card).toContain('data-hopper-low="true"');
		expect(card).toContain("Low: refill soon");
		expect(sidebar).toContain("Low: refill soon");
		expect(sidebar).toContain("hopper-low-pulse");
	});

	it("stays normal at 30.1 %", () => {
		const card = cardHtml({ levelPercent: 30.1, isOffline: false });

		expect(card).not.toContain("Low: refill soon");
		expect(card).not.toContain('data-hopper-low="true"');
	});

	it("keeps the greyed last-known treatment and no blink when offline", () => {
		const offline = cardHtml({ levelPercent: 25, isOffline: true });

		expect(offline).toContain("Last known 25%");
		expect(offline).not.toContain("Low: refill soon");
		expect(offline).not.toContain('data-hopper-low="true"');
		expect(offline).not.toContain("hopper-low-pulse");
	});

	it("disables the pulse for readers who prefer reduced motion", () => {
		const css = readFileSync(join(__dirname, "../../app/globals.css"), "utf8");
		const start = css.indexOf("@keyframes hopper-low-pulse");

		expect(start).toBeGreaterThan(-1);
		expect(css.slice(start)).toContain("prefers-reduced-motion: no-preference");
		expect(css.slice(start)).toContain("prefers-reduced-motion: reduce");
		expect(css.slice(start)).toMatch(/animation:\s*none/);
	});

	it("still shows a shared low level through the plain display component", () => {
		const html = renderToStaticMarkup(
			<FeedLevelDisplay levelPercent={30} updatedAt={snapshot.levelUpdatedAt} isOffline={false} />,
		);

		expect(html).toContain("30%");
		expect(html).toContain("Low: refill soon");
		expect(html).toContain("hopper-low-pulse");
	});
});
