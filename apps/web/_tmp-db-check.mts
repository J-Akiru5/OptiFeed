import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
	const m = line.match(/^([A-Z_]+)=(.*)$/);
	if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const p = new PrismaClient();

const migrations = await p.$queryRawUnsafe<
	{ migration_name: string; finished: boolean; applied_steps_count: number }[]
>(
	"SELECT migration_name, finished_at IS NOT NULL AS finished, applied_steps_count FROM _prisma_migrations ORDER BY started_at",
);
console.log("=== _prisma_migrations ===");
for (const r of migrations) {
	console.log(`${r.migration_name} | finished: ${r.finished} | steps: ${r.applied_steps_count}`);
}

const cols = await p.$queryRawUnsafe<{ column_name: string }[]>(
	"SELECT column_name FROM information_schema.columns WHERE table_name = 'EnergyDevice' ORDER BY ordinal_position",
);
console.log("\n=== EnergyDevice columns ===");
console.log(cols.map((c) => c.column_name).join(", "));

const feedEventCols = await p.$queryRawUnsafe<{ column_name: string }[]>(
	"SELECT column_name FROM information_schema.columns WHERE table_name = 'FeedEvent' ORDER BY ordinal_position",
);
console.log("\n=== FeedEvent columns ===");
console.log(feedEventCols.map((c) => c.column_name).join(", "));

const devices = await p.energyDevice.findMany({
	select: { id: true, label: true, pondId: true },
});
console.log("\n=== EnergyDevice rows ===");
console.log(JSON.stringify(devices, null, 1));

const tables = await p.$queryRawUnsafe<{ table_name: string }[]>(
	"SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
);
console.log("\n=== tables ===");
console.log(tables.map((t) => t.table_name).join(", "));

const indexes = await p.$queryRawUnsafe<{ indexname: string }[]>(
	"SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND (indexname LIKE '%FeedEvent%' OR indexname LIKE '%BiomassLog%') ORDER BY indexname",
);
console.log("\n=== relevant indexes ===");
console.log(indexes.map((i) => i.indexname).join(", "));

await p.$disconnect();
