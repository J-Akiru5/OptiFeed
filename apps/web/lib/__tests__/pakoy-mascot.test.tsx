import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

import { MASCOT_POSES, Mascot } from "@/components/assistant/mascot";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-ui";

function publicPath(src: string): string {
	return join(process.cwd(), "public", src.replace(/^\//, ""));
}

describe("Pakoy mascot art slot", () => {
	it("ships a file for every pose and keeps each one small", () => {
		for (const [pose, src] of Object.entries(MASCOT_POSES)) {
			expect(src, pose).toMatch(/^\/mascot\/pakoy-[a-z-]+\.(webp|png)$/);
			const file = publicPath(src);
			expect(existsSync(file), `${pose} -> ${src}`).toBe(true);
			// Keep the payload tiny: the mascot must never slow a farmer's page.
			expect(statSync(file).size, pose).toBeLessThan(120 * 1024);
		}
	});

	it("renders the head mark as the default avatar", () => {
		const html = renderToStaticMarkup(<Mascot size={32} />);
		expect(html).toContain('data-pose="head"');
		expect(html).toContain(encodeURIComponent("/mascot/pakoy-head.webp"));
		// Decorative by default: the surrounding text already says "Pakoy".
		expect(html).toContain('alt=""');
	});

	it("maps every requested pose to its own file", () => {
		for (const pose of Object.keys(MASCOT_POSES) as Array<keyof typeof MASCOT_POSES>) {
			const html = renderToStaticMarkup(<Mascot pose={pose} size={64} />);
			expect(html, pose).toContain(`data-pose="${pose}"`);
			expect(html, pose).toContain(encodeURIComponent(MASCOT_POSES[pose]));
		}
	});

	it("carries alt text when the art is the only label", () => {
		const html = renderToStaticMarkup(<Mascot decorative={false} pose="offline" />);
		expect(html).toContain('alt="Pakoy, the PakaonAI mascot"');
	});

	it("puts a Pakoy pose in an empty state", () => {
		const html = renderToStaticMarkup(
			<DashboardEmptyState mascot="idle" title="No data yet" description="Add a sample." />,
		);
		expect(html).toContain('data-pose="idle"');
		expect(html).toContain("No data yet");
	});
});
