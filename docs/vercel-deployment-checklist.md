# OptiFeed — Vercel Deployment Checklist

> Complete these steps before deploying to production.

---

## 1. Environment Variables (Required)

Add these to Vercel Dashboard → Settings → Environment Variables:

| Variable | Where to get it | Used by |
|----------|----------------|---------|
| `UPSTASH_REDIS_REST_URL` | Upstash Console → Database overview | Rate limiting (Finding #4) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Console → Database overview | Rate limiting (Finding #4) |
| `DEVICE_TOKEN` | Generate a UUID, e.g. `esp32-tok-<uuid>` | `pnpm prisma db seed` (Finding #2) |

Without `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, the
rate limiters in `lib/rate-limit.ts` will throw at runtime. The app will
fail to start.

---

## 2. Prisma Migration Deploy

Vercel does not run `prisma migrate dev` automatically. Add this to your
build or postbuild script in `package.json`:

```json
"build": "prisma generate && prisma migrate deploy && next build"
```

Or add a `postbuild` script:

```json
"postbuild": "prisma migrate deploy"
```

Without this, schema changes (like the new `user_lockout` table) will not
be applied to the production database.

---

## ⚠️ CONFIRMATION NEEDED BEFORE IMPLEMENTATION — 3. Remove Deprecated Models

**Finding #26: Deprecated Models Still Active**

The `Device` and `FeedingEvent` models in `prisma/schema.prisma` are
marked `@deprecated` and are only used by `prisma/seed.ts`. No route
handlers or server actions reference them.

**What will happen:**
1. Remove `Device` and `FeedingEvent` model blocks from `schema.prisma`
2. Remove `Device[]` and `FeedingEvent[]` relation fields from `Pond`
3. Remove seed lines in `prisma/seed.ts` that create Device and FeedingEvent records
4. Run `prisma migrate dev --name remove-deprecated-models` to generate
   a migration that DROPs both tables

**Risk:** Any data in the `Device` or `FeedingEvent` tables will be
permanently deleted. Since these are only used for seed data, this should
be safe — but confirm you have no custom queries or reports reading from
these tables.

**Confirmation needed:** Do you want to proceed with removing these
models and their database tables? (yes/no)

---

## ⚠️ CONFIRMATION NEEDED BEFORE IMPLEMENTATION — 4. Test Framework Setup

**Finding #13: No Test Framework**

Zero test files, zero test dependencies, zero test scripts exist in the
codebase. The only quality gates are `pnpm lint` and `pnpm typecheck`.

**What will happen:**
1. Install `vitest` as a dev dependency
2. Create `vitest.config.ts` with `@/*` path alias and `globals: true`
3. Add `"test"` and `"test:watch"` scripts to `package.json`
4. Create 3 initial test files:
   - `__tests__/lib/fcr-calculation.test.ts` — 8 tests, pure math, no mocks
   - `__tests__/lib/auth/lockout.test.ts` — 6 tests, mocked Prisma
   - `__tests__/app/api/health/route.test.ts` — 2 tests, mocked Prisma
5. CI can run `pnpm test` to catch regressions automatically

**After this:** `pnpm test` runs ~16 tests in ~2 seconds.

**Confirmation needed:** Do you want me to set up Vitest with these
initial test files? (yes/no)

---

## ⚠️ CONFIRMATION NEEDED BEFORE IMPLEMENTATION — 5. Row-Level Security

**Finding #9: No Row-Level Security in Database**

The database has zero RLS policies. If someone obtains the Supabase anon
key (which is in client-side JavaScript as `NEXT_PUBLIC_SUPABASE_ANON_KEY`),
they could craft requests that bypass application-level `ownerId` checks.

**What will happen:**
1. Create `docs/rls-policies.sql` — a complete SQL migration covering:
   - 3 helper functions (`current_farm_id()`, `current_device_token_id()`,
     `current_device_pond_id()`)
   - ENABLE + FORCE RLS on all 13 tables
   - Owner policies for every table (via `auth.email()` -> farmId -> Pond.ownerId)
   - Device policies for 8 tables (via `app.current_device_token` session variable)
   - REVOKE + GRANT for defense in depth
2. This file goes in `docs/` as a reference — it is NOT auto-applied

**What you must do manually after:**
1. Run the SQL in Supabase SQL Editor (Dashboard -> SQL Editor -> New query)
2. Update `lib/auth/lockout.ts` to use `SUPABASE_SERVICE_ROLE_KEY` instead
   of anon key (the login flow checks lockout BEFORE auth, so `auth.email()`
   is NULL)
3. Add Prisma middleware to set `app.current_device_token` session variable
   in device API routes (`/api/ingest`, `/api/feed-command`, `/api/schedule-sync`)

**Risk:** If RLS is enabled without the Prisma middleware changes, ALL
database queries will fail with "permission denied" errors. The policies
are strict by default.

**Confirmation needed:** Do you want me to generate the `docs/rls-policies.sql`
file? (yes/no) Note: applying it to the database requires separate manual
steps in the Supabase dashboard.

---

## Items Already Implemented (No Action Needed)

These findings have been fixed in the codebase and require no further action:

- Finding #1: `.env` block in pre-commit hook
- Finding #2: `DEVICE_TOKEN` env var in seed (no more hardcoded token)
- Finding #3: Account lockout system (`UserLockout` table + `lib/auth/lockout.ts`)
- Finding #4: Upstash rate limiting on all endpoints (requires env vars above)
- Finding #5: `withAuth` wrapper + CI auth check for API routes
- Finding #6: Ownership validation in all server actions
- Finding #7: Security headers in `next.config.ts`
- Finding #8: CORS configuration for device API routes
- Finding #10: Error sanitization in import/confirm
- Finding #11: Error handling in feed-command and schedule-sync
- Finding #12: N+1 fix with `createMany` in import/confirm
- Finding #14: Health check endpoint at `/api/health`
- Finding #17: Removed Gemini API key prefix from debug info
- Finding #18: Prompt injection protection (per-message limit + sanitized pondName)
- Finding #19: Hardcoded user data replaced with session-derived values
- Finding #21: Shared constants file (`lib/constants.ts`) + time utils (`lib/time-utils.ts`)
- Finding #22: Export query row limits (50,000 max per type)
- Finding #23: Prisma indexes on Pond, Notification, FcrReport
- Finding #24: Audit log cursor fix (uses `id` instead of `createdAt`)
- Finding #27: Chat history cleared on logout (via `clearMessages` context)
- Finding #28: Error boundaries (`global-error.tsx`, `not-found.tsx`)
- Finding #29: try/catch added to all unprotected server actions
- Finding #30: CSV `dynamicTyping` disabled + basic type validation

---

*Generated by OptiFeed audit remediation — August 2026*
