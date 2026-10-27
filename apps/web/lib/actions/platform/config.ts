"use server";

import { actorContext, writePlatformAudit } from "@/lib/actions/platform/audit";
import { MEMBER_ROLES } from "@/lib/auth/member-rules";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import prisma from "@/lib/prisma";
import {
	FEEDING_CAPS_HARD_MAX,
	FEEDING_CAPS_KEY,
	FEEDING_CAPS_MIN,
	isWithinFeedingCaps,
	normalizeFeedingCaps,
} from "@/lib/settings/feeding-caps";
import {
	FEATURE_FLAGS,
	featureFlagSettingKey,
	isFeatureFlagKey,
	normalizeFeatureFlag,
} from "@/lib/settings/flags";
import {
	DEVICE_REGISTRATION_MODES,
	ORG_DEFAULTS_KEY,
	ORG_DEFAULT_FEEDING_RATE_MAX,
	ORG_DEFAULT_FEEDING_RATE_MIN,
	ORG_HOPPER_LOW_PCT_MAX,
	ORG_HOPPER_LOW_PCT_MIN,
	ORG_OFFLINE_AFTER_MIN_MAX,
	ORG_OFFLINE_AFTER_MIN_MIN,
	normalizeOrgDefaults,
} from "@/lib/settings/org";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/**
 * Configuration-centre writes (superadmin I-14, decision E16.3).
 *
 * Every mutation is a platform action: `requirePlatformAdmin()`, a zod-validated
 * payload, a required reason and exactly one `PlatformAuditLog` row written in
 * the same transaction as the `PlatformSetting` upsert (no schema change).
 *
 * Two rules are enforced here rather than only in the UI:
 *  - the feeding safety caps can only be lowered: a value above the hard-coded
 *    maximum is rejected, never clamped and saved;
 *  - a feature flag must be declared in the typed registry, so a typo cannot
 *    create a setting nothing reads.
 */

const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 500;

const reasonSchema = z.string().trim().min(MIN_REASON_LENGTH).max(MAX_REASON_LENGTH);

function reasonError(): string {
	return `A reason of at least ${MIN_REASON_LENGTH} characters is required.`;
}

export type ConfigActionResult = { success: true } | { error: string };

const feedingCapsSchema = z.object({
	maxDispenseMs: z
		.number()
		.int("Relay time must be a whole number of milliseconds")
		.min(FEEDING_CAPS_MIN.maxDispenseMs)
		.max(
			FEEDING_CAPS_HARD_MAX.maxDispenseMs,
			`Relay time cannot exceed the hard-coded maximum of ${FEEDING_CAPS_HARD_MAX.maxDispenseMs} ms`,
		),
	dailyCapFactor: z
		.number()
		.min(FEEDING_CAPS_MIN.dailyCapFactor)
		.max(
			FEEDING_CAPS_HARD_MAX.dailyCapFactor,
			"The daily allowance factor cannot exceed the hard-coded maximum of 1",
		),
});

/**
 * Save the feeding safety caps. The payload must be inside
 * `[min, hardMax]`; the reader additionally clamps, so a hand-edited row still
 * cannot raise a cap.
 */
export async function setFeedingSafetyCaps(
	input: { maxDispenseMs: number; dailyCapFactor: number },
	reason: string,
): Promise<ConfigActionResult> {
	await requirePlatformAdmin();

	const parsed = feedingCapsSchema.safeParse(input);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		return { error: issue?.message ?? "The feeding caps are invalid." };
	}
	if (!isWithinFeedingCaps(parsed.data)) {
		return {
			error: `Feeding caps can only be lowered below the hard-coded maximum of ${FEEDING_CAPS_HARD_MAX.maxDispenseMs} ms and a daily factor of ${FEEDING_CAPS_HARD_MAX.dailyCapFactor}.`,
		};
	}

	const parsedReason = reasonSchema.safeParse(reason);
	if (!parsedReason.success) return { error: reasonError() };

	const actor = await actorContext();

	await prisma.$transaction(async (tx) => {
		const existing = await tx.platformSetting.findUnique({
			where: { key: FEEDING_CAPS_KEY },
			select: { value: true },
		});
		const before = normalizeFeedingCaps(existing?.value);

		await tx.platformSetting.upsert({
			where: { key: FEEDING_CAPS_KEY },
			create: { key: FEEDING_CAPS_KEY, value: parsed.data, updatedById: actor.id },
			update: { value: parsed.data, updatedById: actor.id },
		});

		await writePlatformAudit(tx, {
			actorUserId: actor.id,
			action: "platform.settings.feeding_caps",
			targetType: "platform_setting",
			targetId: FEEDING_CAPS_KEY,
			reason: parsedReason.data,
			temporaryGrant: actor.temporaryGrant,
			before: { ...before },
			after: { ...parsed.data },
		});
	});

	revalidatePath("/[locale]/(superadmin)", "layout");
	return { success: true };
}

const orgDefaultsSchema = z.object({
	defaultFeedingRatePct: z
		.number()
		.min(ORG_DEFAULT_FEEDING_RATE_MIN)
		.max(ORG_DEFAULT_FEEDING_RATE_MAX),
	hopperLowPct: z.number().int().min(ORG_HOPPER_LOW_PCT_MIN).max(ORG_HOPPER_LOW_PCT_MAX),
	offlineAfterMin: z.number().int().min(ORG_OFFLINE_AFTER_MIN_MIN).max(ORG_OFFLINE_AFTER_MIN_MAX),
	missedFeedingAlerts: z.boolean(),
	alertRoles: z.array(z.enum(MEMBER_ROLES)).min(1, "Choose at least one alert role"),
	deviceRegistration: z.enum(DEVICE_REGISTRATION_MODES),
});

export type OrgDefaultsInput = z.input<typeof orgDefaultsSchema>;

/**
 * Save the defaults every new organization starts from. Existing orgs keep
 * their own row; only orgs without one read these values.
 */
export async function setOrgDefaults(
	input: OrgDefaultsInput,
	reason: string,
): Promise<ConfigActionResult> {
	await requirePlatformAdmin();

	const parsed = orgDefaultsSchema.safeParse(input);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		const field = issue?.path.join(".");
		return {
			error: issue ? (field ? `${field}: ${issue.message}` : issue.message) : "Invalid defaults.",
		};
	}

	const parsedReason = reasonSchema.safeParse(reason);
	if (!parsedReason.success) return { error: reasonError() };

	// Normalize before saving so an alert-role duplicate cannot be stored twice.
	const next = normalizeOrgDefaults(parsed.data);
	const actor = await actorContext();

	await prisma.$transaction(async (tx) => {
		const existing = await tx.platformSetting.findUnique({
			where: { key: ORG_DEFAULTS_KEY },
			select: { value: true },
		});
		const before = normalizeOrgDefaults(existing?.value);

		await tx.platformSetting.upsert({
			where: { key: ORG_DEFAULTS_KEY },
			create: { key: ORG_DEFAULTS_KEY, value: next, updatedById: actor.id },
			update: { value: next, updatedById: actor.id },
		});

		await writePlatformAudit(tx, {
			actorUserId: actor.id,
			action: "platform.settings.org_defaults",
			targetType: "platform_setting",
			targetId: ORG_DEFAULTS_KEY,
			reason: parsedReason.data,
			temporaryGrant: actor.temporaryGrant,
			before: { ...before },
			after: { ...next },
		});
	});

	revalidatePath("/[locale]/(superadmin)", "layout");
	revalidatePath("/[locale]/(admin)", "layout");
	revalidatePath("/[locale]/(dashboard)", "layout");
	return { success: true };
}

const flagValueSchema = z.boolean();

/** Flip one declared feature flag. Unknown keys are refused before any write. */
export async function setFeatureFlag(
	key: string,
	enabled: boolean,
	reason: string,
): Promise<ConfigActionResult> {
	await requirePlatformAdmin();

	if (!isFeatureFlagKey(key)) {
		return { error: "That feature flag is not declared in the registry." };
	}
	const parsedValue = flagValueSchema.safeParse(enabled);
	if (!parsedValue.success) {
		return { error: "A feature flag can only be on or off." };
	}
	const parsedReason = reasonSchema.safeParse(reason);
	if (!parsedReason.success) return { error: reasonError() };

	const definition = FEATURE_FLAGS.find((flag) => flag.key === key);
	const settingKey = featureFlagSettingKey(key);
	const actor = await actorContext();

	await prisma.$transaction(async (tx) => {
		const existing = await tx.platformSetting.findUnique({
			where: { key: settingKey },
			select: { value: true },
		});
		const before = normalizeFeatureFlag(existing?.value, definition?.defaultValue ?? true);

		await tx.platformSetting.upsert({
			where: { key: settingKey },
			create: { key: settingKey, value: parsedValue.data, updatedById: actor.id },
			update: { value: parsedValue.data, updatedById: actor.id },
		});

		await writePlatformAudit(tx, {
			actorUserId: actor.id,
			action: "platform.settings.feature_flag",
			targetType: "platform_setting",
			targetId: settingKey,
			reason: parsedReason.data,
			temporaryGrant: actor.temporaryGrant,
			before: { enabled: before },
			after: { enabled: parsedValue.data },
		});
	});

	revalidatePath("/[locale]/(superadmin)", "layout");
	revalidatePath("/[locale]/(admin)", "layout");
	revalidatePath("/[locale]/(dashboard)", "layout");
	return { success: true };
}
