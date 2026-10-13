/**
 * Playwright global setup — gap #7.
 *
 * Refuses to run the e2e suite unless the DATABASE_URL host matches the
 * allow-listed host in E2E_ALLOWED_DB_HOST. This makes it impossible for
 * `pnpm test:e2e` to run destructive flows against production.
 *
 * Both env vars are required: without an explicit allow-list the suite
 * simply does not run.
 */
export default function globalSetup(): void {
	const databaseUrl = process.env.DATABASE_URL;
	const allowedHost = process.env.E2E_ALLOWED_DB_HOST;

	if (!databaseUrl) {
		throw new Error(
			"e2e blocked: DATABASE_URL is not set. Set DATABASE_URL and E2E_ALLOWED_DB_HOST to run e2e tests.",
		);
	}
	if (!allowedHost) {
		throw new Error(
			"e2e blocked: E2E_ALLOWED_DB_HOST is not set. Set it to the dev database host to run e2e tests.",
		);
	}

	const host = new URL(databaseUrl).hostname;
	if (host !== allowedHost) {
		throw new Error(
			`e2e blocked: DATABASE_URL host "${host}" is not the allow-listed host "${allowedHost}". E2E tests may only run against the dev database.`,
		);
	}
}
