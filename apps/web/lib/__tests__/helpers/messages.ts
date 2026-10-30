import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Minimal message lookup for rendering pages in tests.
 *
 * The real app resolves messages through next-intl; tests that render a server
 * page need the same strings, so this reads the shipped JSON instead of
 * hand-copying translations into each test. It supports the subset the admin
 * console uses: `{name}` interpolation and `{count, plural, one {…} other {…}}`.
 */

type Tree = { [key: string]: string | Tree };

export function loadMessages(locale: "en" | "hil" | "tl" = "en"): Record<string, string> {
	const raw = JSON.parse(
		readFileSync(join(__dirname, "../../../messages", `${locale}.json`), "utf8"),
	);
	const flat: Record<string, string> = {};
	const walk = (tree: Tree, prefix: string) => {
		for (const [key, value] of Object.entries(tree)) {
			const path = prefix ? `${prefix}.${key}` : key;
			if (typeof value === "string") flat[path] = value;
			else walk(value, path);
		}
	};
	walk(raw as Tree, "");
	return flat;
}

export function formatMessage(
	template: string,
	values: Record<string, string | number> = {},
): string {
	const withPlurals = template.replace(
		/\{(\w+),\s*plural,\s*one\s*\{([^{}]*)\}\s*other\s*\{([^{}]*)\}\s*\}/g,
		(_match, name: string, one: string, other: string) => {
			const count = Number(values[name] ?? 0);
			return (count === 1 ? one : other).replace(/#/g, String(count));
		},
	);

	return withPlurals.replace(/\{(\w+)\}/g, (_match, name: string) =>
		values[name] === undefined ? `{${name}}` : String(values[name]),
	);
}

export type TestTranslator = ((key: string, values?: Record<string, string | number>) => string) & {
	has: (key: string) => boolean;
	rich: (key: string, values?: Record<string, unknown>) => string;
};

/** Build the `getTranslations(namespace)` / `useTranslations(namespace)` shape. */
export function createTranslator(namespace: string, locale: "en" | "hil" = "en"): TestTranslator {
	const messages = loadMessages(locale);
	const resolve = (key: string) => messages[namespace ? `${namespace}.${key}` : key];

	const translator = (key: string, values?: Record<string, string | number>) => {
		const template = resolve(key);
		if (template === undefined) return `${namespace}.${key}`;
		return formatMessage(template, values);
	};
	translator.has = (key: string) => resolve(key) !== undefined;
	translator.rich = (key: string, values?: Record<string, unknown>) =>
		translator(key, values as Record<string, string | number> | undefined);
	return translator;
}
