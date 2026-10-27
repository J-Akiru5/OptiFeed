import prisma from "@/lib/prisma";
import { cache } from "react";

/**
 * Typed feature-flag registry (superadmin configuration centre I-14).
 *
 * Flags are platform-wide switches stored one row per flag in
 * `PlatformSetting` (`flag.<key>`). The registry is the only place a flag may
 * be declared: an unknown key is refused by the action and ignored by the
 * reader, so a typo cannot silently create a dead setting.
 *
 * The reader is server-side only (`lib/settings/flags.ts` imports Prisma).
 * A page/action that needs a flag awaits `isFeatureEnabled(...)`; a client
 * component receives the resolved boolean as a prop.
 */

export type FeatureFlagId = "assistantActions" | "helpCentre";

export type FeatureFlagDefinition = {
	/** Stable identifier used in the UI and in the message catalogue. */
	id: FeatureFlagId;
	/** The stored key suffix; the full PlatformSetting key is `flag.<key>`. */
	key: "assistant.actions" | "help.centre";
	defaultValue: boolean;
};

export const FEATURE_FLAGS: readonly FeatureFlagDefinition[] = [
	{ id: "assistantActions", key: "assistant.actions", defaultValue: true },
	{ id: "helpCentre", key: "help.centre", defaultValue: true },
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[number]["key"];

export const FEATURE_FLAG_SETTING_PREFIX = "flag.";

export function featureFlagSettingKey(key: FeatureFlagKey): string {
	return `${FEATURE_FLAG_SETTING_PREFIX}${key}`;
}

export function isFeatureFlagKey(value: unknown): value is FeatureFlagKey {
	return typeof value === "string" && FEATURE_FLAGS.some((flag) => flag.key === value);
}

export function featureFlagDefinition(key: FeatureFlagKey): FeatureFlagDefinition {
	const flag = FEATURE_FLAGS.find((entry) => entry.key === key);
	if (!flag) throw new Error(`Unknown feature flag: ${key}`);
	return flag;
}

/** Strict boolean read; anything else uses the registry default. */
export function normalizeFeatureFlag(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

export type FeatureFlagValues = Record<FeatureFlagId, boolean>;

/** Defaults from the registry, for a page that cannot read the table. */
export function defaultFeatureFlags(): FeatureFlagValues {
	const values = {} as FeatureFlagValues;
	for (const flag of FEATURE_FLAGS) values[flag.id] = flag.defaultValue;
	return values;
}

/**
 * Read every flag in one query. A missing table, a missing row or a malformed
 * value falls back to the registry default, so a flag can never break a page.
 */
export const getFeatureFlags = cache(async (): Promise<FeatureFlagValues> => {
	const values = defaultFeatureFlags();
	try {
		const rows = await prisma.platformSetting.findMany({
			where: { key: { in: FEATURE_FLAGS.map((flag) => featureFlagSettingKey(flag.key)) } },
			select: { key: true, value: true },
		});
		for (const flag of FEATURE_FLAGS) {
			const row = rows.find((entry) => entry.key === featureFlagSettingKey(flag.key));
			values[flag.id] = normalizeFeatureFlag(row?.value, flag.defaultValue);
		}
	} catch {
		return defaultFeatureFlags();
	}
	return values;
});

/** One flag, read through the shared per-request cache. */
export async function isFeatureEnabled(key: FeatureFlagKey): Promise<boolean> {
	const flag = featureFlagDefinition(key);
	const values = await getFeatureFlags();
	return values[flag.id];
}
