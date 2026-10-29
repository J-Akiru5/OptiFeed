import type { MemberRole, OrgStatus, OrgType, PondStatus, UserRole } from "@prisma/client";
import { expect } from "vitest";

/**
 * Two-tenant fixture for cross-organization negative tests (mission T-05).
 *
 * The point of this harness is not to stub "the answer"; it is to give the
 * actions a small, real in-memory Prisma-shaped database that contains *both*
 * tenants. An action therefore only stays inside org A when its own scope
 * filter (or its own `findFirst`/`findUnique` guard) actually excludes org B.
 * `expectNoCrossOrgAccess()` then fails if an org B identifier reaches the
 * result, an error, or a thrown exception.
 *
 * Supported queries are the subset used by `lib/actions/admin.ts`,
 * `lib/actions/superadmin.ts` and `lib/auth/org-scope.ts`: equality, `in`,
 * `notIn`, `not`, `lt`/`lte`/`gt`/`gte`, `contains` (+ insensitive), `OR`/`AND`/
 * `NOT`, relation filters, `select`/`include`, `orderBy`, `skip`/`take`, plus
 * the create/update/upsert/delete writes those actions perform. It is a test
 * double, not a Prisma implementation: an unsupported operator is treated as a
 * match rather than silently hiding a row, and tests should assert on the
 * action's result as well as on the fixture rows.
 */

export const FIXED_NOW = new Date("2026-10-20T08:00:00.000Z");

// ─── Stable ids ──────────────────────────────────────────────────────────────
//
// Exported so a test never has to hard-code a fixture id and so a failure names
// the tenant in the assertion message.

export const ORG_A_ID = "org-a";
export const ORG_B_ID = "org-b";

export const ADMIN_A_ID = "user-admin-a";
export const FARMER_A_ID = "user-farmer-a";
export const VIEWER_A_ID = "user-viewer-a";
export const PLATFORM_ADMIN_A_ID = "user-platform-a";
export const ADMIN_B_ID = "user-admin-b";
export const FARMER_B_ID = "user-farmer-b";

export const FARM_A = "farm-a";
export const FARM_A_ADMIN = "farm-a-admin";
export const FARM_A_VIEWER = "farm-a-viewer";
export const FARM_A_PLATFORM_ADMIN = "farm-platform-a";
export const FARM_B = "farm-b";
export const FARM_B_ADMIN = "farm-b-admin";

export const FARM_ROW_A = "farm-row-a";
export const FARM_ROW_B = "farm-row-b";

export const POND_A_1 = "pond-a-1";
export const POND_A_2 = "pond-a-2";
export const POND_B_1 = "pond-b-1";

export const DEVICE_A_1 = "device-a-1";
export const DEVICE_A_2 = "device-a-2";
export const DEVICE_B_1 = "device-b-1";

export const EVENT_A_1 = "event-a-1";
export const EVENT_A_2 = "event-a-2";
export const EVENT_B_1 = "event-b-1";

export const MEMBERSHIP_ADMIN_A = "membership-admin-a";
export const MEMBERSHIP_FARMER_A = "membership-farmer-a";
export const MEMBERSHIP_VIEWER_A = "membership-viewer-a";
export const MEMBERSHIP_PLATFORM_ADMIN_A = "membership-platform-a";
export const MEMBERSHIP_ADMIN_B = "membership-admin-b";
export const MEMBERSHIP_FARMER_B = "membership-farmer-b";

export const ORG_A_NAME = "Bayanihan Aqua Cooperative (A)";
export const ORG_B_NAME = "Highland Fish Farm (B)";
export const POND_A_1_NAME = "Pond A One";
export const POND_A_2_NAME = "Pond A Two";
export const POND_B_1_NAME = "Pond B One";
export const DEVICE_A_1_LABEL = "Feeder A One";
export const DEVICE_A_2_LABEL = "Feeder A Two";
export const DEVICE_B_1_LABEL = "Feeder B One";
export const DEVICE_A_1_MAC = "A4:CF:12:7E:3B:09";
export const DEVICE_A_2_MAC = "A4:CF:12:7E:00:FF";
export const DEVICE_B_1_MAC = "11:22:33:44:55:66";

const TOKEN_A_1 = "tok_SECRET_org_a_one_do_not_leak";
const TOKEN_A_2 = "tok_SECRET_org_a_two_do_not_leak";
const TOKEN_B_1 = "tok_SECRET_org_b_one_do_not_leak";

export type TenancyOrgKey = "orgA" | "orgB";

// ─── Row shapes ──────────────────────────────────────────────────────────────

export type TenancyOrganization = {
	id: string;
	name: string;
	type: OrgType;
	status: OrgStatus;
	parentId: string | null;
	suspendedAt: Date | null;
	suspendedReason: string | null;
	deletionRequestedAt: Date | null;
	purgeAfter: Date | null;
	createdAt: Date;
	updatedAt: Date;
};

export type TenancyUser = {
	id: string;
	supabaseId: string;
	farmId: string;
	email: string;
	displayName: string | null;
	role: UserRole;
	mustChangePassword: boolean;
	createdAt: Date;
	updatedAt: Date;
};

export type TenancyMembership = {
	id: string;
	orgId: string;
	userId: string;
	role: MemberRole;
	invitedBy: string | null;
	createdAt: Date;
	revokedAt: Date | null;
};

export type TenancyMembershipPermission = {
	id: string;
	membershipId: string;
	permission: string;
	grantedAt: Date;
	revokedAt: Date | null;
};

export type TenancyFarm = {
	id: string;
	ownerId: string;
	name: string;
	createdAt: Date;
	updatedAt: Date;
};

export type TenancyPond = {
	id: string;
	ownerId: string;
	farmId: string;
	name: string;
	feedingRatePct: number;
	feedsPerDay: number;
	population: number | null;
	sampleIntervalDays: number;
	scheduleStart: Date;
	scheduleEnd: Date;
	notificationPrefs: unknown;
	status: PondStatus;
	isFallow: boolean;
	createdAt: Date;
};

export type TenancyEnergyDevice = {
	id: string;
	mac: string;
	token: string;
	tokenHash: string | null;
	label: string;
	pondId: string | null;
	rtcOk: boolean;
	feederActive: boolean;
	isPaused: boolean;
	gramsPerFeeding: number;
	buttonFeedGrams: number;
	lastSeenAt: Date | null;
	createdAt: Date;
	feedLevelPercent: number | null;
	feedLevelCm: number | null;
	feedLevelUpdatedAt: Date | null;
	waterTempC: number | null;
	waterTempOk: boolean;
	waterTempUpdatedAt: Date | null;
	hopperEmptyCm: number | null;
	hopperFullCm: number | null;
	hopperCapacityG: number | null;
	gramsPerSecond: number;
	tempOffsetC: number;
	approvalStatus: "PENDING" | "APPROVED" | "REJECTED";
};

export type TenancyOrgSetting = {
	orgId: string;
	defaultFeedingRatePct: number;
	hopperLowPct: number;
	offlineAfterMin: number;
	missedFeedingAlerts: boolean;
	alertRoles: MemberRole[];
	deviceRegistration: "ADMIN_APPROVAL" | "SELF_REGISTER";
	updatedById: string | null;
	updatedAt: Date;
};

export type TenancyDeviceStateEvent = {
	id: string;
	deviceId: string;
	eventType: string;
	source: string;
	actorId: string | null;
	metadata: unknown;
	deviceTime: string | null;
	createdAt: Date;
	farmId: string | null;
};

export type TenancyPlatformAdmin = {
	id: string;
	userId: string;
	grantedBy: string | null;
	expiresAt: Date | null;
	revokedAt: Date | null;
	mfaEnrolledAt: Date | null;
	createdAt: Date;
};

export type TenancyPlatformAuditLog = {
	id: string;
	actorUserId: string;
	action: string;
	targetType: string;
	targetId: string | null;
	orgId: string | null;
	reason: string;
	stepUpAt: Date | null;
	temporaryGrant: boolean;
	impersonationId: string | null;
	before: unknown;
	after: unknown;
	ip: string | null;
	userAgent: string | null;
	createdAt: Date;
};

export type TenancyBiomassLog = {
	id: string;
	pondId: string;
	batchLabel: string | null;
	recordedAt: Date;
	farmId: string | null;
};

export type TenancyPondEvent = {
	id: string;
	pondId: string;
	title: string;
	startsAt: Date;
	type: string;
	status: string;
	farmId: string | null;
};

export type TenancyFeedEvent = {
	id: string;
	deviceId: string;
	eventType: string;
	receivedAt: Date;
	grams: number | null;
	source: string | null;
	farmId: string | null;
};

export type TenancyFixture = {
	organizations: TenancyOrganization[];
	users: TenancyUser[];
	memberships: TenancyMembership[];
	membershipPermissions: TenancyMembershipPermission[];
	farms: TenancyFarm[];
	ponds: TenancyPond[];
	energyDevices: TenancyEnergyDevice[];
	orgSettings: TenancyOrgSetting[];
	deviceStateEvents: TenancyDeviceStateEvent[];
	biomassLogs: TenancyBiomassLog[];
	pondEvents: TenancyPondEvent[];
	feedEvents: TenancyFeedEvent[];
	platformAdmins: TenancyPlatformAdmin[];
	platformAuditLogs: TenancyPlatformAuditLog[];
};

// ─── Fixture ─────────────────────────────────────────────────────────────────

/**
 * Build a fresh fixture.
 *
 * Org A is the caller's tenant: an OWNER (the admin), an OPERATOR farmer with a
 * farm and two ponds/devices, a VIEWER with a farm but no pond, and a platform
 * admin who also holds an org A OWNER membership (so tenant reads must exclude
 * them by grant, not by membership). Org B mirrors the farmer shape and is the
 * tenant the caller must never see.
 */
export function createTenancyFixture(): TenancyFixture {
	const at = (minutes: number) => new Date(FIXED_NOW.getTime() + minutes * 60_000);
	const scheduleStart = new Date("1970-01-01T06:00:00.000Z");
	const scheduleEnd = new Date("1970-01-01T18:00:00.000Z");

	const organizations: TenancyOrganization[] = [
		{
			id: ORG_A_ID,
			name: ORG_A_NAME,
			type: "COOPERATIVE",
			status: "ACTIVE",
			parentId: null,
			suspendedAt: null,
			suspendedReason: null,
			deletionRequestedAt: null,
			purgeAfter: null,
			createdAt: at(0),
			updatedAt: at(0),
		},
		{
			id: ORG_B_ID,
			name: ORG_B_NAME,
			type: "COMPANY",
			status: "ACTIVE",
			parentId: null,
			suspendedAt: null,
			suspendedReason: null,
			deletionRequestedAt: null,
			purgeAfter: null,
			createdAt: at(1),
			updatedAt: at(1),
		},
	];

	const users: TenancyUser[] = [
		{
			id: ADMIN_A_ID,
			supabaseId: "sb-admin-a",
			farmId: FARM_A_ADMIN,
			email: `${FARM_A_ADMIN}@pond.optifeed.local`,
			displayName: "Admin A",
			role: "ADMIN",
			mustChangePassword: false,
			createdAt: at(10),
			updatedAt: at(10),
		},
		{
			id: FARMER_A_ID,
			supabaseId: "sb-farmer-a",
			farmId: FARM_A,
			email: `${FARM_A}@pond.optifeed.local`,
			displayName: "Farmer A",
			role: "OPERATOR",
			mustChangePassword: false,
			createdAt: at(11),
			updatedAt: at(11),
		},
		{
			id: VIEWER_A_ID,
			supabaseId: "sb-viewer-a",
			farmId: FARM_A_VIEWER,
			email: `${FARM_A_VIEWER}@pond.optifeed.local`,
			displayName: "Viewer A",
			role: "VIEWER",
			mustChangePassword: false,
			createdAt: at(12),
			updatedAt: at(12),
		},
		{
			id: PLATFORM_ADMIN_A_ID,
			supabaseId: "sb-platform-a",
			farmId: FARM_A_PLATFORM_ADMIN,
			email: `${FARM_A_PLATFORM_ADMIN}@pond.optifeed.local`,
			displayName: "Platform Admin A",
			role: "ADMIN",
			mustChangePassword: false,
			createdAt: at(13),
			updatedAt: at(13),
		},
		{
			id: ADMIN_B_ID,
			supabaseId: "sb-admin-b",
			farmId: FARM_B_ADMIN,
			email: `${FARM_B_ADMIN}@pond.optifeed.local`,
			displayName: "Admin B",
			role: "ADMIN",
			mustChangePassword: false,
			createdAt: at(20),
			updatedAt: at(20),
		},
		{
			id: FARMER_B_ID,
			supabaseId: "sb-farmer-b",
			farmId: FARM_B,
			email: `${FARM_B}@pond.optifeed.local`,
			displayName: "Farmer B",
			role: "OPERATOR",
			mustChangePassword: false,
			createdAt: at(21),
			updatedAt: at(21),
		},
	];

	const memberships: TenancyMembership[] = [
		{
			id: MEMBERSHIP_ADMIN_A,
			orgId: ORG_A_ID,
			userId: ADMIN_A_ID,
			role: "OWNER",
			invitedBy: null,
			createdAt: at(10),
			revokedAt: null,
		},
		{
			id: MEMBERSHIP_FARMER_A,
			orgId: ORG_A_ID,
			userId: FARMER_A_ID,
			role: "OPERATOR",
			invitedBy: ADMIN_A_ID,
			createdAt: at(11),
			revokedAt: null,
		},
		{
			id: MEMBERSHIP_VIEWER_A,
			orgId: ORG_A_ID,
			userId: VIEWER_A_ID,
			role: "VIEWER",
			invitedBy: ADMIN_A_ID,
			createdAt: at(12),
			revokedAt: null,
		},
		{
			id: MEMBERSHIP_PLATFORM_ADMIN_A,
			orgId: ORG_A_ID,
			userId: PLATFORM_ADMIN_A_ID,
			role: "OWNER",
			invitedBy: null,
			createdAt: at(13),
			revokedAt: null,
		},
		{
			id: MEMBERSHIP_ADMIN_B,
			orgId: ORG_B_ID,
			userId: ADMIN_B_ID,
			role: "OWNER",
			invitedBy: null,
			createdAt: at(20),
			revokedAt: null,
		},
		{
			id: MEMBERSHIP_FARMER_B,
			orgId: ORG_B_ID,
			userId: FARMER_B_ID,
			role: "OPERATOR",
			invitedBy: ADMIN_B_ID,
			createdAt: at(21),
			revokedAt: null,
		},
	];

	const farms: TenancyFarm[] = [
		{ id: FARM_ROW_A, ownerId: FARM_A, name: "Farm A", createdAt: at(11), updatedAt: at(11) },
		{ id: FARM_ROW_B, ownerId: FARM_B, name: "Farm B", createdAt: at(21), updatedAt: at(21) },
	];

	const ponds: TenancyPond[] = [
		{
			id: POND_A_1,
			ownerId: FARM_A,
			farmId: FARM_ROW_A,
			name: POND_A_1_NAME,
			feedingRatePct: 3,
			feedsPerDay: 3,
			population: 1000,
			sampleIntervalDays: 14,
			scheduleStart,
			scheduleEnd,
			notificationPrefs: {},
			status: "ACTIVE",
			isFallow: false,
			createdAt: at(30),
		},
		{
			id: POND_A_2,
			ownerId: FARM_A,
			farmId: FARM_ROW_A,
			name: POND_A_2_NAME,
			feedingRatePct: 3,
			feedsPerDay: 2,
			population: null,
			sampleIntervalDays: 14,
			scheduleStart,
			scheduleEnd,
			notificationPrefs: {},
			status: "ACTIVE",
			isFallow: false,
			createdAt: at(31),
		},
		{
			id: POND_B_1,
			ownerId: FARM_B,
			farmId: FARM_ROW_B,
			name: POND_B_1_NAME,
			feedingRatePct: 4,
			feedsPerDay: 4,
			population: 2000,
			sampleIntervalDays: 14,
			scheduleStart,
			scheduleEnd,
			notificationPrefs: {},
			status: "ACTIVE",
			isFallow: false,
			createdAt: at(32),
		},
	];

	const deviceDefaults = {
		rtcOk: true,
		feederActive: false,
		isPaused: false,
		gramsPerFeeding: 150,
		buttonFeedGrams: 80,
		lastSeenAt: null,
		feedLevelPercent: null,
		feedLevelCm: null,
		feedLevelUpdatedAt: null,
		waterTempC: null,
		waterTempOk: false,
		waterTempUpdatedAt: null,
		hopperEmptyCm: null,
		hopperFullCm: null,
		hopperCapacityG: null,
		gramsPerSecond: 4,
		tempOffsetC: 0,
		approvalStatus: "APPROVED" as const,
	};

	const energyDevices: TenancyEnergyDevice[] = [
		{
			...deviceDefaults,
			id: DEVICE_A_1,
			mac: DEVICE_A_1_MAC,
			token: TOKEN_A_1,
			tokenHash: "hash_a_one",
			label: DEVICE_A_1_LABEL,
			pondId: POND_A_1,
			createdAt: at(40),
		},
		{
			...deviceDefaults,
			id: DEVICE_A_2,
			mac: DEVICE_A_2_MAC,
			token: TOKEN_A_2,
			tokenHash: "hash_a_two",
			label: DEVICE_A_2_LABEL,
			pondId: POND_A_2,
			createdAt: at(41),
		},
		{
			...deviceDefaults,
			id: DEVICE_B_1,
			mac: DEVICE_B_1_MAC,
			token: TOKEN_B_1,
			tokenHash: "hash_b_one",
			label: DEVICE_B_1_LABEL,
			pondId: POND_B_1,
			createdAt: at(42),
		},
	];

	const deviceStateEvents: TenancyDeviceStateEvent[] = [
		{
			id: EVENT_A_1,
			deviceId: DEVICE_A_1,
			eventType: "connected",
			source: "device",
			actorId: null,
			metadata: null,
			deviceTime: null,
			createdAt: at(50),
			farmId: FARM_A,
		},
		{
			id: EVENT_A_2,
			deviceId: DEVICE_A_2,
			eventType: "feed_dispensed",
			source: "device",
			actorId: null,
			metadata: null,
			deviceTime: null,
			createdAt: at(51),
			farmId: FARM_A,
		},
		{
			id: EVENT_B_1,
			deviceId: DEVICE_B_1,
			eventType: "connected",
			source: "device",
			actorId: null,
			metadata: null,
			deviceTime: null,
			createdAt: at(52),
			farmId: FARM_B,
		},
	];

	const platformAdmins: TenancyPlatformAdmin[] = [
		{
			id: "platform-admin-a",
			userId: PLATFORM_ADMIN_A_ID,
			grantedBy: null,
			expiresAt: null,
			revokedAt: null,
			mfaEnrolledAt: null,
			createdAt: at(5),
		},
	];

	return {
		organizations,
		users,
		memberships,
		membershipPermissions: [],
		farms,
		ponds,
		energyDevices,
		deviceStateEvents,
		biomassLogs: [],
		pondEvents: [],
		feedEvents: [],
		platformAdmins,
		platformAuditLogs: [],
		orgSettings: [],
	};
}

/**
 * The org scope `resolveOrgScope()` must produce for each fixture tenant.
 * Exported for documentation and for tests that want to assert the harness and
 * the real resolver agree.
 */
export const ORG_A_SCOPE = {
	orgIds: [ORG_A_ID],
	memberUserIds: [ADMIN_A_ID, FARMER_A_ID, VIEWER_A_ID, PLATFORM_ADMIN_A_ID],
	farmIds: [FARM_A_ADMIN, FARM_A, FARM_A_VIEWER, FARM_A_PLATFORM_ADMIN],
	pondIds: [POND_A_1, POND_A_2],
};

const ORG_B_SCOPE = {
	orgIds: [ORG_B_ID],
	memberUserIds: [ADMIN_B_ID, FARMER_B_ID],
	farmIds: [FARM_B_ADMIN, FARM_B],
	pondIds: [POND_B_1],
};

function identifiersFor(org: TenancyOrgKey): string[] {
	if (org === "orgA") {
		return [
			ORG_A_ID,
			ORG_A_NAME,
			ADMIN_A_ID,
			FARMER_A_ID,
			VIEWER_A_ID,
			PLATFORM_ADMIN_A_ID,
			FARM_A_ADMIN,
			FARM_A,
			FARM_A_VIEWER,
			FARM_A_PLATFORM_ADMIN,
			FARM_ROW_A,
			POND_A_1,
			POND_A_2,
			POND_A_1_NAME,
			POND_A_2_NAME,
			DEVICE_A_1,
			DEVICE_A_2,
			DEVICE_A_1_LABEL,
			DEVICE_A_2_LABEL,
			DEVICE_A_1_MAC,
			DEVICE_A_2_MAC,
			TOKEN_A_1,
			TOKEN_A_2,
			EVENT_A_1,
			EVENT_A_2,
		];
	}
	return [
		ORG_B_ID,
		ORG_B_NAME,
		ADMIN_B_ID,
		FARMER_B_ID,
		FARM_B_ADMIN,
		FARM_B,
		FARM_ROW_B,
		POND_B_1,
		POND_B_1_NAME,
		DEVICE_B_1,
		DEVICE_B_1_LABEL,
		DEVICE_B_1_MAC,
		TOKEN_B_1,
		EVENT_B_1,
	];
}

function serialise(value: unknown): string {
	if (value instanceof Error) {
		return `${value.name}: ${value.message}\n${value.stack ?? ""}`;
	}
	try {
		const json = JSON.stringify(value);
		return json ?? String(value);
	} catch {
		return String(value);
	}
}

/**
 * Run `fn` and fail when any identifier of the foreign org appears anywhere in
 * the result (JSON), an error, or a thrown exception. Returns the result so a
 * test can continue asserting the allow/deny shape.
 */
export async function expectNoCrossOrgAccess<T>(
	fn: () => Promise<T>,
	options: { foreignOrg?: TenancyOrgKey; extra?: string[] } = {},
): Promise<T> {
	const forbidden = [...identifiersFor(options.foreignOrg ?? "orgB"), ...(options.extra ?? [])];
	const assertClean = (value: unknown) => {
		const text = serialise(value);
		for (const identifier of forbidden) {
			expect(text, `foreign org identifier leaked: ${identifier}`).not.toContain(identifier);
		}
	};

	let result: T;
	try {
		result = await fn();
	} catch (error) {
		assertClean(error);
		throw error;
	}
	assertClean(result);
	return result;
}

// ─── In-memory Prisma double ─────────────────────────────────────────────────

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;
type Projection = Record<string, unknown>;
type ModelName =
	| "organization"
	| "user"
	| "membership"
	| "membershipPermission"
	| "farm"
	| "pond"
	| "energyDevice"
	| "deviceStateEvent"
	| "biomassLog"
	| "pondEvent"
	| "feedEvent"
	| "platformAdmin"
	| "platformAuditLog"
	| "orgSetting";
type OrderBy = Record<string, "asc" | "desc">;

export type QueryArgs = {
	where?: Where;
	select?: Projection;
	include?: Projection;
	orderBy?: OrderBy;
	skip?: number;
	take?: number;
};

export type TenancyDelegate = {
	findMany: (args?: QueryArgs) => Promise<Row[]>;
	findFirst: (args?: QueryArgs) => Promise<Row | null>;
	findUnique: (args?: QueryArgs) => Promise<Row | null>;
	count: (args?: QueryArgs) => Promise<number>;
	create: (args: { data: Row; select?: Projection }) => Promise<Row>;
	update: (args: { where: Where; data: Row }) => Promise<Row>;
	updateMany: (args?: { where?: Where; data?: Row }) => Promise<{ count: number }>;
	upsert: (args: { where: Where; update: Row; create: Row }) => Promise<Row>;
	deleteMany: (args?: { where?: Where }) => Promise<{ count: number }>;
	delete: (args: { where: Where }) => Promise<Row>;
};

export type TenancyClient = Record<ModelName, TenancyDelegate> & {
	$transaction: <T>(fn: (tx: TenancyClient) => Promise<T>) => Promise<T>;
};

export type TenancyDb = {
	client: TenancyClient;
	tables: TenancyFixture;
	fixture: TenancyFixture;
	reset: () => void;
};

const MODEL_TABLE: Record<ModelName, keyof TenancyFixture> = {
	organization: "organizations",
	user: "users",
	membership: "memberships",
	membershipPermission: "membershipPermissions",
	farm: "farms",
	pond: "ponds",
	energyDevice: "energyDevices",
	deviceStateEvent: "deviceStateEvents",
	biomassLog: "biomassLogs",
	pondEvent: "pondEvents",
	feedEvent: "feedEvents",
	platformAdmin: "platformAdmins",
	platformAuditLog: "platformAuditLogs",
	orgSetting: "orgSettings",
};

const OPERATORS = new Set([
	"equals",
	"in",
	"notIn",
	"not",
	"lt",
	"lte",
	"gt",
	"gte",
	"contains",
	"startsWith",
	"endsWith",
	"mode",
]);

function cloneFixture(fixture: TenancyFixture): TenancyFixture {
	if (typeof structuredClone === "function") return structuredClone(fixture);
	return JSON.parse(JSON.stringify(fixture)) as TenancyFixture;
}

function rowsOf(fixture: TenancyFixture, model: ModelName): Row[] {
	return fixture[MODEL_TABLE[model]] as unknown as Row[];
}

function compareScalar(a: unknown, b: unknown): number | null {
	if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
	if (typeof a === "number" && typeof b === "number") return a - b;
	if (typeof a === "string" && typeof b === "string") return a.localeCompare(b);
	return null;
}

function matchValue(value: unknown, condition: unknown): boolean {
	if (condition === null) return value === null || value === undefined;
	if (condition instanceof Date) {
		return value instanceof Date && value.getTime() === condition.getTime();
	}
	if (typeof condition !== "object") return value === condition;

	const cond = condition as Record<string, unknown>;
	const isOperator = Object.keys(cond).some((key) => OPERATORS.has(key));
	if (!isOperator) {
		if (typeof value === "object" && value !== null) {
			return matchWhere(value as Row, cond);
		}
		return true;
	}

	if ("equals" in cond) {
		if (
			cond.mode === "insensitive" &&
			typeof value === "string" &&
			typeof cond.equals === "string"
		) {
			return value.toLowerCase() === cond.equals.toLowerCase();
		}
		if (cond.equals instanceof Date) {
			return value instanceof Date && value.getTime() === cond.equals.getTime();
		}
		return value === cond.equals;
	}
	if ("in" in cond) return Array.isArray(cond.in) && cond.in.includes(value);
	if ("notIn" in cond) return Array.isArray(cond.notIn) && !cond.notIn.includes(value);
	if ("not" in cond) return !matchValue(value, cond.not);
	if ("lt" in cond) {
		const compared = compareScalar(value, cond.lt);
		return compared !== null && compared < 0;
	}
	if ("lte" in cond) {
		const compared = compareScalar(value, cond.lte);
		return compared !== null && compared <= 0;
	}
	if ("gt" in cond) {
		const compared = compareScalar(value, cond.gt);
		return compared !== null && compared > 0;
	}
	if ("gte" in cond) {
		const compared = compareScalar(value, cond.gte);
		return compared !== null && compared >= 0;
	}
	if ("contains" in cond) {
		if (typeof value !== "string" || typeof cond.contains !== "string") return false;
		return cond.mode === "insensitive"
			? value.toLowerCase().includes(cond.contains.toLowerCase())
			: value.includes(cond.contains);
	}
	return true;
}

function matchWhere(row: Row, where: Where = {}): boolean {
	for (const [key, condition] of Object.entries(where)) {
		if (key === "OR") {
			const parts = Array.isArray(condition) ? condition : [condition];
			if (!parts.some((part) => matchWhere(row, part as Where))) return false;
			continue;
		}
		if (key === "AND") {
			const parts = Array.isArray(condition) ? condition : [condition];
			if (!parts.every((part) => matchWhere(row, part as Where))) return false;
			continue;
		}
		if (key === "NOT") {
			const parts = Array.isArray(condition) ? condition : [condition];
			if (parts.some((part) => matchWhere(row, part as Where))) return false;
			continue;
		}
		if (!matchValue(row[key], condition)) return false;
	}
	return true;
}

function sortRows(rows: Row[], orderBy?: OrderBy): Row[] {
	if (!orderBy) return rows;
	return [...rows].sort((left, right) => {
		for (const [field, direction] of Object.entries(orderBy)) {
			const compared = compareScalar(left[field], right[field]) ?? 0;
			if (compared !== 0) return direction === "asc" ? compared : -compared;
		}
		return 0;
	});
}

function projectValue(value: unknown, spec: unknown): unknown {
	if (value === null || value === undefined || spec === true) return value;
	if (Array.isArray(value)) return value.map((item) => projectValue(item, spec));
	if (typeof value !== "object") return value;

	const projection = spec as QueryArgs;
	return projectRow(value as Row, projection);
}

function projectRow(row: Row, projection: QueryArgs = {}): Row {
	if (projection.select) {
		const output: Row = {};
		for (const [key, spec] of Object.entries(projection.select)) {
			if (!spec) continue;
			output[key] = spec === true ? row[key] : projectValue(row[key], spec);
		}
		return output;
	}

	if (projection.include) {
		const output: Row = { ...row };
		for (const [key, spec] of Object.entries(projection.include)) {
			if (!spec) continue;
			output[key] = projectValue(row[key], spec);
		}
		return output;
	}

	return { ...row };
}

function decorate(model: ModelName, row: Row, fixture: TenancyFixture): Row {
	const users = rowsOf(fixture, "user");
	const farms = rowsOf(fixture, "farm");
	const ponds = rowsOf(fixture, "pond");
	const devices = rowsOf(fixture, "energyDevice");

	switch (model) {
		case "user": {
			const farm = farms.find((candidate) => candidate.ownerId === row.farmId) ?? null;
			const decoratedFarm = farm
				? {
						...farm,
						ponds: ponds
							.filter((pond) => pond.farmId === farm.id)
							.map((pond) => ({
								...pond,
								energyDevices: devices.filter((device) => device.pondId === pond.id),
							})),
					}
				: null;
			return { ...row, farm: decoratedFarm };
		}
		case "pond": {
			const owner = users.find((user) => user.farmId === row.ownerId) ?? null;
			const farm = farms.find((candidate) => candidate.id === row.farmId) ?? null;
			return {
				...row,
				owner,
				farm,
				energyDevices: devices.filter((device) => device.pondId === row.id),
				_count: { biomassLogs: 0, notifications: 0, ownershipHistory: 0 },
			};
		}
		case "energyDevice": {
			return { ...row, pond: ponds.find((pond) => pond.id === row.pondId) ?? null };
		}
		case "biomassLog": {
			return { ...row, pond: ponds.find((pond) => pond.id === row.pondId) ?? null };
		}
		case "pondEvent": {
			return { ...row, pond: ponds.find((pond) => pond.id === row.pondId) ?? null };
		}
		case "feedEvent": {
			return { ...row, device: devices.find((device) => device.id === row.deviceId) ?? null };
		}
		case "deviceStateEvent": {
			return { ...row, device: devices.find((device) => device.id === row.deviceId) ?? null };
		}
		case "farm": {
			return {
				...row,
				owner: users.find((user) => user.farmId === row.ownerId) ?? null,
				ponds: ponds
					.filter((pond) => pond.farmId === row.id)
					.map((pond) => ({
						...pond,
						energyDevices: devices.filter((device) => device.pondId === pond.id),
					})),
			};
		}
		default:
			return { ...row };
	}
}

function matchUnique(row: Row, where: Where): boolean {
	for (const [key, expected] of Object.entries(where)) {
		if (key === "membershipId_permission") {
			const composite = expected as { membershipId: string; permission: string };
			if (row.membershipId !== composite.membershipId || row.permission !== composite.permission) {
				return false;
			}
			continue;
		}
		const actual = row[key];
		if (expected instanceof Date) {
			if (!(actual instanceof Date) || actual.getTime() !== expected.getTime()) return false;
			continue;
		}
		if (actual !== expected) return false;
	}
	return true;
}

function defaultsFor(model: ModelName, now: Date): Row {
	switch (model) {
		case "user":
			return {
				displayName: null,
				role: "OPERATOR",
				mustChangePassword: false,
				createdAt: now,
				updatedAt: now,
			};
		case "organization":
			return {
				type: "INDIVIDUAL",
				status: "ACTIVE",
				parentId: null,
				suspendedAt: null,
				suspendedReason: null,
				deletionRequestedAt: null,
				purgeAfter: null,
				createdAt: now,
				updatedAt: now,
			};
		case "membership":
			return { invitedBy: null, createdAt: now, revokedAt: null };
		case "membershipPermission":
			return { grantedAt: now, revokedAt: null };
		case "farm":
			return { name: "", createdAt: now, updatedAt: now };
		case "pond":
			return {
				population: null,
				sampleIntervalDays: 14,
				notificationPrefs: {},
				status: "ACTIVE",
				isFallow: false,
				createdAt: now,
			};
		case "energyDevice":
			return {
				rtcOk: true,
				feederActive: false,
				isPaused: false,
				gramsPerFeeding: 150,
				buttonFeedGrams: 80,
				lastSeenAt: null,
				createdAt: now,
				feedLevelPercent: null,
				feedLevelCm: null,
				feedLevelUpdatedAt: null,
				waterTempC: null,
				waterTempOk: false,
				waterTempUpdatedAt: null,
				hopperEmptyCm: null,
				hopperFullCm: null,
				hopperCapacityG: null,
				gramsPerSecond: 4,
				tempOffsetC: 0,
				approvalStatus: "APPROVED",
			};
		case "deviceStateEvent":
			return {
				actorId: null,
				metadata: null,
				deviceTime: null,
				createdAt: now,
				farmId: null,
			};
		case "biomassLog":
			return { batchLabel: null, recordedAt: now, farmId: null };
		case "pondEvent":
			return {
				title: "",
				startsAt: now,
				type: "OTHER",
				status: "PLANNED",
				farmId: null,
			};
		case "feedEvent":
			return {
				eventType: "feed_dispensed",
				receivedAt: now,
				grams: null,
				source: null,
				farmId: null,
			};
		case "platformAdmin":
			return {
				grantedBy: null,
				expiresAt: null,
				revokedAt: null,
				mfaEnrolledAt: null,
				createdAt: now,
			};
		case "platformAuditLog":
			return {
				targetId: null,
				orgId: null,
				stepUpAt: null,
				temporaryGrant: false,
				impersonationId: null,
				before: null,
				after: null,
				ip: null,
				userAgent: null,
				createdAt: now,
			};
		case "orgSetting":
			return {
				defaultFeedingRatePct: 3,
				hopperLowPct: 20,
				offlineAfterMin: 30,
				missedFeedingAlerts: true,
				alertRoles: ["OWNER", "ADMIN"],
				deviceRegistration: "ADMIN_APPROVAL",
				updatedById: null,
				updatedAt: now,
			};
	}
}

/**
 * Create an in-memory Prisma-shaped client plus the mutable fixture tables.
 * `reset()` restores the fixture in place, so delegates and test references stay
 * valid between tests.
 */
export function createTenancyDb(base: TenancyFixture = createTenancyFixture()): TenancyDb {
	const fixture = cloneFixture(base);
	const state = cloneFixture(base);
	let sequence = 0;

	const createRow = (model: ModelName, data: Row): Row => {
		const now = new Date(FIXED_NOW.getTime());
		const generatedId = `${model}-${++sequence}`;
		const row: Row = { ...defaultsFor(model, now), ...data, id: data.id ?? generatedId };
		rowsOf(state, model).push(row);
		return row;
	};

	const delegateFor = (model: ModelName): TenancyDelegate => {
		const rows = () => rowsOf(state, model);
		const materialise = (row: Row, args: QueryArgs = {}) =>
			projectRow(decorate(model, row, state), args);
		// Relation filters (`device: { pondId: { in } }`) need the decorated row;
		// the raw row only holds the foreign key.
		const matches = (row: Row, where: Where = {}) => matchWhere(decorate(model, row, state), where);

		return {
			async findMany(args = {}) {
				const matched = rows().filter((row) => matches(row, args.where));
				const ordered = sortRows(matched, args.orderBy);
				const start = args.skip ?? 0;
				const end = args.take === undefined ? undefined : start + args.take;
				return ordered.slice(start, end).map((row) => materialise(row, args));
			},
			async findFirst(args = {}) {
				const matched = sortRows(
					rows().filter((row) => matches(row, args.where)),
					args.orderBy,
				);
				return matched.length > 0 ? materialise(matched[0], args) : null;
			},
			async findUnique(args = {}) {
				const found = rows().find((row) => matchUnique(row, args.where ?? {}));
				return found ? materialise(found, args) : null;
			},
			async count(args = {}) {
				return rows().filter((row) => matches(row, args.where)).length;
			},
			async create(args) {
				const row = createRow(model, args.data);
				return materialise(row, { select: args.select });
			},
			async update(args) {
				const table = rows();
				const index = table.findIndex((row) => matchUnique(row, args.where));
				if (index === -1) throw new Error(`${model} row not found`);
				const updated: Row = {
					...table[index],
					...args.data,
					updatedAt: new Date(FIXED_NOW.getTime()),
				};
				table[index] = updated;
				return materialise(updated);
			},
			async updateMany(args = {}) {
				const table = rows();
				let count = 0;
				for (let index = 0; index < table.length; index += 1) {
					if (!matches(table[index], args.where)) continue;
					table[index] = {
						...table[index],
						...args.data,
						updatedAt: new Date(FIXED_NOW.getTime()),
					};
					count += 1;
				}
				return { count };
			},
			async upsert(args) {
				const table = rows();
				const index = table.findIndex((row) => matchUnique(row, args.where));
				if (index === -1) return materialise(createRow(model, args.create));
				table[index] = {
					...table[index],
					...args.update,
					updatedAt: new Date(FIXED_NOW.getTime()),
				};
				return materialise(table[index]);
			},
			async deleteMany(args = {}) {
				const table = rows();
				let count = 0;
				for (let index = table.length - 1; index >= 0; index -= 1) {
					if (!matches(table[index], args.where)) continue;
					table.splice(index, 1);
					count += 1;
				}
				return { count };
			},
			async delete(args) {
				const table = rows();
				const index = table.findIndex((row) => matchUnique(row, args.where));
				if (index === -1) throw new Error(`${model} row not found`);
				const [removed] = table.splice(index, 1);
				return removed;
			},
		};
	};

	const client: TenancyClient = {
		organization: delegateFor("organization"),
		user: delegateFor("user"),
		membership: delegateFor("membership"),
		membershipPermission: delegateFor("membershipPermission"),
		farm: delegateFor("farm"),
		pond: delegateFor("pond"),
		energyDevice: delegateFor("energyDevice"),
		deviceStateEvent: delegateFor("deviceStateEvent"),
		biomassLog: delegateFor("biomassLog"),
		pondEvent: delegateFor("pondEvent"),
		feedEvent: delegateFor("feedEvent"),
		platformAdmin: delegateFor("platformAdmin"),
		platformAuditLog: delegateFor("platformAuditLog"),
		orgSetting: delegateFor("orgSetting"),
		$transaction: async (fn) => fn(client),
	};

	return {
		client,
		fixture,
		get tables() {
			return state;
		},
		reset() {
			const fresh = cloneFixture(fixture);
			for (const key of Object.keys(state) as Array<keyof TenancyFixture>) {
				const target = state[key] as unknown[];
				const replacement = fresh[key] as unknown[];
				target.splice(0, target.length, ...replacement);
			}
			sequence = 0;
		},
	};
}

/** Fixture rows keyed for readable test assertions. */
export function userById(db: TenancyDb, userId: string): TenancyUser {
	const user = db.tables.users.find((row) => row.id === userId);
	if (!user) throw new Error(`fixture user ${userId} not found`);
	return user;
}

export function membershipFor(db: TenancyDb, userId: string): TenancyMembership[] {
	return db.tables.memberships.filter((row) => row.userId === userId);
}
