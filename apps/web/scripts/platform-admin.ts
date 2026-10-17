import { loadEnvFile } from "node:process";
import { PrismaClient } from "@prisma/client";
import { isPlatformAdminActive } from "../lib/auth/platform-admin";

try {
	loadEnvFile(".env");
} catch {
	// .env may not exist; fall back to the ambient process environment.
}

const MIN_REASON_LENGTH = 10;

const prisma = new PrismaClient();

type Args = Record<string, string>;

function parseArgs(argv: string[]): Args {
	const args: Args = {};
	for (let i = 3; i < argv.length; i++) {
		const key = argv[i];
		if (!key?.startsWith("--")) continue;
		const val = argv[i + 1];
		if (val && !val.startsWith("--")) {
			args[key] = val;
			i++;
		} else {
			args[key] = "true";
		}
	}
	return args;
}

function requireReason(args: Args): string {
	const reason = args["--reason"]?.trim() ?? "";
	if (reason.length < MIN_REASON_LENGTH) {
		console.error(`--reason is required and must be at least ${MIN_REASON_LENGTH} characters.`);
		process.exit(1);
	}
	return reason;
}

function parseExpiresAt(args: Args): Date | null {
	const raw = args["--expires-at"];
	if (!raw) return null;
	const parsed = new Date(raw);
	if (Number.isNaN(parsed.getTime())) {
		console.error(`--expires-at "${raw}" is not a valid ISO 8601 date.`);
		process.exit(1);
	}
	return parsed;
}

async function resolveUser(args: Args) {
	const farmId = args["--farm-id"]?.trim().toLowerCase();
	if (!farmId) {
		console.error("Usage: --farm-id <id> is required.");
		process.exit(1);
	}
	const user = await prisma.user.findUnique({ where: { farmId } });
	if (!user) {
		console.error(`User "${farmId}" not found.`);
		process.exit(1);
	}
	return user;
}

function statusOf(row: { revokedAt: Date | null; expiresAt: Date | null }): string {
	if (row.revokedAt) return "REVOKED";
	if (!isPlatformAdminActive(row)) return "EXPIRED";
	return "ACTIVE";
}

async function grant(args: Args) {
	const reason = requireReason(args);
	const expiresAt = parseExpiresAt(args);
	const grantedBy = args["--granted-by"]?.trim() || "cli";
	const user = await resolveUser(args);

	const existing = await prisma.platformAdmin.findUnique({
		where: { userId: user.id },
	});

	if (existing && isPlatformAdminActive(existing)) {
		console.log(
			`"${user.farmId}" is already an active platform admin (grantedBy=${existing.grantedBy}, expiresAt=${existing.expiresAt?.toISOString() ?? "never"}). No change made.`,
		);
		return;
	}

	const row = existing
		? await prisma.platformAdmin.update({
				where: { userId: user.id },
				data: { revokedAt: null, grantedBy, expiresAt },
			})
		: await prisma.platformAdmin.create({
				data: { userId: user.id, grantedBy, expiresAt },
			});

	await prisma.platformAuditLog.create({
		data: {
			actorUserId: grantedBy,
			action: "platform_admin.grant",
			targetType: "platform_admin",
			targetId: user.id,
			reason,
			temporaryGrant: expiresAt !== null,
			after: {
				platformAdminId: row.id,
				grantedBy,
				expiresAt: expiresAt?.toISOString() ?? null,
			},
		},
	});

	console.log(
		`✓ Granted platform admin to "${user.farmId}" (${user.email}).${expiresAt ? ` Temporary, expires ${expiresAt.toISOString()}.` : ""}`,
	);
	console.log(`  Status: ${statusOf(row)}  Audit row written.\n`);
}

async function revoke(args: Args) {
	const reason = requireReason(args);
	const user = await resolveUser(args);

	const existing = await prisma.platformAdmin.findUnique({
		where: { userId: user.id },
	});
	if (!existing) {
		console.error(`"${user.farmId}" has no platform admin row to revoke.`);
		process.exit(1);
	}
	if (existing.revokedAt) {
		console.log(`"${user.farmId}" is already revoked. No change made.`);
		return;
	}

	const row = await prisma.platformAdmin.update({
		where: { userId: user.id },
		data: { revokedAt: new Date() },
	});

	await prisma.platformAuditLog.create({
		data: {
			actorUserId: args["--granted-by"]?.trim() || "cli",
			action: "platform_admin.revoke",
			targetType: "platform_admin",
			targetId: user.id,
			reason,
			temporaryGrant: existing.expiresAt !== null,
			before: {
				platformAdminId: existing.id,
				expiresAt: existing.expiresAt?.toISOString() ?? null,
			},
			after: { revokedAt: row.revokedAt?.toISOString() ?? null },
		},
	});

	console.log(`✓ Revoked platform admin for "${user.farmId}". Audit row written.\n`);
}

async function deleteRow(args: Args) {
	const reason = requireReason(args);
	const user = await resolveUser(args);

	const existing = await prisma.platformAdmin.findUnique({
		where: { userId: user.id },
	});
	if (!existing) {
		console.error(`"${user.farmId}" has no platform admin row to delete.`);
		process.exit(1);
	}

	// Hard delete: restores the pre-grant state (no row at all), unlike revoke,
	// which keeps the row and only stamps revokedAt. The audit trail lives in
	// the append-only PlatformAuditLog, so removing the row loses no history.
	await prisma.$transaction([
		prisma.platformAdmin.delete({ where: { userId: user.id } }),
		prisma.platformAuditLog.create({
			data: {
				actorUserId: args["--granted-by"]?.trim() || "cli",
				action: "platform_admin.delete",
				targetType: "platform_admin",
				targetId: user.id,
				reason,
				temporaryGrant: existing.expiresAt !== null,
				before: {
					platformAdminId: existing.id,
					grantedBy: existing.grantedBy,
					expiresAt: existing.expiresAt?.toISOString() ?? null,
					revokedAt: existing.revokedAt?.toISOString() ?? null,
				},
			},
		}),
	]);

	console.log(`✓ Deleted platform admin row for "${user.farmId}". Audit row written.\n`);
}

async function list() {
	const rows = await prisma.platformAdmin.findMany({ orderBy: { createdAt: "desc" } });

	if (rows.length === 0) {
		console.log('No platform admins. Run: pnpm platform-admin grant --farm-id <id> --reason "..."');
		return;
	}

	const users = await prisma.user.findMany({
		where: { id: { in: rows.map((r) => r.userId) } },
		select: { id: true, farmId: true, email: true },
	});
	const byId = new Map(users.map((u) => [u.id, u]));

	console.log(`\n${rows.length} platform admin(s):\n`);
	for (const r of rows) {
		const u = byId.get(r.userId);
		const label = u ? `${u.farmId.padEnd(20)} ${u.email.padEnd(40)}` : `${r.userId} (user missing)`;
		console.log(
			`  ${label} grantedBy=${(r.grantedBy ?? "-").padEnd(20)} expiresAt=${(r.expiresAt?.toISOString() ?? "never").padEnd(26)} ${statusOf(r)}${r.mfaEnrolledAt ? "  MFA" : ""}`,
		);
	}
	console.log();
}

async function main() {
	const command = process.argv[2];
	const args = parseArgs(process.argv);

	switch (command) {
		case "grant":
			await grant(args);
			break;
		case "revoke":
			await revoke(args);
			break;
		case "delete":
			await deleteRow(args);
			break;
		case "list":
			await list();
			break;
		default:
			console.log(`
OptiFeed Platform Admin Manager

Commands:
  grant   --farm-id <id> --reason "<at least 10 chars>"
          [--expires-at <ISO 8601>] [--granted-by <name>]
  revoke  --farm-id <id> --reason "<at least 10 chars>"
  delete  --farm-id <id> --reason "<at least 10 chars>"
  list
`);
			break;
	}
}

main()
	.catch((e) => {
		console.error("Error:", e);
		process.exit(1);
	})
	.finally(() => prisma.$disconnect());
