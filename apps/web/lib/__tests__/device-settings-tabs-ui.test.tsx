import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

const push = vi.fn();
vi.mock("@/i18n/routing", () => ({ useRouter: () => ({ push }) }));

import { DeviceSettingsTabs } from "@/components/settings/device-settings-tabs";
import { useReportUnsavedChanges } from "@/components/settings/unsaved-changes";
import { HELP_REVEAL_EVENT } from "@/lib/help/highlight";
import { useState } from "react";

function DraftField() {
	const [value, setValue] = useState("1200");
	useReportUnsavedChanges("cap", value !== "1200");
	return (
		<label>
			Cap
			<input value={value} onChange={(event) => setValue(event.target.value)} />
		</label>
	);
}

const devices = [
	{ id: "dev-1", label: "Feeder 1", pondName: "Pond A", state: "online" as const },
	{ id: "dev-2", label: "Feeder 2", pondName: "Pond B", state: "offline" as const },
];

function renderTabs(initialTab: "overview" | "feeding" = "overview") {
	return render(
		<DeviceSettingsTabs
			initialTab={initialTab}
			deviceId="dev-1"
			devices={devices}
			panels={{
				overview: <p>Status panel</p>,
				feeding: <DraftField />,
				calibration: <p data-help="hopper-calibration">Hopper panel</p>,
				network: <p>WiFi panel</p>,
			}}
		/>,
	);
}

beforeEach(() => {
	push.mockClear();
	window.history.replaceState(null, "", "/en/dashboard/settings/hardware");
});
afterEach(cleanup);

describe("DeviceSettingsTabs (#403)", () => {
	it("shows one panel and keeps the tab in the URL", () => {
		renderTabs();
		expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
		expect(screen.getByText("WiFi panel").closest("[role=tabpanel]")).toHaveAttribute("hidden");

		fireEvent.click(screen.getByRole("tab", { name: "Network" }));
		expect(screen.getByText("WiFi panel").closest("[role=tabpanel]")).not.toHaveAttribute("hidden");
		expect(window.location.search).toBe("?tab=network");

		fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
		expect(window.location.search).toBe("");
	});

	it("moves between tabs with the arrow keys", () => {
		renderTabs();
		fireEvent.keyDown(screen.getByRole("tab", { name: "Overview" }), { key: "ArrowLeft" });
		expect(screen.getByRole("tab", { name: "Network" })).toHaveAttribute("aria-selected", "true");
		expect(screen.getByRole("tab", { name: "Network" })).toHaveFocus();
	});

	it("marks a tab with unsaved edits and keeps them across a tab switch", () => {
		renderTabs("feeding");
		fireEvent.change(screen.getByLabelText("Cap"), { target: { value: "900" } });
		expect(screen.getByRole("tab", { name: /Feeding.*unsaved/ })).toBeInTheDocument();

		fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
		fireEvent.click(screen.getByRole("tab", { name: /Feeding/ }));
		expect(screen.getByLabelText("Cap")).toHaveValue("900");
	});

	it("switches device straight away when nothing is unsaved, keeping the tab", () => {
		renderTabs("feeding");
		fireEvent.change(screen.getByLabelText("Feeder"), { target: { value: "dev-2" } });
		expect(push).toHaveBeenCalledWith("/dashboard/settings/hardware?device=dev-2&tab=feeding");
	});

	it("asks before a device switch would discard edits", () => {
		renderTabs("feeding");
		fireEvent.change(screen.getByLabelText("Cap"), { target: { value: "900" } });
		fireEvent.change(screen.getByLabelText("Feeder"), { target: { value: "dev-2" } });

		expect(push).not.toHaveBeenCalled();
		expect(screen.getByText("Not saved yet: Feeding.")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
		expect(push).not.toHaveBeenCalled();

		fireEvent.change(screen.getByLabelText("Feeder"), { target: { value: "dev-2" } });
		fireEvent.click(screen.getByRole("button", { name: "Discard and switch" }));
		expect(push).toHaveBeenCalledWith("/dashboard/settings/hardware?device=dev-2&tab=feeding");
	});

	it("opens the tab holding a help target", () => {
		renderTabs();
		act(() => {
			screen
				.getByText("Hopper panel")
				.dispatchEvent(new Event(HELP_REVEAL_EVENT, { bubbles: true }));
		});
		expect(screen.getByRole("tab", { name: "Calibration" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});

	it("opens the tab for a pre-tab anchor link", () => {
		window.history.replaceState(null, "", "/en/dashboard/settings/hardware#daily-ceiling");
		renderTabs();
		expect(screen.getByRole("tab", { name: "Feeding" })).toHaveAttribute("aria-selected", "true");
	});
});
