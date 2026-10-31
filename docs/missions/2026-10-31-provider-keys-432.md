# Mission 2026-10-31 — Provider keys and OpenAI-compatible providers (#432)

Requested by Jeff: "Can we make it that we can change api key of provider model on the superadmin?
Make the secrets variable? Can superadmin add other provider too? plan out … ask for clarifications
… create an issue pertaining to this for the record."

Issue: [#432](https://github.com/J-Akiru5/OptiFeed/issues/432). Decisions recorded there on 2026-10-31:
encrypted in Postgres, generic OpenAI-compatible adapter, write-only masked keys, step-up + live test
required.

## Problem

The console could name the environment variable that holds a provider key, but could not change the
key, could not test it, and could not add a vendor without an adapter PR. Rotating a key meant editing
Vercel environment variables and redeploying, with no audit of the value change.

## Built (feature/432-provider-keys)

### Secret storage

- `lib/ai-providers/secrets.ts`: AES-256-GCM, random 12-byte IV per write, 16-byte tag, AAD bound to
  the provider slug. `AI_SECRET_KEY` (32 bytes, base64 or hex), `AI_SECRET_KEY_VERSION` (default 1)
  and `AI_SECRET_KEY_PREVIOUS` for lazy rotation. Missing/malformed master key fails closed per row,
  never throws.
- `AiProviderConfig` gains `keyCiphertext`, `keyIv`, `keyTag`, `keyVersion`, `keyLast4`,
  `keyUpdatedAt`, `keyUpdatedBy` (additive migration `20261031150000_add_ai_provider_secrets`).
- The backup export deliberately omits the ciphertext columns; a restore uses the environment
  fallback until an operator re-enters the key.

### Resolution

`lib/ai-providers/config.ts` resolves `db key → apiKeyEnv → adapter default env`. A ciphertext that
cannot be decrypted (wrong generation, tamper) logs a redacted warning and falls back to the
environment. The 30 s config cache is invalidated on every mutation.

### Console actions

- `setAiProviderKey`: validates the key, runs a **live test call** through the adapter with a 15 s
  timeout, and only then encrypts and stores it. A failed test writes `key_test_failed` and leaves the
  previous key in place. Requires step-up (re-entered password).
- `clearAiProviderKey`, `removeAiProvider`, `resetAiProviderConfig`: step-up + audit.
- `createAiProvider`: adds an `openai-compatible` instance (slug, label, https base URL, model,
  priority) with a required reason; built-in ids are reserved.
- Every mutation writes `platform.ai_provider.*` with actor, reason and `stepUpAt`.

### Generic provider

- `lib/ai-providers/openai-compatible.ts`: plain chat-completions adapter (no vendor extensions) used
  by console-created instances.
- `lib/ai-providers/url-safety.ts`: https only, no credentials/fragments, rejects loopback, private,
  link-local, CGNAT, unique-local and local-suffix hosts; the URL is fetched server-side with a key,
  so this guard is an SSRF boundary.

### Console UI

- Per-provider key panel: source badge (`db` / `env` / `none`), masked last four, updated at/by,
  "Set / Rotate key", "Clear", and a live test result message.
- "Add provider" form for OpenAI-compatible endpoints; custom providers can be removed.
- Step-up dialog is reused for key writes, removal and reset.

## Verification

- `lib/__tests__/ai-provider-secrets.test.ts`: round-trip, tamper, cross-row replay, wrong key,
  missing master key, generation rotation, hex/base64 keys.
- `lib/__tests__/ai-provider-url.test.ts`: https-only and the SSRF ranges.
- `lib/__tests__/ai-provider-key-actions.test.ts`: test-before-store, rejected key never overwrites,
  missing `AI_SECRET_KEY`, step-up result, audit rows, create/remove rules.
- `lib/__tests__/ai-providers.test.ts`: registry, DB-key precedence, undecryptable fallback, custom
  instance resolution, adapter stream/complete.
- Full suite, lint and typecheck run before the PR; CI (quality + e2e) is the final gate.

## Deployment note

`AI_SECRET_KEY` must be added to Vercel (Production and Preview) before keys can be stored there.
Without it the feature reports a clear error and the environment variables keep working exactly as
before. Staging and production share one database, so a key saved from staging is the row production
reads.
