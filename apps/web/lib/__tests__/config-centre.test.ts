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
		async () => new Headers({ "x-forwarded-for": "203.0.113.5", "user-agent": "vitest-config" }),
	),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
	setFeatureFlag,
	setFeedingSafetyCaps,
	setOrgDefaults,
} from "@/lib/actions/platform/config";
import { setFirmwareGates } from "@/lib/actions/platform/settings";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { FIRMWARE_GATES_SETTING_KEY, FIRMWARE_GATE_FIELDS } from "@/lib/firmware/config";
import { resolveDailyCapG } from "@/lib/limits";
import { DEFAULT_INVITE_FROM, getEmailConfiguration } from "@/lib/settings/email-status";
import {
	FEEDING_CAPS_DEFAULTS,
	FEEDING_CAPS_HARD_MAX,
	FEEDING_CAPS_KEY,
	FEEDING_CAPS_MIN,
	isWithinFeedingCaps,
	normalizeFeedingCaps,
} from "@/lib/settings/feeding-caps";
import { normalizeFeatureFlag } from "@/lib/settings/flags";
import { ORG_DEFAULTS_KEY, ORG_SETTINGS_DEFAULTS, normalizeOrgDefaults } from "@/lib/settings/org";

const mockGate = vi.mocked(requirePlatformAdmin);

const REASON = "Platform review of the deployment limits";

const CAPS = { maxDispenseMs: 120_000, dailyCapFactor: 0.5 };

const ORG_DEFAULTS = {
	defaultFeedingRatePct: 4,
	hopperLowPct: 25,
	offlineAfterMin: 45,
	missedFeedingAlerts: false,
	alertRoles: ["OWNER", "OPERATOR"] as ("OWNER" | "ADMIN" | "OPERATOR" | "VIEWER")[],
	deviceRegistration: "SELF_REGISTER" as const,
};

beforeEach(() => {
	vi.clearAllMocks();
	mockGate.mockResolvedValue(undefined);
	db.platformAdmin.findUnique.mockResolvedValue(null);
	tx.platformSetting.findUnique.mockResolvedValue(null);
	tx.platformSetting.upsert.mockResolvedValue({});
	tx.platformAuditLog.create.mockResolvedValue({});
});

describe("setFeedingSafetyCaps", () => {
	it("allows a platform admin, saves the caps and writes one audit row", async () => {
		const result = await setFeedingSafetyCaps(CAPS, REASON);

		expect(result).toEqual({ success: true });
		expect(tx.platformSetting.upsert).toHaveBeenCalledWith({
			where: { key: FEEDING_CAPS_KEY },
			create: { key: FEEDING_CAPS_KEY, value: CAPS, updatedById: "admin-1" },
			update: { value: CAPS, updatedById: "admin-1" },
		});
		expect(tx.platformAuditLog.create).toHaveBeenCalledTimes(1);
		expect(tx.platformAuditLog.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					actorUserId: "admin-1",
					action: "platform.settings.feeding_caps",
					targetType: "platform_setting",
					targetId: FEEDING_CAPS_KEY,
					reason: REASON,
					before: FEEDING_CAPS_DEFAULTS,
					after: CAPS,
				}),
			}),
		);
	});

	it("records the stored caps as the old value", async () => {
		tx.platformSetting.findUnique.mockResolvedValue({ value: CAPS });

		await setFeedingSafetyCaps({ maxDispenseMs: 60_000, dailyCapFactor: 0.25 }, REASON);

		expect(tx.platformAuditLog.create).toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ before: CAPS }) }),
		);
	});

	it("refuses a relay time above the hard-coded maximum", async () => {
		const result = await setFeedingSafetyCaps(
			{ maxDispenseMs: FEEDING_CAPS_HARD_MAX.maxDispenseMs + 1, dailyCapFactor: 1 },
			REASON,
		);

		expect(result).toEqual({
			error: expect.stringContaining("hard-coded maximum"),
		});
		expect(db.$transaction).not.toHaveBeenCalled();
		expect(tx.platformAuditLog.create).not.toHaveBeenCalled();
	});

	it("refuses a daily factor above 1", async () => {
		const result = await setFeedingSafetyCaps(
			{ maxDispenseMs: 60_000, dailyCapFactor: 1.5 },
			REASON,
		);

		expect(result).toEqual({ error: expect.stringContaining("maximum of 1") });
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it("refuses values below the minimum", async () => {
		const tooShort = await setFeedingSafetyCaps(
			{ maxDispenseMs: FEEDING_CAPS_MIN.maxDispenseMs - 1, dailyCapFactor: 0.5 },
			REASON,
		);
		const tooSmall = await setFeedingSafetyCaps(
			{ maxDispenseMs: 60_000, dailyCapFactor: 0.01 },
			REASON,
		);

		expect("error" in tooShort).toBe(true);
		expect("error" in tooSmall).toBe(true);
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it("denies a tenant admin (no platform grant)", async () => {
		mockGate.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

		await expect(setFeedingSafetyCaps(CAPS, REASON)).rejects.toThrow("NEXT_REDIRECT");
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it("denies an anonymous caller", async () => {
		mockGate.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

		await expect(setFeedingSafetyCaps(CAPS, REASON)).rejects.toThrow("NEXT_REDIRECT");
		expect(tx.platformSetting.upsert).not.toHaveBeenCalled();
		expect(tx.platformAuditLog.create).not.toHaveBeenCalled();
	});

	it("rejects a reason shorter than 10 characters", async () => {
		const result = await setFeedingSafetyCaps(CAPS, "too short");

		expect(result).toEqual({ error: "A reason of at least 10 characters is required." });
		expect(db.$transaction).not.toHaveBeenCalled();
	});
});

describe("setOrgDefaults", () => {
	it("allows a platform admin, saves the defaults and writes one audit row", async () => {
		const result = await setOrgDefaults(ORG_DEFAULTS, REASON);

		expect(result).toEqual({ success: true });
		expect(tx.platformSetting.upsert).toHaveBeenCalledWith({
			where: { key: ORG_DEFAULTS_KEY },
			create: { key: ORG_DEFAULTS_KEY, value: ORG_DEFAULTS, updatedById: "admin-1" },
			update: { value: ORG_DEFAULTS, updatedById: "admin-1" },
		});
		expect(tx.platformAuditLog.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					action: "platform.settings.org_defaults",
					targetId: ORG_DEFAULTS_KEY,
					before: ORG_SETTINGS_DEFAULTS,
					after: ORG_DEFAULTS,
				}),
			}),
		);
	});

	it("denies a tenant admin and writes nothing", async () => {
		mockGate.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

		await expect(setOrgDefaults(ORG_DEFAULTS, REASON)).rejects.toThrow("NEXT_REDIRECT");
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it("denies an anonymous caller", async () => {
		mockGate.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

		await expect(setOrgDefaults(ORG_DEFAULTS, REASON)).rejects.toThrow("NEXT_REDIRECT");
		expect(tx.platformAuditLog.create).not.toHaveBeenCalled();
	});

	it("refuses an out-of-range feeding rate", async () => {
		const result = await setOrgDefaults({ ...ORG_DEFAULTS, defaultFeedingRatePct: 25 }, REASON);

		expect(result).toEqual({ error: expect.stringContaining("defaultFeedingRatePct") });
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it("refuses an empty alert-role policy", async () => {
		const result = await setOrgDefaults({ ...ORG_DEFAULTS, alertRoles: [] }, REASON);

		expect(result).toEqual({ error: expect.stringContaining("alertRoles") });
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it("rejects a reason shorter than 10 characters", async () => {
		const result = await setOrgDefaults(ORG_DEFAULTS, "short");

		expect(result).toEqual({ error: "A reason of at least 10 characters is required." });
	});
});

describe("setFeatureFlag", () => {
	it("allows a platform admin to switch a declared flag on", async () => {
		const result = await setFeatureFlag("help.centre", true, REASON);

		expect(result).toEqual({ success: true });
		expect(tx.platformSetting.upsert).toHaveBeenCalledWith({
			where: { key: "flag.help.centre" },
			create: { key: "flag.help.centre", value: true, updatedById: "admin-1" },
			update: { value: true, updatedById: "admin-1" },
		});
		expect(tx.platformAuditLog.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					action: "platform.settings.feature_flag",
					targetId: "flag.help.centre",
					before: { enabled: true },
					after: { enabled: true },
				}),
			}),
		);
	});

	it("uses the registry default as the old value when no row exists", async () => {
		tx.platformSetting.findUnique.mockResolvedValue({ value: false });

		await setFeatureFlag("assistant.actions", true, REASON);

		expect(tx.platformAuditLog.create).toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ before: { enabled: false } }) }),
		);
	});

	it("refuses a flag that is not declared in the registry", async () => {
		const result = await setFeatureFlag("unknown.flag", true, REASON);

		expect(result).toEqual({ error: "That feature flag is not declared in the registry." });
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it("denies a tenant admin", async () => {
		mockGate.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

		await expect(setFeatureFlag("help.centre", false, REASON)).rejects.toThrow("NEXT_REDIRECT");
		expect(db.$transaction).not.toHaveBeenCalled();
	});

	it("denies an anonymous caller", async () => {
		mockGate.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

		await expect(setFeatureFlag("help.centre", false, REASON)).rejects.toThrow("NEXT_REDIRECT");
		expect(tx.platformSetting.upsert).not.toHaveBeenCalled();
	});

	it("rejects a reason shorter than 10 characters", async () => {
		const result = await setFeatureFlag("help.centre", true, "short");

		expect(result).toEqual({ error: "A reason of at least 10 characters is required." });
	});
});

describe("feeding-cap readers clamp to the hard maximum", () => {
	it("caps a hand-edited relay time at the hard maximum", () => {
		expect(normalizeFeedingCaps({ maxDispenseMs: 999_999, dailyCapFactor: 5 })).toEqual({
			maxDispenseMs: FEEDING_CAPS_HARD_MAX.maxDispenseMs,
			dailyCapFactor: FEEDING_CAPS_HARD_MAX.dailyCapFactor,
		});
	});

	it("raises values below the minimum and falls back for garbage", () => {
		expect(normalizeFeedingCaps({ maxDispenseMs: 1, dailyCapFactor: -1 })).toEqual({
			maxDispenseMs: FEEDING_CAPS_MIN.maxDispenseMs,
			dailyCapFactor: FEEDING_CAPS_MIN.dailyCapFactor,
		});
		expect(normalizeFeedingCaps(null)).toEqual(FEEDING_CAPS_DEFAULTS);
		expect(normalizeFeedingCaps("nope")).toEqual(FEEDING_CAPS_DEFAULTS);
	});

	it("reads legacy string values and rounds the relay time", () => {
		expect(normalizeFeedingCaps({ maxDispenseMs: "60000.4", dailyCapFactor: "0.5" })).toEqual({
			maxDispenseMs: 60_000,
			dailyCapFactor: 0.5,
		});
	});

	it("accepts only values inside the writable window", () => {
		expect(isWithinFeedingCaps(CAPS)).toBe(true);
		expect(isWithinFeedingCaps(FEEDING_CAPS_DEFAULTS)).toBe(true);
		expect(isWithinFeedingCaps({ maxDispenseMs: 300_001, dailyCapFactor: 1 })).toBe(false);
		expect(isWithinFeedingCaps({ maxDispenseMs: 60_000, dailyCapFactor: 1.01 })).toBe(false);
	});

	it("lowers the daily allowance without ever being able to raise it", () => {
		// The default is 2,000 g; the platform factor may only lower it.
		expect(resolveDailyCapG({ hopperCapacityG: 10_000, dailyCapFactor: 0.5 })).toBe(1_000);
		// A small hopper is the physical limit.
		expect(resolveDailyCapG({ hopperCapacityG: 1_000 })).toBe(1_000);
		// The platform factor is clamped to 1, so it cannot raise the default.
		expect(resolveDailyCapG({ hopperCapacityG: 10_000, dailyCapFactor: 5 })).toBe(2_000);
		// A raised ceiling is honoured up to the hard guard.
		expect(resolveDailyCapG({ configuredCapG: 5_000, hopperCapacityG: 10_000 })).toBe(5_000);
		expect(resolveDailyCapG({ configuredCapG: 6_000 })).toBe(5_000);
	});
});

describe("flag and organization-default readers", () => {
	it("only accepts real booleans for a flag", () => {
		expect(normalizeFeatureFlag(true, false)).toBe(true);
		expect(normalizeFeatureFlag(false, true)).toBe(false);
		expect(normalizeFeatureFlag("true", true)).toBe(true);
		expect(normalizeFeatureFlag(null, false)).toBe(false);
	});

	it("clamps the default organization settings and drops invalid roles", () => {
		const normalized = normalizeOrgDefaults({
			defaultFeedingRatePct: 99,
			hopperLowPct: 99,
			offlineAfterMin: 1,
			missedFeedingAlerts: "yes",
			alertRoles: ["OWNER", "NOT_A_ROLE"],
			deviceRegistration: "WHATEVER",
		});

		expect(normalized.defaultFeedingRatePct).toBe(10);
		expect(normalized.hopperLowPct).toBe(50);
		expect(normalized.offlineAfterMin).toBe(5);
		expect(normalized.missedFeedingAlerts).toBe(true);
		expect(normalized.alertRoles).toEqual(["OWNER"]);
		expect(normalized.deviceRegistration).toBe("ADMIN_APPROVAL");
	});

	it("returns the schema defaults for a missing or malformed row", () => {
		expect(normalizeOrgDefaults(null)).toEqual(ORG_SETTINGS_DEFAULTS);
		expect(normalizeOrgDefaults({ alertRoles: [] })).toEqual(ORG_SETTINGS_DEFAULTS);
	});
});

describe("email configuration never returns a secret", () => {
	it("returns presence booleans and sender addresses only", () => {
		const configuration = getEmailConfiguration({
			RESEND_API_KEY: "super-secret-value",
			INVITE_FROM_EMAIL: "PakaonAI <invite@syntaxure.dev>",
			NEXT_PUBLIC_BASE_URL: "https://pakaonai.example",
			REMINDER_FROM_EMAIL: "PakaonAI <reminders@syntaxure.dev>",
		});

		expect(configuration).toEqual({
			resendConfigured: true,
			inviteFromConfigured: true,
			reminderFromConfigured: true,
			baseUrlConfigured: true,
			inviteFrom: "PakaonAI <invite@syntaxure.dev>",
			reminderFrom: "PakaonAI <reminders@syntaxure.dev>",
			inviteReady: true,
			reminderReady: true,
		});
		expect(JSON.stringify(configuration)).not.toContain("super-secret-value");
		expect(configuration).not.toHaveProperty("resendApiKey");
	});

	it("reports the documented invite sender and the skipped states when unset", () => {
		const configuration = getEmailConfiguration({});

		expect(configuration.inviteFrom).toBe(DEFAULT_INVITE_FROM);
		expect(configuration.reminderFrom).toBeNull();
		expect(configuration.inviteReady).toBe(false);
		expect(configuration.reminderReady).toBe(false);
		expect(configuration.resendConfigured).toBe(false);
	});
});

describe("setFirmwareGates (I-100)", () => {
	const GATES = {
		min_dispense_gap_s: 30,
		max_dispenses_per_hour: 3,
		brownout_hold_s: 120,
		safe_mode_abnormal_window_s: 900,
		safe_mode_abnormal_threshold: 4,
		safe_mode_quiet_s: 2400,
		safe_mode_healthy_clear_s: 720,
	};

	it("saves the gates and writes one audit row with the before/after values", async () => {
		tx.platformSetting.findUnique.mockResolvedValue(null);

		const result = await setFirmwareGates(GATES, REASON);

		expect(result).toEqual({ success: true, value: expect.objectContaining(GATES) });
		expect(tx.platformSetting.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { key: FIRMWARE_GATES_SETTING_KEY },
				update: expect.objectContaining({
					value: expect.objectContaining(GATES),
				}),
			}),
		);
		expect(tx.platformAuditLog.create).toHaveBeenCalledTimes(1);
		expect(tx.platformAuditLog.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					action: "platform.settings.firmware_gates",
					targetId: FIRMWARE_GATES_SETTING_KEY,
					reason: REASON,
				}),
			}),
		);
	});

	it("preserves non-gate values already stored", async () => {
		tx.platformSetting.findUnique.mockResolvedValue({
			value: { ota_check_interval_s: 3600, heartbeat_interval_s: 8 },
		});

		await setFirmwareGates({ min_dispense_gap_s: 20 }, REASON);

		const saved = (tx.platformSetting.upsert.mock.calls[0][0] as { update: { value: object } })
			.update.value;
		expect(saved).toMatchObject({
			min_dispense_gap_s: 20,
			ota_check_interval_s: 3600,
			heartbeat_interval_s: 8,
		});
	});

	it("refuses a value outside the envelope", async () => {
		const result = await setFirmwareGates({ min_dispense_gap_s: 1 }, REASON);
		expect(result).toEqual({ error: expect.stringContaining("min_dispense_gap_s") });
		expect(tx.platformSetting.upsert).not.toHaveBeenCalled();
	});

	it("refuses a fractional value in a whole-number gate", async () => {
		const result = await setFirmwareGates({ max_dispenses_per_hour: 3.5 }, REASON);
		expect(result).toEqual({ error: expect.stringContaining("whole number") });
	});

	it("refuses a field that is not an editable gate", async () => {
		const result = await setFirmwareGates({ heartbeat_interval_s: 30 }, REASON);
		expect(result).toEqual({ error: expect.stringContaining("not a configurable") });
	});

	it("requires a reason of at least ten characters", async () => {
		const result = await setFirmwareGates({ min_dispense_gap_s: 20 }, "short");
		expect(result).toEqual({ error: expect.stringContaining("reason") });
	});

	it("keeps the documented gate list in sync with the form", () => {
		expect(FIRMWARE_GATE_FIELDS.every((field) => field.editable)).toBe(true);
	});
});
