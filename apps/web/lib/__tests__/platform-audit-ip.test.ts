import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #329: PlatformAuditLog.ip must come from the trusted proxy hop, not
 * from a client-supplied header.
 *
 * Proxy assumption: exactly one trusted hop — Vercel's edge. Vercel rewrites
 * `x-forwarded-for` with the address it observed and does not forward
 * client-supplied entries. This is also the generic trusted-proxy-count = 1
 * model: the final entry is the proxy's, and every entry to its left is
 * client-controlled. These tests therefore treat a chain such as
 * "203.0.113.66, 198.51.100.4" as "client-supplied value, edge-written value".
 */

const { tx } = vi.hoisted(() => ({
	tx: { platformAuditLog: { create: vi.fn() } },
}));

const headerState = vi.hoisted(() => ({ current: new Headers() }));

vi.mock("next/headers", () => ({
	headers: vi.fn(async () => headerState.current),
}));
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn() }));

import { writePlatformAudit } from "@/lib/actions/platform/audit";
import type { Prisma } from "@prisma/client";

const AUDIT = {
	actorUserId: "admin-1",
	action: "platform.org.create",
	targetType: "organization",
	reason: "Operator request reviewed by the platform team",
};

const client = tx as unknown as Prisma.TransactionClient;

function recordedIp(): unknown {
	return tx.platformAuditLog.create.mock.calls[0][0].data.ip;
}

async function recordWith(headers: Record<string, string>): Promise<unknown> {
	headerState.current = new Headers(headers);
	await writePlatformAudit(client, AUDIT);
	return recordedIp();
}

beforeEach(() => {
	vi.clearAllMocks();
	headerState.current = new Headers();
	tx.platformAuditLog.create.mockResolvedValue({});
});

describe("PlatformAuditLog ip (#329)", () => {
	it("records the edge-written final hop, never the forged left-most X-Forwarded-For entry", async () => {
		const ip = await recordWith({ "x-forwarded-for": "203.0.113.66, 198.51.100.4" });

		expect(ip).toBe("198.51.100.4");
		expect(ip).not.toBe("203.0.113.66");
	});

	it("records null when X-Forwarded-For is absent", async () => {
		expect(await recordWith({ "user-agent": "vitest-audit-ip" })).toBeNull();
	});

	it("records null when X-Forwarded-For is malformed", async () => {
		expect(await recordWith({ "x-forwarded-for": "203.0.113.66, not-an-ip" })).toBeNull();
	});

	it("does not fall back to a client-supplied x-real-ip", async () => {
		// Under the Vercel edge x-real-ip mirrors x-forwarded-for, but it is a
		// second, unvalidated source: if the header is missing we record null
		// rather than let a forged value set the audit address.
		expect(await recordWith({ "x-real-ip": "203.0.113.66" })).toBeNull();
	});
});
