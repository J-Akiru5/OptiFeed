import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	upsert: vi.fn(),
	update: vi.fn(),
	findMany: vi.fn(),
	deleteMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
	default: {
		errorEvent: {
			upsert: mocks.upsert,
			update: mocks.update,
			findMany: mocks.findMany,
			deleteMany: mocks.deleteMany,
		},
	},
}));

import {
	ERROR_EVENT_RETENTION_DAYS,
	MAX_ERROR_MESSAGE_LENGTH,
	buildErrorEvent,
	deleteExpiredErrorEvents,
	fingerprintError,
	persistErrorEvent,
} from "@/lib/error-capture";
import { reportError } from "@/lib/observability";

const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function thrown(stack = "Error: hopper sensor missing\n    at feed (lib/feed.ts:42:7)"): Error {
	const error = new Error("hopper sensor missing for farm juan@example.com");
	error.stack = stack;
	return error;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.upsert.mockResolvedValue({});
	mocks.update.mockResolvedValue({});
	mocks.findMany.mockResolvedValue([]);
	mocks.deleteMany.mockResolvedValue({ count: 0 });
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("buildErrorEvent", () => {
	it("scrubs the message, stack and context before they reach the table", () => {
		const record = buildErrorEvent(thrown(), {
			route: "ingest",
			deviceId: "dev-1",
			deviceToken: SECRET,
			email: "juan@example.com",
		});

		expect(record.message).not.toContain("juan@example.com");
		expect(record.stack).not.toContain(SECRET);
		expect(record.context).toMatchObject({
			route: "ingest",
			deviceId: "dev-1",
			deviceToken: "[redacted]",
			email: "[redacted]",
		});
		expect(record.route).toBe("ingest");
		expect(record.severity).toBe("ERROR");
	});

	it("falls back to the caller action, then to unknown", () => {
		expect(buildErrorEvent(thrown(), { action: "loginWithPassword" }).route).toBe(
			"loginWithPassword",
		);
		expect(buildErrorEvent(thrown()).route).toBe("unknown");
	});

	it("truncates a pathological message", () => {
		const record = buildErrorEvent(new Error("x ".repeat(3_000)));

		expect(record.message).toHaveLength(MAX_ERROR_MESSAGE_LENGTH);
	});
});

describe("fingerprintError", () => {
	it("is stable for the same error identity", () => {
		const first = buildErrorEvent(thrown());
		const second = buildErrorEvent(thrown());

		expect(first.fingerprint).toBe(second.fingerprint);
	});

	it("ignores run-specific numbers and line numbers", () => {
		const first = fingerprintError(
			"invalid grams 1200 for farm 8842",
			"Error: x\n    at feed (lib/feed.ts:42:7)",
			"feed-command",
			"ERROR",
		);
		const second = fingerprintError(
			"invalid grams 4500 for farm 9931",
			"Error: x\n    at feed (lib/feed.ts:98:2)",
			"feed-command",
			"ERROR",
		);

		expect(first).toBe(second);
	});

	it("separates route, severity and message", () => {
		const base = fingerprintError("boom", null, "ingest", "ERROR");

		expect(fingerprintError("boom", null, "feed-command", "ERROR")).not.toBe(base);
		expect(fingerprintError("boom", null, "ingest", "WARNING")).not.toBe(base);
		expect(fingerprintError("different", null, "ingest", "ERROR")).not.toBe(base);
	});
});

describe("persistErrorEvent", () => {
	it("creates a new row with count 1 and both timestamps", async () => {
		const record = buildErrorEvent(thrown(), { route: "ingest" });

		await persistErrorEvent(record);

		const call = mocks.upsert.mock.calls[0][0];
		expect(call.where).toEqual({ fingerprint: record.fingerprint });
		expect(call.create).toMatchObject({
			fingerprint: record.fingerprint,
			route: "ingest",
			count: 1,
			resolved: false,
		});
		expect(call.create.firstSeenAt).toBeInstanceOf(Date);
		expect(call.create.lastSeenAt).toBeInstanceOf(Date);
	});

	it("increments count, touches lastSeenAt and reopens a resolved row", async () => {
		const record = buildErrorEvent(thrown(), { route: "ingest" });

		await persistErrorEvent(record);

		const update = mocks.upsert.mock.calls[0][0].update;
		expect(update.count).toEqual({ increment: 1 });
		expect(update.lastSeenAt).toBeInstanceOf(Date);
		expect(update.resolved).toBe(false);
		expect(update.resolvedAt).toBeNull();
		expect(update.resolvedBy).toBeNull();
		expect(update.message).toBe(record.message);
	});

	it("retries as an update when two first occurrences race the unique index", async () => {
		const record = buildErrorEvent(thrown());
		mocks.upsert.mockRejectedValueOnce(
			new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
				code: "P2002",
				clientVersion: "6.6.0",
			}),
		);

		await persistErrorEvent(record);

		expect(mocks.update).toHaveBeenCalledWith(
			expect.objectContaining({ where: { fingerprint: record.fingerprint } }),
		);
	});

	it("never rejects when the database is down, and falls back to console", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		mocks.upsert.mockRejectedValueOnce(new Error("connection refused"));

		await expect(persistErrorEvent(buildErrorEvent(thrown()))).resolves.toBeUndefined();

		expect(consoleError).toHaveBeenCalledWith(
			"[obs] failed to persist error event",
			expect.objectContaining({ message: "connection refused" }),
		);
	});
});

describe("reportError", () => {
	it("logs, then persists without blocking the caller", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

		expect(() => reportError(thrown(), { route: "ingest" })).not.toThrow();

		await vi.waitFor(() => expect(mocks.upsert).toHaveBeenCalledTimes(1));
		expect(consoleError).toHaveBeenCalledWith(
			"[obs]",
			"ingest",
			{ route: "ingest" },
			expect.stringContaining("hopper sensor missing"),
			expect.any(String),
		);
	});

	it("never throws when persistence fails", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		mocks.upsert.mockRejectedValueOnce(new Error("database unavailable"));

		expect(() => reportError(new Error("original failure"))).not.toThrow();

		await vi.waitFor(() =>
			expect(vi.mocked(console.error)).toHaveBeenCalledWith(
				"[obs] failed to persist error event",
				expect.objectContaining({ message: "database unavailable" }),
			),
		);
	});

	it("keeps raw secrets out of the console line too", () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

		reportError(new Error("login failed for juan@example.com"), {
			route: "ingest",
			deviceToken: SECRET,
		});

		const logged = consoleError.mock.calls
			.flat()
			.map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
			.join(" ");
		expect(logged).not.toContain(SECRET);
		expect(logged).not.toContain("juan@example.com");
		expect(logged).toContain("ingest");
	});
});

describe("deleteExpiredErrorEvents", () => {
	it("deletes one bounded batch older than the retention window", async () => {
		mocks.findMany.mockResolvedValue([{ id: "e1" }, { id: "e2" }]);
		mocks.deleteMany.mockResolvedValue({ count: 2 });

		const deleted = await deleteExpiredErrorEvents();

		expect(deleted).toBe(2);
		const query = mocks.findMany.mock.calls[0][0];
		const cutoff = query.where.lastSeenAt.lt as Date;
		const ageDays = (Date.now() - cutoff.getTime()) / (24 * 60 * 60 * 1_000);
		expect(ageDays).toBeCloseTo(ERROR_EVENT_RETENTION_DAYS, 0);
		expect(query.take).toBe(500);
		expect(mocks.deleteMany).toHaveBeenCalledWith({
			where: { id: { in: ["e1", "e2"] } },
		});
	});

	it("does nothing when every row is inside the window", async () => {
		mocks.findMany.mockResolvedValue([]);

		await expect(deleteExpiredErrorEvents()).resolves.toBe(0);
		expect(mocks.deleteMany).not.toHaveBeenCalled();
	});
});
