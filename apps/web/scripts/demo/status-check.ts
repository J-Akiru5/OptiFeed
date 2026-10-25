import { loadEnvFile } from "node:process";
import { PrismaClient } from "@prisma/client";

try {
	loadEnvFile(".env");
} catch {}

const prisma = new PrismaClient();
const DEVICE_MAC = process.env.DEMO_DEVICE_MAC ?? "DE:AD:DE:MO:00:01";
const DEMO_SUPABASE_ID = process.env.DEMO_SUPABASE_ID ?? "demo-supabase-user-001";
const OFFLINE_MS = 15 * 60 * 1000;

const results: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail = "") {
	results.push({ name, ok, detail });
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function main() {
	console.log("Demo status check\n");

	const user = await prisma.user.findUnique({ where: { supabaseId: DEMO_SUPABASE_ID } });
	check(
		"demo user exists with demo identity",
		Boolean(user) && user?.farmId === "demo-farmer-1" && user?.role === "ADMIN",
		user ? `${user.farmId} / ${user.role}` : "missing",
	);

	const device = await prisma.energyDevice.findUnique({
		where: { mac: DEVICE_MAC },
		include: { pond: true },
	});
	check("demo device exists", Boolean(device), DEVICE_MAC);

	if (!device) {
		summarise();
		return;
	}

	const age = device.lastSeenAt
		? Date.now() - device.lastSeenAt.getTime()
		: Number.POSITIVE_INFINITY;
	check(
		"heartbeat fresh (online window < 15 min)",
		age < OFFLINE_MS,
		Number.isFinite(age) ? `${Math.round(age / 1000)}s ago` : "never seen",
	);
	check("device is not paused", device.isPaused === false);
	check(
		"hopper level is healthy (>= 20%)",
		(device.feedLevelPercent ?? 0) >= 20,
		`${device.feedLevelPercent ?? "unknown"}%`,
	);
	check("water temperature probe reported ok", device.waterTempOk === true);

	const unread = await prisma.notification.count({
		where: { pondId: device.pondId ?? undefined, read: false },
	});
	check("no unread notifications", unread === 0, `${unread} unread`);

	const activeCycle = device.pondId
		? await prisma.cropCycle.findFirst({ where: { pondId: device.pondId, status: "ACTIVE" } })
		: null;
	check("active grow-out cycle exists", Boolean(activeCycle), activeCycle?.label ?? "none");

	const upcoming = device.pondId
		? await prisma.pondEvent.count({
				where: {
					pondId: device.pondId,
					status: "PLANNED",
					startsAt: { gte: new Date() },
				},
			})
		: 0;
	check("upcoming pond events exist", upcoming > 0, `${upcoming} planned`);

	summarise();
}

function summarise() {
	const failed = results.filter((item) => !item.ok);
	console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
	if (failed.length > 0) {
		console.log(`\nNot online yet:\n${failed.map((item) => `  - ${item.name}`).join("\n")}`);
		console.log("Start the heartbeat: node scripts/demo/heartbeat.mjs");
		process.exitCode = 1;
	}
}

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
