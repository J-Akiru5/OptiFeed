import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ADR-0007: Telegram is not used by this platform.
 *
 * The decision has one home — `docs/adr/0007-no-telegram.md` — and this test
 * is the enforcement that keeps it true. Alerts are in-app only
 * (`Notification` rows) and e-mail only where a mailbox can receive it
 * (Resend). There is no bot token, no chat id and no outbound Telegram call
 * anywhere in the app.
 *
 * A reintroduced Telegram path is a privacy and security regression: the
 * privacy policy tells users the platform does not message them on Telegram
 * (`components/legal/privacy-policy-content.tsx`), and a bot token in the
 * environment would put a third-party processor back on the data path.
 *
 * The scan covers the runtime source only. `components/legal/` states the
 * decision in prose (and is checked by `legal-config.test.ts`), and the test
 * files themselves are excluded so this guard can name what it forbids.
 */
const appRoot = join(__dirname, "../..");
const SCAN_DIRS = ["app", "lib"];
const EXCLUDED_DIRS = ["__tests__", "node_modules", ".next"];

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			if (EXCLUDED_DIRS.includes(name)) return [];
			return sourceFiles(path);
		}
		return /\.(ts|tsx)$/.test(name) ? [path] : [];
	});
}

describe("ADR-0007 — Telegram is not used", () => {
	it("has no Telegram integration in the runtime source", () => {
		// Prose that says "we do not use Telegram" is allowed; an integration is
		// not. The markers are the API host, the environment variables, the
		// helper and the module path.
		const integration = /api\.telegram\.org|TELEGRAM_[A-Z_]+|sendTelegramMessage|notify\/telegram/i;
		const hits: string[] = [];
		for (const dir of SCAN_DIRS) {
			for (const file of sourceFiles(join(appRoot, dir))) {
				if (integration.test(readFileSync(file, "utf8"))) {
					hits.push(relative(appRoot, file).replaceAll("\\", "/"));
				}
			}
		}
		expect(
			hits,
			`Telegram integration found in the runtime source (${hits.join(", ")}); ADR-0007 says the platform does not use Telegram`,
		).toEqual([]);
	});

	it("documents no Telegram environment variable", () => {
		const envExample = readFileSync(join(appRoot, ".env.example"), "utf8");
		expect(envExample).not.toMatch(/TELEGRAM_[A-Z_]+/);
	});
});
