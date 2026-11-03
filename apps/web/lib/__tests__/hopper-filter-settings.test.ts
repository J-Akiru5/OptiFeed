import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The hopper filter tuning (issue #659).
 *
 * Seven `hopper_*` keys guarded the ultrasonic reading but were firmware-only:
 * `editable: false`, never overlaid, so a bouncing sensor could only be adapted
 * with a new build. These checks pin what makes the new control safe:
 *  - the dashboard envelope is the firmware's own, parsed from `config.h`;
 *  - the write is guarded and audited like the neighbouring calibration;
 *  - the raw distance the operator calibrates against is the stored device
 *    value, scoped to the caller's farm.
 */

const { db, mocks } = vi.hoisted(() => {
	const db = {
		energyDevice: { findFirst: vi.fn(), update: vi.fn() },
		deviceStateEvent: { create: vi.fn(), findFirst: vi.fn() },
		$transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
	};
	return {
		db,
		mocks: {
			requireWriteAccess: vi.fn(),
			requirePermission: vi.fn(),
			revalidatePath: vi.fn(),
		},
	};
});

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth/session", () => ({
	getCurrentPondOwnerId: vi.fn(async () => "farm-1"),
	requireWriteAccess: mocks.requireWriteAccess,
}));
vi.mock("@/lib/auth/permissions", () => ({
	requirePermission: mocks.requirePermission,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { saveHopperFilterSettings } from "@/lib/actions/energy";
import { FIRMWARE_FIELDS, firmwareField } from "@/lib/firmware/config";
import {
	HOPPER_FILTER_CHANGED_EVENT,
	HOPPER_FILTER_COLUMNS,
	HOPPER_FILTER_FORM_FIELDS,
	type HopperFilterColumns,
	type HopperFilterKey,
	type HopperFilterValues,
	hopperFilterDefaults,
	hopperFilterOverrides,
	hopperFilterSchema,
	resolveHopperFilterValues,
} from "@/lib/firmware/hopper-filter";

const cwd = process.cwd();
const repoRoot = existsSync(join(cwd, "firmware")) ? cwd : join(cwd, "..", "..");
// Strip the macro's backslash line continuations so one regex reads every entry.
const firmwareHeader = readFileSync(
	join(repoRoot, "firmware/firmware-main/config.h"),
	"utf8",
).replace(/\\\r?\n/g, " ");

const FILTER_KEYS = Object.keys(HOPPER_FILTER_COLUMNS) as HopperFilterKey[];

/** The values a save sends: the firmware defaults, one decimal where needed. */
const DEFAULTS: HopperFilterValues = Object.fromEntries(
	FILTER_KEYS.map((key) => [key, firmwareField(key)?.defaultValue ?? 0]),
) as HopperFilterValues;

function columns(
	overrides: Partial<HopperFilterColumns> = {},
): HopperFilterColumns & { id: string } {
	const base = { ...overrides } as HopperFilterColumns;
	for (const key of FILTER_KEYS) {
		const column = HOPPER_FILTER_COLUMNS[key];
		if (!(column in base)) base[column] = null;
	}
	return { id: "device-1", ...base };
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.requireWriteAccess.mockResolvedValue(undefined);
	mocks.requirePermission.mockResolvedValue(undefined);
	db.energyDevice.findFirst.mockResolvedValue(columns());
	db.energyDevice.update.mockResolvedValue({});
	db.deviceStateEvent.create.mockResolvedValue({});
});

describe("the field table and the firmware cannot drift", () => {
	it("maps every filter field onto exactly one device column", () => {
		expect(FILTER_KEYS).toHaveLength(7);
		for (const key of FILTER_KEYS) {
			expect(
				FIRMWARE_FIELDS.some((field) => field.id === key),
				key,
			).toBe(true);
			expect(key in HOPPER_FILTER_COLUMNS, key).toBe(true);
		}
		expect(HOPPER_FILTER_FORM_FIELDS.map((field) => field.id)).toEqual(FILTER_KEYS);
	});

	it("keeps every filter field out of the platform gate form", () => {
		// `editable` is the superadmin gate flag: these are per device.
		for (const key of FILTER_KEYS) {
			const field = firmwareField(key);
			expect(field?.editable, key).toBe(false);
			expect(field?.surface, key).toBe("hopper_filter");
		}
	});

	it.each(FILTER_KEYS)("mirrors config.h for %s", (key) => {
		// X(camelName, "json_key", min, max, integer, default)
		const jsonKey = firmwareField(key)?.key;
		const pattern = new RegExp(
			`X\\(\\w+,\\s*"${jsonKey}",\\s*(-?\\d+(?:\\.\\d+)?)f,\\s*(-?\\d+(?:\\.\\d+)?)f,\\s*(true|false),\\s*(-?\\d+(?:\\.\\d+)?)f`,
		);
		const match = firmwareHeader.match(pattern);
		expect(match, `config.h must declare ${jsonKey}`).not.toBeNull();
		const field = firmwareField(key);
		expect(Number(match?.[1])).toBe(field?.min);
		expect(Number(match?.[2])).toBe(field?.max);
		expect(match?.[3] === "true").toBe(field?.integer);
		expect(Number(match?.[4])).toBe(field?.defaultValue);
	});
});

describe("hopperFilterSchema", () => {
	it("accepts the firmware defaults and the envelope edges", () => {
		expect(hopperFilterSchema.safeParse(DEFAULTS).success).toBe(true);

		const edges = Object.fromEntries(
			FILTER_KEYS.map((key) => [key, firmwareField(key)?.min ?? 0]),
		) as HopperFilterValues;
		expect(hopperFilterSchema.safeParse(edges).success).toBe(true);
	});

	it("refuses a value outside the firmware envelope", () => {
		const tooSmall = { ...DEFAULTS, hopper_ema_alpha: 0.01 };
		const tooBig = { ...DEFAULTS, hopper_jump_pct: 101 };
		expect(hopperFilterSchema.safeParse(tooSmall).success).toBe(false);
		expect(hopperFilterSchema.safeParse(tooBig).success).toBe(false);
	});

	it("refuses a fractional value in a whole-number field", () => {
		const result = hopperFilterSchema.safeParse({ ...DEFAULTS, hopper_persist_cycles: 2.5 });
		expect(result.success).toBe(false);
	});

	it("requires the full set and refuses unknown keys", () => {
		const { hopper_jump_pct: _omitted, ...partial } = DEFAULTS;
		expect(hopperFilterSchema.safeParse(partial).success).toBe(false);
		expect(hopperFilterSchema.safeParse({ ...DEFAULTS, hopper_not_a_field: 1 }).success).toBe(
			false,
		);
	});
});

describe("stored columns", () => {
	it("turns a null column into 'no override' and keeps the rest", () => {
		expect(hopperFilterOverrides(columns({ hopperEmaAlpha: 0.2 }))).toEqual({
			hopper_ema_alpha: 0.2,
		});
	});

	it("shows the firmware default until a value is written", () => {
		const values = resolveHopperFilterValues(columns({ hopperJumpPct: 25 }));
		expect(values.hopper_jump_pct).toBe(25);
		expect(values.hopper_ema_alpha).toBe(0.35);
		expect(hopperFilterDefaults(columns({ hopperJumpPct: 25 })).usingDefaults).not.toContain(
			"hopper_jump_pct",
		);
		expect(hopperFilterDefaults(columns()).usingDefaults).toHaveLength(FILTER_KEYS.length);
	});
});

describe("saveHopperFilterSettings", () => {
	it("requires write access before reading anything", async () => {
		mocks.requireWriteAccess.mockRejectedValue(new Error("read only"));

		const result = await saveHopperFilterSettings("device-1", DEFAULTS);

		expect(result.success).toBe(false);
		expect(db.energyDevice.findFirst).not.toHaveBeenCalled();
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it("uses the revocable manage_schedule permission like the calibration", async () => {
		await saveHopperFilterSettings("device-1", DEFAULTS);
		expect(mocks.requirePermission).toHaveBeenCalledWith("manage_schedule");
	});

	it("refuses an out-of-envelope value before touching the device", async () => {
		const result = await saveHopperFilterSettings("device-1", {
			...DEFAULTS,
			hopper_reject_below_cm: 51,
		});

		expect(result.success).toBe(false);
		expect(db.energyDevice.findFirst).not.toHaveBeenCalled();
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it("refuses a device outside the caller's farm", async () => {
		db.energyDevice.findFirst.mockResolvedValue(null);

		const result = await saveHopperFilterSettings("device-9", DEFAULTS);

		expect(result).toEqual({ success: false, error: "Device not found" });
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it("writes the columns, records the change and revalidates", async () => {
		const result = await saveHopperFilterSettings("device-1", {
			...DEFAULTS,
			hopper_ema_alpha: 0.2,
			hopper_persist_cycles: 5,
		});

		expect(result).toEqual({
			success: true,
			values: { ...DEFAULTS, hopper_ema_alpha: 0.2, hopper_persist_cycles: 5 },
		});
		expect(db.energyDevice.findFirst).toHaveBeenCalledWith({
			where: { id: "device-1", pond: { ownerId: "farm-1" } },
			select: expect.objectContaining({ id: true, hopperEmaAlpha: true }),
		});
		expect(db.energyDevice.update).toHaveBeenCalledWith({
			where: { id: "device-1" },
			data: expect.objectContaining({
				hopperEmaAlpha: 0.2,
				hopperPersistCycles: 5,
				hopperRejectBelowCm: 2,
			}),
		});
		expect(db.deviceStateEvent.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				deviceId: "device-1",
				eventType: HOPPER_FILTER_CHANGED_EVENT,
				source: "user",
				actorId: "farm-1",
				metadata: expect.objectContaining({
					before: expect.objectContaining({ hopper_ema_alpha: null }),
					after: expect.objectContaining({ hopper_ema_alpha: 0.2 }),
				}),
			}),
		});
		expect(mocks.revalidatePath).toHaveBeenCalledWith(
			"/[locale]/(dashboard)/dashboard/settings/hardware",
			"page",
		);
	});

	it("returns a generic error when the transaction fails", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		db.$transaction.mockRejectedValueOnce(new Error("db down"));

		const result = await saveHopperFilterSettings("device-1", DEFAULTS);

		expect(result).toEqual({ success: false, error: "Failed to save the hopper filter settings" });
		consoleError.mockRestore();
	});
});
