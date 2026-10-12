-- Tasks 2.6 + 2.7: shared Postgres rate limiter + per-(farm, IP) login lockout.
--
-- rate_limit_bucket: fixed-window counters, written with atomic
-- INSERT ... ON CONFLICT DO UPDATE so concurrent serverless instances
-- cannot lose increments (the old in-memory Map reset on every deploy).
-- Expired windows are pruned by the 3.1 device-watch cron later.
--
-- login_lockout: hard lock at 5 failed PIN attempts per (farmId, ip)
-- for 15 minutes. Split by IP so a stranger cannot lock the real
-- farmer out; the global per-farm counter in user_lockout only slows
-- down (see lib/auth/lockout.ts).

CREATE TABLE IF NOT EXISTS "rate_limit_bucket" (
  "key"         TEXT        NOT NULL,
  "window_start" TIMESTAMPTZ NOT NULL,
  "count"       INTEGER     NOT NULL DEFAULT 0,
  CONSTRAINT "rate_limit_bucket_pkey" PRIMARY KEY ("key", "window_start")
);

CREATE TABLE IF NOT EXISTS "login_lockout" (
  "farmId"         TEXT        NOT NULL,
  "ip"             TEXT        NOT NULL,
  "failedAttempts" INTEGER     NOT NULL DEFAULT 0,
  "lockedUntil"    TIMESTAMPTZ,
  "lastFailedAt"   TIMESTAMPTZ,
  CONSTRAINT "login_lockout_pkey" PRIMARY KEY ("farmId", "ip")
);
