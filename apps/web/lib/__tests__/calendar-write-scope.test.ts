import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	resolveOrgScope: vi.fn(),
	getCurrentPondOwnerId: vi.fn(),
}));

vi.mock("@/lib/auth/org-scope", () => ({ resolveOrgScope: mocks.resolveOrgScope }));
vi.mock("@/lib/auth/session", () => ({
	getCurrentPondOwnerId: mocks.getCurrentPondOwnerId,
}));

import {
	resolveCalendarWriteScope,
	writablePondEventWhere,
	writablePondWhere,
} from "@/lib/calendar/write-scope";

const EMPTY_SCOPE = { orgIds: [], memberUserIds: [], farmIds: [], pondIds: [] };

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getCurrentPondOwnerId.mockResolvedValue("farm-own");
	mocks.resolveOrgScope.mockResolvedValue(EMPTY_SCOPE);
});

describe("resolveCalendarWriteScope", () => {
	it("keeps a plain member on their own farm", async () => {
		const scope = await resolveCalendarWriteScope();

		expect(scope).toEqual({ ownerId: "farm-own", orgPondIds: [] });
		expect(writablePondWhere(scope)).toEqual({ ownerId: "farm-own" });
		expect(writablePondEventWhere(scope)).toEqual({ pond: { ownerId: "farm-own" } });
	});

	it("adds the ponds of every organization the caller administers", async () => {
		mocks.resolveOrgScope.mockResolvedValue({
			orgIds: ["org-1"],
			memberUserIds: [],
			farmIds: ["farm-other"],
			pondIds: ["pond-other"],
		});

		const scope = await resolveCalendarWriteScope();

		expect(scope).toEqual({ ownerId: "farm-own", orgPondIds: ["pond-other"] });
		expect(writablePondWhere(scope)).toEqual({
			OR: [{ ownerId: "farm-own" }, { id: { in: ["pond-other"] } }],
		});
		expect(writablePondEventWhere(scope)).toEqual({
			OR: [{ pond: { ownerId: "farm-own" } }, { pondId: { in: ["pond-other"] } }],
		});
	});

	it("never widens to another organization", async () => {
		// resolveOrgScope fails closed for orgs the caller does not administer,
		// so an empty result leaves only the caller's own farm.
		mocks.resolveOrgScope.mockResolvedValue(EMPTY_SCOPE);

		const scope = await resolveCalendarWriteScope();

		expect(scope.orgPondIds).toEqual([]);
		expect(writablePondEventWhere(scope)).not.toHaveProperty("OR");
	});
});
