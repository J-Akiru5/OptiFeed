export const DEFAULT_FISH_COUNT = 5000;
export const HOPPER_CAPACITY_KG = 22.19;
export const EXPORT_ROW_LIMIT = 50_000;
// A single CSV import is capped far below the export ceiling so one request
// cannot demand an unbounded transaction (F-003).
export const IMPORT_ROW_LIMIT = 5_000;
export const MAX_PROMPT_LENGTH = 10_000;
export const PH_TZ = "Asia/Manila";
/** Asia/Manila has no DST; the device RTC is treated as this offset from UTC. */
export const PH_UTC_OFFSET_MINUTES = 480;

// §3.1 retrofit: unversioned /api/* paths are dual-served alongside /api/v1/*
// until this date. New endpoints MUST be created under /api/v1 only.
export const LEGACY_API_SUNSET = "2027-06-30";

// Devices are considered offline when no heartbeat arrives within this window.
export const OFFLINE_THRESHOLD_MS = 15 * 60 * 1000;

// A dispatched/sent schedule command older than this never reached the
// device (lib/actions/energy.ts and schedule.ts clear the stale rows).
export const STALE_DISPATCHED_MS = 10 * 60 * 1000;
export const STALE_SENT_MS = 10 * 60 * 1000;

// Pending feed requests older than this are lazily marked expired on poll.
export const REQUEST_EXPIRY_MS = 60_000;

// How far back to search for orphaned FeedRequests during reconciliation.
export const RECONCILIATION_LOOKBACK_HOURS = 4;

// Heartbeat FeedEvent rows are thinned: at most one per device per 5 minutes
// unless a stored value changed (N11 — was 17,280 rows/device/day).
export const HEARTBEAT_ROW_INTERVAL_MS = 5 * 60 * 1000;

// Pellet alerts fire on a tier transition or at most this often while still low.
export const PELLET_ALERT_WINDOW_MS = 6 * 60 * 60 * 1000;

// Hopper fill thresholds (percent full): CRITICAL at or below the first,
// WARNING at or below the second, refill detected above the second.
export const PELLET_CRITICAL_PCT = 5;
export const PELLET_LOW_PCT = 20;

// Advance warning when projected feed remaining drops below this many days.
export const FEED_DAYS_WARNING = 2;
