import type { AssistantRole } from "./types";

/**
 * The first message and suggestion chips, per role (issue #194, E9).
 *
 * Keys, not sentences: the copy lives under the `chat` namespace in
 * `messages/{en,hil}.json`. A missing translation therefore fails a test
 * instead of shipping an English sentence to a Hiligaynon reader.
 */
const INTRO_KEYS: Record<AssistantRole, string> = {
	farmer: "introFarmer",
	owner: "introOwner",
	superadmin: "introSuperadmin",
};

const CHIP_KEYS: Record<AssistantRole, string[]> = {
	farmer: ["chipsFarmer0", "chipsFarmer1", "chipsFarmer2"],
	owner: ["chipsOwner0", "chipsOwner1", "chipsOwner2"],
	superadmin: ["chipsSuperadmin0", "chipsSuperadmin1", "chipsSuperadmin2"],
};

export function introKey(role: AssistantRole): string {
	return INTRO_KEYS[role];
}

export function suggestionKeys(role: AssistantRole): string[] {
	return CHIP_KEYS[role];
}
