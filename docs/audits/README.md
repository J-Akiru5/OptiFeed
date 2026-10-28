# Calculation audits — index (2026-10-28)

Jeff asked for the backend's computational logic to be audited to help Karl, who is
recording the fixes in the plan as **amendment A-001**
(`docs/amendments/A-001-feeding-single-source.md` and the contract
`docs/feeding-single-source-plan.md`, on branch `docs/update-industry-grade-plan`).

**Decision (Jeff, 2026-10-28): ledgers now, code later.** These ledgers are merged into
`develop` as reference material. The code fixes the audit workers wrote are **not** merged:
they stay on their branches and get reconciled onto Karl's `feat/feeding-single-source`
branch once it is pushed, so A-001 has one implementation, not two.

| Ledger | Area | Held code branch | A-001 overlap |
|---|---|---|---|
| [2026-10-28-calc-feeding.md](2026-10-28-calc-feeding.md) | feed amount, per-meal grams, prediction, schedule caps, next feeding | `mission/I-34-feeding` | defects 4, 5, 7, 8, 9 · F-01, F-02, F-03, F-06 (cap paths), F-07 · D5, D6, D8, D9 |
| [2026-10-28-calc-growth.md](2026-10-28-calc-growth.md) | ABW, biomass, live count, FCR, SGR, growth plan, harvest | `mission/I-35-growth` | defects 1, 2, 3, 10 · F-04, F-05 |
| [2026-10-28-calc-device.md](2026-10-28-calc-device.md) | hopper %, days remaining, calibration, drift, device API numbers | `mission/I-36-device` | defect 11 only; the rest (hopper, drift, calibration) is **not** in A-001 and can merge separately |

Line numbers in the ledgers refer to `develop` at `d2ff03a` (2026-10-28 10:40). Sections
titled "Defects fixed" describe the held branches, not `develop`.

## Where the audits and A-001 differ (needs Karl/Jeff)

1. **Which fish count.**
   - A-001 (D5) makes `Pond.population` the single source.
   - The audits feed **live fish = stocked − mortality**, matching the data sheet (300 → 285).
   - The growth ledger (I-35) notes there is **no mortality record in the schema**, so
     "live fish" can only come from `Pond.population` being kept up to date (its option B),
     unless a mortality log is added (its option A, which needs a migration).
   - The feeding ledger (I-34) reports 2,110 g → 2,004.55 g "when the cycle records 285 live
     fish". Check which field it reads before reconciling: it should be the same source the
     growth ledger names.
2. **The FCR tile is imported, not calculated.** `FcrReport` is written only by seed/import
   (growth ledger, item 2). Choose between a rolling live FCR or a report written at harvest.
3. **Projected harvest in the AI context** still uses stocked × survival (growth ledger,
   item 3).
4. **Data-sheet row 1** says 0.093 kg/day, but 0.0093 kg × 300 × 10 % = 0.279 kg. The data
   was left as recorded.

## Agreements (no decision needed)

- `lib/feed-calc.ts` is the only correct formula: Daily = biomass × rate; per meal = daily ÷
  feeds per day.
- The phantom 5,000-fish fallback must go: an unknown population means no actionable number.
- The FCR calculator's rate is 5,000× too small (double division by the fish count).
- There must be one next-feeding implementation, in Asia/Manila time.
- There must be one daily-cap function, which the platform factor can only lower.
- `hand_fed` rows count as feed given for FCR, but never as device output.

## Related audit (not a calculation audit)

- [2026-10-28-audit-trail-benchmark.md](2026-10-28-audit-trail-benchmark.md) — the
  industry comparison and RBAC/retention gap analysis behind issue #273. It records what
  the current `DeviceStateEvent` audit trail can prove and the schema-level gaps
  (IP/user-agent, typed before/after, actor snapshots, hash chain/WORM, retention) that
  would need a migration. Implemented work is on `develop` since v1.22.0.
