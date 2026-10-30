# Security Policy

OptiFeed is deployed as **PakaonAI** (<https://pakaonai.syntaxure.dev>): a shrimp-feeding
management system made of a Next.js web application, its HTTP/JSON API, and an ESP32 feeder
controller. This document says how to report a security problem in that system, what is in
scope, and what you can expect from us.

**Read this first: this is a capstone project, not a company.** It is built and operated by a
two-person student team at ISUFST Dingle Campus, with a faculty adviser and a panel. There is no
security team, no on-call rotation, and no bug bounty. The commitments below are honest targets
for the capacity we actually have, not contractual service levels. Where we cannot meet a
target we will say so rather than go quiet.

---

## 1. Supported versions

Only the release currently deployed in production is supported; `develop` is accepted on a
best-effort basis. Fixes are prepared on `develop`, promoted through `staging`, and reach
production through the release process in [`CONTRIBUTING.md`](./CONTRIBUTING.md) §9.

| Line | Supported | Notes |
| --- | --- | --- |
| Production (`main`, deployed to `pakaonai.syntaxure.dev`) | **Yes** | The only line that receives security fixes. As of 2026-10-29 the repository's `main` declares **1.23.0**. |
| `develop` (integration branch) | Best effort | Pre-release. It may be broken or mid-change at any time; a report against it is still useful. As of 2026-10-29 it declares **1.29.0**. |
| Older tagged releases | **No** | No backports. Upgrade to the current production release; we fix forward. |
| Firmware under `firmware/` | **Yes**, current release | The build on `main` and the version flashed on registered units. Firmware updates are signed and delivered over the air; older builds are not maintained. |
| Local development setups, forks, and copies of the repository | **No** | We cannot support environments we do not operate. |

The version skew above is real and is recorded rather than hidden: `main` is behind `develop`
while releases await promotion. A vulnerability in `develop` that is not yet in `main` is still
worth reporting; it will be fixed before it ships.

---

## 2. Reporting a vulnerability privately

**Do not open a public issue, pull request, or discussion containing the vulnerability.** A
public report exposes every deployed farm to the problem before a fix exists.

### Preferred channel: GitHub private vulnerability reporting

1. Open the repository: <https://github.com/J-Akiru5/OptiFeed>.
2. Go to the **Security** tab → **Advisories** → **Report a vulnerability**.
3. Describe the issue there. This creates a private GitHub Security Advisory visible only to
   the maintainers, and gives us a place to collaborate on a fix and a coordinated disclosure.

If that button is not shown, private reporting has not been enabled on the repository yet. In
that case open a normal issue titled **`Security contact request`** that says only that you need
a private channel and how to reach you. Include **no** technical detail, reproduction steps,
screenshots, or personal data in that issue; we will move the conversation somewhere private.

### If personal data is involved

If the report involves personal data, a suspected data breach, or an account compromise, also
email the Data Protection Officer at **privacy@pakaonai.syntaxure.dev**. That address is
published in the [Privacy Policy](https://pakaonai.syntaxure.dev/privacy) and is the only
contact the project has published. **There is no dedicated `security@` mailbox; do not assume
one exists.** The Privacy Policy's commitment to notify the National Privacy Commission and
affected data subjects within 72 hours of knowledge (RA 10173 IRR §38) applies to suspected
breaches, and the DPO owns that process.

### What not to do

- Do not test against, modify, download, or retain another farm's data.
- Do not run destructive or high-volume tests against production or staging. The `staging`
  deployment shares the production database ([`docs/deployment-workflow.md`](./docs/deployment-workflow.md) §6),
  so "staging" is production for this purpose.
- Do not disclose the issue publicly before we have agreed a date (section 6).
- Do not access, pivot into, or attempt to reconfigure our Supabase, Vercel, OpenCodeGo,
  Resend, or Google accounts.

---

## 3. What to include

A useful report lets us reproduce the problem without guessing. Please include:

- **Component and version**: web app, API route, firmware, or build script; the release
  (`main` is 1.23.0 at the time of writing), commit SHA if you have it, and browser or device
  details where relevant.
- **Environment**: production (`pakaonai.syntaxure.dev`), `staging`, a local build, or a
  physical unit.
- **Impact**: what an attacker gains — read or write access to farm data, cross-tenant access,
  account takeover, device command injection, data exfiltration, denial of service, and so on.
- **Reproduction**: minimal numbered steps, the request or payload, and the observed result.
  Redact tokens, cookies, passwords, and personal data; replace them with obvious placeholders.
- **Evidence**: logs, screenshots, or a proof of concept that stays within the scope in section 5
  and the rules in section 6.
- **Whether personal data was accessed or could have been**, and whether any data left the
  system. This determines whether the 72-hour breach process starts.
- **Your contact details and disclosure preference**, and whether you want credit.

If you are unsure whether something is a vulnerability, report it. A short report we close as
not-a-bug costs far less than an unreported one.

---

## 4. What to expect

These are **targets, not guarantees**. They assume the maintainers are reachable and the
academic calendar cooperates; exam and defense weeks can delay a response. If we miss a target
we will tell you and give a new date.

| Stage | Target |
| --- | --- |
| Acknowledgement that we received the report | Within **3 business days** |
| Initial triage: severity, affected versions, whether it is exploitable in production | Within **7 business days** |
| Mitigation or fix — **critical** (unauthenticated access to farm data, auth bypass, remote device command) | Within **7 calendar days**; the mitigation may be disabling the affected feature rather than a complete fix |
| Mitigation or fix — **high** (authenticated cross-tenant access, privilege escalation, stored injection) | Within **30 calendar days** |
| Mitigation or fix — **medium / low** | Next scheduled release, target **90 calendar days** |
| Coordinated public disclosure | By agreement; default **90 days** after the report, or sooner if a fix ships and you agree |

Severity is assigned by the maintainers using impact and exploitability in this deployment, not
by a scanner's label. We will explain a rating you disagree with rather than ignore it.

We will not pay a bounty. We will credit you in the advisory and the release notes if you want
that; tell us the name or handle to use, or say that you prefer to stay anonymous.

---

## 5. Scope

### In scope

- The web application at `pakaonai.syntaxure.dev`: authentication, sessions, password and
  lockout handling, role-based access, tenant (farm/organization) isolation, and the
  admin/superadmin surfaces.
- The HTTP/JSON API under `/api`, including device-facing routes such as `/api/feed-command`,
  `/api/ingest`, `/api/devices/[id]/state`, `/api/schedule-sync`, and `/api/firmware/check`.
- File upload, export/import jobs, and signed-URL handling (for example the private `avatars`
  bucket).
- The ESP32 firmware under `firmware/`: the provisioning access point, device-token
  authentication, feed-command handling, OTA manifest verification, and the safety caps.
- Secrets committed to the repository, or a build or CI path that could leak them.
- Vulnerable dependencies **where you can show the vulnerable code is reachable in this
  application**. A raw scanner line without a reachability argument is handled by the
  repository's dependency-audit gate and its allowlist, not as a vulnerability report.

### Out of scope

- **Third-party platforms**: Supabase, Vercel, OpenCodeGo, Resend, and Google. Report those to
  the provider. If the problem is in *our configuration* of them (a public bucket, a leaked
  key, an over-broad policy), that is in scope and we want to know.
- **Denial of service**, volumetric or load testing, and rate-limit exhaustion against
  production. These harm real users and tell us little we do not already know.
- **Physical attacks**: opening the enclosure, the flashing port, the SD card, or a stolen
  device; and attacks that require an already-compromised phone or laptop.
- **Social engineering** of maintainers, the adviser, the panel, or university staff.
- **Spam and email content** sent through Resend, and the Google Form, printed forms, and
  paper records used for the research evaluation.
- **Automated scanner output with no demonstrated impact**, missing security headers with no
  exploit path, and reports that only restate a public dependency advisory already tracked by
  Dependabot.
- **TLS, DNS, and edge configuration** owned by Vercel or Supabase, beyond reporting a
  misconfiguration of ours to us.
- **The laws, policies, and practices of the university**, which are outside this repository.

If you are not sure whether something is in scope, report it privately and ask. We would rather
triage one out-of-scope report than miss an in-scope one.

---

## 6. Rules of engagement and safe harbour

We authorise good-faith security research on the scope above, provided you:

1. use accounts and a farm/pond you created for the test, and never another user's data;
2. stop as soon as you have proof, and do not escalate, persist, or move laterally;
3. do not modify or delete data, run destructive actions, or send commands to a physical feeder;
4. do not degrade the service for real users, and do not run automated scanning at volume;
5. do not retain personal data you encounter: report that you saw it, then delete your copy;
6. give us a reasonable chance to fix the issue before public disclosure, and agree the date
   with us;
7. comply with Philippine law, including the Data Privacy Act of 2012 (RA 10173).

If you follow these rules, we will not pursue or support legal action against you for the
research, and we will say publicly that the research was authorised by this policy if a third
party questions it. We cannot bind third parties — the university, Supabase, Vercel, or another
provider may have its own position — but we will not encourage action against good-faith
research that followed this policy.

This is a statement about our intent and our own actions. It is not legal advice, and it does
not create a contract.

---

## 7. What we do and do not claim

**We do:**

- run dependency auditing and Dependabot in CI, with a written, expiring allowlist for findings
  we judge unreachable;
- keep production errors in our own database rather than shipping them to a third-party error
  service, and scrub tokens and personal data before writing them;
- record incident and recovery procedures in
  [`docs/operations/backup-and-recovery.md`](./docs/operations/backup-and-recovery.md), including
  retention for backups and error records;
- tell you honestly when a fix will take longer than the targets above.

**We do not claim:**

- ISO/IEC 27001 certification, or any other security certification. A repository cannot be
  certified; this project has no certified management system.
- PCI DSS, HIPAA, or SOC 2 compliance. The application does not integrate a payment processor
  and does not collect payment card data.
- A bug bounty, a service-level agreement, or 24/7 incident response.
- That the system is free of vulnerabilities, or that a report will always result in a fix
  within the target window.

---

## 8. Related documents

- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — branch model, review rules, and the non-negotiable
  database rules.
- [`docs/deployment-workflow.md`](./docs/deployment-workflow.md) — deployment, rollback, and the
  accepted shared staging/production database decision.
- [`docs/operations/backup-and-recovery.md`](./docs/operations/backup-and-recovery.md) — backups,
  retention, RPO/RTO, and the restore drill.
- [Privacy Policy](https://pakaonai.syntaxure.dev/privacy) and
  [Terms of Service](https://pakaonai.syntaxure.dev/terms) — what data is processed, for how
  long, and the breach-notification commitment.
- [`docs/legal/`](./docs/legal/) — the working notes and review record behind those pages.
