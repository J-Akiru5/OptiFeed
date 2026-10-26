import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("sonner", () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		warning: vi.fn(),
	},
}));

vi.mock("@/lib/supabase/client", () => ({
	createClient: () => ({
		auth: {
			getSession: vi.fn().mockResolvedValue({
				data: { session: { user: { id: "user-a" } } },
			}),
		},
	}),
}));

vi.mock("@/lib/offline/db", () => ({
	clearOfflineDataIfUserChanged: vi.fn().mockResolvedValue(false),
	getOfflineMeta: vi.fn().mockResolvedValue({
		key: "active",
		scope: "farm-1",
		pondId: "pond-1",
		pondName: "POND-1",
		savedAt: "2026-10-26T08:00:00.000Z",
	}),
}));

vi.mock("@/lib/offline/sync", () => ({
	flushBiomassOutbox: vi.fn().mockResolvedValue({
		synced: 0,
		remaining: 0,
		errors: [],
		failures: [],
		discardedFeed: 0,
		busy: false,
	}),
}));

vi.mock("@/lib/offline/outbox", () => ({
	OUTBOX_CHANGED_EVENT: "optifeed:outbox-changed",
	listOutbox: vi.fn(),
	removeOutboxItem: vi.fn(),
	resetOutboxItem: vi.fn(),
}));

import { OfflineSync } from "@/components/pwa/offline-sync";
import { listOutbox, removeOutboxItem, resetOutboxItem } from "@/lib/offline/outbox";

function item(overrides: Record<string, unknown> = {}) {
	return {
		id: "offline-conflict-0001",
		type: "biomass",
		payload: {
			clientEventId: "offline-conflict-0001",
			pondId: "pond-1",
			scope: "farm-1",
			sampleCount: 20,
			sampleWeightKg: 3.4,
			sampleLengthCm: 24,
			batchLabel: null,
			recordedAt: "2026-10-26T08:00:00.000Z",
		},
		createdAt: "2026-10-26T08:00:00.000Z",
		attempts: 1,
		status: "conflict",
		lastError: "Pond not found",
		...overrides,
	};
}

let queue: ReturnType<typeof item>[] = [];

beforeEach(() => {
	vi.clearAllMocks();
	queue = [
		item(),
		item({
			id: "offline-pending-0002",
			payload: {
				clientEventId: "offline-pending-0002",
				pondId: "pond-1",
				scope: "farm-1",
				sampleCount: 10,
				sampleWeightKg: 1.5,
				sampleLengthCm: 22,
				batchLabel: null,
				recordedAt: "2026-10-26T09:00:00.000Z",
			},
			status: "pending",
			lastError: undefined,
		}),
	];
	vi.mocked(listOutbox).mockImplementation(async () => queue as never);
	vi.mocked(removeOutboxItem).mockImplementation(async (id: string) => {
		queue = queue.filter((entry) => entry.id !== id);
	});
	vi.mocked(resetOutboxItem).mockResolvedValue(undefined);
});

describe("offline sync panel", () => {
	it("shows the pending count, the last sync time and the failed item", async () => {
		render(<OfflineSync scope="farm-1" />);

		expect(await screen.findByText("2 items waiting to sync")).toBeInTheDocument();
		expect(screen.getByText(/Last synced/)).toBeInTheDocument();
		expect(screen.getByText("Needs attention")).toBeInTheDocument();
		expect(screen.getByText("Reason: Pond not found")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Retry sync" })).toBeInTheDocument();
	});

	it("offers retry and discard for a conflicted item and never hides it", async () => {
		render(<OfflineSync scope="farm-1" />);

		expect(await screen.findByText("Needs attention")).toBeInTheDocument();
		// Conflicts cannot be dismissed as a whole; the user must act on the item.
		expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await waitFor(() => expect(resetOutboxItem).toHaveBeenCalledWith("offline-conflict-0001"));

		fireEvent.click(screen.getAllByRole("button", { name: "Discard" })[0]);
		await waitFor(() => expect(removeOutboxItem).toHaveBeenCalledWith("offline-conflict-0001"));
		await waitFor(() =>
			expect(screen.queryByText("Reason: Pond not found")).not.toBeInTheDocument(),
		);
	});
});
