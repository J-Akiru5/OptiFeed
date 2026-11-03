import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The hopper filter card (issue #659).
 *
 * Seven firmware keys had no dashboard surface. The form must show the
 * firmware's own envelope (the inputs are bounded from `FIRMWARE_FIELDS`, not a
 * second copy), save through the device-config action, and report what the
 * DEVICE echoed so a saved-but-unapplied change is visible.
 */

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { type HopperFilterEchoReport, HopperFilterForm } from "@/components/HopperFilterForm";
import {
	HOPPER_FILTER_FORM_FIELDS,
	type HopperFilterKey,
	resolveHopperFilterValues,
} from "@/lib/firmware/hopper-filter";

type SaveResult = { success: boolean; error?: string };

function makeReport(overrides: Partial<HopperFilterEchoReport> = {}): HopperFilterEchoReport {
	return {
		available: true,
		state: "applied",
		reportedAtLabel: "Tue, Nov 3 • 6:05 PM",
		reportedRev: 12345,
		configSource: "server",
		changedAtLabel: null,
		...overrides,
	};
}

const VALUES = resolveHopperFilterValues(null);

function renderForm(
	options: {
		report?: HopperFilterEchoReport;
		canWrite?: boolean;
		usingDefaults?: HopperFilterKey[];
		result?: SaveResult;
		values?: typeof VALUES;
	} = {},
) {
	const {
		report = makeReport(),
		canWrite = true,
		usingDefaults = [],
		result = { success: true },
		values = VALUES,
	} = options;
	const saveAction = vi.fn(async () => result);
	render(
		<HopperFilterForm
			deviceId="dev-1"
			values={values}
			fields={HOPPER_FILTER_FORM_FIELDS}
			usingDefaults={usingDefaults}
			report={report}
			saveAction={saveAction}
			canWrite={canWrite}
		/>,
	);
	return { saveAction };
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("HopperFilterForm", () => {
	it("renders every filter field with its unit and firmware default", () => {
		renderForm();

		expect(screen.getByLabelText("Refill margin (%)")).toHaveValue(10);
		expect(screen.getByLabelText("Reject readings below (cm)")).toHaveValue(2);
		expect(screen.getByLabelText("Reject readings past empty by (cm)")).toHaveValue(10);
		expect(screen.getByLabelText("Smoothing weight")).toHaveValue(0.35);
		expect(screen.getByLabelText("Jump limit (%)")).toHaveValue(15);
		expect(screen.getByLabelText("Confirm cycles")).toHaveValue(3);
		expect(screen.getByLabelText("State hold (s)")).toHaveValue(600);
	});

	it("resolves its copy from the catalogue instead of a dotted key", () => {
		renderForm();

		const html = document.body.textContent ?? "";
		expect(html).not.toContain("dashboard.appSettings.");
		expect(html).toContain("Readings closer to the sensor than this are echo noise");
	});

	it("says which values still run on the firmware default", () => {
		renderForm({ usingDefaults: ["hopper_ema_alpha", "hopper_jump_pct"] });
		expect(
			screen.getByText(/2 of the seven values still run on the firmware default/),
		).toBeInTheDocument();
	});

	it("saves all seven values through the action", async () => {
		const { saveAction } = renderForm();

		fireEvent.change(screen.getByLabelText("Confirm cycles"), { target: { value: "5" } });
		fireEvent.click(screen.getByRole("button", { name: "Save filter settings" }));

		await waitFor(() => expect(saveAction).toHaveBeenCalledTimes(1));
		expect(saveAction).toHaveBeenCalledWith("dev-1", {
			...VALUES,
			hopper_persist_cycles: 5,
		});
		await waitFor(() => expect(screen.getByText(/Filter settings saved/)).toBeInTheDocument());
	});

	it("refuses an out-of-envelope value before any request is made", async () => {
		const { saveAction } = renderForm();

		fireEvent.change(screen.getByLabelText("Jump limit (%)"), { target: { value: "101" } });
		expect(screen.getByRole("button", { name: "Save filter settings" })).toBeDisabled();

		fireEvent.click(screen.getByRole("button", { name: "Save filter settings" }));
		expect(saveAction).not.toHaveBeenCalled();
	});

	it("blocks saving without write access", () => {
		renderForm({ canWrite: false });
		expect(screen.getByRole("button", { name: "Save filter settings" })).toBeDisabled();
	});

	it("reports the device's own confirmation state", () => {
		renderForm({
			report: makeReport({
				state: "applied",
				configSource: "server",
				reportedRev: 987,
			}),
		});
		expect(
			screen.getByText(/Confirmed: the device reported a config after this change/),
		).toBeInTheDocument();
		expect(screen.getByText(/Config revision 987 · source server/)).toBeInTheDocument();

		cleanup();

		renderForm({ report: makeReport({ state: "pending" }) });
		expect(screen.getByText(/Not confirmed: the device's last config report/)).toBeInTheDocument();

		cleanup();

		renderForm({ report: makeReport({ state: "never_reported" }) });
		expect(screen.getByText(/this unit has never reported a config/)).toBeInTheDocument();

		cleanup();

		renderForm({ report: makeReport({ available: false }) });
		expect(screen.getByText(/config report could not be read/)).toBeInTheDocument();
	});
});
