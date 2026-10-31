import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * #213: the remote-control panel lives in its own full-width row under the
 * device row, not inside the Actions cell. The cell stays narrow at any width,
 * so the table can never overflow its card.
 *
 * These tests render the real table structure (`<tr>` + `<td colSpan>`), so a
 * regression that puts the form back in the Actions cell fails here.
 */

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("@/i18n/routing", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

vi.mock("@/lib/actions/platform/devices", () => ({
	remoteFeedDevice: vi.fn(),
	remoteSetDevicePause: vi.fn(),
}));

vi.mock("@/components/superadmin/step-up-dialog", () => ({ StepUpDialog: () => null }));

import {
	RemoteFeedProvider,
	RemoteFeederRow,
	RemoteFeederTrigger,
} from "@/components/superadmin/remote-feeder-control";

function DeviceTable({ devices }: { devices: { id: string; label: string }[] }) {
	return (
		<RemoteFeedProvider>
			<table>
				<caption>Fleet</caption>
				<thead>
					<tr>
						<th scope="col">Device</th>
						<th scope="col">Actions</th>
					</tr>
				</thead>
				<tbody>
					{devices.map((device) => [
						<tr key={device.id}>
							<td>{device.label}</td>
							<td data-testid={`actions-${device.id}`}>
								<RemoteFeederTrigger deviceId={device.id} label={device.label} />
							</td>
						</tr>,
						<RemoteFeederRow
							key={`${device.id}-panel`}
							deviceId={device.id}
							label={device.label}
							isPaused={false}
							colSpan={8}
						/>,
					])}
				</tbody>
			</table>
		</RemoteFeedProvider>
	);
}

const devices = [
	{ id: "d1", label: "Pond 1 feeder" },
	{ id: "d2", label: "Pond 2 feeder" },
];

afterEach(() => {
	cleanup();
	document.body.innerHTML = "";
});

describe("the remote-control panel (#213)", () => {
	it("keeps the Actions cell free of the feed form until the row is opened", () => {
		render(<DeviceTable devices={devices} />);

		expect(document.querySelector("[data-remote-feed-row]")).toBeNull();
		const actions = screen.getByTestId("actions-d1");
		expect(actions.querySelector("form")).toBeNull();
		expect(within(actions).queryByRole("spinbutton")).toBeNull();

		const trigger = within(actions).getByRole("button", {
			name: "Remote control for Pond 1 feeder",
		});
		expect(trigger).toHaveAttribute("aria-expanded", "false");
	});

	it("opens the feed form in a full-width row under the device row", () => {
		render(<DeviceTable devices={devices} />);

		fireEvent.click(screen.getByRole("button", { name: "Remote control for Pond 1 feeder" }));

		const row = document.querySelector("tr[data-remote-feed-row]");
		expect(row).not.toBeNull();
		expect(row?.id).toBe("remote-feed-d1");

		const cell = row?.querySelector("td");
		expect(cell?.getAttribute("colspan")).toBe("8");

		// The panel is complete: title, the caps sentence and the feed form.
		expect(row).toHaveTextContent("Remote control — Pond 1 feeder");
		expect(row).toHaveTextContent("Commands use the normal server rules");
		expect(cell?.querySelector("form")).not.toBeNull();
		expect(within(row as HTMLElement).getByRole("spinbutton")).toHaveValue(150);

		// The trigger now points at the row it opened.
		const trigger = screen.getByRole("button", { name: "Remote control for Pond 1 feeder" });
		expect(trigger).toHaveAttribute("aria-expanded", "true");
		expect(trigger).toHaveAttribute("aria-controls", "remote-feed-d1");

		// …and the Actions cell itself is still just the button.
		expect(screen.getByTestId("actions-d1").querySelector("form")).toBeNull();
	});

	it("closes from the panel's Close button and the trigger", () => {
		render(<DeviceTable devices={devices} />);

		fireEvent.click(screen.getByRole("button", { name: "Remote control for Pond 1 feeder" }));
		const row = document.querySelector("tr[data-remote-feed-row]") as HTMLElement | null;
		fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "Close" }));
		expect(document.querySelector("[data-remote-feed-row]")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Remote control for Pond 1 feeder" }));
		expect(document.querySelector("[data-remote-feed-row]")).not.toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Remote control for Pond 1 feeder" }));
		expect(document.querySelector("[data-remote-feed-row]")).toBeNull();
	});

	it("keeps one panel open at a time", () => {
		render(<DeviceTable devices={devices} />);

		fireEvent.click(screen.getByRole("button", { name: "Remote control for Pond 2 feeder" }));
		expect(document.querySelectorAll("[data-remote-feed-row]")).toHaveLength(1);
		expect(document.querySelector("[data-remote-feed-row]")?.id).toBe("remote-feed-d2");

		fireEvent.click(screen.getByRole("button", { name: "Remote control for Pond 1 feeder" }));
		expect(document.querySelectorAll("[data-remote-feed-row]")).toHaveLength(1);
		expect(document.querySelector("[data-remote-feed-row]")?.id).toBe("remote-feed-d1");
	});
});
