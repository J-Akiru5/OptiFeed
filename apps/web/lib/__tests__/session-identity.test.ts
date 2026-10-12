import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above imports, so they must reference
// vi.fn() inline (not outer const bindings) to avoid TDZ errors. The auth
// object is stable across createClient() calls so tests can stub it.
vi.mock("@/lib/supabase/server", () => {
	const auth = { getUser: vi.fn(async () => ({ data: { user: null } })) };
	return { createClient: vi.fn(async () => ({ auth })) };
});

vi.mock("@/lib/prisma", () => ({
	default: { user: { findUnique: vi.fn() } },
}));

vi.mock("@/i18n/routing", () => ({ redirect: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "en") }));

import { farmIdFromEmail, getCurrentPondOwnerIdSafe, getCurrentUser } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

type AuthUser = { id: string; email: string } | null;

async function setAuthUser(user: AuthUser) {
	const client = await createClient();
	client.auth.getUser = vi.fn(async () => ({ data: { user } })) as never;
}

const findUnique = vi.mocked(prisma.user.findUnique);

describe("getCurrentUser identity lookup", () => {
	beforeEach(() => {
		findUnique.mockReset();
	});

	it("returns the user when supabaseId and email domain both match", async () => {
		await setAuthUser({ id: "sb-1", email: "demo-farmer-1@pond.optifeed.local" });
		const row = { farmId: "demo-farmer-1", supabaseId: "sb-1", role: "ADMIN" };
		findUnique.mockResolvedValue(row as never);

		const user = await getCurrentUser();
		expect(user).toBe(row);
		expect(findUnique).toHaveBeenCalledWith({ where: { supabaseId: "sb-1" } });
	});

	it("rejects a lookalike domain email even if the supabaseId exists", async () => {
		// demo-farmer-1@evil.com — the local part matches, the account must not.
		await setAuthUser({ id: "sb-1", email: "demo-farmer-1@evil.com" });
		findUnique.mockResolvedValue({ farmId: "demo-farmer-1", supabaseId: "sb-1" } as never);

		expect(await getCurrentUser()).toBeNull();
	});

	it("returns null when no DB row matches the supabaseId", async () => {
		await setAuthUser({ id: "sb-unknown", email: "demo-farmer-1@pond.optifeed.local" });
		findUnique.mockResolvedValue(null);

		expect(await getCurrentUser()).toBeNull();
	});

	it("getCurrentPondOwnerIdSafe returns the DB farmId, not the email local part", async () => {
		await setAuthUser({ id: "sb-1", email: "demo-farmer-1@evil.com" });
		findUnique.mockResolvedValue({ farmId: "demo-farmer-1", supabaseId: "sb-1" } as never);

		expect(await getCurrentPondOwnerIdSafe()).toBeNull();
	});

	it("getCurrentPondOwnerIdSafe returns farmId on a valid session", async () => {
		await setAuthUser({ id: "sb-1", email: "demo-farmer-1@pond.optifeed.local" });
		findUnique.mockResolvedValue({ farmId: "demo-farmer-1", supabaseId: "sb-1" } as never);

		expect(await getCurrentPondOwnerIdSafe()).toBe("demo-farmer-1");
	});

	it("farmIdFromEmail still normalizes the local part", () => {
		expect(farmIdFromEmail("Demo-Farmer-1@x.com")).toBe("demo-farmer-1");
		expect(farmIdFromEmail(null)).toBeNull();
	});
});
