import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));

import {
	IDENTITY_LINE_PREFIX,
	IDENTITY_MANIFEST_MARKER,
	buildIdentityManifest,
	renderIdentityManifest,
} from "@/lib/backup/identity";

/**
 * The auth identity manifest (issue #322). A restore needs the identities; it
 * must never need — or receive — a credential.
 */

const USERS = [
	{
		id: "user-2",
		supabaseId: "22222222-2222-2222-2222-222222222222",
		farmId: "beta",
		email: "beta@example.com",
		displayName: "Beta",
		role: "OPERATOR",
	},
	{
		id: "user-1",
		supabaseId: "11111111-1111-1111-1111-111111111111",
		farmId: "alpha",
		email: "alpha@example.com",
		displayName: null,
		role: "OWNER",
	},
];

const MEMBERSHIPS = [
	{ userId: "user-1", orgId: "org-1", role: "OWNER", revokedAt: null },
	{
		userId: "user-1",
		orgId: "org-2",
		role: "VIEWER",
		revokedAt: new Date("2026-01-02T03:04:05.000Z"),
	},
	{ userId: "user-2", orgId: "org-1", role: "OPERATOR", revokedAt: null },
];

describe("buildIdentityManifest", () => {
	it("groups organization links per user and sorts by user id", () => {
		const records = buildIdentityManifest(USERS, MEMBERSHIPS);

		expect(records.map((record) => record.id)).toEqual(["user-1", "user-2"]);
		expect(records[0].memberships).toEqual([
			{ orgId: "org-1", role: "OWNER", revokedAt: null },
			{ orgId: "org-2", role: "VIEWER", revokedAt: "2026-01-02T03:04:05.000Z" },
		]);
		expect(records[1].memberships).toEqual([{ orgId: "org-1", role: "OPERATOR", revokedAt: null }]);
	});

	it("keeps a user with no membership", () => {
		const records = buildIdentityManifest([USERS[1]], []);
		expect(records).toHaveLength(1);
		expect(records[0].memberships).toEqual([]);
		expect(records[0].displayName).toBeNull();
	});

	it("ignores a membership with no user id", () => {
		const records = buildIdentityManifest([USERS[1]], [{ orgId: "org-1", role: "OWNER" }]);
		expect(records[0].memberships).toEqual([]);
	});

	it("carries no credential-shaped field", () => {
		const record = buildIdentityManifest(USERS, MEMBERSHIPS)[0];
		expect(Object.keys(record).sort()).toEqual([
			"displayName",
			"email",
			"farmId",
			"id",
			"memberships",
			"role",
			"supabaseId",
		]);
	});
});

describe("renderIdentityManifest", () => {
	it("writes an inert comment block with one JSON object per identity", () => {
		const records = buildIdentityManifest(USERS, MEMBERSHIPS);
		const text = renderIdentityManifest(records);

		expect(text).toContain(IDENTITY_MANIFEST_MARKER);
		expect(text).toContain("-- Identities: 2");
		const lines = text
			.split("\n")
			.filter((line) => line.startsWith(IDENTITY_LINE_PREFIX))
			.map((line) => JSON.parse(line.slice(IDENTITY_LINE_PREFIX.length)));

		expect(lines).toHaveLength(2);
		expect(lines[0]).toMatchObject({ id: "user-1", email: "alpha@example.com" });
		expect(text).not.toMatch(/password|token|hash/i);
	});

	it("states a zero count for an empty export", () => {
		expect(renderIdentityManifest([])).toContain("-- Identities: 0");
	});
});
