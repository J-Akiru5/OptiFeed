# Environment matrix

Every variable this repository reads, where it is read, and what breaks when it is missing.
Scope: `apps/web` (the deployed application), the Prisma CLI and the repository scripts. Source of
record for names: `apps/web/.env.example` plus a sweep of `process.env` in the tree (see
[§4](#4-deltas-found-in-this-audit)).

Measured 2026-10-29 against `origin/develop` @ `8eb6ce4`.

## 1. How to read this

| Layer | Meaning |
| --- | --- |
| **build** | Evaluated while `next build` runs (and, for `NEXT_PUBLIC_*`, inlined into the browser bundle). A wrong value here is permanent for that image. |
| **runtime** | Read by the Node process per request. Safe to change with a restart, except where noted. |
| **browser** | Shipped in the client bundle. Only `NEXT_PUBLIC_*`. Not secret. |
| **tooling** | Read by Prisma, seed/e2e scripts or repository scripts. Never by the running app. |

`NEXT_PUBLIC_*` values are substituted at build time. They must be present **when the image is
built**, not only at `docker run`; putting them in the runtime environment of an already-built image
changes nothing. Server secrets are the opposite: they are read at runtime and must never be build
arguments, because they would be recorded in an image layer.

## 2. Application and tooling variables

| Variable | Required | Layers | Source | If missing |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | **Yes** | build (placeholder is enough), runtime | Supabase → Project Settings → Database → pooled connection string | Prisma cannot connect. `/api/health` answers 503 and every data-backed page/route fails. `next build` needs only a syntactically valid placeholder. |
| `DIRECT_URL` | **Yes for migrations** | tooling (`prisma migrate`), build (placeholder) | Supabase → direct/session connection string | `prisma migrate deploy` fails. The running app is unaffected because queries use `DATABASE_URL`; the schema declares `directUrl`, so `prisma validate` also needs it present. |
| `NEXT_PUBLIC_SUPABASE_URL` | **Yes** | build, browser, runtime | Supabase → Project Settings → API → Project URL | Auth throws `Missing environment variable: NEXT_PUBLIC_SUPABASE_URL` on the first request that touches a Supabase client. Sign-in is impossible. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Yes** | build, browser, runtime | Supabase → Project Settings → API → anon/public key | Same failure as above (`lib/supabase/client.ts`, `lib/supabase/server.ts`). |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes for admin features** | runtime (server only) | Supabase → Project Settings → API → service_role key | `createAdminClient()` throws, so invitations, member provisioning, platform user administration and the e2e seed fail. Ordinary sign-in and normal pages still work. Bypasses RLS — never expose it to the browser. |
| `NEXT_PUBLIC_BASE_URL` | **Yes for outbound links** | runtime | Deployment origin, e.g. `https://pakaonai.syntaxure.dev` | Telegram alert links and export links lose their host (`lib/notify/telegram.ts` returns `null`), and reminder **and** invite e-mail are skipped entirely: both require `RESEND_API_KEY` + sender + `NEXT_PUBLIC_BASE_URL`. In-app notifications still run. |
| `OPENCODE_GO_API_KEY` | No | runtime | OpenCode Go dashboard | The OpenCode Go provider is inactive unless a key is stored in the console (`lib/ai-providers/config.ts` resolves the encrypted DB key first, then this variable). AI chat falls through to Gemini, then to "AI unavailable". |
| `GEMINI_API_KEY` | No | runtime | Google AI Studio | The fallback provider is inactive unless a stored DB key exists. Nothing else degrades. |
| `AI_SECRET_KEY` | No | runtime (server only) | `openssl rand -base64 32` | Provider keys stored from `/superadmin` cannot be decrypted or written: the console shows "DB keys disabled: set AI_SECRET_KEY" and the chain falls back to `OPENCODE_GO_API_KEY` / `GEMINI_API_KEY`. Never expose it to the browser. |
| `AI_SECRET_KEY_PREVIOUS` | No | runtime (server only) | Previous `AI_SECRET_KEY` value | Rows encrypted with the previous key (`keyVersion` 0) become unreadable after a rotation until they are re-encrypted. Set it only for the rotation window. |
| `OPENCODE_GO_REASONING_EFFORT` | No | runtime | — | Defaults to `high` (`lib/ai-providers/reasoning.ts`). |
| `OPENCODE_GO_MODEL` | **Unused** — see §4 | — | — | Nothing. No code reads it. |
| `CRON_SECRET` | **Yes if cron is scheduled** | runtime | Generated secret, also stored in Supabase Vault by `docs/sql/cron-*.sql` | `withCronAuth` answers 403 `Cron secret is not configured`, so `device-watch`, `crop-watch` and `jobs` never run: no dead-device alerts, no reminders, no `ErrorEvent` retention sweep. Fails closed, never open. |
| `RESEND_API_KEY` | No | runtime | Resend dashboard | E-mail is skipped and logged once per process; in-app notifications still run. |
| `REMINDER_FROM_EMAIL` | No | runtime | Verified Resend sending domain | Harvest/sampling reminder e-mail is skipped. |
| `INVITE_FROM_EMAIL` | No | runtime | Verified Resend sending domain | Invite e-mail is skipped. The UI shows the documented default sender (`PakaonAI <invite@syntaxure.dev>`) but does not send with it — the variable must be set for `inviteReady`. |
| `RESET_FROM_EMAIL` | No | runtime | Verified Resend sending domain | Password-reset e-mail is skipped; `INVITE_FROM_EMAIL` is used when this is unset. The request still succeeds and is audited with `emailSent: false`. |
| `TELEGRAM_BOT_TOKEN` | No | runtime | BotFather | CRITICAL alerts stay in-app only (`sendTelegramMessage` returns `false`). |
| `TELEGRAM_CHAT_ID` | No | runtime | Telegram chat id | Same as above; both are required. |
| `DEMO_PASSWORD` | No | tooling | Chosen locally | `apps/web/scripts/provision-demo-user.ts` cannot provision the demo login. Not part of production configuration. |
| `DEVICE_TOKEN` | No | tooling | Chosen locally | `prisma/seed.ts` cannot seed devices. |
| `E2E_ALLOWED_DB_HOST` | No | tooling | The e2e database host | Playwright's global setup refuses to run; no e2e test executes. |
| `E2E_CONFIRM_PRODUCTION` | No | tooling | Literal `yes` | Same refusal. This is an acknowledgement guard, not a credential. |
| `E2E_PASSWORD` | No | tooling | Chosen locally | Same refusal; the three `e2e-` logins share it. |
| `NEXT_PUBLIC_SITE_URL` | No | build | Deployment origin | Defaults to `https://pakaonai.syntaxure.dev` (`apps/web/lib/site-url.ts`). Set it for any deployment that must advertise a different host in `robots.txt`, `sitemap.xml` and the Open Graph/Twitter metadata. Added by I-70. |

### AI provider key storage (issue #432)

`/superadmin/ai-providers` can store a provider key encrypted in `AiProviderConfig`
(AES-256-GCM, 12-byte IV, 16-byte tag, AAD = `provider:keyVersion`). Resolution order is:

1. an authenticated DB ciphertext (`keyVersion` 1 = `AI_SECRET_KEY`, 0 = `AI_SECRET_KEY_PREVIOUS`);
2. the row's `apiKeyEnv`, or the adapter default (`OPENCODE_GO_API_KEY`, `GEMINI_API_KEY`);
3. nothing — the provider is inactive.

A key write requires a fresh step-up check and one live completion with the submitted key; a failed
test leaves the previous key active. Missing or malformed `AI_SECRET_KEY` disables DB keys only: the
environment fallback still works, so CI and cold environments behave as before. Backups never export
the `key*` columns (`lib/backup/tables.ts`); re-enter keys after a restore.

## 3. Platform and container variables (not in `.env.example`)

| Variable | Set by | Layers | Effect |
| --- | --- | --- | --- |
| `NODE_ENV` | Next.js / the container | build, runtime | `production` enables production behaviour: the Prisma singleton is not cached on `globalThis`, and development-only code paths (PWA registration, `'unsafe-eval'` in the CSP) are off. |
| `VERCEL_ENV` | Vercel | build | `production` is the only value that lets `apps/web/scripts/migrate-if-production.mjs` run `prisma migrate deploy`. **Unset outside Vercel**, so a container build never migrates — deliberate; run migrations as an explicit step. |
| `PORT` | Container / host | runtime | Listen port. The image sets `3000` and passes it to `next start` explicitly. |
| `HOSTNAME` | Container | runtime | Bind address. The image sets `0.0.0.0`; `next start` also receives `-H 0.0.0.0`. |
| `NEXT_TELEMETRY_DISABLED` | Container / CI | build, runtime | `1` disables Next.js build telemetry. Set in the image and in CI. |
| `NEXT_PUBLIC_PWA_DEV` | Developer | build, browser | `1` registers the service worker outside production. Development convenience only; undocumented before this audit. |
| `PLAYWRIGHT_BASE_URL` | Developer / CI | tooling | Playwright base URL; defaults to `http://localhost:3000`. |
| `DEMO_SUPABASE_ID` | Developer | tooling | Pins the demo user's Supabase id in `prisma/seed*.ts`. |
| `API_BASE_URL`, `API_GATE_MODE`, `API_TEST_BEARER`, `API_TEST_COOKIE` | Developer | tooling | Repository-root live API checks (`scripts/api/*`). Not part of the app. |

## 4. Deltas found in this audit

1. **`OPENCODE_GO_MODEL` is documented but unused.** It appears in `apps/web/.env.example`,
   `apps/web/README.md`, `docs/vercel-deployment-checklist.md` and `scripts/self-check.mjs`, but no
   source file reads it. Model selection comes from `AiProviderConfig` rows in `/superadmin`, with
   `defaultModel` in `lib/ai-providers/opencode-go.ts` as the fallback. Setting the variable has no
   effect. Documented, not removed — removing it is a product decision.
2. **`DEMO_PIN` is required by `scripts/self-check.mjs` but absent from `.env.example` and unused in
   code.** `pnpm self-check` therefore reports `FAIL .env.example documents DEMO_PIN` on a clean
   `develop`. Pre-existing; recorded here rather than silently deleted.
3. **`NEXT_PUBLIC_SITE_URL` was missing entirely.** The production host was hard-coded in
   `app/[locale]/layout.tsx`, `app/robots.ts` and `app/sitemap.ts`. Added by I-70 with a production
   default, so behaviour is unchanged when it is unset.
4. **`NEXT_PUBLIC_BASE_URL` and `NEXT_PUBLIC_SITE_URL` overlap.** Both express "the origin of this
   deployment". They are kept separate on purpose: `NEXT_PUBLIC_BASE_URL` is the base for outbound
   links (and gates e-mail sending), `NEXT_PUBLIC_SITE_URL` is the advertised canonical origin for
   crawlers and metadata. A deployment that changes one usually wants to change both. Collapsing
   them into one variable is a follow-up, not part of this change.
5. **`NEXT_PUBLIC_PWA_DEV`, `PLAYWRIGHT_BASE_URL` and `DEMO_SUPABASE_ID` were undocumented.**
   Recorded in §3. They are development/test switches and are not required to run the app.
6. **Nothing reads a `SUPABASE_*` value at build time except the two `NEXT_PUBLIC_*` ones.** The
   service-role key is runtime-only, which is what lets the image be built without production
   secrets.

## 5. Build-time versus runtime for the container

| Supplied at `docker build` | Supplied at `docker run` (or `docker compose`) |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — inlined into the browser bundle | `DATABASE_URL`, `DIRECT_URL` |
| `NEXT_PUBLIC_SITE_URL` — baked into `robots.txt`, `sitemap.xml` and the metadata | `SUPABASE_SERVICE_ROLE_KEY` |
| `NEXT_TELEMETRY_DISABLED` | `CRON_SECRET`, `RESEND_API_KEY`, `REMINDER_FROM_EMAIL`, `INVITE_FROM_EMAIL`, `RESET_FROM_EMAIL`, `TELEGRAM_*`, `NEXT_PUBLIC_BASE_URL` |
| — | `OPENCODE_GO_API_KEY`, `GEMINI_API_KEY`, `AI_SECRET_KEY`, `AI_SECRET_KEY_PREVIOUS`, `OPENCODE_GO_REASONING_EFFORT` |

A server secret passed with `--build-arg` is written into the build history and the layer it was used
in. Do not do it. See `docs/operations/deployment.md` for the exact commands.
