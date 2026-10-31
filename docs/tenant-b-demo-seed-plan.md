# Tenant B demo seed — contract and remaining work (issue #418)

| Field | Value |
|---|---|
| Item | Value |
|---|---|
| Issue | [#418](https://github.com/J-Akiru5/OptiFeed/issues/418) — *feat: add a demo data on tenant2-admin account* |
| Date | 2026-10-31 |
| Requested by | Karl (issue author) |
| Owner instruction | "pull the latest in staging then read the open issues 418" (2026-10-31), then "after you pr then merge to develop branch" |
| Plan | `docs/OPTIFEED-INDUSTRY-GRADE-PLAN v3.md` |
| Implementation PR | [#434](https://github.com/J-Akiru5/OptiFeed/pull/434) — merged into `develop` as `95b4453` (commit `867cf49`) |
| Status | implemented and merged; **operator steps remain** (H12-H15, plan section 5) |
| Supersedes | nothing; no locked decision changes |

## 1. Problem

The live database carries a `tenant2-admin` account ("Tenant B Admin") that owns
the *Tenant B Fisheries* organization, but that account owns **no farm and no
ponds**. Logging in as it therefore showed an empty farmer dashboard, and the
tenant console showed almost nothing — even though the organization model, the
membership chain and the permission screens are the parts worth demonstrating.

The organization itself was intact: `tenant2-admin` was already the `OWNER` of
"Tenant B Fisheries", and `resolveOrgScope()`
(`apps/web/lib/auth/org-scope.ts`) resolves a tenant's scope as *membership →
active organization → member users → their `User.farmId` → `Pond.ownerId`*. The
missing piece was data on the tenant's own side of that chain.

## 2. What was implemented

A new scoped seed, `apps/web/scripts/seed-tenant-b.ts`, run as
`pnpm --filter web seed:tenant-b`. It gives the tenant:

| Element | Detail |
|---|---|
| Farm | "Tenant B Fisheries Farm", owned by `tenant2-admin` |
| Ponds | Two under the admin (`demo-tenant-b-pond-alpha`, `-bravo`) and one under the operator (`-gamma`) |
| Crop cycles | One `ACTIVE` grow-out cycle per pond, 135-day grow-out, with a stocking date in the past and a future target harvest |
| Calendar events | `STOCKING` (done), `SAMPLING` and `HARVEST_PLANNED` (planned) per pond |
| Feeders | Three, with distinct MAC addresses: two healthy, one weak-signal (RSSI -84 dBm), one silent for 45 minutes |
| Members | `tenant2-admin` (`OWNER`) and `tenant2-operator` (`OPERATOR`), the latter carrying a revoked `control_feeder` override |
| History | Feeding (112 pairs), feed level (110 points), water temperature (84 readings), biomass with named batches (10 logs, 40 individual fish), FCR reports (7), device activity (54 events), schedule commands (6), calibration runs (6) and notifications (5) |

The dataset itself lives in `apps/web/scripts/tenant-b-demo-data.ts` and is a
**pure function of `now`** — no clock reads, no randomness, no database access —
so the same input always produces the same rows and the tests can assert on
them exactly.

## 3. Safety properties

Each is covered by a test in `apps/web/scripts/seed-tenant-b.test.ts`:

| Property | Why it matters |
|---|---|
| Every delete is filtered by the demo pond ids or feeder MAC addresses | The staging deployment runs against the **production** database. An unscoped delete could reach another tenant's rows. |
| The existing admin keeps its Supabase identity | `getCurrentUser()` looks the row up by `supabaseId`; rewriting it makes the account unable to sign in. |
| `mustChangePassword` is only cleared with `--unlock` | The account keeps its forced password change unless the operator asks otherwise. |
| The organization the admin already owns is reused | The seed never creates a second "Tenant B Fisheries" organization. |
| A non-loopback host is refused until `SEED_TENANT_B_CONFIRM=yes` | The acknowledgement guard mirrors the e2e fixture guard (`scripts/e2e/guards.ts`). |
| Re-running replaces the demo rows | Ponds are upserted by a stable id and every child row is deleted and recreated. |

## 4. What is left to do

The implementation is merged and the issue is closed. Everything remaining is
operator-side and is recorded as **H12-H15** in plan section 5.

| ID | Remaining work | Owner |
|---|---|---|
| H12 | Run the seed against the live database: `SEED_TENANT_B_CONFIRM=yes pnpm --filter web seed:tenant-b` (add `--unlock` to skip the forced password change). **Never run against the live database** — so no demo row exists yet. | Karl |
| H13 | Decide whether the `tenant2-operator` demo member belongs on the live database. Without `SUPABASE_SERVICE_ROLE_KEY` the seed skips that member and its pond, and the console shows one member instead of two. | Karl |
| H14 | Promote `develop` → `staging`. `develop` does not deploy in this repository, so the seed script is not reachable from the preview until the promotion happens. | Jeff |
| H15 | Confirm with the other developer that their uncommitted work survived the shared-`refs/stash` incident (plan section 8, question 8). | Karl |

## 5. Verification

- `pnpm lint`, `pnpm typecheck` and `pnpm dead-code` (knip) pass.
- The full unit suite passes: 4,250 tests across 335 files, including 31 new
  tests for the seed and the dataset builder.
- All ten CI checks on PR #434 passed, including the `e2e` job against a
  disposable local Supabase stack, and all six workflows passed on the merge
  commit `95b4453` in `develop`.
- The 9 failures seen under `pnpm --filter web test:coverage` locally are
  load-dependent timeouts that also occur on the base commit without these
  changes; the same suite passes without coverage instrumentation.

## 6. Branch note

The first revision of this work was cut from `staging` (the branch that was
pulled at the start of the task) and had to be rebased onto `develop` before
merging. Merging the `staging`-based branch directly would have carried 22
staging-only merge commits into `develop` — including a staging-only
dependabot bump — and reverted 13 commits `develop` had since gained.
`CONTRIBUTING.md` section "Branch model" requires a feature branch to start
from the latest `develop`, and PR #434 follows that rule: its diff is exactly
the nine files of this change, +2,241 lines and **0 deletions**.
