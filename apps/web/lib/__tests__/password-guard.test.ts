import { beforeEach, describe, expect, it, vi } from "vitest";

// Same identity setup as session-identity.test.ts: a stable auth object so
// each test can stub the Supabase user without re-mocking the module.
vi.mock("@/lib/supabase/server", () => {
	const auth = { getUser: vi.fn(async () => ({ data: { user: null } })) };
	return { createClient: vi.fn(async () => ({ auth })) };
});

vi.mock("@/lib/prisma", () => ({
	default: { user: { findUnique: vi.fn() } },
}));

vi.mock("@/i18n/routing", () => ({ redirect: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "en") }));

import { redirect } from "@/i18n/routing";
import {
	assertPasswordChanged,
	canWrite,
	requirePasswordChanged,
	requireWriteAccess,
} from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

async function signIn(user: { id: string; email: string } | null) {
	const client = await createClient();
	client.auth.getUser = vi.fn(async () => ({ data: { user } })) as never;
}

const findUnique = vi.mocked(prisma.user.findUnique);
const mockRedirect = vi.mocked(redirect);

const USER = {
	id: "user-1",
	farmId: "demo-farmer-1",
	supabaseId: "sb-1",
	role: "ADMIN",
	mustChangePassword: false,
};

async function setUser(overrides: Partial<typeof USER> = {}) {
	await signIn({ id: "sb-1", email: "demo-farmer-1@pond.optifeed.local" });
	findUnique.mockResolvedValue({ ...USER, ...overrides } as never);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("assertPasswordChanged", () => {
	it("resolves for a user who has completed the change", async () => {
		await setUser();

		await expect(assertPasswordChanged()).resolves.toBeUndefined();
	});

	it("throws while a temporary password is still active", async () => {
		await setUser({ mustChangePassword: true });

		await expect(assertPasswordChanged()).rejects.toThrow("Password change required");
	});

	it("throws without a session", async () => {
		await signIn(null);

		await expect(assertPasswordChanged()).rejects.toThrow("Not authenticated");
	});
});

describe("canWrite", () => {
	it("is true for an unflagged ADMIN", async () => {
		await setUser();

		expect(await canWrite()).toBe(true);
	});

	it("is false while a password change is pending", async () => {
		await setUser({ mustChangePassword: true });

		expect(await canWrite()).toBe(false);
	});

	it("is false for a VIEWER", async () => {
		await setUser({ role: "VIEWER" });

		expect(await canWrite()).toBe(false);
	});
});

describe("requireWriteAccess", () => {
	it("throws while a password change is pending", async () => {
		await setUser({ mustChangePassword: true });

		await expect(requireWriteAccess()).rejects.toMatchObject({
			code: "action_denied",
			reason: "password_change_required",
			message: "Change your temporary password before making changes.",
		});
	});

	it("throws a typed wrong-role denial for a VIEWER", async () => {
		await setUser({ role: "VIEWER" });

		await expect(requireWriteAccess()).rejects.toMatchObject({
			code: "action_denied",
			reason: "wrong_role",
		});
	});

	it("throws a typed not-authenticated denial without a session", async () => {
		await signIn(null);

		await expect(requireWriteAccess()).rejects.toMatchObject({
			code: "action_denied",
			reason: "not_authenticated",
		});
	});

	it("allows an unflagged OPERATOR", async () => {
		await setUser({ role: "OPERATOR" });

		await expect(requireWriteAccess()).resolves.toBeUndefined();
	});
});

describe("requirePasswordChanged", () => {
	it("redirects a flagged user to /change-password", async () => {
		await setUser({ mustChangePassword: true });

		await expect(requirePasswordChanged()).rejects.toThrow("redirect");
		expect(mockRedirect).toHaveBeenCalledWith({
			href: "/change-password",
			locale: "en",
		});
	});

	it("returns the user when the change is complete", async () => {
		await setUser();

		await expect(requirePasswordChanged()).resolves.toMatchObject({ id: "user-1" });
		expect(mockRedirect).not.toHaveBeenCalled();
	});
});
