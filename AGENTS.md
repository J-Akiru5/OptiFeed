# Agent rules — OptiFeed (project layer)

**Status:** canonical for this repository. Tracked in git so every agent, on every machine, reads the
same rules. This file is not a copy of the global agent protocol — it is the project layer that sits
above it.

---

## 1. Precedence

When two rules disagree, resolve in this order, highest first:

| # | Layer | Can it be overridden? |
| --- | --- | --- |
| 1 | **Platform enforcement** — OpenCode permissions, GitHub branch protection, required checks | No. If a document says otherwise, the platform wins. |
| 2 | **Explicit owner instruction** for the named task | Only by the owner |
| 3 | **This repository** — this file, `apps/web/AGENTS.md`, `docs/deployment-workflow.md`, `docs/adr/**`, `CONTRIBUTING.md` | By the owner, in a PR |
| 4 | **Global agent rules** — `~/.config/opencode/AGENTS.md` and its `instructions/` | By the owner, globally |
| 5 | Agent defaults | — |

**How to apply it:**

- For anything scoped to this repository, **layer 3 beats layer 4**. The global defaults describe a
  generic project; this repository has its own deployment model, branch model and CI gates, and they
  are authoritative here.
- Global rules still apply wherever this repository is silent.
- **Safety invariants are not overridable by silence.** Secrets handling, destructive production
  actions, authorization boundaries and the honesty protocol apply here even though they are defined
  globally. This file narrows the project's *own* defaults — it never loosens those.
- If a conflict would change blast radius, security posture or data safety, **stop and record it** in
  the task record instead of choosing silently.

Worked example — the deployment allowlist. The global default is `main` + `develop`. This repository
deploys `main` + `staging`, and `develop` is validation-only (**plan T20 / mission D7**). Layer 3
wins for this repository; do not "fix" `apps/web/vercel.json` to match the global default.

---

## 2. Do not edit the global rules

Never modify, move or delete anything under `~/.config/opencode/**` — `AGENTS.md`,
`opencode.jsonc`, `instructions/**`, agents, skills or commands.

Changes to how agents behave **in this project** go in this file (or a nested `AGENTS.md`) and land
through a pull request, so they are visible to every collaborator and every machine.

If a global rule genuinely blocks correct work here, record the conflict and ask the owner. Do not
edit around it locally.

---

## 3. Nested layers

- `apps/web/AGENTS.md` governs `apps/web/**` and is **more specific** than this file. Read it before
  touching the Next.js app.
- Deeper paths win over shallower ones for their own subtree. This file wins for the repository as a
  whole.

---

## 4. Deployment

| Branch | Role | Deploys |
| --- | --- | --- |
| `main` | production | **yes** — Vercel Production, runs `prisma migrate deploy` |
| `staging` | preview | **yes** — Vercel Preview |
| `develop` | integration | **no** — CI validation only |
| everything else | short-lived | **no**, including PR previews |

- Sources of truth: `apps/web/vercel.json` (`git.deploymentEnabled`) and
  `docs/deployment-workflow.md`. ADR: `docs/adr/0001-deployment-model.md`.
- **`develop` must never deploy**, by any route: Git integration, CLI, SHA deploy, deploy hook or
  Actions.
- Preview deployments must stay behind Vercel Deployment Protection. That is a dashboard setting and
  cannot be verified from the repository — treat it as unverified, not as guaranteed.
- The allowlist is currently **policy-only**: no in-repo check enforces it yet. Do not claim
  "verified enforcement" until a check exists.
- Production migrations only happen through the `main` deployment. Never run `prisma migrate deploy`
  against a hosted database by hand.

---

## 5. Branch model and integration

- `develop` is the integration branch. `staging` and `main` are promotion targets only.
- One task = one branch = one worktree. Never implement in the primary checkout.
- Never push directly to `develop`, `staging` or `main`. Everything lands by PR.
- Reconcile through the repository workflow (branch → PR → required checks → merge). A green local
  build is not completion.
- Never force-push or rewrite shared history.

---

## 6. Migrations

- Additive and idempotent by default.
- One open migration PR at a time.
- **A duplicate 14-digit timestamp prefix is a hard reject**, even if directory names differ.
- Rebase onto `origin/develop` before opening the PR, and re-check the prefix at merge time.
- Record reserved prefixes on the issue so the ledger survives the session.

---

## 7. CI gates

Required contexts on `develop`, `staging` and `main`:

- `quality`
- `bundle budget + latency`

`enforce_admins` is on; `strict` is off, so **GitHub does not enforce up-to-dateness or merge order**.
Sequencing is a human/agent responsibility, not a platform guarantee.

Check names are part of the contract. Do not rename `quality`, `bundle budget + latency`, or the
separate `e2e-smoke.yml` check `public smoke (chromium, firefox, webkit)`.

---

## 8. Worktrees and parallel agents

- Discover before acting: `git worktree list --porcelain`.
- Never edit another agent's worktree. Hand work over through commits or a note naming the files and
  commit ids.
- Declared ownership globs are exclusive.
- Never remove a worktree that is dirty, locked, active or foreign. Preserve on the remote first.
- Resource pressure is a scheduling constraint, not a stop order — defer heavy verification and say
  so; never report a deferred check as passed.

---

## 9. Code and commands

- Package manager: **pnpm**. Node ≥ 22.5.
- Style: Biome (tabs, 100 columns, double quotes). Conventional Commits.
- `apps/web` is Next.js on a version with breaking changes — read `node_modules/next/dist/docs/`
  before writing app code.
- Focused checks first (`pnpm --filter web typecheck`, targeted `vitest`), then the full gate.
- Do not add a second charting library to `apps/web` without a written justification; Recharts is
  already installed and themed.

---

## 10. Where the rest lives

- Contribution flow: `CONTRIBUTING.md`
- Deployment detail: `docs/deployment-workflow.md`, `docs/adr/0001-deployment-model.md`
- Product and phase decisions: `docs/SUPERADMIN-MULTITENANCY-PLAN.md` (the plan; decisions `T1`–`T26`)
- Mission records and owner decisions `D1`–`D10`: `docs/missions/2026-10-26-autonomous-mission.md`
- Global agent protocol: `~/.config/opencode/AGENTS.md` (read it; do not edit it)

---

## 11. Changing these rules

1. Open an issue describing the rule and the failure it prevents.
2. Change this file, or the specific document it points at — never both with different wording.
3. Land it by PR with the reason in the description.
4. If the change contradicts the global rules, say so explicitly in the PR. Silence is not consent.
