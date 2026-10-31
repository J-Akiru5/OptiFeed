import { loadEnvFile } from "node:process";
import { assertCiLocalStackTarget } from "./guards";

/**
 * CI preflight (issue #317). Runs before `prisma migrate deploy`.
 *
 * A misconfigured DATABASE_URL pointing at a hosted project fails here, before
 * a single statement can reach it. The `.env` load is best-effort: CI exports
 * the values into the job environment and has no file.
 */
export function runCheckCiTarget(env: Record<string, string | undefined> = process.env): string {
	const { host } = assertCiLocalStackTarget(env);
	return host;
}

function main(): void {
	try {
		loadEnvFile(".env");
	} catch {
		// .env is optional; the job environment is authoritative in CI.
	}

	try {
		const host = runCheckCiTarget();
		console.log(`[e2e-ci] target verified: ${host} (disposable local stack)`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}

main();
