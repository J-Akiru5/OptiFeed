// Provider registry. Adding a provider means writing one adapter and registering
// it here — the orchestrator, the superadmin console and the tests all discover
// providers through this map.

import { geminiProvider } from "./gemini";
import { opencodeGoProvider } from "./opencode-go";
import type { AiProvider } from "./types";

const PROVIDERS: Record<string, AiProvider> = {
	[opencodeGoProvider.id]: opencodeGoProvider,
	[geminiProvider.id]: geminiProvider,
};

export function getProvider(id: string): AiProvider | undefined {
	return PROVIDERS[id];
}

export function listProviders(): AiProvider[] {
	return Object.values(PROVIDERS);
}
