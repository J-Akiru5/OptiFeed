import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * #761 — the public surface shipped a literal `?` placeholder in the hardware
 * label and mojibake in the NPC address, and unknown URLs fell through to the
 * default English Next.js 404.
 */

vi.mock("next-intl/server", async () => {
	const { createTranslator } = await import("./helpers/messages");
	return { getTranslations: async (namespace: string) => createTranslator(namespace) };
});

vi.mock("@/i18n/routing", () => ({
	Link: ({ href, children }: { href: string; children?: React.ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

vi.mock("@/components/assistant/mascot", () => ({ Mascot: () => <span /> }));

import LocaleNotFound from "@/app/[locale]/not-found";

const webRoot = join(__dirname, "../..");
const MESSAGES = ["en", "hil", "tl"] as const;

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = "", out: Record<string, string> = {}) {
	for (const [key, value] of Object.entries(tree)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (typeof value === "string") out[path] = value;
		else flatten(value, path, out);
	}
	return out;
}

function messages(locale: (typeof MESSAGES)[number]): Record<string, string> {
	return flatten(
		JSON.parse(readFileSync(join(webRoot, "messages", `${locale}.json`), "utf8")) as Tree,
	);
}

const MOJIBAKE = ["\uFFFD", "Ã", "Â", "â€", "ï¿½"];

describe("public copy integrity (#761)", () => {
	it("has no mojibake in any locale catalogue", () => {
		for (const locale of MESSAGES) {
			const raw = readFileSync(join(webRoot, "messages", `${locale}.json`), "utf8");
			for (const sequence of MOJIBAKE) {
				expect(raw.includes(sequence), `${locale}.json contains ${JSON.stringify(sequence)}`).toBe(
					false,
				);
			}
		}
	});

	it("has no placeholder question marks standing in for punctuation", () => {
		for (const locale of MESSAGES) {
			for (const [key, value] of Object.entries(messages(locale))) {
				expect(/\s\?\s/.test(value), `${locale}:${key} has a placeholder "?"`).toBe(false);
				expect(value.includes("???"), `${locale}:${key} has "???"`).toBe(false);
			}
		}
	});

	it("renders the NPC address with a real en dash and no mojibake", () => {
		const config = readFileSync(join(webRoot, "lib/legal/config.ts"), "utf8");

		for (const sequence of MOJIBAKE) {
			expect(config.includes(sequence), `config.ts contains ${JSON.stringify(sequence)}`).toBe(
				false,
			);
		}
		expect(config).toContain("25th–27th Floors");
	});
});

describe("localized 404 (#761)", () => {
	it("renders branded, localized copy and a way home", async () => {
		render(await LocaleNotFound());

		expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Page not found");
		expect(screen.getByText("The page you are looking for does not exist.")).toBeInTheDocument();
		const home = screen.getByRole("link", { name: /Back to home/ });
		expect(home).toHaveAttribute("href", "/");
	});
});
