import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { passwordErrorMessage, validatePassword } from "../lib/auth/password";

const prisma = new PrismaClient();

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`Missing env var: ${name}`);
	return value;
}

function createAdminClient() {
	return createClient(
		requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
		requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
		{ auth: { autoRefreshToken: false, persistSession: false } },
	);
}

function buildPondEmail(farmId: string): string {
	return `${farmId}@pond.optifeed.local`;
}

function readPassword(args: Record<string, string>): string | undefined {
	// `--pin` is kept as a deprecated alias so existing scripts do not break.
	return args["--password"] ?? args["--pin"];
}

function forcesChange(args: Record<string, string>): boolean {
	return args["--no-force-change"] !== "true";
}

// ── Commands ────────────────────────────────────────────────────────────────

async function listUsers() {
	const users = await prisma.user.findMany({
		orderBy: { createdAt: "desc" },
		include: { _count: { select: { ponds: true } } },
	});

	if (users.length === 0) {
		console.log("No users found.");
		return;
	}

	console.log(`\n${users.length} user(s):\n`);
	for (const u of users) {
		const change = u.mustChangePassword ? " [must change password]" : "";
		console.log(`  ${u.farmId.padEnd(20)} ${u.displayName ?? "-".padEnd(16)} [${u.role}]${change}`);
	}
	console.log();
}

async function createUser(args: Record<string, string>) {
	const farmId = args["--farm-id"];
	const name = args["--name"];
	const role = (args["--role"] ?? "OPERATOR").toUpperCase();
	const password = readPassword(args);
	const forceChange = forcesChange(args);

	if (!farmId || !name || !password) {
		console.error(
			"Usage: pnpm manage-user create --farm-id <id> --name <name> [--role ADMIN|OPERATOR|VIEWER] --password <value> [--no-force-change]",
		);
		process.exit(1);
	}

	const passwordCheck = validatePassword(password, forceChange ? "temporary" : "permanent");
	if (!passwordCheck.ok) {
		console.error(passwordErrorMessage(passwordCheck.code));
		process.exit(1);
	}

	if (!["ADMIN", "OPERATOR", "VIEWER"].includes(role)) {
		console.error("Role must be ADMIN, OPERATOR, or VIEWER.");
		process.exit(1);
	}

	const normalizedFarmId = farmId.trim().toLowerCase();
	const email = buildPondEmail(normalizedFarmId);

	const existing = await prisma.user.findFirst({
		where: { OR: [{ farmId: normalizedFarmId }, { email }] },
	});
	if (existing) {
		console.error(`User "${normalizedFarmId}" already exists.`);
		process.exit(1);
	}

	const supabase = createAdminClient();
	const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
	});
	if (authError) {
		console.error("Supabase auth error:", authError.message);
		process.exit(1);
	}

	const user = await prisma.$transaction(async (tx) => {
		const created = await tx.user.create({
			data: {
				supabaseId: authUser.user.id,
				farmId: normalizedFarmId,
				email,
				displayName: name,
				role: role as "ADMIN" | "OPERATOR" | "VIEWER",
				mustChangePassword: forceChange,
			},
		});
		await tx.farm.create({
			data: {
				ownerId: created.farmId,
				name: `${name || normalizedFarmId} Farm`,
			},
		});
		return created;
	});

	console.log(`\n✓ Created user: ${user.farmId} (${user.displayName}) [${user.role}]`);
	console.log(`  Login with farmId "${user.farmId}" and password "${password}"`);
	if (forceChange) {
		console.log("  The user must change this password on first login.\n");
	} else {
		console.log();
	}
}

async function resetPassword(args: Record<string, string>) {
	const farmId = args["--farm-id"];
	const password = readPassword(args);
	const forceChange = forcesChange(args);

	if (!farmId || !password) {
		console.error(
			"Usage: pnpm manage-user reset-password --farm-id <id> --password <value> [--no-force-change]",
		);
		process.exit(1);
	}

	const passwordCheck = validatePassword(password, forceChange ? "temporary" : "permanent");
	if (!passwordCheck.ok) {
		console.error(passwordErrorMessage(passwordCheck.code));
		process.exit(1);
	}

	const normalizedFarmId = farmId.trim().toLowerCase();
	const user = await prisma.user.findUnique({ where: { farmId: normalizedFarmId } });
	if (!user) {
		console.error(`User "${normalizedFarmId}" not found.`);
		process.exit(1);
	}

	const supabase = createAdminClient();
	const { error } = await supabase.auth.admin.updateUserById(user.supabaseId, {
		password,
	});
	if (error) {
		console.error("Supabase auth error:", error.message);
		process.exit(1);
	}

	await prisma.user.update({
		where: { id: user.id },
		data: { mustChangePassword: forceChange },
	});

	console.log(`\n✓ Password reset for "${user.farmId}" (${user.displayName})`);
	console.log(`  Login with farmId "${user.farmId}" and password "${password}"`);
	if (forceChange) {
		console.log("  The user must change this password on first login.\n");
	} else {
		console.log();
	}
}

async function deleteUser(args: Record<string, string>) {
	const farmId = args["--farm-id"];
	if (!farmId) {
		console.error("Usage: pnpm manage-user delete --farm-id <id>");
		process.exit(1);
	}

	const normalizedFarmId = farmId.trim().toLowerCase();
	const user = await prisma.user.findUnique({ where: { farmId: normalizedFarmId } });
	if (!user) {
		console.error(`User "${normalizedFarmId}" not found.`);
		process.exit(1);
	}

	const supabase = createAdminClient();
	await supabase.auth.admin.deleteUser(user.supabaseId);

	// Delete the farmer's whole subtree in FK-safe order:
	// event rows and devices (RESTRICT) → ponds → farm → user.
	await prisma.$transaction(async (tx) => {
		const pondIds = (
			await tx.pond.findMany({ where: { ownerId: user.farmId }, select: { id: true } })
		).map((p) => p.id);

		if (pondIds.length > 0) {
			const wherePond = { pondId: { in: pondIds } };
			const whereDevicePond = { device: { pondId: { in: pondIds } } };

			await tx.feedLevelLog.deleteMany({ where: whereDevicePond });
			await tx.feedRequest.deleteMany({ where: whereDevicePond });
			await tx.feedEvent.deleteMany({ where: whereDevicePond });
			await tx.deviceStateEvent.deleteMany({ where: whereDevicePond });
			await tx.scheduleCommand.deleteMany({ where: { OR: [whereDevicePond, wherePond] } });
			await tx.notification.deleteMany({ where: wherePond });
			await tx.fcrReport.deleteMany({ where: wherePond });
			await tx.biomassLog.deleteMany({ where: wherePond });
			await tx.feedingEvent.deleteMany({ where: whereDevicePond });
			await tx.energyDevice.deleteMany({ where: wherePond });
			await tx.device.deleteMany({ where: wherePond });
			await tx.pond.deleteMany({ where: { id: { in: pondIds } } });
		}

		await tx.farm.deleteMany({ where: { ownerId: user.farmId } });
		await tx.user.delete({ where: { id: user.id } });
	});

	console.log(`\n✓ Deleted user "${user.farmId}" (${user.displayName})\n`);
}

// ── CLI Router ──────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string> {
	const args: Record<string, string> = {};
	for (let i = 3; i < argv.length; i++) {
		if (argv[i].startsWith("--")) {
			const key = argv[i];
			const val = argv[i + 1];
			if (val && !val.startsWith("--")) {
				args[key] = val;
				i++;
			} else {
				args[key] = "true";
			}
		} else {
			args._positional = argv[i];
		}
	}
	return args;
}

async function main() {
	const command = process.argv[2];
	const args = parseArgs(process.argv);

	switch (command) {
		case "list":
			await listUsers();
			break;
		case "create":
			await createUser(args);
			break;
		case "reset-password":
			await resetPassword(args);
			break;
		case "reset-pin":
			console.warn("`reset-pin` is deprecated; use `reset-password`.");
			await resetPassword(args);
			break;
		case "delete":
			await deleteUser(args);
			break;
		default:
			console.log(`
OptiFeed User Manager

Commands:
  list                                        List all users
  create    --farm-id <id> --name <name>      Create a new user
            [--role ADMIN|OPERATOR|VIEWER]
            --password <value>
            [--no-force-change]
  reset-password --farm-id <id>               Reset a user's password
            --password <value>
            [--no-force-change]
  delete    --farm-id <id>                   Delete a user

Temporary passwords are allowed to be weak and force a change on first login.
--no-force-change requires a permanent password (8+ characters, letter + number).
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
