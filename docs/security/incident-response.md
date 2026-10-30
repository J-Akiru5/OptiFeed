# Incident response plan

This plan covers a security incident or a data-protection incident affecting OptiFeed / PakaonAI:
the web application, the API, the Supabase project, the device fleet, or the credentials that
operate them.

**Read this first.** OptiFeed is a capstone project run by two maintainers, with **one owner of
production access** (Jeff). There is no security team, no on-call rotation, no pager and no 24/7
coverage. Everything below is a procedure one or two people can actually execute, and the
response targets are best-effort targets, not contractual service levels. Where this plan depends
on a capability the project does not have (a second operator with production access, verified
provider backups), it says so.

Related: [`SECURITY.md`](../../SECURITY.md) (disclosure policy, response targets),
[`threat-model.md`](./threat-model.md) (assets and threats),
[`../operations/backup-and-recovery.md`](../operations/backup-and-recovery.md) (RPO/RTO and restore
paths), [`../deployment-workflow.md`](../deployment-workflow.md) §8 (application rollback),
[`../runbook.md`](../runbook.md) (operational triage).

---

## 1. Roles

| Role | Who | Decides |
| --- | --- | --- |
| Incident commander (IC) | The owner (Jeff) | Severity, containment, whether production is changed, when the incident is closed |
| Technical responder | The second maintainer (Karl) or the IC | Executes containment under the IC's direction |
| Privacy lead | The Data Protection Officer named in the Privacy Policy | Whether personal data was involved, and the RA 10173 notification decision |
| Faculty escalation | The adviser | Academic consequences, and substituting for the IC if the IC is unreachable |

Honest limits: the IC is also the only person with production credentials, and the DPO process is
documented in the Privacy Policy but is not part of this repository. If the IC is unreachable,
**no one currently has the access to contain an infrastructure incident**; the adviser is an
escalation path, not a substitute operator. That is a recorded gap (see §8), not something this
plan can fix.

---

## 2. Severity levels

Severity drives who is told, how fast, and what may be changed without asking.

| Level | Definition | Examples | First response target |
| --- | --- | --- | --- |
| **SEV1 — Critical** | Confirmed or strongly suspected unauthorized access to tenant data, authentication bypass, remote device command injection, loss or corruption of production data, or compromise of the OTA signing key | Another farm's data visible in the UI; a session minted without credentials; a valid token can command arbitrary units; the database is gone | Act immediately; notify the DPO the same day if personal data may be involved |
| **SEV2 — High** | A single tenant's data exposed, privilege escalation between roles, a production secret leaked, or a sustained inability to send feed commands | Service-role key in a log or commit; tenant admin can read another org's pond; device polling blocked for hours | Triage within 1 business day |
| **SEV3 — Medium** | A control is missing or broken with no evidence of exploitation, or a limited data exposure | CSP bypass with no payload; a dependency advisory with a reachable path; an audit gap | Triage within 3 business days |
| **SEV4 — Low** | Hardening, process or documentation gap; scanner false positive | A stale allowlist entry; a missing header with no exploit path; a gitleaks finding that is a test fixture | Next maintenance window |

The severity is set by impact on real data and real feeders, not by a scanner's label. A
CVSS 9.8 in a package that is never loaded is not a SEV1. An unauthenticated read of one farm's
biomass logs is.

Mapping to the disclosure targets in `SECURITY.md` §4: a **critical** report is a SEV1/SEV2 and the
7-calendar-day fix target applies; a **high** report is SEV2/SEV3 with a 30-day target. An incident
found internally uses the same clock, starting when the IC declares it.

---

## 3. Detection

| Source | What it catches | Where to look |
| --- | --- | --- |
| A report through `SECURITY.md` | Anything a reporter can demonstrate | GitHub private advisory, or the DPO mailbox for personal-data reports |
| Vercel runtime logs | `[obs]` errors, 5xx spikes, unusual route patterns | Vercel → Project → Logs |
| Supabase dashboard | Auth sign-in anomalies, database CPU/connections, storage access | Supabase → Reports / Auth logs |
| `/api/health` | Readiness (database reachability) | Uptime monitor, if one is configured |
| In-app notifications and the audit console | Failed-login bursts, device offline, remote feed/pause actions | `/admin/audit`, `/superadmin/operations/audit` |
| CI | New dependency advisories (`security`), new committed secrets (`sbom` → gitleaks) | GitHub Actions |
| GitHub security advisories / Dependabot | Dependency vulnerabilities | GitHub → Security |
| A farmer or a user | Physical behaviour, a phishing e-mail, a strange login | Direct contact |

There is no intrusion-detection system. Detection depends on someone looking, or on a user
noticing. That is a real limitation of a system this size, and it is stated rather than papered
over with a control that does not exist.

---

## 4. First 30 minutes

1. **Declare.** Write down the time, the reporter, what was observed, and the provisional severity.
   Open `docs/incidents/YYYY-MM-DD-<slug>.md` from the template in §7. Do not investigate inside a
   chat thread only.
2. **Preserve before you change.** Export the evidence named in §6 — especially
   `PlatformAuditLog`, `DeviceStateEvent`, `FeedEvent` and the relevant Vercel log range. Error
   records are retained for 30 days, so an incident discovered late may already have lost its
   evidence window.
3. **Contain the smallest thing that stops the harm.** Pause the affected device, disable the
   affected account, roll back the deployment, or rotate the one credential — in that order of
   preference. Do not take the whole system down to look careful.
4. **Tell the DPO** if personal data was, or may have been, accessed. That starts the 72-hour
   clock described in the Privacy Policy and `SECURITY.md` §2; it is not a decision to wait on.
5. **Write the timeline as you go.** Times, actions, who did them. Reconstructing it afterwards
   loses the detail that the post-incident review needs.

---

## 5. Containment by asset

Every step below is executed by the owner or under their direction. Steps that change production
are marked **[owner decision]**. Nothing here is automated.

### 5.1 Supabase (database, Auth, Storage)

| Goal | Action | Notes |
| --- | --- | --- |
| Stop one account | Ban the login and revoke memberships via the platform console (`disablePlatformUser`) or Supabase Auth → Ban | The platform action is audited and requires step-up; the dashboard path is not audited by the app |
| Stop every session of one user | Ban the login, then reset the password | An already-issued access token is not revoked by sign-out; it expires on its own. The 30 s server cache does not extend that |
| Stop a leaked service-role key | Rotate `SUPABASE_SERVICE_ROLE_KEY` in the Supabase dashboard, then update Vercel and redeploy | Until the redeploy, the old key is still live in the running deployment |
| Stop a leaked database password | Rotate the database password, update `DATABASE_URL`/`DIRECT_URL`, redeploy | Migrations and the app share the credential |
| Stop a leaked anon key | Rotate the anon key and redeploy (`NEXT_PUBLIC_*` is baked into the build) | RLS is what bounds the anon key; check the policies before assuming rotation is enough |
| Stop data exfiltration through the Data API | Disable the Data API / restrict it in the Supabase dashboard **[owner decision]** | The app talks to Postgres directly, so it keeps working |
| Last resort: take the database offline | Pause the Supabase project **[owner decision]** | Every tenant loses the app; devices keep feeding from their RTC schedule |
| Recover data | Follow [`backup-and-recovery.md`](../operations/backup-and-recovery.md) | A restore is an owner decision (mission decision E4) and has never been drilled |

Check for a rogue change before restoring: compare `_prisma_migrations` against the repository,
inspect `PlatformAuditLog` and `Membership` rows, and look for new Supabase API keys or users in
the dashboard.

### 5.2 Vercel (edge, runtime, environment)

| Goal | Action | Notes |
| --- | --- | --- |
| Serve the last known-good build | Deployments → previous production deployment → **Instant Rollback** | Changes the served build only; it does not revert a migration or a data change (`deployment-workflow.md` §8) |
| Stop a bad deployment from recurring | Remove the branch from `git.deploymentEnabled` in the app's `vercel.json`, or disconnect the Git integration | Only `main` and `develop` are approved to deploy; `vercel.json` still enables `staging` (#323) |
| Remove a leaked secret | Rotate at the provider, update the Vercel environment variable, redeploy | Rotating in Vercel without a redeploy leaves the old value in the running function |
| Stop a deployment hook or token | Revoke the token/hook in Vercel settings | Deploy hooks are deployment pathways; unauthorised ones are removed, not rotated |

A Vercel account compromise is a SEV1 even with no data access: the environment variables are the
production credentials.

### 5.3 Device fleet

| Goal | Action | Notes |
| --- | --- | --- |
| Stop one unit feeding | Platform console → pause the device (`remoteSetDevicePause`, step-up + reason + audit), or cut relay power | A paused device still keeps its RTC schedule but refuses new `FeedRequest`s |
| Stop a stolen token | Platform console → rotate the device token (`rotateDeviceToken`), then re-provision the unit | The old hash stops matching immediately; the physical unit needs the new token |
| Stop a bad firmware release | Remove or correct `channels/stable.json` in the `firmware` bucket **[owner decision]** | Devices that already installed it keep running it; there is no remote rollback command |
| Check for rogue commands | Inspect `FeedRequest`, `FeedEvent` and `DeviceStateEvent` for the affected unit; compare grams against the caps | Per-dose cap 1,000 g, daily cap 5,000 g, 300 s pump limit |
| Signing key compromised | Treat as SEV1: stop OTA, publish a new key through a manifest signed by a still-trusted key if possible, otherwise reflash units physically | There is no revocation list; `primary`/`spare` rotation is the only in-band path |

### 5.4 Credentials

| Secret | Blast radius | Rotation | Sessions invalidated? |
| --- | --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Full database and Auth admin access; also signs step-up and view-as cookies | Supabase dashboard → API keys → rotate → Vercel → redeploy | Yes for step-up/view-as (the HMAC key changes); app sessions no |
| Database password (`DATABASE_URL`, `DIRECT_URL`) | Full SQL access | Supabase → Database settings → reset → Vercel → redeploy | No |
| `CRON_SECRET` | Anyone can trigger cron jobs (watchdogs, cleanup) | Generate a new value → Vercel → update the Supabase Vault secret used by `pg_cron` → redeploy | Old value stops working on redeploy |
| Device token (per unit) | Telemetry and command retrieval for one unit | Platform console → rotate (audited, step-up) | Immediately, for that unit |
| AI provider keys (`OPENCODE_GO_API_KEY`, `GEMINI_API_KEY`) | Spend and data sent to the provider under our account | Provider console → revoke → Vercel → redeploy | N/A |
| `RESEND_API_KEY` | Send mail as the verified domain | Resend dashboard → revoke → Vercel → redeploy | N/A |
| `TELEGRAM_BOT_TOKEN` | Post to the alert chat | BotFather → revoke → Vercel → redeploy | N/A |
| OTA private signing key | Arbitrary firmware on the fleet | Offline key ceremony; see §5.3 | N/A |
| GitHub / Vercel / Supabase account credentials | Everything above | Provider account recovery, then rotate every secret in this table | Depends |

After any rotation, check the Vercel deployment that is actually serving traffic — not just the
environment variable page — and confirm with `/api/health` and one authenticated request.

---

## 6. Evidence: preserve, then remediate

Preserve in this order, because remediation destroys the state that proves what happened:

1. **Database rows** — export `PlatformAuditLog`, `DeviceStateEvent`, `FeedEvent`, `FeedRequest`,
   `Membership`, `PlatformAdmin` and the affected tenant's `Pond`/`BiomassLog` rows. Use the
   platform audit CSV export (`/api/platform/audit/export`) for the audit slice, and `pg_dump` for
   the rest. Store the export outside the repository and outside the Supabase project.
2. **Application logs** — the relevant Vercel log range for the affected routes and window.
3. **Provider logs** — Supabase Auth logs, database logs, storage access logs; Vercel deployment
   and access logs.
4. **CI artefacts** — the gitleaks SARIF and SBOM artefacts for the affected commit
   (`.github/workflows/sbom.yml`), Dependabot/audit results.
5. **The incident record** — timeline, decisions, who authorised what.

Rules:

- Do not delete or edit audit rows, notifications or feed events to "clean up".
- Do not paste secrets, tokens or personal data into the incident record, a GitHub issue or a chat.
  Reference the location and the time instead.
- Evidence that contains personal data is handled under the Privacy Policy's retention rules and
  is deleted once the incident and any notification obligation are closed.

Retention that constrains this plan: error records are kept **30 days** and backups **30 days**
(I-65 policy). An incident discovered more than 30 days after the fact may have no recoverable
database evidence. Export early, and record that the evidence window was already closed if it was.

---

## 7. Post-incident review

Within **5 business days** of containment, the IC writes a blameless review in the incident record:

1. **Summary** — what happened, in three sentences, for someone who was not involved.
2. **Timeline** — detection, declaration, each containment step, resolution, with times.
3. **Impact** — which tenants, which data, how many devices, for how long, whether personal data
   was involved.
4. **Root cause** — the control that failed or was missing, not "human error".
5. **What worked / what did not** — including detection delay and any step that required the IC
   personally.
6. **Actions** — each with an owner, a date, and a linked issue. A security action that is not
   filed as an issue is not an action.
7. **Control updates** — which row of [`threat-model.md`](./threat-model.md) changes, and which
   test now covers the regression.
8. **Disclosure** — whether a GitHub advisory, a user notification or an NPC report was made, and
   when.

The review is stored in `docs/incidents/` (created by the first incident; keep the filename stable
so links from issues keep working). It is not a public post-mortem unless the IC decides it is.

---

## 8. Known gaps in this plan

Recorded so the plan is not mistaken for a capability it does not have:

| Gap | Consequence | Owner action |
| --- | --- | --- |
| One person holds all production access | No containment while that person is unavailable | Add a second operator with scoped access, or document a break-glass procedure |
| No 24/7 monitoring or paging | Detection can lag by days; the `SECURITY.md` response targets are best-effort | At minimum, an external uptime check on `/api/health` and alerting on the Vercel error rate |
| No restore drill has been executed | RTO/RPO are targets, not measurements; a restore during an incident is the first attempt | Execute the drill in [`restore-drill-record.md`](../operations/restore-drill-record.md) |
| Provider backups unconfirmed | The effective RPO may be "since the last manual dump" | Confirm the Supabase plan's backup coverage (plan H7) |
| No DPA/retention evidence for processors | A processor incident is hard to bound | Record provider terms and retention before onboarding farms outside the study |
| Staging shares the production database | A staging incident is a production incident | Provision a separate dev/test project (plan H8) |
| No security mailbox | Reports can sit in a personal inbox | Keep the GitHub private-advisory path working; do not invent a `security@` address |
