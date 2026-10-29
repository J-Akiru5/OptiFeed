# Supply-chain security

Status: active from 2026-10-29 (mission I-62, ISO/IEC 25010 readiness).
Owner: Jeff. Gate: `.github/workflows/security.yml`.

This document records how dependency risk is measured, what is currently
patched, and the only permitted way to accept a finding that is not patched.

Policy in one sentence: **a `critical` or `high` advisory in a production
dependency fails CI unless it has a written, expiring allowlist entry, and every
allowlist entry is capped at 90 days.**

---

## 1. What is measured

`pnpm audit --prod` — production dependencies only, resolved from
`pnpm-lock.yaml`. Development dependencies (test runners, code generators, CLI
tools) are installed at build time but are not shipped, so they do not belong
in a runtime supply-chain gate. That distinction is what `--prod` encodes, and
it is why `shadcn` moved to `devDependencies` in this change (see §3).

Commands:

```bash
pnpm audit --prod          # human-readable, everything
pnpm audit                 # includes dev dependencies
pnpm audit:gate            # the CI gate: fails on unallowlisted critical/high
```

The gate script is `scripts/security/audit-gate.mjs`. It:

- runs `pnpm audit --prod --json` and parses the advisories itself, because
  `pnpm audit` exits non-zero whenever it finds anything of any severity;
- fails on a `critical` or `high` advisory whose `id` + `package` pair is not in
  `security/audit-allowlist.json`;
- fails when an allowlist entry is expired, malformed, or expires more than 90
  days out;
- reports — without failing — an allowlist entry that no longer matches a
  finding, so stale entries are visible;
- fails (exit 2) when the audit cannot run at all. A registry outage must not
  read as "clean";
- writes the summary to the workflow step summary and emits `::error` workflow
  commands for each blocking finding.

Exit codes: `0` pass, `1` gate failure, `2` audit could not run.

---

## 2. Baseline and result (measured 2026-10-29, v1.29.0)

| | Before | After |
| --- | --- | --- |
| Critical | 2 | **0** |
| High | 37 | **1** (allowlisted, §4) |
| Moderate | 43 | **0** |
| Low | 11 | **0** |
| Production packages audited | 606 | 357 |

Before: 93 findings — `2 critical, 37 high, 43 moderate, 11 low`. After: 1 finding
(`deepmerge-ts`, build/CLI only, see §4). The counts in the mission brief said
`36 high`; the audit itself reported 37.

---

## 3. Triage of the 2026-10-29 findings

Reachability is judged from the shipped artefact: the Next.js server bundle and
the browser bundle. Anything that only runs in a developer shell, a CI job, or
the Vercel build is not runtime-reachable.

The dominant cause was `shadcn` sitting in `dependencies`. It is a code
generation CLI (`npx shadcn add …`); no application file imports its JavaScript
— the only reference is `@import "shadcn/tailwind.css"` in `app/globals.css`,
which Tailwind resolves at build time, and `components.json`, which is CLI input.
It dragged in an entire server stack (`@modelcontextprotocol/sdk`, `express`,
`hono`, `undici`, `systeminformation`, `js-yaml`, `fast-uri`, `ip-address`, …)
that was never shipped but was counted as production. Moving it to
`devDependencies` is the correct classification, not a suppression: the package
is still installed and still used to generate components, and `pnpm audit`
(without `--prod`) still reports its tree.

| Package | Severity | Advisory ids | Reached through | Reachable in production? | Action |
| --- | --- | --- | --- | --- | --- |
| `dompurify` | critical, high | 1242880, 1242881 | `jspdf` (optional dep) → browser PDF sanitizer | **Yes, in principle** — `jspdf` is used by `lib/jobs/pdf-export.ts`, but the app never calls `doc.html()`, so the sanitizer is never invoked | override `^3.4.17` |
| `proxy-addr` | critical | 1241210 | `shadcn` → `@modelcontextprotocol/sdk` → `express` | No — dev/CLI only | `shadcn` → `devDependencies`, plus override `^2.0.8` |
| `@modelcontextprotocol/sdk` | high (4) | 1241339, 1242628, 1242649, 1243488 | `shadcn` | No — dev/CLI only | `shadcn` → `devDependencies` |
| `body-parser` | high | 1243074 | `shadcn` → `express` | No — dev/CLI only | `shadcn` → `devDependencies` |
| `brace-expansion` | high (4) | 1130591, 1130734, 1240107, 1240111 | `shadcn` → `ts-morph` → `minimatch` | No — dev/CLI only | `shadcn` → `devDependencies` |
| `browserslist` | high (2) | 1153171, 1153172 | `next` → `styled-jsx` → `@babel/core` | No — Vercel build only, input is our own browserslist config | override `^4.28.7` |
| `deepmerge-ts` | high | 1145093 | `@prisma/client` → optional `prisma` CLI → `@prisma/config` | No — CLI loads `prisma.config.ts`; the generated client does not import it | **allowlisted** (§4) — the fix is a major |
| `fast-uri` | high (8) | 1124064, 1130720, 1158521, 1158524, 1158527, 1158530, 1239943, 1240091, 1243098, 1243104 | `shadcn` → `@dotenvx/dotenvx` → `conf` → `ajv` | No — dev/CLI only | `shadcn` → `devDependencies` |
| `ip-address` | high, moderate (6) | 1130722, 1130723, 1130724, 1239948, 1239949, 1240097, 1240098, 1242883 | `shadcn` → `@modelcontextprotocol/sdk` → `express-rate-limit` | No — dev/CLI only | `shadcn` → `devDependencies` |
| `js-yaml` | high (2) | 1138115, 1193727 | `shadcn` → `cosmiconfig` | No — dev/CLI only | `shadcn` → `devDependencies` |
| `nanoid` | high (2) | 1138811, 1139427 | `shadcn` → `postcss` | No — dev/CLI only | `shadcn` → `devDependencies` |
| `postcss` | high | 1139510 | `shadcn` → `postcss` | No — dev/CLI only (`next` pins its own `postcss@8.5.23`, which is unaffected) | `shadcn` → `devDependencies` |
| `source-map-js` | high | 1241209 | `next` → `postcss` | No — build only | override `^1.2.2` |
| `systeminformation` | high | 1243663 | `shadcn` → `@dotenvx/dotenvx` | No — dev/CLI only | `shadcn` → `devDependencies` |
| `undici` | high (7) | 1130718, 1240041, 1240050, 1243113, 1243473, 1243475, 1243478 | `shadcn` | No — dev/CLI only | `shadcn` → `devDependencies` |
| `zod` | high | 1243066 | two paths: direct (`apps/web`, `^4.4.3`) and `shadcn` (`3.x`) | **Yes** — the direct copy validates API input | bump direct dependency to `^4.6.6`; the `shadcn` copy is dev-only |
| `baseline-browser-mapping` | moderate | 1193686 | `next` | No — build only | deduped via override `^2.11.0` (already inside `next`'s `^2.9.19` range) |

Every remaining `moderate`/`low` finding in the baseline belonged to the same
`shadcn` tree or to `baseline-browser-mapping`; none survives the changes above.

---

## 4. Overrides and the allowlist

`pnpm.overrides` in the root `package.json` pins four transitive packages to a
patched version. Every one of them is **inside the range its parent already
declares**, so this is a floor pin, not a forced major:

| Override | Was | Now | Declared by parent |
| --- | --- | --- | --- |
| `dompurify` | 3.4.14 | 3.4.17 | `jspdf` requires `^3.3.1` |
| `proxy-addr` | 2.0.7 | 2.0.8 | `express` requires `^2.0.7` |
| `browserslist` | 4.28.4 | 4.29.5 | `@babel/helper-compilation-targets` requires `^4.28.x` |
| `source-map-js` | 1.2.1 | 1.2.2 | `postcss` requires `^1.2.1` |
| `baseline-browser-mapping` | 2.10.42 | 2.11.34 | `next` requires `^2.9.19` (also dedupes the copy `browserslist` uses) |

Direct dependency change: `apps/web` `zod` `^4.4.3` → `^4.6.6`.

### The one allowlisted finding

`security/audit-allowlist.json` contains exactly one entry:

- **`deepmerge-ts` < 8.0.0 (advisory 1145093, high)** — reached only through
  `@prisma/client`'s optional dependency on the Prisma CLI. It merges
  `prisma.config.ts` while the CLI runs; the generated runtime client does not
  import it and no request-controlled object reaches the merge. The patched
  version is 8.0.0, a major, and Prisma 6.19.3 pins `deepmerge-ts` to `7.1.5`
  exactly. The supported fix is the Prisma 8 upgrade, not a forced major
  override inside Prisma 6. Expires **2027-01-27** (90 days).

Adding an entry is allowed only with a reason that explains why the finding is
not reachable, and an expiry no more than 90 days out. The gate enforces the
date; it cannot judge the reason, so review does.

---

## 5. Responding to a new advisory

1. `pnpm audit --prod` and read the path, not just the package name.
2. Is it in a production dependency? If it is in `devDependencies`, it is not a
   production finding; fix it when convenient, do not allowlist it here.
3. Is a patched version available inside the range the parent already declares?
   Add or update a `pnpm.overrides` entry — that is the lowest-risk fix.
4. If the patch needs a major bump of a direct dependency, treat it as its own
   task (release notes, changelog, full gate). Do not bundle it into a security
   patch PR.
5. If it cannot be fixed now, add an allowlist entry with a written reason and
   an expiry of at most 90 days, and record the follow-up.
6. Re-run `pnpm audit:gate`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and
   `pnpm build` before pushing. An override that breaks the build is worse than
   the finding it fixes.

## 6. Automation

- `.github/workflows/security.yml` — runs the gate on pushes and pull requests
  to `develop`, `staging` and `main`, plus weekly on Monday to catch advisories
  published against unchanged dependencies. It never deploys and needs no
  secrets.
- `.github/dependabot.yml` — weekly npm (root workspace) and GitHub Actions
  updates. Minor and patch updates are grouped per dependency type; major
  updates arrive as individual pull requests. No auto-merge is configured.

## 7. Findings outside the production gate (development tooling)

`pnpm audit` without `--prod` still reports the test-tooling tree. Measured
2026-10-29 after this change: **2 critical, 40 high, 57 moderate, 12 low**, where
the criticals are `tinypool@1.1.1` (two advisories) reached through
`vitest@3.2.7`, and the highs are that same vitest/vite tree plus the `shadcn`
CLI tree described in §3.

None of it is shipped: `vitest`, `vite`, `tinypool` and `shadcn` are build/dev
tools, and Vercel's build never serves them. Patching `tinypool` needs
`vite`/`vitest` 4, which is a major of the test runner and is out of scope for
this change (owner decision E3: no broad major upgrades). The follow-up is a
dedicated test-runner upgrade, not an override inside vitest 3.

This is recorded here rather than hidden: the production gate is deliberately
`--prod`, and an override of a test runner's internals would trade a
developer-only finding for a real risk of a broken test suite.

