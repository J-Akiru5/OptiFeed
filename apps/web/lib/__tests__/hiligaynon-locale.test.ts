import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Hiligaynon partial-locale labelling (#762).
 *
 * 141 of 220 landing keys are still byte-identical English, including whole
 * sections, and `/hil/privacy` still has an English H1. Translating everything
 * is a separate workstream; this change makes sure the product never presents
 * the locale as complete while that gap exists, the same way Tagalog carries
 * its Beta badge (#457).
 */

const webRoot = join(__dirname, "../..");

describe("Hiligaynon partial labelling (#762)", () => {
	it("carries a visible Partial status in the language menu", () => {
		const switcher = readFileSync(join(webRoot, "components/locale-switcher.tsx"), "utf8");

		expect(switcher).toMatch(/hil: "Hiligaynon"/);
		expect(switcher).toMatch(/hil: "Partial"/);
		// The badge text is rendered from the status map, not hardcoded per row.
		expect(switcher).toMatch(/\{status\}/);
	});

	it("labels Hiligaynon as Partial on the login page's compact toggle", () => {
		const login = readFileSync(join(webRoot, "app/[locale]/login/page.tsx"), "utf8");

		expect(login).toMatch(/code: "hil", label: "HIL", title: "Hiligaynon \(Partial\)"/);
	});
});
