# Restore drill record — template

**This template is intentionally empty.** Copy it to `restore-drill-YYYY-MM-DD.md`, fill it
during the drill, and commit the filled copy. Leave this file blank so the next drill starts from
a clean form. A drill without a filled record did not happen.

Instructions:

- Write times as `HH:MM` with the date and timezone (`Asia/Manila` unless stated otherwise).
- Use **Not run** rather than an assumed result. "Not run" is an honest entry; an invented
  "Pass" is a false record.
- Redact credentials, tokens, and personal data from anything pasted here.
- If a step was skipped or the order changed, say so and why.

---

## 1. Identification

| Field | Value |
| --- | --- |
| Drill date | `<YYYY-MM-DD>` |
| Drill type | `<Plan A provider restore / Plan B logical dump / Plan C no-backup finding>` |
| Operator (executes) | `<name>` |
| Recorder | `<name>` |
| Reviewer | `<name>` |
| Reason for this drill | `<first drill / scheduled / after plan change / after incident>` |
| Related issue or PR | `<#NN or n/a>` |

## 2. Scope and targets

| Field | Value |
| --- | --- |
| Production project ref | `xjjnkikgkraixlfhhvoh` (confirm before starting) |
| Scratch project ref | `<ref or n/a>` |
| Production host | `<e.g. pakaonai.syntaxure.dev>` |
| Recovery point chosen (backup id or timestamp) | `<value>` |
| Backup type offered by the provider | `<daily / PITR / none / other>` |
| PITR available? | `<yes / no / unknown>` |
| Provider retention setting observed | `<days>` |
| Migrations applied at baseline | `<count; 38 at v1.29.0>` |

## 3. Baseline captured before restoring

Production is read-only in this phase. Paste the query output, not a summary.

| Measure | Value | Captured at |
| --- | --- | --- |
| Row counts (section 7.1 query) | `<paste>` | `<HH:MM>` |
| Latest timestamps (section 7.1 query) | `<paste>` | `<HH:MM>` |
| `auth.users` count | `<value>` | `<HH:MM>` |
| `User` rows with `supabaseId` | `<value>` | `<HH:MM>` |

## 4. Timeline

| Step | Planned | Actual start | Actual end | Duration | Notes |
| --- | --- | --- | --- | --- | --- |
| Phase 0 — prepare and confirm provider backups | 15 min | `<HH:MM>` | `<HH:MM>` | `<n> min` | |
| Phase 1 — create target and restore | 30–60 min | `<HH:MM>` | `<HH:MM>` | `<n> min` | |
| Phase 2 — point local app at restored database | 20 min | `<HH:MM>` | `<HH:MM>` | `<n> min` | |
| Phase 3 — verify | `<n> min` | `<HH:MM>` | `<HH:MM>` | `<n> min` | |
| Phase 4 — tear down and record | 15 min | `<HH:MM>` | `<HH:MM>` | `<n> min` | |
| **Total, decision to verified** | ≤ 24 h (RTO) | `<HH:MM>` | `<HH:MM>` | `<n> h <n> min` | |

## 5. Verification results

Mark one column per row. Do not leave a row blank.

| Check | Expected | Observed | Pass / Fail / Not run |
| --- | --- | --- | --- |
| Restore completed without error | No error | `<observed>` | `<result>` |
| `prisma migrate status` | Up to date, `<n>` migrations | `<observed>` | `<result>` |
| Core row counts vs baseline | At or above baseline | `<observed>` | `<result>` |
| Latest timestamps vs recovery point | Within 24 h of the recovery point | `<observed>` | `<result>` |
| Auth linkage (`auth.users` ≥ `User` with `supabaseId`) | True | `<observed>` | `<result>` |
| App boots against restored database | Login page loads | `<observed>` | `<result>` |
| Login with a restored account | Succeeds, or explicitly not tested | `<observed>` | `<result>` |
| Dashboard renders pond, device, next feed | Renders | `<observed>` | `<result>` |
| Tenant isolation spot-check | No cross-farm data | `<observed>` | `<result>` |
| Device rows keep `lastSeenAt` and hashed token | Present, no token printed | `<observed>` | `<result>` |
| No feed command sent | Zero commands | `<observed>` | `<result>` |
| Production unchanged after drill | Counts did not shrink | `<observed>` | `<result>` |

## 6. Data handling and teardown

| Field | Value |
| --- | --- |
| Scratch project deleted | `<yes/no/n/a>` at `<HH:MM>` |
| Local dump deleted | `<yes/no/n/a>` at `<HH:MM>` |
| Drill environment variables cleared | `<yes/no/n/a>` at `<HH:MM>` (closing the drill terminal is enough) |
| Any copy of restored data retained | `<none / describe and justify>` |
| Personal data seen outside its intended place | `<none / describe>` |

## 7. Outcome

| Field | Value |
| --- | --- |
| Overall result | `<Pass / Pass with findings / Fail>` |
| Data loss observed in the restore | `<none / describe>` |
| Measured RTO vs 24-hour target | `<within / exceeded by n hours>` |
| Does the measured result support the current RPO/RTO? | `<yes / no — propose amendment>` |
| Was production affected? | `<no / describe>` |

## 8. Findings and follow-ups

| # | Finding | Severity | Owner | Issue | Due |
| --- | --- | --- | --- | --- | --- |
| 1 | `<finding>` | `<high/medium/low>` | `<name>` | `<#NN>` | `<YYYY-MM-DD>` |
| 2 | | | | | |

Procedure changes required:

- `<change, or "none">`

Documents to update as a result:

- `<docs/operations/backup-and-recovery.md section, or "none">`

## 9. Sign-off

| Role | Name | Date | Signature or confirmation |
| --- | --- | --- | --- |
| Operator | `<name>` | `<YYYY-MM-DD>` | `<confirmation>` |
| Recorder | `<name>` | `<YYYY-MM-DD>` | `<confirmation>` |
| Reviewer | `<name>` | `<YYYY-MM-DD>` | `<confirmation>` |

By signing, the operator confirms that the restore was executed as recorded, that no step was
reported as passed without being run, and that production data was not modified except as stated
in section 7.
