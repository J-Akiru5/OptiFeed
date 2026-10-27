import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The admin write pages (`ponds/new`, `ponds/[pondId]/edit`, `ponds/[pondId]/delete`)
 * used to render for anyone who could reach `/admin`: the guarded action then threw
 * `Forbidden` into the admin error boundary. They now check `manage_farms_ponds`
 * and answer with a 404 instead.
 */

vi.mock("next-intl/server", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		getTranslations: async (namespace: string) => createTranslator(namespace),
		getLocale: async () => "en",
	};
});

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace),
		useLocale: () => "en",
	};
});

vi.mock("@/i18n/routing", () => ({
	Link: ({ href, children }: { href: string; children?: ReactNode }) => (
		<a href={href}>{children}</a>
	),
	getPathname: ({ href }: { href: string }) => href,
	usePathname: () => "/admin/ponds/new",
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
	notFound: vi.fn(() => {
		throw new Error("NEXT_NOT_FOUND");
	}),
}));

vi.mock("@/lib/auth/permissions", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/auth/permissions")>();
	return { ...actual, hasPermission: vi.fn(async () => true) };
});

vi.mock("@/lib/actions/ponds", () => ({
	getPondOwnerOptions: vi.fn(async () => [{ farmId: "farmer-1", name: "Farmer One" }]),
	getPondDetail: vi.fn(async () => ({
		pond: {
			id: "pond-1",
			name: "Pond One",
			ownerId: "farmer-1",
			feedsPerDay: 3,
			scheduleStart: "06:00",
			scheduleEnd: "18:00",
			feedingRatePct: 3,
			population: 1000,
		},
		cropCycle: null,
		biomass: null,
		fcr: null,
		deletion: { blockers: [] },
	})),
	getPondDeletionCheck: vi.fn(async () => ({ canDelete: true, blockers: [] })),
}));

vi.mock("@/lib/auth/org-scope", () => ({
	resolveOrgScope: vi.fn(async () => ({
		orgIds: ["org-1"],
		memberUserIds: ["user-1"],
		farmIds: ["farmer-1"],
		pondIds: ["pond-1"],
	})),
}));

vi.mock("@/lib/settings/org", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/settings/org")>();
	return { ...actual, getOrgSettings: vi.fn(async () => actual.ORG_SETTINGS_DEFAULTS) };
});

import { hasPermission } from "@/lib/auth/permissions";
import { notFound } from "next/navigation";

async function expectNotFound(promise: Promise<unknown>) {
	await expect(promise).rejects.toThrow("NEXT_NOT_FOUND");
	expect(vi.mocked(notFound)).toHaveBeenCalled();
}

describe("admin pond write pages", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(hasPermission).mockResolvedValue(true);
	});

	it("renders the create form when pond management is allowed", async () => {
		const NewPondPage = (await import("@/app/[locale]/(admin)/admin/ponds/new/page")).default;
		const html = renderToStaticMarkup(await NewPondPage());
		expect(html).toContain("New Pond");
		expect(html).toContain("Create pond");
	});

	it("returns not-found for the create page when pond management is revoked", async () => {
		vi.mocked(hasPermission).mockResolvedValue(false);
		const NewPondPage = (await import("@/app/[locale]/(admin)/admin/ponds/new/page")).default;
		await expectNotFound(NewPondPage());
	});

	it("returns not-found for the edit page when pond management is revoked", async () => {
		vi.mocked(hasPermission).mockResolvedValue(false);
		const EditPondPage = (await import("@/app/[locale]/(admin)/admin/ponds/[pondId]/edit/page"))
			.default;
		await expectNotFound(EditPondPage({ params: Promise.resolve({ pondId: "pond-1" }) }));
	});

	it("returns not-found for the delete page when pond management is revoked", async () => {
		vi.mocked(hasPermission).mockResolvedValue(false);
		const DeletePondPage = (await import("@/app/[locale]/(admin)/admin/ponds/[pondId]/delete/page"))
			.default;
		await expectNotFound(DeletePondPage({ params: Promise.resolve({ pondId: "pond-1" }) }));
	});
});
