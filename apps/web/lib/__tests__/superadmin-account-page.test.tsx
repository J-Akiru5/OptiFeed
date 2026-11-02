import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Platform account page (issue #560).
 *
 * The page is the destination the console menu links to. It must render the
 * admin's identity and the three account surfaces without a farm membership —
 * the previous route (`/dashboard/settings/profile`) only existed for tenant
 * members.
 */

const mocks = vi.hoisted(() => ({
	requirePasswordChanged: vi.fn(),
	canWrite: vi.fn(async () => true),
	requirePlatformAdmin: vi.fn(async () => undefined),
	getSignedAvatarUrls: vi.fn(async () => ({})),
}));

vi.mock("@/lib/auth/session", () => ({
	requirePasswordChanged: mocks.requirePasswordChanged,
	canWrite: mocks.canWrite,
}));
vi.mock("@/lib/auth/require-platform-admin", () => ({
	requirePlatformAdmin: mocks.requirePlatformAdmin,
}));
vi.mock("@/lib/avatars", () => ({
	getSignedAvatarUrls: mocks.getSignedAvatarUrls,
}));
vi.mock("next-intl/server", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		getLocale: async () => "en",
		getTranslations: async (namespace: string) => createTranslator(namespace),
	};
});
vi.mock("@/components/change-password-form", async () => {
	const react = await import("react");
	return {
		ChangePasswordForm: () => react.createElement("div", { "data-testid": "password-form" }),
	};
});
vi.mock("@/components/LogoutButton", async () => {
	const react = await import("react");
	return {
		LogoutButton: () => react.createElement("button", { type: "button" }, "sign-out-stub"),
	};
});
vi.mock("@/components/profile/avatar-upload", async () => {
	const react = await import("react");
	return {
		AvatarUpload: ({ name }: { name: string }) =>
			react.createElement("div", { "data-testid": "avatar-upload" }, name),
	};
});

import SuperadminAccountPage from "@/app/[locale]/(superadmin)/superadmin/account/page";
import { createTranslator } from "./helpers/messages";

const t = createTranslator("superadmin.account");

const USER = {
	id: "user-karl",
	farmId: "platform-karl",
	email: "platform-karl@pond.optifeed.local",
	contactEmail: "karl@example.com",
	displayName: "Karl Calimotan",
	role: "ADMIN",
	avatarPath: null,
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe("SuperadminAccountPage", () => {
	it("renders the platform admin identity without a tenant membership", async () => {
		mocks.requirePasswordChanged.mockResolvedValue(USER);

		const html = renderToStaticMarkup(await SuperadminAccountPage());

		expect(html).toContain("Karl Calimotan");
		expect(html).toContain("karl@example.com");
		expect(html).toContain("platform-karl");
		expect(html).toContain("ADMIN");
		expect(html).toContain(t("title"));
		expect(html).toContain(t("identity"));
	});

	it("offers the avatar, password and session surfaces", async () => {
		mocks.requirePasswordChanged.mockResolvedValue(USER);

		const html = renderToStaticMarkup(await SuperadminAccountPage());

		expect(html).toContain(t("avatar"));
		expect(html).toContain(t("password"));
		expect(html).toContain(t("session"));
		expect(html).toContain('data-testid="avatar-upload"');
		expect(html).toContain('data-testid="password-form"');
		expect(html).toContain("sign-out-stub");
	});

	it("gates the page on the platform admin record", async () => {
		mocks.requirePasswordChanged.mockResolvedValue(USER);

		await SuperadminAccountPage();

		expect(mocks.requirePlatformAdmin).toHaveBeenCalledTimes(1);
	});
});
