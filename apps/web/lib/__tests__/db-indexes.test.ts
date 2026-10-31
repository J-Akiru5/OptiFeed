import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #338/#339: the two performance indexes must exist in both places Prisma
 * reads: the schema (so a future `migrate dev` keeps them) and a committed
 * additive migration (so `migrate deploy` creates them). No database is
 * reachable here; this pins the DDL, it does not prove a query plan.
 */

const WEB_ROOT = join(__dirname, "..", "..");
const schema = readFileSync(join(WEB_ROOT, "prisma", "schema.prisma"), "utf8");

function model(name: string, next: string): string {
	const start = schema.indexOf(`model ${name} {`);
	const end = schema.indexOf(`model ${next} {`);
	expect(start, `${name} model`).toBeGreaterThan(-1);
	expect(end, `${next} model`).toBeGreaterThan(start);
	return schema.slice(start, end);
}

function migration(name: string): string {
	const path = join(WEB_ROOT, "prisma", "migrations", name, "migration.sql");
	expect(existsSync(path), `${name} must exist`).toBe(true);
	return readFileSync(path, "utf8");
}

describe("performance indexes (#338, #339)", () => {
	it("declares FeedEvent(eventType, receivedAt) in the schema", () => {
		expect(model("FeedEvent", "FeedRequest")).toContain("@@index([eventType, receivedAt])");
	});

	it("creates FeedEvent(eventType, receivedAt) with an additive, lock-noted migration", () => {
		const sql = migration("20261031010000_add_feed_event_event_type_received_at_index");
		expect(sql).toContain(
			'CREATE INDEX IF NOT EXISTS "FeedEvent_eventType_receivedAt_idx" ON "FeedEvent"("eventType", "receivedAt")',
		);
		// Project convention: no CONCURRENTLY inside a Prisma migration. The
		// comment above explains why; only executable lines are checked.
		const ddl = sql
			.split("\n")
			.filter((line) => !line.trimStart().startsWith("--"))
			.join("\n");
		expect(ddl.toUpperCase()).not.toContain("CONCURRENTLY");
		expect(sql).toMatch(/SHARE lock/i);
	});

	it("declares and creates EnergyDevice(pondId)", () => {
		expect(model("EnergyDevice", "FeedEvent")).toContain("@@index([pondId])");
		const sql = migration("20261031020000_add_energy_device_pond_id_index");
		expect(sql).toContain(
			'CREATE INDEX IF NOT EXISTS "EnergyDevice_pondId_idx" ON "EnergyDevice"("pondId")',
		);
	});
});
