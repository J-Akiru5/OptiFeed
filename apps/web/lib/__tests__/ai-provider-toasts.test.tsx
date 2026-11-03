import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Saving an AI provider key used to update an inline notice somewhere in the
 * card, which is easy to miss after a long form (#568). Every action on the page
 * now raises a toast, and failures do too.
 */

const { toastSuccess, toastError } = vi.hoisted(() => ({
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
	toast: { success: toastSuccess, error: toastError },
}));

vi.mock("next-intl", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return {
		useTranslations: (namespace: string) => createTranslator(namespace),
		useLocale: () => "en",
	};
});

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// Step-up pulls in the i18n routing helper, which imports next-intl/navigation
// and then next/navigation; neither is needed for this interaction test.
vi.mock("@/lib/actions/step-up", () => ({ startStepUp: vi.fn() }));
vi.mock("@/i18n/routing", () => ({ redirect: vi.fn() }));

vi.mock("@/lib/actions/ai-providers", () => ({
	saveAiProviderConfig: vi.fn(async () => ({ success: true })),
	setAiProviderKey: vi.fn(async () => ({ success: true, latencyMs: 42 })),
	clearAiProviderKey: vi.fn(async () => ({ success: true })),
	removeAiProvider: vi.fn(async () => ({ success: true })),
	createAiProvider: vi.fn(async () => ({ success: true })),
	resetAiProviderConfig: vi.fn(async () => ({ success: true })),
}));

import { AiProviderSettings } from "@/components/superadmin/ai-provider-settings";
import { setAiProviderKey } from "@/lib/actions/ai-providers";

const VIEW = {
	provider: "gemini",
	kind: "gemini",
	label: "Google Gemini",
	builtIn: true,
	configured: true,
	enabled: true,
	priority: 5,
	model: "gemini-2.5-flash",
	apiKeyEnv: "GEMINI_API_KEY",
	apiKeyPresent: true,
	keySource: "db" as const,
	keyLast4: "1234",
	keyUpdatedAt: null,
	keyUpdatedBy: null,
	keyUnreadable: false,
	baseUrl: null,
	reasoningEffort: "high" as const,
};

const REASON = "Rotate the key after the provider incident";

beforeEach(() => {
	toastSuccess.mockClear();
	toastError.mockClear();
	vi.mocked(setAiProviderKey).mockClear();
	vi.mocked(setAiProviderKey).mockResolvedValue({ success: true, latencyMs: 42 });
});

afterEach(cleanup);

function fillKeyForm() {
	fireEvent.change(document.getElementById("gemini-reason") as HTMLInputElement, {
		target: { value: REASON },
	});
	fireEvent.change(document.getElementById("gemini-key") as HTMLInputElement, {
		target: { value: "sk-test-1234" },
	});
}

describe("AI provider action toasts (#568)", () => {
	it("confirms a saved key with a toast, not only an inline notice", async () => {
		render(<AiProviderSettings providers={[VIEW]} />);

		fillKeyForm();
		fireEvent.click(screen.getByRole("button", { name: "Save key" }));

		await waitFor(() =>
			expect(toastSuccess).toHaveBeenCalledWith(
				expect.stringContaining("Key tested and saved (42 ms)"),
			),
		);
		expect(toastError).not.toHaveBeenCalled();
	});

	it("shows a failure toast when the provider rejects the key", async () => {
		vi.mocked(setAiProviderKey).mockResolvedValue({ error: "Provider rejected the key." });

		render(<AiProviderSettings providers={[VIEW]} />);

		fillKeyForm();
		fireEvent.click(screen.getByRole("button", { name: "Save key" }));

		await waitFor(() => expect(toastError).toHaveBeenCalledWith("Provider rejected the key."));
	});

	it("rejects a too-short key with a toast before calling the action", () => {
		render(<AiProviderSettings providers={[VIEW]} />);

		fireEvent.change(document.getElementById("gemini-reason") as HTMLInputElement, {
			target: { value: REASON },
		});
		fireEvent.change(document.getElementById("gemini-key") as HTMLInputElement, {
			target: { value: "short" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save key" }));

		expect(toastError).toHaveBeenCalledWith("Enter a key of at least 8 characters.");
		expect(setAiProviderKey).not.toHaveBeenCalled();
	});
});
