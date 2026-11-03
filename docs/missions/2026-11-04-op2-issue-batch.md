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
| `fix/auth-reset-lockout-718-721-732` | #718, #721, #732 (parts 2–3), #712 docs | #739 | **merged**; #718/#721/#732 close on merge |
| `fix/ingest-724-727` | #724, #727 | #736 | **merged**; #724/#727 close on merge |
| `fix/jobs-723-728` | #723, #728 | #737 | open, **all checks green**; #723 closes on merge, #728 remains partial |
| `chore/ci-deps-dx-710-713-714-715-722` | #710, #713, #714, #715, #722 | #738 | **merged** into `develop` @ `77a7b362`; #713/#714/#715/#722 closed |

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

CI on the PRs: #738, #736 and #739 are merged and were fully green, including `docker build (no
push)`, `quality`, `e2e`, `lighthouse budgets`, `bundle budget + latency` and the public smoke.
#737 was merged with `origin/develop` after those landings and is now fully green, ready to merge.
#740 is this docs-only mission record; its checks rerun after each documentation edit. The three migrations are independent additive tables: `20261104100000` (events),
`20261104110000` (imports) and `20261104120000` (reset proofs). The auth migration landed before
the import one, so the timestamps are not the merge order; they touch different tables, so
application order is immaterial. No deployment was triggered by these branches.

## Deliberately parked

| Issue | Reason |
| --- | --- |
| #711 — RLS bypassed by the app role | Tier C. A dedicated non-`BYPASSRLS` role, grants and INSERT/DELETE policies need owner approval, a backup and a production change. Existing RLS is documented containment, not tenancy. |
| #717 — non-HttpOnly cookies / CSP inline scripts | The `@supabase/ssr` browser client reads its own auth cookies; `httpOnly: true` would break client-side session recovery and data fetching. Removing `unsafe-inline` needs a per-request nonce across the App Router. Architectural change. |
| #719 — no MFA | Product feature and policy decision (TOTP enrolment, recovery codes, enforcement). |
| #720 — plaintext device tokens / no step-up | Encryption/hashing needs key rotation and a migration; the tenant-admin reveal UI has no step-up dialog, so adding `withStepUp` alone would break the flow. |
| #725 — out-of-band cron SQL / no heartbeat | Needs Supabase scheduling, Vault secrets and an external dead-man's-switch; owner infrastructure. |
| #726 — no retention / no org purge | Automatic deletion of telemetry/PII and the lawful retention periods are owner/legal decisions. |
| #729 — no external alerting / SLO pager | Requires an external service, credentials and an on-call policy. |
| #730 — authenticated perf/a11y gate + coverage floor | Needs a seeded authenticated stack, a deliberate bundle re-baseline and a coverage-threshold decision. |
| #731 — 5-second polling at 1,000 devices | Architecture decision (batch telemetry, MQTT/WebSocket or poll cadence) plus a load-test target. |
| #710 — required checks (partial) | Lighthouse budget is corrected; adding required status checks is a GitHub branch-protection change and an owner action. |
| #728 — timeout cancellation (partial) | Artifact size cap and no-copy are delivered; true cancellation needs request-signal plumbing through every builder. |

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
