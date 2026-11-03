import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, tx } = vi.hoisted(() => {
	const tx = {
		platformSetting: { findUnique: vi.fn(), upsert: vi.fn() },
		platformAuditLog: { create: vi.fn() },
	};
	const db = {
		platformAdmin: { findUnique: vi.fn() },
		platformSetting: { findUnique: vi.fn(), findMany: vi.fn() },
		$transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
	};
	return { db, tx };
});

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth/require-platform-admin", () => ({ requirePlatformAdmin: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
	getCurrentUser: vi.fn(async () => ({ id: "admin-1", farmId: "superadmin" })),
}));
vi.mock("next/headers", () => ({
	headers: vi.fn(
		async () => new Headers({ "x-forwarded-for": "203.0.113.5", "user-agent": "vitest-ota" }),
	),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { setFirmwareOtaPolicy } from "@/lib/actions/platform/settings";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import {
	FIRMWARE_GATES_SETTING_KEY,
	FIRMWARE_OTA_FIELDS,
	FIRMWARE_OTA_POLICY_AUDIT_ACTION,
	FIRMWARE_OTA_POLICY_IDS,
	otaPolicyValues,
} from "@/lib/firmware/config";
import {
	type OtaDeviceReport,
	otaConfirmationState,
	summarizeOtaPolicy,
} from "@/lib/settings/ota-policy";

/**
 * #660: the OTA rollout policy surface.
 *
 * The ten `ota_*` keys are settable on the device but had no dashboard surface.
 * These tests pin the three things that make the surface safe: only the ten
 * ids are accepted, the rollout window is validated as a pair (the firmware
 * rejects the whole config otherwise), and the write is a platform action with
 * one audit row carrying before/after.
 */

const mockGate = vi.mocked(requirePlatformAdmin);

const REASON = "Confine the rollout to the night window";

const POLICY = {
	ota_check_interval_s: 3600,
	ota_min_uptime_s: 900,
	ota_min_rssi_dbm: -70,
	ota_feed_guard_min: 30,
	ota_window_start_min: 540,
	ota_window_end_min: 600,
	ota_min_free_heap_bytes: 80000,
	ota_no_data_timeout_ms: 120000,
	ota_download_timeout_ms: 600000,
	ota_health_check_timeout_ms: 240000,
};

beforeEach(() => {
	vi.clearAllMocks();
	mockGate.mockResolvedValue(undefined);
	db.platformAdmin.findUnique.mockResolvedValue(null);
	tx.platformSetting.findUnique.mockResolvedValue(null);
	tx.platformSetting.upsert.mockResolvedValue({});
	tx.platformAuditLog.create.mockResolvedValue({});
});

describe("OTA policy fields", () => {
	it("is exactly the ten firmware keys, in display order", () => {
		expect(FIRMWARE_OTA_POLICY_IDS).toEqual([
			"ota_check_interval_s",
			"ota_min_uptime_s",
			"ota_min_rssi_dbm",
			"ota_feed_guard_min",
			"ota_window_start_min",
			"ota_window_end_min",
			"ota_min_free_heap_bytes",
			"ota_no_data_timeout_ms",
			"ota_download_timeout_ms",
			"ota_health_check_timeout_ms",
		]);
		expect(FIRMWARE_OTA_FIELDS).toHaveLength(10);
	});

	it("is owned by the OTA form, not the feed-safety gate form", () => {
		for (const field of FIRMWARE_OTA_FIELDS) {
			expect(field.surface, field.id).toBe("ota");
			expect(field.editable, field.id).toBe(false);
			expect(field.group, field.id).toBe("runtime");
		}
	});

	it("picks only the policy values out of the whole stored config", () => {
		const values = otaPolicyValues({
			...Object.fromEntries(FIRMWARE_OTA_POLICY_IDS.map((id) => [id, 1])),
			min_dispense_gap_s: 30,
			heartbeat_interval_s: 5,
		});

		expect(Object.keys(values)).toEqual([...FIRMWARE_OTA_POLICY_IDS]);
		expect(values).not.toHaveProperty("min_dispense_gap_s");
	});
});

describe("setFirmwareOtaPolicy", () => {
	it("saves the ten values and writes one audit row with before/after", async () => {
		const result = await setFirmwareOtaPolicy(POLICY, REASON);

		expect(result).toEqual({ success: true, value: expect.objectContaining(POLICY) });
		expect(tx.platformSetting.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { key: FIRMWARE_GATES_SETTING_KEY },
				update: expect.objectContaining({ value: expect.objectContaining(POLICY) }),
			}),
		);
		expect(tx.platformAuditLog.create).toHaveBeenCalledTimes(1);
		expect(tx.platformAuditLog.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					action: FIRMWARE_OTA_POLICY_AUDIT_ACTION,
					targetId: FIRMWARE_GATES_SETTING_KEY,
					reason: REASON,
				}),
			}),
		);
	});

	it("preserves feed-safety gates already stored in the same row", async () => {
		tx.platformSetting.findUnique.mockResolvedValue({
			value: { min_dispense_gap_s: 30, safe_mode_quiet_s: 2400 },
		});

		await setFirmwareOtaPolicy({ ota_check_interval_s: 3600 }, REASON);

		const saved = (tx.platformSetting.upsert.mock.calls[0][0] as { update: { value: object } })
			.update.value;
		expect(saved).toMatchObject({
			ota_check_interval_s: 3600,
			min_dispense_gap_s: 30,
			safe_mode_quiet_s: 2400,
		});
	});

	it("refuses an id that is not part of the OTA policy", async () => {
		const result = await setFirmwareOtaPolicy({ min_dispense_gap_s: 20 }, REASON);

		expect(result).toEqual({ error: expect.stringContaining("not an OTA rollout policy") });
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it("refuses a value outside the firmware envelope", async () => {
		const result = await setFirmwareOtaPolicy({ ota_min_rssi_dbm: -10 }, REASON);

		expect(result).toEqual({ error: expect.stringContaining("ota_min_rssi_dbm") });
		expect(tx.platformSetting.upsert).not.toHaveBeenCalled();
	});

	it("refuses a fractional value in a whole-number field", async () => {
		const result = await setFirmwareOtaPolicy({ ota_check_interval_s: 3600.5 }, REASON);

		expect(result).toEqual({ error: expect.stringContaining("whole number") });
	});

	it("refuses an inverted rollout window instead of repairing it", async () => {
		const result = await setFirmwareOtaPolicy(
			{ ota_window_start_min: 900, ota_window_end_min: 600 },
			REASON,
		);

		expect(result).toEqual({ error: expect.stringContaining("start before it ends") });
		expect(tx.platformSetting.upsert).not.toHaveBeenCalled();
		expect(tx.platformAuditLog.create).not.toHaveBeenCalled();
	});

	it("refuses a partial update that inverts the window against a stored value", async () => {
		tx.platformSetting.findUnique.mockResolvedValue({
			value: { ota_window_start_min: 900, ota_window_end_min: 1200 },
		});

		const result = await setFirmwareOtaPolicy({ ota_window_end_min: 600 }, REASON);

		expect(result).toEqual({ error: expect.stringContaining("start before it ends") });
		expect(tx.platformSetting.upsert).not.toHaveBeenCalled();
	});

	it("refuses a zero-length rollout window", async () => {
		const result = await setFirmwareOtaPolicy(
			{ ota_window_start_min: 600, ota_window_end_min: 600 },
			REASON,
		);

		expect(result).toEqual({ error: expect.stringContaining("start before it ends") });
	});

	it("requires a reason of at least ten characters", async () => {
		const result = await setFirmwareOtaPolicy({ ota_check_interval_s: 3600 }, "short");

		expect(result).toEqual({ error: expect.stringContaining("reason") });
	});

	it("runs the platform-admin gate before writing", async () => {
		mockGate.mockRejectedValue(new Error("redirect"));
		tx.platformSetting.findUnique.mockResolvedValue(null);

		await expect(setFirmwareOtaPolicy(POLICY, REASON)).rejects.toThrow("redirect");
		expect(tx.platformSetting.upsert).not.toHaveBeenCalled();
	});

	it("writes the audit code the reader queries", () => {
		// A `"use server"` module may only export async functions, so the writer
		// spells the code out while `lib/settings/ota-policy.ts` imports the
		// constant. Without this guard a rename would silently stop the
		// "what the units report back" card from finding the last change.
		const source = readFileSync(join(process.cwd(), "lib/actions/platform/settings.ts"), "utf8");
		expect(source).toContain(`"${FIRMWARE_OTA_POLICY_AUDIT_ACTION}"`);
	});
});

describe("summarizeOtaPolicy", () => {
	const changedAt = new Date("2026-11-03T10:00:00Z");

	function report(overrides: Partial<OtaDeviceReport> = {}): OtaDeviceReport {
		return {
			id: "dev-1",
			label: "Pond A",
			lastSeenAt: new Date("2026-11-03T10:05:00Z"),
			reportedRev: 1234,
			configSource: "server",
			reportedAt: new Date("2026-11-03T10:01:00Z"),
			...overrides,
		};
	}

	it("classifies a unit by whether it echoed a config after the change", () => {
		expect(otaConfirmationState(new Date("2026-11-03T10:01:00Z"), changedAt)).toBe("applied");
		expect(otaConfirmationState(new Date("2026-11-03T09:59:00Z"), changedAt)).toBe("pending");
		expect(otaConfirmationState(null, changedAt)).toBe("never_reported");
		expect(otaConfirmationState(new Date("2026-11-03T09:59:00Z"), null)).toBe("reported");
	});

	it("counts each state and lists the units needing attention first", () => {
		const status = summarizeOtaPolicy({
			changedAt,
			reports: [
				report({ id: "applied", label: "Applied unit" }),
				report({
					id: "pending",
					label: "Pending unit",
					reportedAt: new Date("2026-11-03T09:00:00Z"),
				}),
				report({ id: "never", label: "Silent unit", reportedAt: null, reportedRev: null }),
			],
		});

		expect(status.available).toBe(true);
		expect(status.total).toBe(3);
		expect(status.appliedCount).toBe(1);
		expect(status.pendingCount).toBe(1);
		expect(status.neverReportedCount).toBe(1);
		expect(status.reportedCount).toBe(0);
		expect(status.devices.map((device) => device.id)).toEqual(["pending", "never", "applied"]);
	});

	it("marks every reporting unit as reported when no policy change is recorded", () => {
		const status = summarizeOtaPolicy({
			changedAt: null,
			reports: [report(), report({ id: "dev-2", reportedAt: null })],
		});

		expect(status.appliedCount).toBe(0);
		expect(status.pendingCount).toBe(0);
		expect(status.reportedCount).toBe(1);
		expect(status.neverReportedCount).toBe(1);
	});

	it("keeps the fleet counts while capping the rendered rows", () => {
		const reports = Array.from({ length: 20 }, (_, index) =>
			report({
				id: `dev-${index}`,
				reportedAt: new Date("2026-11-03T09:00:00Z"),
			}),
		);

		const status = summarizeOtaPolicy({ changedAt, reports, devicesTruncated: true });

		expect(status.total).toBe(20);
		expect(status.pendingCount).toBe(20);
		expect(status.devices.length).toBeLessThan(status.total);
		expect(status.devicesTruncated).toBe(true);
	});
});
