// Provider registry. Adding a provider means writing one adapter and registering
// it here — the orchestrator, the superadmin console and the tests all discover
// providers through this map.
//
// Issue #432: "openai-compatible" is a *kind*, not a default card. It is
// instantiated from the console with a base URL, so it is excluded from the
// built-in provider cards but still listed here for `getProvider(kind)`.

import { geminiProvider } from "./gemini";
import { openAiCompatibleProvider } from "./openai-compatible";
import { opencodeGoProvider } from "./opencode-go";
import type { AiProvider } from "./types";

const PROVIDERS: Record<string, AiProvider> = {
	[opencodeGoProvider.id]: opencodeGoProvider,
	[geminiProvider.id]: geminiProvider,
	[openAiCompatibleProvider.id]: openAiCompatibleProvider,
};

/** Adapter id for console-created instances. */
export const CUSTOM_PROVIDER_KIND = openAiCompatibleProvider.id;

export function getProvider(id: string): AiProvider | undefined {
	return PROVIDERS[id];
}

export function listProviders(): AiProvider[] {
	return Object.values(PROVIDERS);
}

/**
 * Adapters that get a built-in console card. `openai-compatible` is a template
 * for custom rows, not a provider on its own.
 */
export function listBuiltInProviders(): AiProvider[] {
	return listProviders().filter((provider) => provider.id !== CUSTOM_PROVIDER_KIND);
}

/** True when `id` names an adapter that already has a built-in card. */
export function isBuiltInProvider(id: string): boolean {
	return listBuiltInProviders().some((provider) => provider.id === id);
}
