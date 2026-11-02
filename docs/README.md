# OptiFeed documentation — start here

This page is the map, not the rules. Every row points at one canonical file, so
there is a single place to change each rule and nothing here can drift from it.

## Read by what you are doing

| I am… | Read |
| --- | --- |
| new to the codebase | [`HANDOFF.md`](../HANDOFF.md) — where we are and what the pieces are |
| about to commit or open a PR | [`CONTRIBUTING.md`](../CONTRIBUTING.md) — branch model, review rules, who promotes |
| deploying or promoting a release | [`docs/deployment-workflow.md`](./deployment-workflow.md) and [ADR-0001](./adr/0001-deployment-model.md) |
| planning the next phase | [`docs/OPTIFEED-INDUSTRY-GRADE-PLAN v3.md`](./OPTIFEED-INDUSTRY-GRADE-PLAN%20v3.md) |
| checking why a decision exists | [`docs/adr/`](./adr/) — one record per locked decision |
| picking up a task | [`docs/missions/`](./missions/) — the dated record, newest first |
| changing an API route | [`docs/api-regulation-backlog.md`](./api-regulation-backlog.md) and `pnpm api:check` |
| touching the firmware contract | [`docs/firmware-dashboard-config.md`](./firmware-dashboard-config.md) and [`docs/hardware/`](./hardware/) |
| calibrating a device, or asking what a technician can adjust | [`docs/audits/2026-11-03-calibration-coverage.md`](./audits/2026-11-03-calibration-coverage.md) |
| adding copy or a locale | [`docs/i18n.md`](./i18n.md) |

## The plan and the record

- **Plan** — [`docs/OPTIFEED-INDUSTRY-GRADE-PLAN v3.md`](./OPTIFEED-INDUSTRY-GRADE-PLAN%20v3.md).
  One file, with an update log that names the base commit of every amendment.
  Change the plan in the same PR that changes the behaviour it describes.
- **Decisions** — [`docs/adr/`](./adr/). A decision that changes behaviour gets
  an ADR before the code that depends on it.
- **Missions** — [`docs/missions/`](./missions/). Dated records of what was
  asked, what changed and what proved it worked. Newest first.
- **Change history** — [`CHANGELOG.md`](../CHANGELOG.md). `Unreleased` is filled
  in the same change that alters behaviour.

## Area guides

| Area | Start at |
| --- | --- |
| Deployment and release | [`docs/deployment-workflow.md`](./deployment-workflow.md), [`docs/vercel-deployment-checklist.md`](./vercel-deployment-checklist.md) |
| Operations and recovery | [`docs/runbook.md`](./runbook.md), [`docs/operations/`](./operations/) |
| Security | [`docs/security/`](./security/) |
| Performance | [`docs/performance/`](./performance/) |
| Testing | [`docs/e2e.md`](./e2e.md), [`docs/e2e-on-production.md`](./e2e-on-production.md) |
| Internationalisation | [`docs/i18n.md`](./i18n.md), [`docs/i18n/tagalog-glossary.md`](./i18n/tagalog-glossary.md) |
| Data and tenancy | [`docs/rbac-permissions.md`](./rbac-permissions.md), [`docs/superadmin-multitenancy-plan.md`](./SUPERADMIN-MULTITENANCY-PLAN.md), [`docs/superadmin-data-contracts.md`](./superadmin-data-contracts.md) |
| Offline and PWA | [`docs/pwa-offline.md`](./pwa-offline.md) |
| Legal and privacy | [`docs/legal/`](./legal/) |
| Audits | [`docs/audits/`](./audits/) |

## Quality gates

CI runs the full set on every pull request into `develop`. Run the cheap ones
locally first; the commands and what each proves are listed in the
[`package.json`](../package.json) scripts.

```bash
pnpm self-check                 # migrations, schema and repository invariants
pnpm lint                       # Biome
pnpm typecheck                  # TypeScript, whole workspace
pnpm --filter web test:coverage # unit/integration + coverage gate
pnpm api:check                  # every API route declares its guard and endpoint
pnpm --filter web test:e2e      # Playwright against a local Supabase stack
```

## The wiki is a generated mirror

The GitHub wiki is **not** a second source of truth. It is generated from the
files above, pinned to one commit, and every page says so at the top. If a wiki
page and the repository disagree, the repository wins and the page is stale.

Rebuild it after the plan, the ADRs or the mission log change:

```bash
git clone https://github.com/J-Akiru5/OptiFeed.wiki.git /tmp/optifeed-wiki
node scripts/docs/build-wiki.mjs --out /tmp/optifeed-wiki
git -C /tmp/optifeed-wiki add -A
git -C /tmp/optifeed-wiki commit -m "docs(wiki): regenerate from <commit>"
git -C /tmp/optifeed-wiki push
```

`scripts/docs/build-wiki.mjs` reads the repository and writes `Home`, `Plan`,
`Decisions`, `Missions`, `Deployment`, `Quality`, plus the wiki `_Sidebar` and
`_Footer`. It never rewords the plan or the ADRs; it links to them at the
generated commit.
