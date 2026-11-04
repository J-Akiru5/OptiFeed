# Mission 2026-11-04: OP2 issue batch #710–#732

Owner: Jeff. Lead / integrator: OpenCode.
Base at start: `origin/develop` @ `d7ff4518` (v1.51.0, 2026-11-03).
Branch: `docs/op2-issue-batch-2026-11-04`.

This document is the single source of truth for the batch. It records what was attempted, what
was verified, and what remains an owner decision. `CONTRIBUTING.md`,
`docs/deployment-workflow.md`, `CHANGELOG.md` and the production-readiness register remain
authoritative for their own scopes.

## Rules read before changing code

- `CONTRIBUTING.md` — one branch per task, PR into `develop`, review required, database rules.
- `docs/deployment-workflow.md` — only `staging` and `main` deploy; `develop` is CI-only.
- `docs/audits/2026-11-03-production-readiness.md` — the register behind the issues.
- `.github/pull_request_template.md` — verification evidence is mandatory.
- Global agent rules — no deployment, no production database change, Tier C owner boundaries.

## Scope

Open issues #710–#732 (22 issues; #716 is a pull request, not an issue).

## Delivered

| Branch | Issues | PR | State |
| --- | --- | --- | --- |
| `fix/auth-reset-lockout-718-721-732` | #718, #721, #732 (parts 2–3), #712 docs | #739 | **merged**; #718/#721/#732 closed; #712 remains open for the Supabase account action |
| `fix/ingest-724-727` | #724, #727 | #736 | **merged**; #724/#727 closed |
| `fix/jobs-723-728` | #723, #728 | #737 | **merged**; #723 closed; #728 closed as partial (timeout-cancellation follow-up) |
| `chore/ci-deps-dx-710-713-714-715-722` | #710, #713, #714, #715, #722 | #738 | **merged**; #713/#714/#715/#722 closed; #710 closed separately (required-check decision remains) |

The four branches were merged into `chore/op2-verification` for the combined gate. Two
integration-only defects were found and fixed there:

- `ImportConfirmation` had no backup export decision; it is now excluded with a written reason.
- The superadmin "Send link" flow minted a recovery link without the new reset proof and still
  used the production fallback. It now mints the same proof after step-up and fails closed when
  the base URL is unset.

## Verification

Local gate on the combined verification tree:

- `pnpm lint` — **pass** (1,247 files checked, no fixes).
- `pnpm typecheck` — **pass** after `pnpm --filter web prisma:generate`.
- Focused Vitest — **15 files / 377 tests pass** across auth, ingest and jobs.
- `pnpm install --frozen-lockfile` — **pass** with the pnpm 10 overrides and the guarded
  `postinstall`; the old pnpm warning is gone.
- `pnpm security:overrides` — **PASS**; all nine overrides resolve within their floors.
- Full `pnpm test` + coverage — **pass**: 456 files / 5,468 tests; coverage 92.23 % lines,
  90.21 % statements, 92.4 % functions, 82.59 % branches (floors 90/89/91.5/81.5).

CI on the PRs: #736, #737, #738, #739 and this docs record (#740) are all merged. Every
code PR was fully green, including `docker build (no push)`, `quality`, `e2e`,
`lighthouse budgets`, `bundle budget + latency` and the public smoke. The three migrations are
independent additive tables: `20261104100000` (events), `20261104110000` (imports) and
`20261104120000` (reset proofs). The auth migration landed before the import one, so the
timestamps are not the merge order; they touch different tables, so application order is
immaterial. No deployment was triggered by these branches.

## Currently open issues (7)

These are the only issues from #710–#732 still open. The rest are closed as done, or were
closed by Jeff. The three owner decisions below are the work that remains.

| Issue | Why it is open |
| --- | --- |
| #711 — RLS bypassed by the app role | Tier C. A dedicated non-`BYPASSRLS` role, grants and INSERT/DELETE policies need owner approval, a backup and a production change. Existing RLS is documented containment, not tenancy. |
| #712 — two accounts on the breached temporary password | The documentation part is done; `superadmin`, `independent-farmer` and `test` still need action in Supabase Auth (decision 3 below). |
| #719 — no MFA | Product feature and policy decision (TOTP enrolment, recovery codes, enforcement). |
| #726 — no retention / no org purge | Automatic deletion of telemetry/PII and the lawful retention periods are owner/legal decisions. |
| #729 — no external alerting / SLO pager | Requires an external service, credentials and an on-call policy. |
| #730 — authenticated perf/a11y gate + coverage floor | Needs a seeded authenticated stack, a deliberate bundle re-baseline and a coverage-threshold decision. |
| #731 — 5-second polling at 1,000 devices | Architecture decision (batch telemetry, MQTT/WebSocket or poll cadence) plus a load-test target. |

Closed by this batch: #710, #713, #714, #715, #717, #718, #720, #721, #722, #723, #724, #725,
#727, #728, #732. (#710 and #725 were closed by Jeff; the others closed as done.)

## Owner decisions required (Jeff)

These are the three decisions/actions the batch leaves open. Nothing below was done by an agent
without authorization.

### 1. Approve the three production migrations

The normal `main` deployment applies migrations with `prisma migrate deploy`. Before the next
production release, review and explicitly approve these three:

| Migration | What it does | Decision / risk |
| --- | --- | --- |
| `apps/web/prisma/migrations/20261104100000_feed_event_device_unique` | Drops the global `FeedEvent.eventId` unique index and creates the compound `(deviceId, eventId)` unique index. | **Explicit approval required** under `CONTRIBUTING.md` §8 because it drops an existing index. No rows are deleted; the old constraint was stricter, so existing data cannot violate the new one. Confirm a verified backup before applying. |
| `apps/web/prisma/migrations/20261104110000_import_idempotency` | Creates the `ImportConfirmation` table, its owner/key unique index and RLS default-deny. | Additive, no existing data touched. |
| `apps/web/prisma/migrations/20261104120000_password_reset_proof` | Creates the `PasswordResetToken` table, its unique/indexes and RLS default-deny. | Additive, no existing data touched. |

Do **not** run `prisma migrate dev` or `prisma migrate reset` against production. Approve the
schema relaxation above, confirm the backup, and let the documented `main` release path apply
them. If the index drop is not approved, the release must exclude that migration and the
event-id bug remains open.

### 2. Decide the required status checks

#738 corrected the Lighthouse budget and added `docs/ci-required-checks.md`, but adding required
checks is a GitHub branch-protection change and remains owner-only. Decide whether `develop`,
`staging` and `main` should require:

- `audit`
- `CycloneDX SBOM`
- `gitleaks`
- `public smoke (chromium, firefox, webkit)`
- `lighthouse budgets`

The exact `gh api` capture/apply/rollback commands are in `docs/ci-required-checks.md`. If the
answer is “not yet”, record that decision and leave the checks advisory.

### 3. Complete the Supabase Auth account actions (#712)

The repository cannot verify or change these; only Supabase Auth holds the credentials:

- Confirm whether `superadmin` still uses `password123`; if so, rotate it to a unique random
  password.
- Force completion of the password change (or disable) `independent-farmer` and `test`, which
  were still flagged `mustChangePassword = true` on 2026-11-03.
- Stop using `password123` as a shared manual-testing fallback; use per-account random temporary
  passwords.

### Verification after the decisions

- Run a real-email smoke test of the recovery link to confirm Supabase preserves the
  `?reset=...` parameter through the action link. The flow fails closed if the parameter is
  dropped.
- Decide the parked issues in the table above: schedule them, accept the risk in writing, or
  close them as won't-fix. They are not silently done.
