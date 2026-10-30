#!/usr/bin/env node
/**
 * Capture or verify the state of the restore-drill database.
 *
 * Three modes, all read-only except `--expect-empty`'s assertion (it reads):
 *
 *   node scripts/ops/snapshot-drill.mjs --label baseline --out baseline.json
 *   node scripts/ops/snapshot-drill.mjs --expect-empty --out destroyed.json
 *   node scripts/ops/snapshot-drill.mjs --roundtrip --out roundtrip.json
 *
 * A snapshot contains three independent kinds of evidence:
 *   1. every base table in `public` and its exact row count;
 *   2. schema-object counts (columns, indexes, constraints, policies, triggers,
 *      functions, sequences, enums), so a restore that loses DDL is visible;
 *   3. named invariants with literal expected values, so a bad seed fails the
 *      baseline instead of becoming the reference.
 *
 * The script exits non-zero when an invariant fails or (for `--expect-empty`)
 * when any table survived the destruction.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DRILL, DRILL_INVARIANTS } from "./drill-fixture.mjs";
import { assertDrillTarget, describeTarget, loadPrismaClient } from "./drill-guard.mjs";

function parseArgs(argv) {
	const options = {
		out: null,
		label: "snapshot",
		expectEmpty: false,
		roundtrip: false,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--out") {
			const value = argv[index + 1];
			if (!value) throw new Error("--out needs a path");
			options.out = resolve(value);
			index += 1;
		} else if (arg === "--label") {
			options.label = argv[index + 1] ?? options.label;
			index += 1;
		} else if (arg === "--expect-empty") {
			options.expectEmpty = true;
		} else if (arg === "--roundtrip") {
			options.roundtrip = true;
		} else {
			throw new Error(`unknown argument: ${arg}`);
		}
	}
	return options;
}

function quoteIdent(name) {
	return `"${String(name).replace(/"/g, '""')}"`;
}

function writeJson(path, value) {
	if (!path) return;
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function listBaseTables(prisma) {
	const rows = await prisma.$queryRawUnsafe(
		`SELECT table_name FROM information_schema.tables
		 WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
		 ORDER BY table_name`,
	);
	return rows.map((row) => String(row.table_name));
}

async function countRows(prisma, tables) {
	const counts = {};
	for (const table of tables) {
		const rows = await prisma.$queryRawUnsafe(
			`SELECT COUNT(*)::bigint AS count FROM "public".${quoteIdent(table)}`,
		);
		counts[table] = Number(rows[0]?.count ?? -1);
	}
	return counts;
}

async function schemaCounts(prisma) {
	const [row] = await prisma.$queryRawUnsafe(`
		SELECT
			(SELECT COUNT(*)::int FROM pg_class c
				JOIN pg_namespace n ON n.oid = c.relnamespace
				WHERE n.nspname = 'public' AND c.relkind = 'r') AS tables,
			(SELECT COUNT(*)::int FROM information_schema.columns
				WHERE table_schema = 'public') AS columns,
			(SELECT COUNT(*)::int FROM pg_indexes
				WHERE schemaname = 'public') AS indexes,
			(SELECT COUNT(*)::int FROM pg_constraint con
				JOIN pg_namespace n ON n.oid = con.connamespace
				WHERE n.nspname = 'public') AS constraints,
			(SELECT COUNT(*)::int FROM pg_policies
				WHERE schemaname = 'public') AS policies,
			(SELECT COUNT(*)::int FROM pg_trigger t
				JOIN pg_class c ON c.oid = t.tgrelid
				JOIN pg_namespace n ON n.oid = c.relnamespace
				WHERE n.nspname = 'public' AND NOT t.tgisinternal) AS triggers,
			(SELECT COUNT(*)::int FROM pg_proc p
				JOIN pg_namespace n ON n.oid = p.pronamespace
				WHERE n.nspname = 'public') AS functions,
			(SELECT COUNT(*)::int FROM information_schema.sequences
				WHERE sequence_schema = 'public') AS sequences,
			(SELECT COUNT(*)::int FROM pg_type t
				JOIN pg_namespace n ON n.oid = t.typnamespace
				WHERE n.nspname = 'public' AND t.typtype = 'e') AS enums
	`);

	const result = {};
	for (const key of [
		"tables",
		"columns",
		"indexes",
		"constraints",
		"policies",
		"triggers",
		"functions",
		"sequences",
		"enums",
	]) {
		result[key] = Number(row?.[key] ?? -1);
	}
	return result;
}

async function invariantValues(prisma) {
	// prisma.$queryRaw (tagged template) binds every interpolation as a query
	// parameter, so only identifiers/literals appear in the SQL text.
	const [row] = await prisma.$queryRaw`
		SELECT
			(SELECT COALESCE(SUM("grams"), 0)::numeric(12,3)::text FROM "FeedEvent"
				WHERE "deviceId" = ${DRILL.device.id}) AS feed_event_total_grams,
			(SELECT COUNT(*)::text FROM "FishSample"
				WHERE "biomassLogId" LIKE 'drill-biomass-%') AS fish_sample_count,
			(SELECT COALESCE(SUM("sampleCount"), 0)::text FROM "BiomassLog"
				WHERE "pondId" = ${DRILL.pond.id}) AS biomass_sample_total,
			(SELECT COALESCE(SUM("sampleWeightKg"), 0)::numeric(12,3)::text FROM "BiomassLog"
				WHERE "pondId" = ${DRILL.pond.id}) AS biomass_weight_total_kg,
			(SELECT COUNT(*)::text FROM "Notification"
				WHERE "pondId" = ${DRILL.pond.id} AND "read" = false) AS unread_notifications,
			(SELECT COUNT(*)::text FROM "DeviceStateEvent"
				WHERE "eventType" = 'command_failed') AS error_event_rows,
			(SELECT "metadata"->>'errorCode' FROM "DeviceStateEvent"
				WHERE "id" = ${DRILL.errorEvent.id}) AS error_event_code,
			(SELECT COUNT(*)::text FROM "CropCycle"
				WHERE "pondId" = ${DRILL.pond.id} AND "status" = 'ACTIVE') AS active_crop_cycles,
			(SELECT COUNT(*)::text FROM "PondOwnershipHistory"
				WHERE "pondId" = ${DRILL.pond.id} AND "eventType" = 'CREATED')
				AS pond_ownership_created,
			(SELECT ("tokenHash" = encode(sha256(convert_to("token", 'UTF8')), 'hex'))::text
				FROM "EnergyDevice" WHERE "id" = ${DRILL.device.id})
				AS device_token_hash_matches,
			(SELECT COUNT(*)::text FROM "Pond" p
				LEFT JOIN "Farm" f ON f."id" = p."farmId" WHERE f."id" IS NULL) AS orphan_ponds,
			(SELECT COUNT(*)::text FROM "BiomassLog" b
				LEFT JOIN "Pond" p ON p."id" = b."pondId" WHERE p."id" IS NULL)
				AS orphan_biomass_logs,
			(SELECT COUNT(*)::text FROM "FishSample" s
				LEFT JOIN "BiomassLog" b ON b."id" = s."biomassLogId" WHERE b."id" IS NULL)
				AS orphan_fish_samples,
			(SELECT COUNT(*)::text FROM "FeedEvent" e
				LEFT JOIN "EnergyDevice" d ON d."id" = e."deviceId" WHERE d."id" IS NULL)
				AS orphan_feed_events,
			(SELECT COUNT(*)::text FROM "Notification" n
				LEFT JOIN "Pond" p ON p."id" = n."pondId" WHERE p."id" IS NULL)
				AS orphan_notifications,
			(SELECT COUNT(*)::text FROM "CropCycle" c
				LEFT JOIN "Pond" p ON p."id" = c."pondId" WHERE p."id" IS NULL)
				AS orphan_crop_cycles,
			(SELECT COUNT(*)::text FROM "DeviceStateEvent" e
				LEFT JOIN "EnergyDevice" d ON d."id" = e."deviceId" WHERE d."id" IS NULL)
				AS orphan_device_state_events,
			(SELECT COUNT(*)::text FROM "Membership" m
				LEFT JOIN "Organization" o ON o."id" = m."orgId" WHERE o."id" IS NULL)
				AS orphan_memberships
	`;

	const values = {};
	for (const invariant of DRILL_INVARIANTS) {
		const raw = row?.[invariant.id];
		values[invariant.id] = raw === null || raw === undefined ? "(missing)" : String(raw);
	}
	return values;
}

function evaluateInvariants(values) {
	return DRILL_INVARIANTS.map((invariant) => ({
		id: invariant.id,
		label: invariant.label,
		expected: invariant.expected,
		value: values[invariant.id],
		pass: values[invariant.id] === invariant.expected,
	}));
}

async function captureSnapshot(prisma, target, label) {
	const [versionRow] = await prisma.$queryRawUnsafe("SELECT version() AS version");
	const tables = await listBaseTables(prisma);
	const counts = await countRows(prisma, tables);
	const schema = await schemaCounts(prisma);
	const invariantValuesById = await invariantValues(prisma);
	const invariants = evaluateInvariants(invariantValuesById);

	return {
		label,
		generatedAt: new Date().toISOString(),
		runner: {
			node: process.version,
			platform: process.platform,
		},
		database: {
			host: target.host,
			port: target.port,
			database: target.database,
		},
		postgresVersion: String(versionRow?.version ?? "unknown"),
		tables: counts,
		rowTotal: Object.values(counts).reduce((sum, count) => sum + count, 0),
		schema,
		invariants,
		invariantsPass: invariants.every((invariant) => invariant.pass),
	};
}

async function expectEmpty(prisma, target, label) {
	const tables = await listBaseTables(prisma);
	return {
		label,
		generatedAt: new Date().toISOString(),
		database: {
			host: target.host,
			port: target.port,
			database: target.database,
		},
		publicSchemaTables: tables.length,
		empty: tables.length === 0,
		unexpectedTables: tables,
	};
}

async function roundtrip(prisma, target) {
	const pond = await prisma.pond.findUnique({
		where: { id: DRILL.pond.id },
		include: {
			farm: true,
			owner: true,
			energyDevices: true,
			cropCycles: { include: { events: true } },
			biomassLogs: { include: { fishSamples: true } },
			notifications: true,
		},
	});

	const feedSum = await prisma.feedEvent.aggregate({
		where: { deviceId: DRILL.device.id },
		_sum: { grams: true },
		_count: { _all: true },
	});

	const checks = [];
	const check = (id, actual, expected) => {
		checks.push({ id, actual, expected, pass: actual === expected });
	};

	check("pond_found", pond !== null, true);
	check("farm_name", pond?.farm?.name ?? null, DRILL.farm.name);
	check("owner_login", pond?.owner?.farmId ?? null, DRILL.user.farmSlug);
	check("energy_devices", pond?.energyDevices.length ?? 0, 1);
	check("crop_cycles", pond?.cropCycles.length ?? 0, 1);
	check("crop_cycle_events", pond?.cropCycles[0]?.events.length ?? 0, 1);
	check("biomass_logs", pond?.biomassLogs.length ?? 0, 3);
	check(
		"fish_samples",
		(pond?.biomassLogs ?? []).reduce((sum, log) => sum + log.fishSamples.length, 0),
		9,
	);
	check("notifications", pond?.notifications.length ?? 0, 2);
	check("prisma_feed_event_rows", Number(feedSum._count._all), 3);
	check("prisma_feed_event_grams", Number(feedSum._sum.grams ?? 0), 750);

	return {
		label: "prisma-roundtrip",
		generatedAt: new Date().toISOString(),
		database: {
			host: target.host,
			port: target.port,
			database: target.database,
		},
		ok: checks.every((entry) => entry.pass),
		checks,
	};
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const target = assertDrillTarget();
	const PrismaClient = loadPrismaClient();
	const prisma = new PrismaClient();

	try {
		if (options.expectEmpty) {
			const result = await expectEmpty(prisma, target, options.label);
			writeJson(options.out, result);
			console.log(
				`restore drill destroy check -> ${describeTarget(target)}: ${result.publicSchemaTables} table(s) in public`,
			);
			if (!result.empty) {
				console.error(`public schema still has tables: ${result.unexpectedTables.join(", ")}`);
				process.exitCode = 1;
			}
			return;
		}

		if (options.roundtrip) {
			const result = await roundtrip(prisma, target);
			writeJson(options.out, result);
			for (const check of result.checks) {
				console.log(
					`${check.pass ? "PASS" : "FAIL"}  ${check.id}: ${String(check.actual)} (expected ${String(check.expected)})`,
				);
			}
			if (!result.ok) {
				console.error("Prisma round-trip failed against the restored database.");
				process.exitCode = 1;
			}
			return;
		}

		const snapshot = await captureSnapshot(prisma, target, options.label);
		writeJson(options.out, snapshot);
		console.log(
			`restore drill snapshot (${snapshot.label}) -> ${describeTarget(target)}: ${Object.keys(snapshot.tables).length} tables, ${snapshot.rowTotal} rows`,
		);
		for (const invariant of snapshot.invariants) {
			if (!invariant.pass) {
				console.error(`FAIL  ${invariant.id}: ${invariant.value} (expected ${invariant.expected})`);
			}
		}
		console.log(
			`invariants: ${snapshot.invariants.filter((invariant) => invariant.pass).length}/${snapshot.invariants.length} PASS`,
		);
		if (!snapshot.invariantsPass) {
			process.exitCode = 1;
		}
	} finally {
		await prisma.$disconnect();
	}
}

main().catch((error) => {
	console.error(`\n${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});
