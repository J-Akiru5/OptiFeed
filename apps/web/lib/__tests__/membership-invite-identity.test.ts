import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
	buildPondEmail: (loginId: string) => `${loginId}@pond.optifeed.local`,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: {} }));

import { deriveLoginIdentity } from "@/lib/membership-invite";

describe("deriveLoginIdentity", () => {
	it("derives the login ID from the local part and keeps the internal domain", () => {
		expect(deriveLoginIdentity("Juan.Dela-Cruz@example.com")).toEqual({
			loginId: "juan-dela-cruz",
			loginEmail: "juan-dela-cruz@pond.optifeed.local",
		});
	});

	it("collapses runs of unsupported characters", () => {
		expect(deriveLoginIdentity("  Maria_Santos@example.com  ")).toEqual({
			loginId: "maria-santos",
			loginEmail: "maria-santos@pond.optifeed.local",
		});
	});

	it("rejects an address without a deliverable dotted domain", () => {
		expect(deriveLoginIdentity("juan@example")).toBeNull();
		expect(deriveLoginIdentity("juan@localhost")).toBeNull();
		expect(deriveLoginIdentity("juan")).toBeNull();
		expect(deriveLoginIdentity("juan@@example.com")).toBeNull();
		expect(deriveLoginIdentity("")).toBeNull();
	});

	it("rejects an address whose local part has no usable login characters", () => {
		expect(deriveLoginIdentity("!!!@example.com")).toBeNull();
	});
});
