import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #845: the landing footer used to print a hardcoded "Firmware v1.4.2" while
 * the fleet was on 1.9.0. The line now renders the published channel version
 * supplied by the server page, and the catalogues only hold a placeholder.
 */

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

const { getFirmwareStatus } = vi.hoisted(() => ({ getFirmwareStatus: vi.fn() }));
vi.mock("@/lib/settings/firmware-status", () => ({ getFirmwareStatus }));

const contentProps = vi.hoisted(() => ({
	current: null as { firmwareVersion?: string | null } | null,
}));

vi.mock("@/components/landing/landing-page-content", () => ({
	LandingPageContent: (props: { firmwareVersion: string | null }) => {
		contentProps.current = props;
		return <div data-testid="landing-content" data-version={String(props.firmwareVersion)} />;
	},
}));

import LandingPage from "@/app/[locale]/page";
import { FooterFirmware } from "@/components/landing/footer-firmware";
import { loadMessages } from "./helpers/messages";

const STATUS = {
	storageConfigured: true,
	channelPath: "firmware/stable.json",
	channelVersion: "1.9.0",
	channelAvailable: true,
	windowStart: "10:00",
	windowEnd: "15:00",
};

afterEach(cleanup);

beforeEach(() => {
	contentProps.current = null;
	getFirmwareStatus.mockResolvedValue(STATUS);
});

describe("FooterFirmware", () => {
	it("renders the supplied published version", () => {
		render(<FooterFirmware version="1.9.0" />);

		expect(screen.getByText("Firmware v1.9.0")).toBeInTheDocument();
	});

	it("renders nothing when the channel is unavailable", () => {
		const { container } = render(<FooterFirmware version={null} />);

		expect(container.firstChild).toBeNull();
	});
});

describe("landing page wiring", () => {
	it("passes the channel version from getFirmwareStatus", async () => {
		const html = renderToStaticMarkup(await LandingPage());

		expect(html).toContain('data-version="1.9.0"');
		expect(contentProps.current?.firmwareVersion).toBe("1.9.0");
	});

	it("passes null when no published channel is readable", async () => {
		getFirmwareStatus.mockResolvedValue({
			...STATUS,
			channelAvailable: false,
			channelVersion: null,
		});

		const html = renderToStaticMarkup(await LandingPage());

		expect(html).toContain('data-version="null"');
	});
});

describe("footer copy", () => {
	it("keeps a version placeholder and no version literal in every locale", () => {
		for (const locale of ["en", "hil", "tl"] as const) {
			const copy = loadMessages(locale)["landing.footerFirmware"];

			expect(copy, locale).toContain("{version}");
			expect(copy, locale).not.toMatch(/v\d+\.\d+/);
		}
	});
});
