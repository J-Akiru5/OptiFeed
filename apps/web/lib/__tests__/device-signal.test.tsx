import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

import { DeviceSignalReading } from "@/components/device-signal";

/**
 * I-97: the signal is shown as bars plus the reading in dBm, so the strength is
 * readable as text and never depends on colour or on the icon alone.
 */
describe("DeviceSignalReading", () => {
	it("renders the dBm value with a labelled bars ladder", () => {
		const { container, getByText } = render(<DeviceSignalReading rssiDbm={-84} />);

		expect(getByText(/-84 dBm/)).toBeInTheDocument();
		expect(getByText("Wi-Fi signal:")).toHaveClass("sr-only");

		const bars = container.querySelectorAll("span[aria-hidden='true'] > span");
		expect(bars).toHaveLength(4);
		// -84 dBm is the weakest step: one filled bar out of four.
		expect(container.querySelectorAll(".opacity-100")).toHaveLength(1);
	});

	it("fills the ladder for a strong signal", () => {
		const { container } = render(<DeviceSignalReading rssiDbm={-40} />);

		expect(container.querySelectorAll(".opacity-100")).toHaveLength(4);
	});

	it("renders nothing without a usable reading", () => {
		const empty = render(<DeviceSignalReading rssiDbm={null} />);
		expect(empty.container).toBeEmptyDOMElement();

		const invalid = render(<DeviceSignalReading rssiDbm={-128} />);
		expect(invalid.container).toBeEmptyDOMElement();
	});
});
