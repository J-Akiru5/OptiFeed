import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * #748 — the preference row is pond-wide, not personal. The form now says so and
 * disables its controls for anyone who is not the pond owner or an admin, rather
 * than letting an operator silence alerts for everyone.
 */

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/actions/notifications", () => ({ updateNotificationPrefs: vi.fn() }));

import { NotificationPrefsForm } from "@/components/notification-prefs-form";

function renderForm(canManage: boolean) {
	return render(
		<NotificationPrefsForm
			pondId="pond-1"
			initialPrefs={{ missedFeeding: true, deviceOffline: true, hopperLow: true }}
			canManage={canManage}
		/>,
	);
}

afterEach(cleanup);

describe("notification preferences scope (#748)", () => {
	it("presents the section as pond-wide, not personal", () => {
		renderForm(true);

		expect(screen.getByText("Pond alert settings")).toBeInTheDocument();
		expect(
			screen.getByText("These settings apply to every alert recipient for this pond."),
		).toBeInTheDocument();
	});

	it("disables the toggles and explains the role requirement to a non-admin", () => {
		renderForm(false);

		expect(
			screen.getByText("Only the pond owner or an admin can change pond alert settings."),
		).toBeInTheDocument();
		for (const checkbox of screen.getAllByRole("checkbox")) {
			expect(checkbox).toBeDisabled();
		}
	});

	it("keeps the toggles editable for an owner or admin", () => {
		renderForm(true);

		expect(
			screen.queryByText("Only the pond owner or an admin can change pond alert settings."),
		).not.toBeInTheDocument();
		for (const checkbox of screen.getAllByRole("checkbox")) {
			expect(checkbox).toBeEnabled();
		}
	});
});
