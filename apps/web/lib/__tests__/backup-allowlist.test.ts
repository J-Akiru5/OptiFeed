import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));

import {
	BACKUP_TABLES,
	EXCLUDED_TABLES,
	columnKind,
	findBackupTable,
	tablesForScope,
	writtenColumns,
} from "@/lib/backup/tables";

/**
 * The allow-list guard (issue #353).
 *
 * The export must never discover a table or a column at runtime. These tests
 * compare the allow-list with the generated Prisma data model, so adding a
 * column or a table fails here until someone writes down the decision:
 * export it, redact it, omit it with a reason, or exclude the whole table.
 */

type DmmfModel = {
	name: string;
	fields: {
		name: string;
		kind: string;
		type: string;
		isList: boolean;
		nativeType?: [string, string[]] | null;
	}[];
};
type DmmfField = DmmfModel["fields"][number];

const MODELS = Prisma.dmmf.datamodel.models as unknown as DmmfModel[];

function columnsOf(model: DmmfModel): DmmfField[] {
	return model.fields.filter((field) => field.kind !== "object");
}

/** The allow-list entry for a model, if it is exported. */
function tableFor(modelName: string) {
	return BACKUP_TABLES.find((table) => table.name === modelName);
}

const FORBIDDEN = [
	"token",
	"tokenHash",
	"password",
	"passwordHash",
	"secret",
	"session",
	"sessionToken",
	"accessToken",
	"refreshToken",
	"apiKey",
	"privateKey",
];

/**
 * Foreign keys the restore relies on. `nullable` keys may be null, which is why
 * the restore check treats a null reference as "no row required".
 */
const FOREIGN_KEYS: Record<string, { column: string; table: string; nullable?: boolean }[]> = {
	Farm: [{ column: "ownerId", table: "User" }],
	Pond: [
		{ column: "ownerId", table: "User", nullable: true },
		{ column: "farmId", table: "Farm" },
	],
	CropCycle: [{ column: "pondId", table: "Pond" }],
	PondEvent: [
		{ column: "pondId", table: "Pond" },
		{ column: "cropCycleId", table: "CropCycle", nullable: true },
	],
	PondOwnershipHistory: [{ column: "pondId", table: "Pond" }],
	BiomassLog: [{ column: "pondId", table: "Pond" }],
	FishSample: [{ column: "biomassLogId", table: "BiomassLog" }],
	FcrReport: [{ column: "pondId", table: "Pond" }],
	Notification: [{ column: "pondId", table: "Pond" }],
	Device: [{ column: "pondId", table: "Pond" }],
	EnergyDevice: [{ column: "pondId", table: "Pond", nullable: true }],
	PondSettingsDraft: [
		{ column: "pondId", table: "Pond" },
		{ column: "userId", table: "User" },
		{ column: "deviceId", table: "EnergyDevice", nullable: true },
	],
	FeedingEvent: [{ column: "deviceId", table: "Device" }],
	FeedEvent: [{ column: "deviceId", table: "EnergyDevice" }],
	FeedRequest: [{ column: "deviceId", table: "EnergyDevice" }],
	DeviceStateEvent: [{ column: "deviceId", table: "EnergyDevice" }],
	ScheduleCommand: [
		{ column: "deviceId", table: "EnergyDevice" },
		{ column: "pondId", table: "Pond" },
	],
	FeedLevelLog: [{ column: "deviceId", table: "EnergyDevice" }],
	WaterTempLog: [{ column: "deviceId", table: "EnergyDevice" }],
	CalibrationRun: [{ column: "deviceId", table: "EnergyDevice" }],
};

describe("export allow-list", () => {
	it("decides every Prisma model exactly once", () => {
		const decided = new Set([
			...BACKUP_TABLES.map((table) => table.name),
			...Object.keys(EXCLUDED_TABLES),
		]);
		const undecided = MODELS.filter((model) => !decided.has(model.name)).map((model) => model.name);
		const unknown = [...decided].filter((name) => !MODELS.some((model) => model.name === name));

		expect(undecided, `models with no export decision: ${undecided.join(", ")}`).toEqual([]);
		expect(unknown, `allow-list names that are not models: ${unknown.join(", ")}`).toEqual([]);

		const overlap = BACKUP_TABLES.map((table) => table.name).filter(
			(name) => name in EXCLUDED_TABLES,
		);
		expect(overlap, `models both exported and excluded: ${overlap.join(", ")}`).toEqual([]);
	});

	for (const model of MODELS) {
		const table = tableFor(model.name);
		if (!table) continue;

		it(`${model.name}: every column is exported, placeheld or omitted with a reason`, () => {
			const written = new Set(writtenColumns(table));
			const omitted = new Set((table.omitted ?? []).map((entry) => entry.column));

			const modelColumns = columnsOf(model).map((field) => field.name);
			const unaccounted = modelColumns.filter(
				(column) => !written.has(column) && !omitted.has(column),
			);
			expect(
				unaccounted,
				`${model.name} columns with no export decision: ${unaccounted.join(", ")}`,
			).toEqual([]);

			const stale = [...written, ...omitted].filter((column) => !modelColumns.includes(column));
			expect(
				stale,
				`${model.name} allow-list names that no longer exist: ${stale.join(", ")}`,
			).toEqual([]);

			const both = [...written].filter((column) => omitted.has(column));
			expect(both, `${model.name} columns both written and omitted: ${both.join(", ")}`).toEqual(
				[],
			);
		});

		it(`${model.name}: every allow-listed name is unique`, () => {
			const all = writtenColumns(table);
			expect(new Set(all).size).toBe(all.length);
		});

		it(`${model.name}: JSON and array metadata matches the schema`, () => {
			const byName = new Map(columnsOf(model).map((field) => [field.name, field]));
			for (const column of table.jsonColumns ?? []) {
				expect(byName.get(column)?.type, `${model.name}.${column} is not Json`).toBe("Json");
			}
			for (const column of table.arrayColumns ?? []) {
				expect(byName.get(column)?.isList, `${model.name}.${column} is not a list`).toBe(true);
			}
			for (const column of table.columns) {
				const field = byName.get(column);
				if (field?.type === "Json") {
					expect(
						table.jsonColumns ?? [],
						`${model.name}.${column} must be listed as JSON`,
					).toContain(column);
				}
				if (field?.isList) {
					expect(
						(table.arrayColumns ?? []).includes(column),
						`${model.name}.${column} must be listed as an array`,
					).toBe(true);
				}
			}
		});

		it(`${model.name}: time and date columns are declared`, () => {
			const byName = new Map(columnsOf(model).map((field) => [field.name, field]));
			for (const column of table.timeColumns ?? []) {
				expect(byName.get(column)?.nativeType?.[0], `${model.name}.${column} is not a time`).toBe(
					"Time",
				);
			}
			for (const column of table.dateColumns ?? []) {
				expect(byName.get(column)?.nativeType?.[0], `${model.name}.${column} is not a date`).toBe(
					"Date",
				);
			}
			for (const column of table.columns) {
				const native = byName.get(column)?.nativeType?.[0];
				if (native === "Time") {
					expect(
						(table.timeColumns ?? []).includes(column),
						`${model.name}.${column} must be listed as a time column`,
					).toBe(true);
				}
				if (native === "Date") {
					expect(
						(table.dateColumns ?? []).includes(column),
						`${model.name}.${column} must be listed as a date column`,
					).toBe(true);
				}
			}
		});
	}

	it("never exports a credential column, except the redacted device token placeholder", () => {
		for (const table of BACKUP_TABLES) {
			for (const column of writtenColumns(table)) {
				if (!FORBIDDEN.includes(column)) continue;
				const placeholder = (table.placeholders ?? []).some((entry) => entry.column === column);
				expect(
					placeholder && table.name === "EnergyDevice" && column === "token",
					`${table.name}.${column} is a credential and must not be exported`,
				).toBe(true);
			}
		}
	});

	it("redacts the device token to a non-usable placeholder and omits its hash", () => {
		const device = findBackupTable("EnergyDevice");
		expect(device).toBeDefined();
		const placeholder = device?.placeholders?.find((entry) => entry.column === "token");
		expect(placeholder?.value({ id: "dev-1" })).toBe("redacted:dev-1");
		expect(device?.omitted?.map((entry) => entry.column)).toContain("tokenHash");
	});

	it("lists tables in foreign-key-safe restore order", () => {
		const order = new Map(BACKUP_TABLES.map((table, index) => [table.name, index]));
		const problems: string[] = [];

		for (const [tableName, keys] of Object.entries(FOREIGN_KEYS)) {
			const tableIndex = order.get(tableName);
			expect(tableIndex, `${tableName} is missing from the export`).toBeDefined();
			for (const key of keys) {
				const targetIndex = order.get(key.table);
				expect(targetIndex, `missing referenced table ${key.table}`).toBeDefined();
				if ((tableIndex ?? 0) < (targetIndex ?? 0)) {
					problems.push(`${tableName}.${key.column} -> ${key.table}`);
				}
				expect(tableFor(tableName)?.columns, `${tableName} must export ${key.column}`).toContain(
					key.column,
				);
			}
		}

		expect(problems, `references before their target: ${problems.join(", ")}`).toEqual([]);
	});

	it("fails a tenant export closed for platform-only tables", () => {
		const platformOnly = BACKUP_TABLES.filter((table) => table.scope === "platform");
		expect(platformOnly.length).toBeGreaterThan(0);

		const emptyTenant = {
			kind: "tenant" as const,
			orgIds: [],
			orgNames: [],
			memberUserIds: [],
			farmIds: [],
			pondIds: [],
			membershipIds: [],
		};
		for (const table of platformOnly) {
			const where = JSON.stringify(table.tenantWhere(emptyTenant));
			expect(where.includes('"in":[]'), `${table.name} must match nothing for a tenant`).toBe(true);
		}
	});

	it("selects the table groups the routes ask for", () => {
		expect(tablesForScope("platform")).toEqual(BACKUP_TABLES);
		const tenant = tablesForScope("tenant");
		expect(tenant.every((table) => table.scope === "tenant")).toBe(true);
		expect(tenant.length).toBeLessThan(BACKUP_TABLES.length);
	});

	it("resolves JSON, array, time, date and scalar columns", () => {
		const pond = findBackupTable("Pond");
		const event = findBackupTable("PondEvent");
		const schedule = findBackupTable("ScheduleCommand");
		const cycle = findBackupTable("CropCycle");
		expect(pond && columnKind(pond, "notificationPrefs")).toBe("json");
		expect(event && columnKind(event, "completedOccurrences")).toBe("list");
		expect(schedule && columnKind(schedule, "scheduleStart")).toBe("time");
		expect(cycle && columnKind(cycle, "stockingDate")).toBe("date");
		expect(pond && columnKind(pond, "name")).toBe("scalar");
	});

	it("documents a reason for every excluded table", () => {
		for (const reason of Object.values(EXCLUDED_TABLES)) {
			expect(reason.length).toBeGreaterThan(20);
		}
	});
});
