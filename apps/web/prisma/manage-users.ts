import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

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
		console.log(`  ${u.farmId.padEnd(20)} ${u.displayName ?? "-".padEnd(16)} [${u.role}]`);
	}
	console.log();
}

async function createUser(args: Record<string, string>) {
	const farmId = args["--farm-id"];
	const name = args["--name"];
	const role = (args["--role"] ?? "OPERATOR").toUpperCase();
	const pin = args["--pin"];

	if (!farmId || !name || !pin) {
		console.error(
			"Usage: pnpm manage-user create --farm-id <id> --name <name> [--role ADMIN|OPERATOR|VIEWER] --pin <4-6 digits>",
		);
		process.exit(1);
	}

	if (!/^\d{4,6}$/.test(pin)) {
		console.error("PIN must be 4-6 digits.");
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
		password: pin,
		email_confirm: true,
	});
	if (authError) {
		console.error("Supabase auth error:", authError.message);
		process.exit(1);
	}

	const user = await prisma.user.create({
		data: {
			supabaseId: authUser.user.id,
			farmId: normalizedFarmId,
			email,
			displayName: name,
			role: role as "ADMIN" | "OPERATOR" | "VIEWER",
		},
	});

	console.log(`\n✓ Created user: ${user.farmId} (${user.displayName}) [${user.role}]`);
	console.log(`  Login with farmId "${user.farmId}" and PIN "${pin}"\n`);
}

async function resetPin(args: Record<string, string>) {
	const farmId = args["--farm-id"];
	const pin = args["--pin"];

	if (!farmId || !pin) {
		console.error("Usage: pnpm manage-user reset-pin --farm-id <id> --pin <4-6 digits>");
		process.exit(1);
	}

	if (!/^\d{4,6}$/.test(pin)) {
		console.error("PIN must be 4-6 digits.");
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
		password: pin,
	});
	if (error) {
		console.error("Supabase auth error:", error.message);
		process.exit(1);
	}

	console.log(`\n✓ PIN reset for "${user.farmId}" (${user.displayName})`);
	console.log(`  Login with farmId "${user.farmId}" and PIN "${pin}"\n`);
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
	await prisma.user.delete({ where: { farmId: normalizedFarmId } });

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
		case "reset-pin":
			await resetPin(args);
			break;
		case "delete":
			await deleteUser(args);
			break;
		default:
			console.log(`
OptiFeed User Manager

Commands:
  list                                    List all users
  create    --farm-id <id> --name <name>  Create a new user
            [--role ADMIN|OPERATOR|VIEWER]
            --pin <4-6 digits>
  reset-pin --farm-id <id>               Reset a user's PIN
            --pin <4-6 digits>
  delete    --farm-id <id>               Delete a user
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
