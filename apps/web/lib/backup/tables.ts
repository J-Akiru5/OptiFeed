import prisma from "@/lib/prisma";
import type { TenantExportScope } from "./scope";

/**
 * The export allow-list (issue #353).
 *
 * Every table and column that may leave the database is named here. Nothing is
 * discovered dynamically and nothing is selected with a wildcard, so a new
 * column cannot become exportable by accident: `backup-allowlist.test.ts`
 * compares this list with the Prisma DMMF and fails until someone makes a
 * decision (export it, redact it, or omit it with a reason).
 *
 * Three column categories per table:
 *
 * - `columns`   — exported verbatim, in the order written to the INSERT.
 * - `placeholders` — written with a derived non-secret value instead of reading
 *   the column. Only `EnergyDevice.token` uses this: the column is NOT NULL and
 *   UNIQUE, so omitting it would make the export unrestorable, while exporting
 *   the real value would leak a device credential. The placeholder is
 *   `redacted:<device id>`, which is not a usable token.
 * - `omitted`   — dropped entirely (nullable or regenerable), with the reason.
 *
 * `tenantWhere` is the tenant predicate for the table. The platform scope uses
 * no predicate at all; a table that exists only for the platform export still
 * carries a fail-closed tenant predicate so a wiring mistake returns no rows
 * instead of every row.
 *
 * Tables are listed in foreign-key-safe order: a restore inserts them top to
 * bottom and every referenced row already exists.
 */

export type BackupRow = Record<string, unknown>;

export type ColumnKind = "scalar" | "json" | "list" | "time" | "date";

export interface BackupPlaceholder {
	column: string;
	/** Derived value written instead of the stored column. Never a secret. */
	value: (row: BackupRow) => string;
}

export interface OmittedColumn {
	column: string;
	reason: string;
}

export interface BackupTable {
	/** Prisma model name, which is also the quoted SQL table name. */
	name: string;
	/** Tables included in a tenant export; the rest are platform-only. */
	scope: "tenant" | "platform";
	/** Unique column used for keyset pagination and ORDER BY. */
	key: string;
	columns: readonly string[];
	placeholders?: readonly BackupPlaceholder[];
	omitted?: readonly OmittedColumn[];
	jsonColumns?: readonly string[];
	arrayColumns?: readonly string[];
	/**
	 * `@db.Time` / `@db.Date` columns. Postgres rejects a full timestamp literal
	 * for them, so the exporter writes only the time or date part. The allow-list
	 * test compares this with the Prisma native type so a new one cannot be
	 * missed.
	 */
	timeColumns?: readonly string[];
	dateColumns?: readonly string[];
	tenantWhere: (scope: TenantExportScope) => Record<string, unknown>;
	/**
	 * Prisma delegate. Typed `unknown` because every model has its own
	 * `findMany`/`count` argument type; `backup-query.ts` narrows it once.
	 */
	model: unknown;
}

const byOrgPk = (scope: TenantExportScope) => ({ id: { in: scope.orgIds } });
const byMemberUser = (scope: TenantExportScope) => ({ id: { in: scope.memberUserIds } });
// A farm is in scope when a member owns it, or when an in-scope pond points at
// it (a transferred pond keeps its `farmId`). Without the second branch the
// exported Farm rows could miss a `Pond.farmId` and the restore would fail.
const byFarmOwner = (scope: TenantExportScope) => ({
	OR: [{ ownerId: { in: scope.farmIds } }, { ponds: { some: { id: { in: scope.pondIds } } } }],
});
const byPondPk = (scope: TenantExportScope) => ({ id: { in: scope.pondIds } });
const byOrgFk = (scope: TenantExportScope) => ({ orgId: { in: scope.orgIds } });
const byPondFk = (scope: TenantExportScope) => ({ pondId: { in: scope.pondIds } });
const byMembershipFk = (scope: TenantExportScope) => ({
	membershipId: { in: scope.membershipIds },
});
const byDevicePond = (scope: TenantExportScope) => ({
	device: { pondId: { in: scope.pondIds } },
});
const byBiomassPond = (scope: TenantExportScope) => ({
	biomassLog: { pondId: { in: scope.pondIds } },
});
// A command has both a device and a pond. Requiring both to agree with the
// scope drops a stale row left behind when a feeder was moved to another pond,
// which is what keeps the file restorable without pulling in a foreign pond.
const byCommandScope = (scope: TenantExportScope) => ({
	AND: [{ device: { pondId: { in: scope.pondIds } } }, { pondId: { in: scope.pondIds } }],
});
// A draft's optional device reference must also be inside the scope, or be
// null; a draft for a device that has since moved is stale and is left out.
const byDraftScope = (scope: TenantExportScope) => ({
	AND: [
		{ pondId: { in: scope.pondIds } },
		{ OR: [{ deviceId: null }, { device: { pondId: { in: scope.pondIds } } }] },
	],
});
const byAssistantScope = (scope: TenantExportScope) => ({
	OR: [{ orgId: { in: scope.orgIds } }, { userId: { in: scope.memberUserIds } }],
});

/** Fail-closed predicates for platform-only tables. */
const noneById = () => ({ id: { in: [] as string[] } });
const noneByKey = () => ({ key: { in: [] as string[] } });

const REDACTED_DEVICE_TOKEN: BackupPlaceholder = {
	column: "token",
	value: (row) => `redacted:${String(row.id)}`,
};

export const BACKUP_TABLES: readonly BackupTable[] = [
	{
		name: "Organization",
		scope: "tenant",
		key: "id",
		model: prisma.organization,
		columns: [
			"id",
			"name",
			"type",
			"status",
			"parentId",
			"suspendedAt",
			"suspendedReason",
			"deletionRequestedAt",
			"purgeAfter",
			"createdAt",
			"updatedAt",
		],
		tenantWhere: byOrgPk,
	},
	{
		name: "User",
		scope: "tenant",
		key: "id",
		model: prisma.user,
		columns: [
			"id",
			"supabaseId",
			"farmId",
			"email",
			"contactEmail",
			"displayName",
			"role",
			"mustChangePassword",
			"avatarPath",
			"createdAt",
			"updatedAt",
		],
		tenantWhere: byMemberUser,
	},
	{
		name: "Farm",
		scope: "tenant",
		key: "id",
		model: prisma.farm,
		columns: ["id", "ownerId", "name", "createdAt", "updatedAt"],
		tenantWhere: byFarmOwner,
	},
	{
		name: "Pond",
		scope: "tenant",
		key: "id",
		model: prisma.pond,
		columns: [
			"id",
			"ownerId",
			"farmId",
			"name",
			"feedingRatePct",
			"feedsPerDay",
			"population",
			"sampleIntervalDays",
			"scheduleStart",
			"scheduleEnd",
			"notificationPrefs",
			"status",
			"isFallow",
			"createdAt",
		],
		jsonColumns: ["notificationPrefs"],
		timeColumns: ["scheduleStart", "scheduleEnd"],
		tenantWhere: byPondPk,
	},
	{
		name: "Membership",
		scope: "tenant",
		key: "id",
		model: prisma.membership,
		columns: ["id", "orgId", "userId", "role", "invitedBy", "createdAt", "revokedAt"],
		tenantWhere: byOrgFk,
	},
	{
		name: "MembershipPermission",
		scope: "tenant",
		key: "id",
		model: prisma.membershipPermission,
		columns: ["id", "membershipId", "permission", "grantedAt", "revokedAt"],
		tenantWhere: byMembershipFk,
	},
	{
		name: "OrgSetting",
		scope: "tenant",
		key: "orgId",
		model: prisma.orgSetting,
		columns: [
			"orgId",
			"defaultFeedingRatePct",
			"hopperLowPct",
			"offlineAfterMin",
			"missedFeedingAlerts",
			"alertRoles",
			"deviceRegistration",
			"updatedById",
			"updatedAt",
		],
		arrayColumns: ["alertRoles"],
		tenantWhere: byOrgFk,
	},
	{
		name: "CropCycle",
		scope: "tenant",
		key: "id",
		model: prisma.cropCycle,
		columns: [
			"id",
			"pondId",
			"farmId",
			"label",
			"status",
			"stockingDate",
			"stockingCount",
			"stockingAvgWeightG",
			"growOutDays",
			"targetHarvestDate",
			"targetHarvestWeightG",
			"expectedSurvivalPct",
			"actualHarvestDate",
			"actualHarvestWeightKg",
			"actualHarvestCount",
			"actualFcr",
			"notes",
			"createdBy",
			"createdAt",
			"updatedAt",
		],
		dateColumns: ["stockingDate", "targetHarvestDate", "actualHarvestDate"],
		tenantWhere: byPondFk,
	},
	{
		name: "PondEvent",
		scope: "tenant",
		key: "id",
		model: prisma.pondEvent,
		columns: [
			"id",
			"pondId",
			"cropCycleId",
			"farmId",
			"type",
			"status",
			"title",
			"startsAt",
			"endsAt",
			"allDay",
			"notes",
			"source",
			"sourceId",
			"createdBy",
			"completedBy",
			"completedAt",
			"createdAt",
			"updatedAt",
			"kind",
			"color",
			"recurrenceFreq",
			"recurrenceInterval",
			"recurrenceUntil",
			"completedOccurrences",
			"reminderMinutes",
		],
		arrayColumns: ["completedOccurrences", "reminderMinutes"],
		tenantWhere: byPondFk,
	},
	{
		name: "ReminderLog",
		scope: "tenant",
		key: "id",
		model: prisma.reminderLog,
		columns: [
			"id",
			"pondId",
			"cropCycleId",
			"pondEventId",
			"kind",
			"channel",
			"dedupeKey",
			"recipient",
			"status",
			"attempts",
			"lastError",
			"sentAt",
		],
		tenantWhere: byPondFk,
	},
	{
		name: "PondOwnershipHistory",
		scope: "tenant",
		key: "id",
		model: prisma.pondOwnershipHistory,
		columns: ["id", "pondId", "farmId", "previousFarmId", "eventType", "changedById", "createdAt"],
		tenantWhere: byPondFk,
	},
	{
		name: "BiomassLog",
		scope: "tenant",
		key: "id",
		model: prisma.biomassLog,
		columns: [
			"id",
			"pondId",
			"sampleWeightKg",
			"sampleLengthCm",
			"sampleCount",
			"avgWeightKg",
			"batchLabel",
			"source",
			"recordedAt",
			"farmId",
		],
		tenantWhere: byPondFk,
	},
	{
		name: "FishSample",
		scope: "tenant",
		key: "id",
		model: prisma.fishSample,
		columns: ["id", "biomassLogId", "weightGrams", "lengthCm", "farmId"],
		tenantWhere: byBiomassPond,
	},
	{
		name: "FcrReport",
		scope: "tenant",
		key: "id",
		model: prisma.fcrReport,
		columns: [
			"id",
			"pondId",
			"periodStart",
			"periodEnd",
			"totalFeedKg",
			"biomassGainKg",
			"fcrValue",
			"farmId",
		],
		tenantWhere: byPondFk,
	},
	{
		name: "Notification",
		scope: "tenant",
		key: "id",
		model: prisma.notification,
		columns: [
			"id",
			"pondId",
			"tier",
			"message",
			"linkTo",
			"read",
			"category",
			"acknowledgedAt",
			"acknowledgedBy",
			"autoCleared",
			"createdAt",
			"farmId",
		],
		tenantWhere: byPondFk,
	},
	{
		name: "Device",
		scope: "tenant",
		key: "id",
		model: prisma.device,
		columns: ["id", "pondId", "name", "connectivity", "isPaused", "lastSyncedAt", "hopperLevelPct"],
		tenantWhere: byPondFk,
	},
	{
		name: "EnergyDevice",
		scope: "tenant",
		key: "id",
		model: prisma.energyDevice,
		columns: [
			"id",
			"mac",
			"label",
			"pondId",
			"rtcOk",
			"feederActive",
			"isPaused",
			"gramsPerFeeding",
			"buttonFeedGrams",
			"lastSeenAt",
			"createdAt",
			"feedLevelPercent",
			"feedLevelCm",
			"feedLevelUpdatedAt",
			"waterTempC",
			"waterTempOk",
			"waterTempUpdatedAt",
			"wifiRssiDbm",
			"wifiRssiUpdatedAt",
			"hopperEmptyCm",
			"hopperFullCm",
			"hopperCapacityG",
			"hopperDiameterCm",
			"hopperBulkDensityGCm3",
			"dailyCapG",
			"gramsPerSecond",
			"tempOffsetC",
			"lastCalibratedAt",
			"recalibrationIntervalDays",
			"approvalStatus",
		],
		placeholders: [REDACTED_DEVICE_TOKEN],
		omitted: [
			{
				column: "tokenHash",
				reason:
					"Hashed device credential. Never exported; a restored feeder must be rotated from the console.",
			},
		],
		tenantWhere: byPondFk,
	},
	{
		name: "PondSettingsDraft",
		scope: "tenant",
		key: "id",
		model: prisma.pondSettingsDraft,
		columns: ["id", "pondId", "userId", "deviceId", "data", "createdAt", "updatedAt"],
		jsonColumns: ["data"],
		tenantWhere: byDraftScope,
	},
	{
		name: "FeedingEvent",
		scope: "tenant",
		key: "id",
		model: prisma.feedingEvent,
		columns: ["id", "deviceId", "scheduledTime", "dispensedVolumeG", "status", "createdAt"],
		tenantWhere: byDevicePond,
	},
	{
		name: "FeedEvent",
		scope: "tenant",
		key: "id",
		model: prisma.feedEvent,
		columns: [
			"id",
			"deviceId",
			"eventId",
			"eventType",
			"timestamp",
			"grams",
			"source",
			"feedRequestId",
			"commandId",
			"rtcOk",
			"feederActive",
			"receivedAt",
			"dataSource",
			"farmId",
		],
		tenantWhere: byDevicePond,
	},
	{
		name: "FeedRequest",
		scope: "tenant",
		key: "id",
		model: prisma.feedRequest,
		columns: ["id", "deviceId", "grams", "status", "kind", "createdAt", "updatedAt", "farmId"],
		tenantWhere: byDevicePond,
	},
	{
		name: "DeviceStateEvent",
		scope: "tenant",
		key: "id",
		model: prisma.deviceStateEvent,
		columns: [
			"id",
			"deviceId",
			"eventType",
			"source",
			"actorId",
			"metadata",
			"deviceTime",
			"createdAt",
			"farmId",
		],
		jsonColumns: ["metadata"],
		tenantWhere: byDevicePond,
	},
	{
		name: "ScheduleCommand",
		scope: "tenant",
		key: "id",
		model: prisma.scheduleCommand,
		columns: [
			"id",
			"deviceId",
			"pondId",
			"scheduleStart",
			"scheduleEnd",
			"feedsPerDay",
			"feedingRatePct",
			"buttonFeedGrams",
			"status",
			"createdBy",
			"appliedAt",
			"deviceTime",
			"createdAt",
			"updatedAt",
			"farmId",
		],
		timeColumns: ["scheduleStart", "scheduleEnd"],
		tenantWhere: byCommandScope,
	},
	{
		name: "FeedLevelLog",
		scope: "tenant",
		key: "id",
		model: prisma.feedLevelLog,
		columns: ["id", "deviceId", "levelPercent", "distanceCm", "recordedAt", "dataSource", "farmId"],
		tenantWhere: byDevicePond,
	},
	{
		name: "WaterTempLog",
		scope: "tenant",
		key: "id",
		model: prisma.waterTempLog,
		columns: ["id", "deviceId", "tempC", "recordedAt", "dataSource", "farmId"],
		tenantWhere: byDevicePond,
	},
	{
		name: "CalibrationRun",
		scope: "tenant",
		key: "id",
		model: prisma.calibrationRun,
		columns: [
			"id",
			"deviceId",
			"sessionId",
			"attempt",
			"kind",
			"durationMs",
			"targetGrams",
			"measuredGrams",
			"gramsPerSecondBefore",
			"gramsPerSecondAfter",
			"errorPct",
			"accepted",
			"createdById",
			"createdAt",
		],
		tenantWhere: byDevicePond,
	},
	{
		name: "AssistantAction",
		scope: "tenant",
		key: "id",
		model: prisma.assistantAction,
		columns: [
			"id",
			"userId",
			"orgId",
			"pondId",
			"kind",
			"payload",
			"summary",
			"status",
			"result",
			"error",
			"expiresAt",
			"decidedAt",
			"createdAt",
		],
		jsonColumns: ["payload", "result"],
		tenantWhere: byAssistantScope,
	},
	{
		name: "PlatformAdmin",
		scope: "platform",
		key: "id",
		model: prisma.platformAdmin,
		columns: ["id", "userId", "grantedBy", "expiresAt", "revokedAt", "mfaEnrolledAt", "createdAt"],
		tenantWhere: noneById,
	},
	{
		name: "PlatformSetting",
		scope: "platform",
		key: "key",
		model: prisma.platformSetting,
		columns: ["key", "value", "updatedById", "updatedAt"],
		jsonColumns: ["value"],
		tenantWhere: noneByKey,
	},
	{
		name: "AiProviderConfig",
		scope: "platform",
		key: "id",
		model: prisma.aiProviderConfig,
		// apiKeyEnv names an environment variable; it is not a credential.
		// #432: encrypted key material (keyCiphertext/keyIv/keyTag/keyVersion)
		// is deliberately excluded. A restore re-uses the environment variable
		// until an operator re-enters the key in the console.
		columns: [
			"id",
			"provider",
			"kind",
			"label",
			"baseUrl",
			"enabled",
			"priority",
			"model",
			"apiKeyEnv",
			"params",
			"keyLast4",
			"keyUpdatedAt",
			"keyUpdatedBy",
			"createdAt",
			"updatedAt",
		],
		jsonColumns: ["params"],
		omitted: [
			{
				column: "keyCiphertext",
				reason:
					"Encrypted provider credential (#432). Never exported; a restore re-uses the environment variable until an operator re-enters the key.",
			},
			{ column: "keyIv", reason: "AES-GCM nonce for keyCiphertext; part of the credential." },
			{ column: "keyTag", reason: "AES-GCM authentication tag for keyCiphertext." },
			{ column: "keyVersion", reason: "Master-key generation for keyCiphertext." },
		],
		tenantWhere: noneById,
	},
	{
		name: "PlatformAuditLog",
		scope: "platform",
		key: "id",
		model: prisma.platformAuditLog,
		columns: [
			"id",
			"actorUserId",
			"action",
			"targetType",
			"targetId",
			"orgId",
			"reason",
			"stepUpAt",
			"temporaryGrant",
			"impersonationId",
			"before",
			"after",
			"ip",
			"userAgent",
			"createdAt",
		],
		jsonColumns: ["before", "after"],
		tenantWhere: noneById,
	},
	{
		name: "ErrorEvent",
		scope: "platform",
		key: "id",
		model: prisma.errorEvent,
		columns: [
			"id",
			"fingerprint",
			"message",
			"stack",
			"route",
			"severity",
			"context",
			"firstSeenAt",
			"lastSeenAt",
			"count",
			"resolved",
			"resolvedAt",
			"resolvedBy",
		],
		jsonColumns: ["context"],
		tenantWhere: noneById,
	},
];

/**
 * Tables that are never exported, with the decision behind each one.
 *
 * The allow-list test requires every Prisma model to appear either above or
 * here, so a new table forces the same decision.
 */
export const EXCLUDED_TABLES: Readonly<Record<string, string>> = {
	UserLockout:
		"Transient brute-force counter. Restoring an old lockout would unexpectedly slow a farm's next login.",
	LoginLockout:
		"Transient per-(farm, IP) lockout. Restoring it would lock out an address that may no longer be at fault.",
	RateLimitBucket: "Short-lived limiter windows, regenerated on demand; no farm data.",
	ImpersonationSession:
		"Session data. The brief forbids session data in any export, and an ended view-as session has no restore value.",
	BackgroundJob:
		"Operational queue state for long-running exports/imports; the work is not reproducible from a restored row.",
	JobArtifact:
		"Generated file bytes, including previous tenant exports. Re-exporting is safer than restoring or copying them.",
};

/** Tables the given scope must include, in restore order. */
export function tablesForScope(scopeKind: "platform" | "tenant"): readonly BackupTable[] {
	if (scopeKind === "platform") return BACKUP_TABLES;
	return BACKUP_TABLES.filter((table) => table.scope === "tenant");
}

/** The columns written to the INSERT for a table, in order. */
export function writtenColumns(table: BackupTable): string[] {
	return [...table.columns, ...(table.placeholders ?? []).map((entry) => entry.column)];
}

/** How a column's value must be formatted in SQL. */
export function columnKind(table: BackupTable, column: string): ColumnKind {
	if (table.jsonColumns?.includes(column)) return "json";
	if (table.arrayColumns?.includes(column)) return "list";
	if (table.timeColumns?.includes(column)) return "time";
	if (table.dateColumns?.includes(column)) return "date";
	return "scalar";
}

export function findBackupTable(name: string): BackupTable | undefined {
	return BACKUP_TABLES.find((table) => table.name === name);
}
