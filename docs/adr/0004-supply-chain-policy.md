# ADR-0004: Production dependency audit gated at high, with expiring exceptions

- **Status:** Accepted
- **Date:** 2026-10-29 (owner decision E3)
- **Deciders:** Jeff (owner)
- **Backfilled:** 2026-10-29
- **Related:** issue #328, [ADR-0001](./0001-deployment-model.md)

## Context

The ISO readiness audit measured **93 production advisories** at v1.29.0: 2
critical, 37 high, 43 moderate and 11 low, resolved from `pnpm-lock.yaml` across
606 production packages. Most were not real runtime exposure - they came through
`shadcn`, a component code generator that was declared as a **runtime**
dependency although nothing imports its JavaScript.

The available responses were all imperfect:

- broad major upgrades would have moved the framework and the Prisma toolchain
  during a capstone-defense cycle;
- ignoring the audit would leave a real critical in `dompurify` (reachable in
  principle through `jspdf`) and a knowable supply-chain posture;
- suppressing findings in a lockfile or a `pnpm audit` flag would hide the
  problem rather than record it.

Owner decision E3 (recorded in
[`docs/missions/2026-10-29-iso-readiness.md`](../missions/2026-10-29-iso-readiness.md))
chose a measured gate: patch criticals and reachable highs, gate at `high`, and
allow only written, expiring exceptions for the rest. No broad major upgrades.

## Decision

1. **Measure production dependencies, not the developer tree.**
   `pnpm audit --prod` is the input. A package that runs only in a shell, a CI
   job or the Vercel build is not shipped, so it is not part of the runtime
   supply-chain gate - and it must be classified as a dev dependency if that is
   what it is. `shadcn` was moved to `devDependencies` on that basis; the
   Tailwind CSS import keeps working at build time and the CLI still runs.
2. **Fail on unallowlisted critical/high.** [`scripts/security/audit-gate.mjs`](../../scripts/security/audit-gate.mjs)
   runs the audit, parses the JSON itself, and fails with exit code 1 on any
   unallowlisted critical or high. It exits 2 when the audit cannot run at all: a
   registry outage must never read as "clean".
3. **Every exception is written and expires.** [`security/audit-allowlist.json`](../../security/audit-allowlist.json)
   entries carry the advisory id, package, a written reachability reason, an
   owner and an expiry. An entry that is expired, malformed, or more than 90 days
   out fails the gate. A stale entry that no longer matches a finding is
   reported, so it can be removed.
4. **Overrides stay inside the parent's declared range.**
   [`package.json`](../../package.json) pins five transitive packages
   (`dompurify`, `proxy-addr`, `browserslist`, `source-map-js`,
   `baseline-browser-mapping`) to a patched version that the parent already
   accepts. These are floor pins, not forced majors; a fix that needs a major is
   recorded as an upgrade task instead.
5. **Automate the routine.** `.github/workflows/security.yml` runs the gate on
   pushes and pull requests; [`.github/dependabot.yml`](../../.github/dependabot.yml)
   proposes dependency updates. A separate SBOM and secret-scan workflow covers
   the artefacts and the tree, not the advisory database.

## Consequences

### Positive

- The production tree is measurably clean: **93 -> 1 finding**, all of the
  remainder allowlisted; production packages fell from 606 to 357 because the
  generator tree left the runtime dependency set.
- The exception process is auditable: a reader can see why a finding is
  accepted, who owns it, and when it must be revisited.
- The gate cannot be satisfied by breaking the audit; a failure to measure is a
  failure, not a pass.
- Classification fixes (dev vs. runtime) remove whole dependency trees instead of
  patching each advisory.

### Negative / accepted costs

- **Dev-only findings remain.** The non-`--prod` tree still has 2 criticals and
  roughly 40 highs through the vitest/vite toolchain. They are not shipped; the
  fix is a vitest 4 major, filed as #328. The gate deliberately does not fail on
  them, which is a scope decision, not an absence of findings.
- **Overrides can break a build.** Each one is a version the parent did not
  choose; the mitigation is the full gate after each override batch and reverting
  any override that does not build.
- **The allowlist needs a calendar.** An expiring entry is only useful if someone
  acts before the expiry; the 90-day cap forces a review rather than allowing a
  permanent exception.
- **`--prod` is a judgement about reachability.** It assumes build-time-only
  code is not runtime-reachable. That assumption is sound for this repository but
  must be re-checked when the build output changes (for example, adopting
  `output: "standalone"`).

### Follow-ups

- Take the `deepmerge-ts` fix with the next Prisma upgrade and delete its
  allowlist entry (expires 2027-01-27).
- Resolve #328 (vitest 4) and then consider gating the developer tree too.
- Re-run the reachability triage whenever a dependency moves between
  `dependencies` and `devDependencies`.

## Links

- Implementation: [`package.json`](../../package.json) (`pnpm.overrides`),
  [`security/audit-allowlist.json`](../../security/audit-allowlist.json),
  [`scripts/security/audit-gate.mjs`](../../scripts/security/audit-gate.mjs)
- CI: [`.github/workflows/security.yml`](../../.github/workflows/security.yml),
  [`.github/dependabot.yml`](../../.github/dependabot.yml)
- Policy and triage table: [`docs/security/supply-chain.md`](../security/supply-chain.md)
- Adjacent controls: [`.github/workflows/sbom.yml`](../../.github/workflows/sbom.yml),
  [`.gitleaks.toml`](../../.gitleaks.toml)
- Source of the decision: `docs/missions/2026-10-29-iso-readiness.md`, owner
  decision E3; measurement and rationale in `docs/security/supply-chain.md`
