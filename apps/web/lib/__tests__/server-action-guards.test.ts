import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every export of a "use server" module is a server action a browser can call
 * directly with any arguments. An exported action that writes must therefore
 * run an auth guard itself; it may never trust caller-supplied owner/actor ids.
 *
 * This is a static heuristic: a function body that contains a Prisma write (or
 * a transaction) must also contain one of the guard calls below. Exceptions
 * are listed explicitly with the reason they are safe.
 */

const actionsDir = join(__dirname, "../actions");

const GUARDS = [
	"requireWriteAccess",
	"requirePermission",
	"assertNotViewingAs",
	"requirePlatformAdmin",
	"requireTenantAdmin",
	"withStepUp",
];

const WRITE = /\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(|\$transaction/;

const ALLOWED: Record<string, string> = {
	"password-reset.ts::requestPasswordReset":
		"public by design: reached from the signed-out login page, rate-limited by IP, and writes only an audit row (anti-enumeration answer for unknown farm ids)",
	"password.ts::changeOwnPassword": "changes only the signed-in caller's own password",
	"password-reset.ts::completePasswordReset":
		"changes only the recovery session's own password; supabase.auth.getUser() is the guard and no id is caller-supplied",
	"platform/impersonation.ts::stopViewAs": "only ends the caller's own view-as session",
};

function serverActionFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return serverActionFiles(path);
		if (!name.endsWith(".ts")) return [];
		const source = readFileSync(path, "utf8");
		return source.trimStart().startsWith('"use server"') ? [path] : [];
	});
}

describe("server actions that write are guarded", () => {
	const files = serverActionFiles(actionsDir);

	it("finds the action modules", () => {
		expect(files.length).toBeGreaterThan(10);
	});

	for (const file of files) {
		const rel = relative(actionsDir, file).replaceAll("\\", "/");
		const source = readFileSync(file, "utf8");
		const matches = [...source.matchAll(/export async function (\w+)\(/g)];

		matches.forEach((match, index) => {
			const name = match[1];
			const end = matches[index + 1]?.index ?? source.length;
			const body = source.slice(match.index, end);
			if (!WRITE.test(body)) return;

			it(`${rel}::${name} runs an auth guard`, () => {
				if (ALLOWED[`${rel}::${name}`]) return;
				expect(
					GUARDS.some((guard) => body.includes(guard)),
					`${rel}::${name} writes without calling one of: ${GUARDS.join(", ")}`,
				).toBe(true);
			});
		});
	}

	it("keeps the growth-plan core out of the server-action module", () => {
		const source = readFileSync(join(actionsDir, "growth-plan.ts"), "utf8");
		expect(source).not.toContain("export async function applyGrowthPlanForPond");
	});
});
