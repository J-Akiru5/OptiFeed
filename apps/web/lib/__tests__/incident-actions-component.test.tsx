import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	acknowledge: vi.fn(),
	investigate: vi.fn(),
	resolve: vi.fn(),
	escalate: vi.fn(),
	refresh: vi.fn(),
}));

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("@/i18n/routing", () => ({
	useRouter: () => ({ refresh: mocks.refresh, push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/lib/actions/platform/incidents", () => ({
	acknowledgePlatformIncident: mocks.acknowledge,
	investigatePlatformIncident: mocks.investigate,
	resolvePlatformIncident: mocks.resolve,
	escalatePlatformIncident: mocks.escalate,
}));

import { IncidentDetailActions } from "@/components/superadmin/incident-detail-actions";

/**
 * The lifecycle controls (issue #479, M3C.6).
 *
 * The server action owns every guard. This test only checks that the page offers
 * the actions the transition rules allow, that Escalate reveals the owner
 * picker, and that a resolved incident offers nothing.
 */

const OWNERS = [{ id: "admin-2", label: "Ana Admin" }];

beforeEach(() => {
	vi.clearAllMocks();
	mocks.acknowledge.mockResolvedValue({ success: true, status: "ACKNOWLEDGED" });
	mocks.investigate.mockResolvedValue({ success: true, status: "INVESTIGATING" });
	mocks.resolve.mockResolvedValue({ success: true, status: "RESOLVED" });
	mocks.escalate.mockResolvedValue({ success: true, status: "ESCALATED" });
});

describe("IncidentDetailActions", () => {
	it("offers only the legal actions for a new incident", () => {
		render(
			<IncidentDetailActions incidentId="inc-1" status="NEW" owners={OWNERS} ownersAvailable />,
		);

		expect(screen.getByRole("button", { name: "Acknowledge" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Investigate" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Escalate" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Resolve" })).not.toBeInTheDocument();
	});

	it("reveals the owner picker when Escalate is selected and submits the owner", async () => {
		render(
			<IncidentDetailActions incidentId="inc-1" status="NEW" owners={OWNERS} ownersAvailable />,
		);

		fireEvent.click(screen.getByRole("button", { name: "Escalate" }));
		expect(screen.getByLabelText("Platform-admin owner")).toBeInTheDocument();

		fireEvent.change(screen.getByLabelText("Reason *"), {
			target: { value: "Escalating to the on-call platform admin" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Record action" }));

		await waitFor(() =>
			expect(mocks.escalate).toHaveBeenCalledWith({
				incidentId: "inc-1",
				ownerId: "admin-2",
				reason: "Escalating to the on-call platform admin",
			}),
		);
		expect(mocks.refresh).toHaveBeenCalled();
	});

	it("shows a translated error code instead of the server's English text", async () => {
		mocks.acknowledge.mockResolvedValue({
			error: "That transition is not allowed.",
			code: "invalid_transition",
		});

		render(
			<IncidentDetailActions incidentId="inc-1" status="NEW" owners={OWNERS} ownersAvailable />,
		);
		fireEvent.change(screen.getByLabelText("Reason *"), {
			target: { value: "A sufficiently long reason for the test" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Record action" }));

		expect(
			await screen.findByText("That transition is not allowed from the current status."),
		).toBeInTheDocument();
	});

	it("disables escalation when no active platform admin is available", () => {
		render(
			<IncidentDetailActions incidentId="inc-1" status="NEW" owners={[]} ownersAvailable={false} />,
		);

		fireEvent.click(screen.getByRole("button", { name: "Escalate" }));
		expect(screen.getByText("No active platform admin is available.")).toBeInTheDocument();
		expect(
			screen.getByText("The owner list could not be read. Escalation is unavailable until it can."),
		).toBeInTheDocument();
	});

	it("renders no actions for a resolved incident", () => {
		render(
			<IncidentDetailActions
				incidentId="inc-1"
				status="RESOLVED"
				owners={OWNERS}
				ownersAvailable
			/>,
		);

		expect(screen.queryByRole("button")).not.toBeInTheDocument();
		expect(screen.getByText(/Resolved is terminal/)).toBeInTheDocument();
	});
});
