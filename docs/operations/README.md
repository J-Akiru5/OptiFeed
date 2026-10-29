# Operations index

One page to find the operational document for the job in front of you, and to
see which operational processes are **not** documented or verified yet. The
index is the entry point; the linked document is the procedure.

If you are reading this during an incident, start with section 1.

## 1. If something is broken now

| Situation | Read first | Then |
| --- | --- | --- |
| Feeder is dosing continuously or a dose is too large | [`docs/runbook.md`](../runbook.md) section 1 - pause the device, then cut relay power | Firmware caps in the same section |
| Device shows offline | [`docs/runbook.md`](../runbook.md) section 2 | Admin -> Devices, `device-watch` cron |
| Database errors, elevated 5xx, login broken | [`docs/runbook.md`](../runbook.md) section 3 | [Error handling](./error-handling.md), [incident response](../security/incident-response.md) |
| Data loss or a bad migration | [`docs/runbook.md`](../runbook.md) section 4, then [backup and recovery](./backup-and-recovery.md) | Do not restore production without the owner (decision E4) |
| Suspected security incident or credential leak | [`docs/security/incident-response.md`](../security/incident-response.md) | [`SECURITY.md`](../../SECURITY.md) for disclosure |
| A bad production deployment | [`docs/deployment-workflow.md`](../deployment-workflow.md) section 8 | Vercel Instant Rollback; migrations are not reverted |
| Errors are captured but nobody sees them | [Error handling](./error-handling.md) | Add the alerting follow-up before relying on it |

## 2. The index

### Live operations

| Document | What it covers | Read it when |
| --- | --- | --- |
| [`docs/runbook.md`](../runbook.md) | Triage for a runaway feeder, an offline device, a database outage and a restore | Anything is failing in production |
| [`docs/operations/error-handling.md`](./error-handling.md) | Where errors are captured (logs + `ErrorEvent`), dedupe, scrubbing, retention, triage steps | A user reports a failure, or the error console shows a new entry |
| [`docs/security/incident-response.md`](../security/incident-response.md) | Severity levels, roles, containment per asset, notification duties, post-incident review | An incident is suspected or declared |
| [`docs/security/threat-model.md`](../security/threat-model.md) | Assets, trust boundaries, existing controls and residual risk | You are assessing whether a change weakens a control |

### Data protection and recovery

| Document | What it covers | Read it when |
| --- | --- | --- |
| [`docs/operations/backup-and-recovery.md`](./backup-and-recovery.md) | What is backed up, RPO/RTO (24 h/24 h), retention, restore paths, drill runbook, verification, production-restore rules | Before any migration or restore, and when planning a drill |
| [`docs/operations/restore-drill-record.md`](./restore-drill-record.md) | The blank record to fill during a drill | You are executing a restore drill |
| [`docs/legal/README.md`](../legal/README.md) | Data-processing addendum, research consent and ethics documents | A data-subject request, a privacy question or a research-use review |

### Deployment and environments

| Document | What it covers | Read it when |
| --- | --- | --- |
| [`docs/deployment-workflow.md`](../deployment-workflow.md) | Branch/deployment matrix, the single Vercel mechanism, CI guarantees, migrations during a build, promotion and rollback, shared staging/production database | You are promoting a release, changing a workflow, or asking "which branch deploys?" |
| [`docs/vercel-deployment-checklist.md`](../vercel-deployment-checklist.md) | The per-release Vercel checklist | You are about to promote to production |
| [`docs/operations/deployment.md`](./deployment.md) | The container image (Dockerfile, compose) and what it still needs - never built, not used by Vercel | You are running OptiFeed outside Vercel |
| [`docs/operations/environment-matrix.md`](./environment-matrix.md) | Every environment variable, its layer (build/runtime/browser/tooling), and what breaks when it is missing | You are configuring an environment or debugging a missing variable |
| [`CONTRIBUTING.md`](../../CONTRIBUTING.md) sections 9-10 | Release process and deployment rules for developers | You are preparing or promoting a release |

### Quality gates and test environments

| Document | What it covers | Read it when |
| --- | --- | --- |
| [`docs/e2e.md`](../e2e.md) | The Playwright suite, its guards, the disposable local Supabase stack, the CI job and the coverage gate | You are running or changing the E2E suite |
| [`docs/e2e-on-production.md`](../e2e-on-production.md) | The isolated `e2e-` fixture against the production project, and why it is restricted | You need a production-like run (owner/integrator only) |
| [`docs/operations/maintainability.md`](./maintainability.md) | The dead-code (Knip) and complexity gates, their measured baselines and exemptions | A maintainability job fails, or you are adding a file/export/entry point |
| [`docs/adr/README.md`](../adr/README.md) | The architecture decisions behind the gates (deployment, error capture, supply chain, release, RBAC) | You are about to change one of those decisions |

### Security operations

| Document | What it covers | Read it when |
| --- | --- | --- |
| [`SECURITY.md`](../../SECURITY.md) | Disclosure policy, supported versions, safe harbour | Someone reports a vulnerability |
| [`docs/security/README.md`](../security/README.md) | Index of the security documents and the CI controls (audit gate, SBOM, secret scan) | You need the security picture in one page |
| [`docs/security/supply-chain.md`](../security/supply-chain.md) | Audit gate, allowlist policy and expiry, overrides, Dependabot | A dependency advisory fails CI, or you are adding/upgrading one |
| [`docs/security/authz-review.md`](../security/authz-review.md) | The authorization model, every guard helper and the defects found | You are changing a guard, a role or a tenant boundary |
| [`docs/security/csp-review.md`](../security/csp-review.md) | Which CSP is enforced, what it blocks, what is missing | You are changing headers, adding an embed or a third-party script |

### Device and firmware operations

| Document | What it covers | Read it when |
| --- | --- | --- |
| [`docs/firmware-ota-plan.md`](../firmware-ota-plan.md) | Remote firmware update design, signing and rollback | You are shipping or debugging an OTA update |
| [`docs/flash-plan.md`](../flash-plan.md) | ESP32 flashing procedure | A unit needs a factory or bench flash |
| [`docs/hardware/2026-10-28-cict-pin-map-and-health.md`](../hardware/2026-10-28-cict-pin-map-and-health.md) | Pin map and board health notes | You are wiring, replacing or diagnosing a board |

### Content and locale operations

| Document | What it covers | Read it when |
| --- | --- | --- |
| [`docs/i18n.md`](../i18n.md) | Locale catalogues, parity rules, adding a string | You are changing user-visible copy or a locale |

## 3. Coverage and honest gaps

This table is the evidence for "every operational process is documented". A
process is only marked **documented** when the procedure exists and names the
commands; it is **verified** only when someone actually executed it and recorded
the result.

| Process | Documented | Verified | Note |
| --- | --- | --- | --- |
| Incident triage (feeder, device, database) | Yes | Partly | Procedures come from real incidents; the restore path is unexercised |
| Error capture and triage | Yes | Yes (tests) | Capture, scrub and console have unit tests; no alerting |
| Backup and recovery | Yes | **No** | Provider backup configuration is unconfirmed (H7, issue #325); RPO/RTO are decisions, not measurements |
| Restore drill | Yes (procedure + record) | **No** | No drill has been executed; the record template is empty |
| Production deployment and rollback | Yes | Yes | The Vercel Git integration is the only mechanism; rollback is documented |
| Container deployment | Yes | **No** | The image has never been built or run (no Docker in the authoring environment) |
| Environment configuration | Yes | Partly | The matrix is measured from `process.env`; platform/dashboard settings are not all observable from the repo |
| E2E suite | Yes | Partly | The local-stack path is tested; the CI job's first real run is the evidence |
| Dead code and complexity budgets | Yes | Partly | Both pass locally (Knip: 0 findings; complexity: within budget). `maintainability.yml` is new; its first CI run is the remaining evidence |
| Supply-chain gate | Yes | Yes | Gate, allowlist and overrides are measured; dev-only findings remain (#328) |
| Secret scanning and SBOM | Yes | Yes | Green in CI; historic findings were placeholders |
| Release tagging and notes | Yes | Yes | Idempotent workflow; see [ADR-0005](../adr/0005-release-automation.md) |
| Access control and audit | Yes | Partly | Guards are tested; audit-IP spoofing and platform step-up gaps are open (#329-#332) |
| OTA firmware update | Yes | Partly | Signing and endpoints exist; a fleet rollout has not been executed |

Known gaps that block a fully honest "operations are covered" claim:

1. **No restore has ever been executed.** The backup and recovery document says
   so explicitly; the drill record is a blank template.
2. **Provider backup configuration is unverified.** The Privacy Policy commits to
   backups; issue #325 tracks the mismatch.
3. **No alerting on application errors.** Errors are pull-based
   ([error handling](./error-handling.md) section 7).
4. **One production operator.** The incident plan records that no one else has
   production access; if the owner is unreachable, infrastructure containment is
   blocked.
5. **The container path is unproven.** It is documented so it can be tested, not
   because it has been.

## 4. Maintaining this index

- Every operational document must appear here with a "read it when" line. A new
  runbook, gate or environment procedure is not done until it is indexed.
- When a procedure is executed for the first time, update the **Verified** column
  and link the record (for example a filled restore-drill record or a CI run).
- Do not mark a process verified because the document looks complete. "Not run"
  is an honest entry; an invented "verified" is a false one.
- Decisions belong in [`docs/adr/`](../adr/README.md), procedures here. If a
  document explains both, link the ADR rather than duplicating the rationale.
