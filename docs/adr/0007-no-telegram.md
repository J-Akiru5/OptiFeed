# ADR-0007: Alerts are in-app only — Telegram is not used

- **Status:** Accepted
- **Date:** 2026-10-31 (owner decision; the product already behaved this way)
- **Deciders:** repository owner
- **Backfilled:** 2026-10-31
- **Related:** #411 (password reset), ADR-0003 (first-party error capture)

## Context

The platform grew an outbound Telegram path in its first phase: a
`sendTelegramMessage()` helper in `apps/web/lib/notify/telegram.ts`, a bot token
and a chat id in the environment, and a fan-out call in two places — the device
ingest route (`app/api/ingest/route.ts`) and the device-watch cron
(`app/api/cron/device-watch/route.ts`). The intent was a second channel for
CRITICAL device alerts ("task 3.5", "H11").

It never became the delivery channel. No bot token and no chat id were ever
configured in any environment, so the helper returned `false` on every call and
the alerts stayed in the app: a `Notification` row plus the dashboard alert
panel. The privacy policy has always said so — *"We do not use Telegram for
alerts"* (`apps/web/components/legal/privacy-policy-content.tsx`) — and the
Hiligaynon summary says the same. The threat model, the incident-response
runbook, the environment matrix and `.env.example` all still carried the
option, so a future maintainer could have read the code and concluded that
Telegram was a supported, configurable channel.

That is the state this record replaces: a decision that was never implemented
but was still reachable in code and configuration.

## Decision

OptiFeed does not use Telegram. Alerts reach people in two ways only:

1. **In-app** — a `Notification` row (the source of truth), shown in the
   dashboard alert panel and the notifications page. CRITICAL device alerts
   (offline feeder, nearly empty hopper) are written here by the ingest route
   and the device-watch cron.
2. **E-mail** — through **Resend**, only where a real mailbox can receive it:
   crop reminders (`REMINDER_FROM_EMAIL`), member invitations
   (`INVITE_FROM_EMAIL`) and password-reset links (`RESET_FROM_EMAIL`, falling
   back to `INVITE_FROM_EMAIL`). Delivery is best-effort and never the source
   of truth; the in-app row is.

Concretely, and enforced by CI:

- There is no Telegram client, bot token or chat id in the codebase, and no
  outbound call to `api.telegram.org`. `apps/web/lib/notify/telegram.ts` was
  removed with its two call sites (the device ingest route and the device-watch
  cron). Its one non-Telegram helper (`absoluteAppUrl`, the absolute-link
  builder) had no other caller and went with it.
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are not valid variables: they are
  absent from `apps/web/.env.example`, from the environment matrix and from the
  deployment checklist.
- `apps/web/lib/__tests__/no-telegram.test.ts` fails the build if a Telegram
  reference or a Telegram variable reappears in the runtime source.
- `scripts/self-check.mjs` asserts the same thing from the repository side.

## Consequences

### Positive

- The privacy statement is now true in code, not only in prose: there is no
  third-party messaging processor on the data path, and no bot token in the
  environment to leak or to revoke.
- One fewer external dependency in the critical ingest path. The device
  request no longer prepares a message and schedules a fan-out after the
  response; the offline-alert cron no longer awaits a parallel HTTP call.
- One fewer secret to manage, document and rotate.

### Negative / accepted costs

- **Nobody is paged.** A CRITICAL alert sits in the app until a farmer or an
  operator opens the dashboard. The system-functions portal already called this
  the most consequential operational gap, and it stays open: an e-mail or SMS
  channel to a real mailbox is the natural replacement, and it would be a new
  decision, not an extension of this one.
- The alert is written by the same request that detects the condition, so it is
  only as visible as the dashboard. There is no retry, no escalation and no
  external acknowledgement.
- Removing the fan-out deleted the "a failing Telegram sender never breaks
  ingest" guarantee and its test. That guarantee was about a channel that no
  longer exists; the ingest route now has one less failure mode to defend.

### Follow-ups

- If an out-of-band alert channel is wanted, raise it as a new ADR (an e-mail
  alert to a real mailbox is the obvious candidate) rather than re-enabling the
  Telegram path. This record is never rewritten to allow it.
- `docs/system-functions-portal/index.html` describes the platform's functions
  and was updated with this change; keep it in step with any future channel.

## Links

- Implementation: `apps/web/app/api/ingest/route.ts`,
  `apps/web/app/api/cron/device-watch/route.ts`,
  `apps/web/lib/__tests__/no-telegram.test.ts`, `scripts/self-check.mjs`
- Procedure / source of the decision: the privacy policy
  (`apps/web/components/legal/privacy-policy-content.tsx`, "We do not use
  Telegram for alerts"), the Hiligaynon summary, and the owner's decision of
  2026-10-31 that the platform will not use Telegram.
- Related documents: `docs/operations/environment-matrix.md` (variables),
  `docs/runbook.md` (what an operator does when an alert fires),
  `docs/security/threat-model.md`, `docs/security/incident-response.md`,
  `apps/web/README.md`, `docs/adr/README.md` (index).
