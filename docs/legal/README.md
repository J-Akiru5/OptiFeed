# Legal documents — working notes

This folder contains the research consent package and the working notes for the PakaonAI Privacy Policy and Terms of Service. The public pages live in the web app:

- `/privacy` — `apps/web/app/[locale]/privacy/page.tsx`
- `/terms` — `apps/web/app/[locale]/terms/page.tsx`

## Current status

**Draft — pending University Legal Office review.** The pages are built, but:

- the legal pages show a draft banner;
- the pages are `noindex, nofollow`;
- the footer, login acceptance line, and dashboard legal card are hidden;
- the sitemap does not include the legal URLs.

Do not remove the draft status until the University Legal Office has reviewed and approved the documents.

## Publishing after review

1. Open `apps/web/lib/legal/config.ts`.
2. Set `LEGAL_STATUS` to `"effective"`.
3. Set `LEGAL_EFFECTIVE_DATE` to the date approved by the University Legal Office.
4. Update `LEGAL_LAST_UPDATED` if the text changed during review.
5. Add or update the `LEGAL_HISTORY` entry with the approved date and a short change note.
6. If the app release changed, update `LEGAL_APP_RELEASE` to the current root `package.json` version.
7. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `npx next build`.
8. Deploy and verify `/en/privacy`, `/hil/privacy`, `/en/terms`, `/hil/terms`, the footer links, the login acceptance line, and the dashboard legal card.

The `legal-config.test.ts` test will fail if `LEGAL_APP_RELEASE` does not match the root `package.json` version, so the "applies to" line cannot silently drift.

## Versioning

Legal documents have their own semantic version, separate from the app release.

- **Current legal version:** `1.0`
- **Current app release:** `1.11.0` (root `package.json` + `CHANGELOG`)
- **Version history:** `LEGAL_HISTORY` in `apps/web/lib/legal/config.ts`
- **Display:** “Policy v1.0 · App release 1.11.0”

Do not reuse the app version as the legal version. If the app changes but the legal text does not, update only the “applies to” release. If the legal text changes, bump the legal version (for example, `1.1`) and update the effective date and history.

### App version metadata issue

The repository currently has inconsistent release metadata:

| Source | Value |
| --- | --- |
| Root `package.json` | 1.11.0 |
| `apps/web/package.json` | 1.9.0 (stale) |
| `VERSION` file | missing |
| Git tags | only `v1.0.0` |
| `CHANGELOG` latest | 1.11.0 |

The legal pages use the root version, 1.11.0. A separate release task should sync `apps/web/package.json` to 1.11.0, add a `VERSION` file, and tag `v1.11.0`. Tags are owner-created; do not create or move a release tag as part of the legal work.

## Research package

- `research-information-and-consent.md` — information sheet, consent statement, Hiligaynon summary, Google Forms setup, printing notes.
- `research-information-and-consent.html` — print-ready A4 version.
- `paper-ethics-paragraph.md` — suggested human-participant ethics and data-gathering paragraphs for the capstone paper.

The paper's current Ethical Considerations section covers animal welfare only. Add the human-participant paragraphs before the final defense.

## Data inventory used in the policy

- **Account:** farm ID, display name, pond-provisioned email, role/membership, auth metadata, session/IP/rate-limit/lockout, audit events.
- **Farm:** farm/pond names, area/depth, stocking, cycles, biomass, FCR/SGR, schedules, feed events, harvest, calendar, notes.
- **Device:** MAC/device ID, hashed token, last seen, feed level, water temp, RTC status, commands/acks, offline queue, firmware.
- **AI:** chat/prompts, pond context, recommendations; OpenCodeGo training opt-out enabled.
- **Research:** optional name, date, role, questionnaire responses; printed forms and Google Forms; no email/phone/audio/video/photos/sensitive data.
- **Website/offline:** IP, user agent, logs, aggregate Vercel Analytics/Speed Insights, cookies/local storage, IndexedDB snapshots/outbox, service-worker cache.

## Processors

| Provider | Purpose | Location |
| --- | --- | --- |
| Supabase | Auth, database, storage, backups | Singapore |
| Vercel | Hosting, functions, logs, aggregate Analytics/Speed Insights | Sydney |
| OpenCodeGo | AI inference | Per its terms; training opt-out enabled |
| Resend | Transactional email | Per its terms |
| Google LLC (Forms/Drive) | Research questionnaires | Per Google's terms |

No Telegram. No advertising or analytics cookies. No sale of personal data.

## Review checklist

- [ ] Confirm the legal publisher: PakaonAI Capstone Project, ISUFST Dingle Campus.
- [ ] Confirm the DPO: Jeff Edrick C. Martinez, `privacy@pakaonai.syntaxure.dev`; confirm the mailbox is live and monitored.
- [ ] Confirm the PIC/PIP split for farm operational data.
- [ ] Confirm no sensitive personal information, minors, real emails/phones, photos, or recordings.
- [ ] Confirm the processor list and locations.
- [ ] Google Form: **Collect email addresses = Off**; no file uploads; access restricted to the researchers; do not export responses to Supabase.
- [ ] Confirm the retention schedule, especially research data until publication.
- [ ] Confirm the 72-hour breach process and incident lead.
- [ ] Confirm the NPC registration wording (not yet registered; register if required).
- [ ] Confirm the 14-business-day data-subject response standard.
- [ ] Confirm the Terms positions: as-is, free pilot, feeding/AI safety, liability, Iloilo venue.
- [ ] Confirm the English-authoritative + Hiligaynon-summary approach.
- [ ] Confirm the effective date and remove the draft banner only after approval.

## Legal review notes

- The Privacy Policy is aligned with RA 10173, its IRR, and the NPC breach-notification rule in IRR Section 38. It does not claim NPC certification.
- The 14-business-day response target is a service standard, not a statutory deadline.
- The policy does not rely on the research exemption in IRR Section 37; research processing is consent-based.
- The university reviewer should check the liability cap, the governing-law/venue clause, and the research consent language.
