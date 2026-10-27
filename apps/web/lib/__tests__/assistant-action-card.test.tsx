import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

import { ChatActionCard } from "@/components/chat/chat-action-card";
import type { ChatActionState } from "@/components/chat/chat-storage";

afterEach(cleanup);

function action(overrides: Partial<ChatActionState> = {}): ChatActionState {
	return {
		actionId: "action-1",
		toolId: "feeding.set_grams",
		summary: "Change the feeder to 95 g per meal.",
		fields: [{ label: "New", value: "95 g/meal" }],
		status: "pending",
		...overrides,
	};
}

describe("ChatActionCard", () => {
	it("shows Accept and Reject for a pending row and calls the right handler", () => {
		const onConfirm = vi.fn();
		const onCancel = vi.fn();
		render(<ChatActionCard action={action()} onConfirm={onConfirm} onCancel={onCancel} />);

		expect(screen.getByText("Change the feeder to 95 g per meal.")).toBeVisible();
		fireEvent.click(screen.getByRole("button", { name: "Accept" }));
		fireEvent.click(screen.getByRole("button", { name: "Reject" }));

		expect(onConfirm).toHaveBeenCalledTimes(1);
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it("shows an expired proposal without offering to run it", () => {
		render(
			<ChatActionCard
				action={action({ status: "expired" })}
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
			/>,
		);

		expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
		expect(screen.getByText(/This action expired/)).toBeVisible();
	});

	it("marks a client-side expired proposal as expired", () => {
		render(
			<ChatActionCard
				action={action({ expiresAt: "2020-01-01T00:00:00.000Z" })}
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
			/>,
		);

		expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
		expect(screen.getByText(/This action expired/)).toBeVisible();
	});

	it("never offers Accept for a legacy card without a stored row", () => {
		render(
			<ChatActionCard
				action={action({ actionId: undefined })}
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
			/>,
		);

		expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
		expect(screen.getByText(/Ask me again/)).toBeVisible();
	});
});
