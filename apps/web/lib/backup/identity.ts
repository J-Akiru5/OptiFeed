import type { BackupRow } from "./tables";

/**
 * The auth identity manifest (issue #322).
 *
 * The application's `User` rows point at Supabase Auth identities through
 * `User.supabaseId`. A restore of the `public` schema alone therefore leaves
 * users who exist in the app but cannot sign in, because `auth.users` lives in
 * a provider-managed schema that no app-level export can read.
 *
 * The manifest carries the minimal profile a restore needs to recreate those
 * identities and re-link them — id, Supabase id, email, farm slug, role and the
 * organization links — and nothing else. There is no password, no hash, no
 * token and no session: Supabase Auth has never exposed those to the app, and
 * they must not appear in an export even if it did.
 *
 * The manifest is emitted as SQL comments, so it is inert if the file is piped
 * into `psql`, and readable by `scripts/ops/restore-check.mjs`.
 */

export const IDENTITY_MANIFEST_MARKER = "-- === AUTH IDENTITY MANIFEST (issue #322) ===";
export const IDENTITY_LINE_PREFIX = "-- identity: ";

export interface IdentityMembership {
	orgId: string;
	role: string;
	revokedAt: string | null;
}

export interface IdentityRecord {
	id: string;
	supabaseId: string;
	email: string;
	farmId: string;
	role: string;
	displayName: string | null;
	memberships: IdentityMembership[];
}

function text(value: unknown): string {
	return typeof value === "string"
		? value
		: value === null || value === undefined
			? ""
			: String(value);
}

function dateText(value: unknown): string | null {
	if (value instanceof Date) return value.toISOString();
	return typeof value === "string" ? value : null;
}

/**
 * Build the manifest from the rows that were actually exported.
 *
 * `users` and `memberships` are the streamed `User` / `Membership` rows, so the
 * manifest can never describe a user the export did not include (and vice
 * versa — the restore check verifies that).
 */
export function buildIdentityManifest(
	users: readonly BackupRow[],
	memberships: readonly BackupRow[],
): IdentityRecord[] {
	const byUser = new Map<string, IdentityMembership[]>();
	for (const membership of memberships) {
		const userId = text(membership.userId);
		if (!userId) continue;
		const list = byUser.get(userId) ?? [];
		list.push({
			orgId: text(membership.orgId),
			role: text(membership.role),
			revokedAt: dateText(membership.revokedAt),
		});
		byUser.set(userId, list);
	}

	const records: IdentityRecord[] = users.map((user) => {
		const id = text(user.id);
		return {
			id,
			supabaseId: text(user.supabaseId),
			email: text(user.email),
			farmId: text(user.farmId),
			role: text(user.role),
			displayName: typeof user.displayName === "string" ? user.displayName : null,
			memberships: byUser.get(id) ?? [],
		};
	});

	// Stable order: the file is evidence, and a diff should show real changes only.
	records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	return records;
}

/** The manifest section: instructions as comments, then one JSON object per line. */
export function renderIdentityManifest(records: readonly IdentityRecord[]): string {
	const header = [
		"",
		IDENTITY_MANIFEST_MARKER,
		"-- Recreate each Supabase Auth identity with the SAME id as `supabaseId`",
		"-- (email as given), then restore the data. The User rows re-link by supabaseId.",
		"-- Restore order: docs/operations/backup-and-recovery.md §7.5.",
		`-- Identities: ${records.length}`,
	];
	const lines = records.map((record) => `${IDENTITY_LINE_PREFIX}${JSON.stringify(record)}`);
	return `${[...header, ...lines, ""].join("\n")}\n`;
}
