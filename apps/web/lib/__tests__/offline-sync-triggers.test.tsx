import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	flush: vi.fn(),
	listOutbox: vi.fn(),
}));

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
	getOfflineMeta: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/offline/sync", () => ({
	flushBiomassOutbox: mocks.flush,
}));

vi.mock("@/lib/offline/outbox", () => ({
	OUTBOX_CHANGED_EVENT: "optifeed:outbox-changed",
	listOutbox: mocks.listOutbox,
	removeOutboxItem: vi.fn(),
	resetOutboxItem: vi.fn(),
}));

import { OUTBOX_FLUSH_INTERVAL_MS, OfflineSync } from "@/components/pwa/offline-sync";

const EMPTY_FLUSH = {
	synced: 0,
	remaining: 0,
	errors: [],
	failures: [],
	discardedFeed: 0,
	busy: false,
	exhausted: 0,
};

/** Let chained promises from the identity/mount path settle without advancing timers. */
async function drainMicrotasks(turns = 12) {
	for (let turn = 0; turn < turns; turn += 1) {
		await act(async () => {
			await Promise.resolve();
		});
	}
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.flush.mockResolvedValue(EMPTY_FLUSH);
	mocks.listOutbox.mockResolvedValue([]);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("offline sync drains without an online transition (#665)", () => {
	it("drains the queue on mount when the device is already online", async () => {
		render(<OfflineSync scope="farm-1" />);

		await waitFor(() => expect(mocks.flush).toHaveBeenCalledTimes(1));
		expect(mocks.flush).toHaveBeenCalledWith("farm-1");
	});

	it("drains again from the periodic flush while the tab stays open", async () => {
		vi.useFakeTimers();
		render(<OfflineSync scope="farm-1" />);
		await drainMicrotasks();
		expect(mocks.flush).toHaveBeenCalledTimes(1);

		await act(async () => {
			vi.advanceTimersByTime(OUTBOX_FLUSH_INTERVAL_MS);
		});
		await drainMicrotasks();

		expect(mocks.flush).toHaveBeenCalledTimes(2);
	});

	it("drains as soon as a sample is queued while the connection is reachable", async () => {
		render(<OfflineSync scope="farm-1" />);
		await waitFor(() => expect(mocks.flush).toHaveBeenCalledTimes(1));

		act(() => {
			window.dispatchEvent(new Event("optifeed:outbox-changed"));
		});

		await waitFor(() => expect(mocks.flush).toHaveBeenCalledTimes(2));
	});

	it("drains when the tab becomes visible again", async () => {
		render(<OfflineSync scope="farm-1" />);
		await waitFor(() => expect(mocks.flush).toHaveBeenCalledTimes(1));

		const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
		try {
			act(() => {
				document.dispatchEvent(new Event("visibilitychange"));
			});
			await waitFor(() => expect(mocks.flush).toHaveBeenCalledTimes(2));
		} finally {
			visibility.mockRestore();
		}
	});

	it("does not start a second drain while one is still in flight", async () => {
		let resolveFirst: (value: unknown) => void = () => undefined;
		mocks.flush.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveFirst = resolve;
				}),
		);

		render(<OfflineSync scope="farm-1" />);
		await waitFor(() => expect(mocks.flush).toHaveBeenCalledTimes(1));

		act(() => {
			window.dispatchEvent(new Event("online"));
			window.dispatchEvent(new Event("optifeed:outbox-changed"));
		});
		await drainMicrotasks(3);
		expect(mocks.flush).toHaveBeenCalledTimes(1);

		await act(async () => {
			resolveFirst(EMPTY_FLUSH);
		});
		await waitFor(() => expect(mocks.flush).toHaveBeenCalledTimes(1));

		// The guard is released: a later trigger does drain again.
		act(() => {
			window.dispatchEvent(new Event("online"));
		});
		await waitFor(() => expect(mocks.flush).toHaveBeenCalledTimes(2));
	});

	it("waits for a connection before draining", async () => {
		const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
		try {
			render(<OfflineSync scope="farm-1" />);
			// The mount path still refreshes the panel while offline.
			await waitFor(() => expect(mocks.listOutbox).toHaveBeenCalled());
			expect(mocks.flush).not.toHaveBeenCalled();

			onLine.mockReturnValue(true);
			act(() => {
				window.dispatchEvent(new Event("online"));
			});
			await waitFor(() => expect(mocks.flush).toHaveBeenCalledTimes(1));
		} finally {
			onLine.mockRestore();
		}
	});
});
