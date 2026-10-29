# Architecture decision records

This directory records the architectural decisions that are already in force in
OptiFeed. Each record is a **backfill**: the decision was taken earlier, the
code and documents already implement it, and the ADR now gives it one
addressable home. No ADR here introduces a new decision, and no record should be
read as a proposal.

An ADR is written for a decision that is hard to reverse, that constrains more
than one part of the system, or that a future maintainer would otherwise have to
reverse-engineer from code. Routine implementation choices stay in the relevant
document (see [`docs/operations/README.md`](../operations/README.md) for the
operational index).

## Index

| ADR | Decision | Status | Date |
| --- | --- | --- | --- |
| [0001](./0001-deployment-model.md) | Only `staging` and `main` deploy; `develop` is CI-only; one production database | Accepted | 2026-10-26 |
| [0002](./0002-json-bridges-before-defense.md) | New per-entity settings live in JSON bridges, not new columns, until after the capstone defense | Accepted, temporary | 2026-10-25 |
| [0003](./0003-first-party-error-capture.md) | First-party error capture in our database instead of an external service | Accepted | 2026-10-29 |
| [0004](./0004-supply-chain-policy.md) | Production-dependency audit gated at high with an expiring allowlist and range-safe overrides | Accepted | 2026-10-29 |
| [0005](./0005-release-automation.md) | Every version that reaches `main` is tagged and published from `CHANGELOG.md`, automatically | Accepted | 2026-10-29 |
| [0006](./0006-multi-tenant-rbac.md) | Tenant = Organization with membership roles plus per-membership permission overrides; platform admin is a separate authority | Accepted | 2026-10-17 |

## Status vocabulary

| Status | Meaning |
| --- | --- |
| **Accepted** | The decision is in force and the code implements it. |
| **Accepted, temporary** | In force, but a recorded trigger ends it. The record names the trigger and the migration path. |
| **Deprecated** | Still implemented, but no longer the intended direction. Do not extend it. |
| **Superseded by ADR-NNNN** | Replaced. The old record stays for history; the new one carries the decision. |

An ADR is never deleted or rewritten to say something different. When a decision
changes, add a new ADR and mark the old one superseded. A typo, a dead link or a
new related document may be fixed in place.

## Writing one

- File name: `NNNN-short-slug.md`, four digits, sequential.
- Copy [`template.md`](./template.md).
- Cite the real implementation and the real source of the decision (commit,
  plan section, issue, owner decision). An ADR that says "we decided X" without
  a link is not evidence.
- Record the costs, not only the benefits. An ADR that lists no negative
  consequence is usually incomplete.
- If part of the decision is unverified, say so in the record. "Unverified" is
  an honest status; an invented guarantee is not.

## Relationship to the mission documents

The decisions backfilled here are scattered across
[`docs/SUPERADMIN-MULTITENANCY-PLAN.md`](../SUPERADMIN-MULTITENANCY-PLAN.md)
(tenancy, permissions, deployment), [`CONTRIBUTING.md`](../../CONTRIBUTING.md)
(branch and release process), [`docs/deployment-workflow.md`](../deployment-workflow.md)
(deployment) and source comments that explain a non-obvious choice. The ADR does
not replace those documents: it records the decision, and links to the place
that carries the procedure and the detail.
