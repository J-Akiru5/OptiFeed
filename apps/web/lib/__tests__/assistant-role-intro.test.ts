import { describe, expect, it } from "vitest";
import { introKey, suggestionKeys } from "../assistant/role-intro";
import type { AssistantRole } from "../assistant/types";
import { createTranslator } from "./helpers/messages";

const ROLES: AssistantRole[] = ["farmer", "owner", "superadmin"];

describe("assistant role intro", () => {
	for (const locale of ["en", "hil"] as const) {
		for (const role of ROLES) {
			it(`has an intro and three chips for ${role} in ${locale}`, () => {
				const t = createTranslator("chat", locale);
				expect(t(introKey(role))).not.toBe(`chat.${introKey(role)}`);
				const chips = suggestionKeys(role);
				expect(chips).toHaveLength(3);
				for (const key of chips) {
					expect(t(key)).not.toBe(`chat.${key}`);
				}
			});
		}
	}

	it("introduces each role differently", () => {
		const t = createTranslator("chat", "en");
		const intros = ROLES.map((role) => t(introKey(role)));
		expect(new Set(intros).size).toBe(ROLES.length);
	});
});
