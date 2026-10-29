/**
 * Deterministic restore-drill dataset.
 *
 * Every identifier is a literal `drill-` id (never a generated cuid), every
 * timestamp is a literal instant, and the device token is a fixed fake value.
 * Two runs of the seed therefore produce the same rows, which is what lets the
 * drill compare "before" and "after" counts and aggregates exactly.
 *
 * The values below are assertions, not just fixtures: `DRILL_INVARIANTS` is
 * computed from this data and any seed edit must update the expected values in
 * the same commit.
 */

export const DRILL = {
	org: {
		id: "drill-org",
		name: "Drill Cooperative",
		type: "COOPERATIVE",
	},
	user: {
		id: "drill-user",
		supabaseId: "drill-supabase-user",
		// User.farmId is the login slug and the tenant key used by Pond.ownerId.
		farmSlug: "drill-farmer",
		email: "drill-farmer@drill.optifeed.local",
		displayName: "Drill Farmer",
	},
	membership: {
		id: "drill-membership",
		permissionId: "drill-permission",
		permission: "pond:write",
	},
	farm: {
		id: "drill-farm",
		name: "Drill Farm",
	},
	pond: {
		id: "drill-pond",
		name: "Drill Pond 1",
	},
	cropCycle: {
		id: "drill-cycle",
		label: "Drill Batch 2026",
	},
	pondEvent: {
		id: "drill-event-stocking",
	},
	device: {
		id: "drill-device",
		mac: "D7:11:00:00:00:01",
		token: "drill-token-not-a-real-secret",
		label: "drill-feeder",
	},
	stateEvent: {
		id: "drill-state-connected",
	},
	// The "error event" the drill must restore: a failed command recorded in the
	// unified DeviceStateEvent log, with its error code in the JSON metadata.
	errorEvent: {
		id: "drill-state-error",
		code: "E_DRILL_SENSOR_FAULT",
	},
	feedRequest: {
		id: "drill-feed-request",
	},
	notifications: {
		unread: "drill-notification-unread",
		read: "drill-notification-read",
	},
};

/** Fixed instants keep the seeded rows byte-identical between runs. */
export const DRILL_TIMES = {
	organizationCreatedAt: "2026-01-01T00:00:00.000Z",
	userCreatedAt: "2026-01-05T00:00:00.000Z",
	farmCreatedAt: "2026-01-06T00:00:00.000Z",
	pondCreatedAt: "2026-01-10T00:00:00.000Z",
	cropCycleCreatedAt: "2026-01-20T00:00:00.000Z",
	stockingDate: "2026-01-20T00:00:00.000Z",
	targetHarvestDate: "2026-06-04T00:00:00.000Z",
	pondEventStartsAt: "2026-01-20T00:00:00.000Z",
	deviceCreatedAt: "2026-01-21T00:00:00.000Z",
	deviceLastSeenAt: "2026-02-02T06:00:00.000Z",
	feedRequestCreatedAt: "2026-02-02T05:55:00.000Z",
	stateEventCreatedAt: "2026-02-02T06:00:00.000Z",
	errorEventCreatedAt: "2026-02-02T06:05:00.000Z",
	unreadNotificationCreatedAt: "2026-02-02T06:10:00.000Z",
	readNotificationCreatedAt: "2026-02-01T06:10:00.000Z",
	readNotificationAcknowledgedAt: "2026-02-01T07:00:00.000Z",
};

/** Three sampling sessions; 50 + 60 + 55 = 165 fish, 2.5 + 3.0 + 2.75 = 8.25 kg. */
export const DRILL_BIOMASS_LOGS = [
	{
		id: "drill-biomass-1",
		sampleWeightKg: 2.5,
		sampleLengthCm: 45.5,
		sampleCount: 50,
		avgWeightKg: 0.05,
		batchLabel: "drill-batch-2026",
		recordedAt: "2026-02-01T06:00:00.000Z",
		samples: [
			{ id: "drill-sample-1-1", weightGrams: 48, lengthCm: 44.1 },
			{ id: "drill-sample-1-2", weightGrams: 52, lengthCm: 45.2 },
			{ id: "drill-sample-1-3", weightGrams: 50, lengthCm: 44.8 },
		],
	},
	{
		id: "drill-biomass-2",
		sampleWeightKg: 3.0,
		sampleLengthCm: 48.0,
		sampleCount: 60,
		avgWeightKg: 0.05,
		batchLabel: "drill-batch-2026",
		recordedAt: "2026-02-15T06:00:00.000Z",
		samples: [
			{ id: "drill-sample-2-1", weightGrams: 55, lengthCm: 47.5 },
			{ id: "drill-sample-2-2", weightGrams: 57, lengthCm: 48.1 },
			{ id: "drill-sample-2-3", weightGrams: 53, lengthCm: 47.9 },
		],
	},
	{
		id: "drill-biomass-3",
		sampleWeightKg: 2.75,
		sampleLengthCm: 47.2,
		sampleCount: 55,
		avgWeightKg: 0.05,
		batchLabel: "drill-batch-2026",
		recordedAt: "2026-03-01T06:00:00.000Z",
		samples: [
			{ id: "drill-sample-3-1", weightGrams: 51, lengthCm: 46.8 },
			{ id: "drill-sample-3-2", weightGrams: 49, lengthCm: 46.4 },
			{ id: "drill-sample-3-3", weightGrams: 54, lengthCm: 47.6 },
		],
	},
];

/** 250 + 300 + 200 = 750 g of feed dispensed. */
export const DRILL_FEED_EVENTS = [
	{
		id: "drill-feed-1",
		eventId: "drill-feed-event-1",
		grams: 250,
		source: "scheduled",
		timestamp: "2026-02-02T06:00:00Z",
		receivedAt: "2026-02-02T06:00:02.000Z",
	},
	{
		id: "drill-feed-2",
		eventId: "drill-feed-event-2",
		grams: 300,
		source: "scheduled",
		timestamp: "2026-02-02T12:00:00Z",
		receivedAt: "2026-02-02T12:00:03.000Z",
	},
	{
		id: "drill-feed-3",
		eventId: "drill-feed-event-3",
		grams: 200,
		source: "button",
		timestamp: "2026-02-02T18:00:00Z",
		receivedAt: "2026-02-02T18:00:01.000Z",
	},
];

/**
 * Invariants recomputed before the dump and after the restore. `expected` is a
 * literal so a wrong seed fails the baseline instead of silently becoming the
 * new truth.
 */
export const DRILL_INVARIANTS = [
	{
		id: "feed_event_total_grams",
		label: "Total grams dispensed on the drill device (SUM FeedEvent.grams)",
		expected: "750.000",
	},
	{
		id: "fish_sample_count",
		label: "FishSample rows attached to the three biomass logs",
		expected: "9",
	},
	{
		id: "biomass_sample_total",
		label: "Fish counted across the sampling sessions (SUM BiomassLog.sampleCount)",
		expected: "165",
	},
	{
		id: "biomass_weight_total_kg",
		label: "Sampled biomass (SUM BiomassLog.sampleWeightKg)",
		expected: "8.250",
	},
	{
		id: "unread_notifications",
		label: "Unread notifications on the drill pond",
		expected: "1",
	},
	{
		id: "error_event_rows",
		label: "Failed-command rows in DeviceStateEvent",
		expected: "1",
	},
	{
		id: "error_event_code",
		label: "Error code stored in the failed command's JSON metadata",
		expected: "E_DRILL_SENSOR_FAULT",
	},
	{
		id: "active_crop_cycles",
		label: "ACTIVE crop cycles on the drill pond",
		expected: "1",
	},
	{
		id: "pond_ownership_created",
		label: "Trigger-written PondOwnershipHistory CREATED rows",
		expected: "1",
	},
	{
		id: "device_token_hash_matches",
		label: "EnergyDevice.tokenHash equals sha256(token) computed by Postgres",
		expected: "true",
	},
	{
		id: "orphan_ponds",
		label: "Ponds whose farm does not exist",
		expected: "0",
	},
	{
		id: "orphan_biomass_logs",
		label: "BiomassLog rows whose pond does not exist",
		expected: "0",
	},
	{
		id: "orphan_fish_samples",
		label: "FishSample rows whose biomass log does not exist",
		expected: "0",
	},
	{
		id: "orphan_feed_events",
		label: "FeedEvent rows whose device does not exist",
		expected: "0",
	},
	{
		id: "orphan_notifications",
		label: "Notification rows whose pond does not exist",
		expected: "0",
	},
	{
		id: "orphan_crop_cycles",
		label: "CropCycle rows whose pond does not exist",
		expected: "0",
	},
	{
		id: "orphan_device_state_events",
		label: "DeviceStateEvent rows whose device does not exist",
		expected: "0",
	},
	{
		id: "orphan_memberships",
		label: "Membership rows whose organization does not exist",
		expected: "0",
	},
];
