import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The console page is a server component that renders a client component.
// Nothing else in the suite exercises that boundary, so a mistake there (an
// unserialisable prop, a hook in the wrong place, a bad import) would only
// surface as a 500 in a browser — or as a build failure nobody has run.

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));

vi.mock("@/lib/actions/ai-providers", () => ({
	listAiProviderConfig: listMock,
	saveAiProviderConfig: vi.fn(),
	resetAiProviderConfig: vi.fn(),
}));

vi.mock("next-intl/server", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { getTranslations: async (namespace: string) => createTranslator(namespace) };
});

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { useTranslations: (namespace: string) => createTranslator(namespace) };
});

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

// The dialog pulls in the routing helper, which is not part of this page test.
vi.mock("@/components/superadmin/step-up-dialog", () => ({ StepUpDialog: () => null }));

import SuperadminAiProvidersPage from "@/app/[locale]/(superadmin)/superadmin/ai-providers/page";
import type { AiProviderView } from "@/lib/actions/ai-providers";

const providers: AiProviderView[] = [
	{
		provider: "opencode-go",
		label: "OpenCode Go",
		configured: false,
		enabled: true,
		priority: 10,
		model: "deepseek-v4.1-flash",
		apiKeyEnv: "OPENCODE_GO_API_KEY",
		apiKeyPresent: true,
		key: {
			source: "db",
			last4: "1234",
			updatedAt: "2026-10-31T12:00:00.000Z",
			updatedBy: "admin-1",
		},
		reasoningEffort: "high",
	},
	{
		provider: "gemini",
		label: "Google Gemini",
		configured: false,
		enabled: true,
		priority: 20,
		model: "gemini-2.5-flash",
		apiKeyEnv: "GEMINI_API_KEY",
		apiKeyPresent: false,
		key: { source: "none", last4: null, updatedAt: null, updatedBy: null },
		reasoningEffort: "high",
	},
];

beforeEach(() => {
	listMock.mockReset();
	listMock.mockResolvedValue(providers);
});

afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllEnvs();
});

describe("/superadmin/ai-providers page", () => {
	it("renders both providers with their resolved chain settings", async () => {
		const html = renderToStaticMarkup(await SuperadminAiProvidersPage());

		expect(html).toContain("AI Providers");
		expect(html).toContain("OpenCode Go");
		expect(html).toContain("Google Gemini");
		expect(html).toContain("deepseek-v4.1-flash");
		expect(html).toContain("gemini-2.5-flash");
		expect(html).toContain("OPENCODE_GO_API_KEY");
		expect(html).toContain("GEMINI_API_KEY");
		// Order in the DOM follows priority.
		expect(html.indexOf("OpenCode Go")).toBeLessThan(html.indexOf("Google Gemini"));
	});

	it("shows the source, masked last four and update metadata without any ciphertext", async () => {
		const html = renderToStaticMarkup(await SuperadminAiProvidersPage());

		expect(html).toContain("Stored (encrypted)");
		expect(html).toContain("••••1234");
		expect(html).toContain("2026-10-31 12:00 UTC");
		expect(html).toContain("admin-1");
		expect(html).not.toContain("keyCiphertext");
	});

	it("shows a banner and disables Set/Rotate when AI_SECRET_KEY is missing", async () => {
		vi.stubEnv("AI_SECRET_KEY", "");

		const html = renderToStaticMarkup(await SuperadminAiProvidersPage());

		expect(html).toContain("DB keys disabled: set AI_SECRET_KEY");
		// The key submit button is disabled while the master key is absent.
		expect(html).toMatch(/disabled=""[^>]*>[\s\S]*?(Rotate key|Set key)/);
	});

	it("distinguishes a provider with a key from one without", async () => {
		const html = renderToStaticMarkup(await SuperadminAiProvidersPage());
		expect(html).toContain("Stored (encrypted)");
		expect(html).toContain("No key — inactive");
	});

	it("labels providers that fall back to built-in defaults", async () => {
		const html = renderToStaticMarkup(await SuperadminAiProvidersPage());
		expect(html).toContain("using built-in default");
	});

	it("marks only the unconfigured providers as using built-in defaults", async () => {
		const allDefault = renderToStaticMarkup(await SuperadminAiProvidersPage());
		// Both providers fall back to defaults.
		expect(allDefault.split("using built-in default").length - 1).toBe(2);

		listMock.mockResolvedValue([{ ...providers[0], configured: true, priority: 1 }, providers[1]]);
		const oneConfigured = renderToStaticMarkup(await SuperadminAiProvidersPage());
		// Only Gemini is still on defaults.
		expect(oneConfigured.split("using built-in default").length - 1).toBe(1);
	});

	it("renders the reset control and the audit-reason guidance", async () => {
		const html = renderToStaticMarkup(await SuperadminAiProvidersPage());
		expect(html).toContain("Reset to Defaults");
		expect(html).toContain("platform audit log");
	});

	it("propagates a failure from the action instead of rendering an empty page", async () => {
		listMock.mockRejectedValue(new Error("boom"));
		await expect(SuperadminAiProvidersPage()).rejects.toThrow("boom");
	});
});
