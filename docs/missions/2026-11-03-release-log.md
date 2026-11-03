# Release log — 2026-11-02/03

Owner-authorized autonomous session. Production moved six times in one night, each promotion preceded by a full logical backup of the single hosted database.

## Releases

| Version | Type | Contents |
| --- | --- | --- |
| 1.44.0 | MINOR | The #581-#592 audit slate: atomic feed request, one open alert episode per condition, transactional ingest + `feed_dispensed` idempotency, membership-derived write authority, OWNER hierarchy guards, job retry cap and dead-letter, OTA variant binding, release drift guard, biomass i18n and a11y |
| 1.44.1 | PATCH | #593 RLS containment, list indexes, `DeviceStateEvent` retention |
| 1.45.0 | MINOR | #624 device health fails closed, #623 camera controls, #629 chart system |
| 1.45.1 | PATCH | #622 offset applied once, #620 live health, #602 chat header, #626/#613/#568 |
| 1.46.0 | MINOR | #630 data contracts, #616 large-screen 3D overview |
| 1.47.0 | MINOR | #625 PDF branding, #623 feeder underside, #666 kiosk live header, #617/#618 audits |

## Decisions made while the owner was away

- **#612** raised `resource-summary:total:size` 520,000 -> 525,000. The gate was failing at 520,079 and 520,001 on unrelated branches with 78 bytes of run-to-run variance. Recorded as a calibration fix, not a regression waiver.
- **#650 integration batch.** Three PRs could not land independently because they all append to `CHANGELOG.md`. Merged as one branch with reviewed conflict resolution: `feeder-fallback.tsx` keeps both the #620 freshness props and #626's `onBackToViewer`; `settings-pages.test.tsx` keeps the #622 and #613 tests as two separate cases; `feeder-simple-mode.test.tsx` supplies the live-health props #620 made required.
- **Dependency policy.** Minor and patch bumps merged (#544, #541). Majors held (#545 sonner 2, #546 commitlint 21) under the owner's "stable version wins" instruction.
- **Audits allowed to file.** #617 and #618 each filed their findings as separate issues per their acceptance criteria; 12 issues resulted, of which two were P1 defects fixed the same night (#671 backup dump injection, #670 feed-command double-dispatch).

## Open, with owners

| Issue | Owner | State |
| --- | --- | --- |
| #628 superadmin shell/tokens/theme | op4 | in progress |
| #631 independent QA matrix | op4 | after H/I/J |
| #665 offline sample replay | op2 | in progress |
| #669 auth deletion inside transaction | op1 | in progress |
| #658-#662 firmware/calibration gaps | - | queued |
| #572 sticky header | - | resolves in #628 |
| #563 CI watch | - | tracker, quiet |

## Held for the owner

- **#668** staging shares the production database and credentials. Documented as a decision; separating it is infrastructure spend.
- **#672** provider backups/PITR unconfirmed. The CI restore drill passes; the provider side cannot be verified from the repository.
- **#545 / #546** major dependency bumps.

## Operational facts worth keeping

- There is **one** hosted database. `apps/web/scripts/migrate-if-production.mjs` gates `prisma migrate deploy` on `VERCEL_ENV === "production"`, so only the `main` deployment migrates. Staging shares the database, which is why this guard exists.
- The app's database role is `postgres`, `rolbypassrls = true`, owner of all 44 public tables. RLS can be enabled safely; no table uses `FORCE ROW LEVEL SECURITY`.
- Backups from this session live outside the repository in `_orchestration/backups/` (44 tables, ~3,495 rows, 1.85 MB each).
- Worktrees: 61 at the start of the session, 31 after cleanup, ~5.3 GB reclaimed.
