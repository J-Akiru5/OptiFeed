import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();

vi.mock("@/i18n/routing", () => ({
	useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/actions/step-up", () => ({ startStepUp: vi.fn() }));
vi.mock("@/lib/actions/superadmin", () => ({
	grantPlatformAdmin: vi.fn(),
	revokePlatformAdmin: vi.fn(),
	disablePlatformUser: vi.fn(),
	enablePlatformUser: vi.fn(),
}));

import { StepUpDialog } from "@/components/superadmin/step-up-dialog";
import { UserActions } from "@/components/superadmin/user-actions";
import { grantPlatformAdmin } from "@/lib/actions/superadmin";

afterEach(() => {
	vi.clearAllMocks();
});

describe("platform console dialogs (T-09c)", () => {
	it("opens the account actions in a labelled modal instead of a clipped popover", async () => {
		render(<UserActions userId="u1" farmId="farm-01" isPlatformAdmin={false} disabled={false} />);

		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Actions for farm-01" }));

		const dialog = screen.getByRole("dialog");
		expect(dialog).toHaveAttribute("aria-modal", "true");
		expect(dialog).toHaveAccessibleName("Grant platform access");
		expect(screen.getByText("farm-01")).toBeInTheDocument();

		// Focus starts on the reason field, the first thing to fill in.
		const reason = screen.getByLabelText("Reason *");
		await waitFor(() => expect(reason).toHaveFocus());
	});

	it("closes on Escape and returns focus to the trigger", async () => {
		render(<UserActions userId="u1" farmId="farm-01" isPlatformAdmin={false} disabled={false} />);
		const trigger = screen.getByRole("button", { name: "Actions for farm-01" });
		trigger.focus();
		fireEvent.click(trigger);
		await waitFor(() => expect(screen.getByLabelText("Reason *")).toHaveFocus());

		fireEvent.keyDown(document, { key: "Escape" });

		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
		expect(trigger).toHaveFocus();
	});

	it("offers Enable, not grant/revoke/disable, for a disabled account", () => {
		render(<UserActions userId="u1" farmId="farm-01" isPlatformAdmin={false} disabled />);
		fireEvent.click(screen.getByRole("button", { name: "Actions for farm-01" }));

		expect(screen.getByRole("dialog")).toHaveAccessibleName("Enable account");
		expect(screen.getByRole("button", { name: "Enable" })).toHaveAttribute("aria-pressed", "true");
		expect(screen.queryByRole("button", { name: "Disable" })).not.toBeInTheDocument();
	});

	it("asks the admin to type the farm ID before a disable", () => {
		render(<UserActions userId="u1" farmId="farm-01" isPlatformAdmin={false} disabled={false} />);
		fireEvent.click(screen.getByRole("button", { name: "Actions for farm-01" }));
		fireEvent.click(screen.getByRole("button", { name: "Disable" }));

		expect(screen.getByRole("dialog")).toHaveAccessibleName("Disable account");
		expect(screen.getByLabelText("Type farm-01 to confirm *")).toBeInTheDocument();
	});

	it("names and describes the step-up dialog, and Escape cancels it", async () => {
		const onClose = vi.fn();
		render(
			<StepUpDialog
				open
				actionLabel="rotate this device token"
				onClose={onClose}
				onVerified={vi.fn()}
			/>,
		);

		const dialog = screen.getByRole("dialog");
		expect(dialog).toHaveAccessibleName("Confirm your password");
		expect(dialog).toHaveAccessibleDescription(
			"To rotate this device token, re-enter your own password. The check lasts 5 minutes.",
		);
		await waitFor(() => expect(screen.getByLabelText("Password *")).toHaveFocus());

		fireEvent.keyDown(document, { key: "Escape" });
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("closes only the topmost dialog when step-up is stacked over an action", async () => {
		vi.mocked(grantPlatformAdmin).mockResolvedValue({
			error: "Confirm your password to continue.",
			code: "step_up_required",
		});

		render(<UserActions userId="u1" farmId="farm-01" isPlatformAdmin={false} disabled={false} />);
		fireEvent.click(screen.getByRole("button", { name: "Actions for farm-01" }));
		fireEvent.change(screen.getByLabelText("Reason *"), {
			target: { value: "A perfectly valid audit reason" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

		await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(2));

		fireEvent.keyDown(document, { key: "Escape" });

		// The step-up dialog (topmost) goes away; the action dialog stays open.
		await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(1));
		expect(screen.getByRole("dialog")).toHaveAccessibleName("Grant platform access");
	});
});
