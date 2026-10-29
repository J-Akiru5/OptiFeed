# Container deployment

How to build and run the OptiFeed web app as a container, what configuration it needs, and what is
still unverified.

Measured 2026-10-29 against `origin/develop` @ `8eb6ce4` (workstream I-70).

> **Honest status.** The `Dockerfile` and `docker-compose.yml` in this repository have **never been
> built or run**. Docker is not installed in the environment that wrote them, and CI does not build
> the image yet. Everything below is the intended procedure, checked only as far as a machine without
> Docker allows: file syntax, referenced paths, `pnpm install --frozen-lockfile`, Prisma generation,
> TypeScript, Biome and the unit tests. See [§6](#6-what-is-verified-and-what-is-not).

## 1. What the image is

`Dockerfile` at the repository root, four stages — a shared `base` plus three working stages:

| Stage | Base | Does |
| --- | --- | --- |
| `deps` | `node:22-bookworm-slim` | Enables pnpm through corepack at the version pinned in the root `package.json` (`pnpm@10.33.3`) and runs `pnpm install --frozen-lockfile` against the committed lockfile. |
| `builder` | `deps` | Copies the source, runs `prisma generate`, then `next build` with placeholder database URLs and the public build arguments. |
| `runner` | `node:22-bookworm-slim` | Non-root (`nextjs`, uid 1001), production `NODE_ENV`, `NEXT_TELEMETRY_DISABLED=1`, `HEALTHCHECK` on `/api/health`, `CMD next start` on `0.0.0.0:3000`. |

Properties: the build is frozen to `pnpm-lock.yaml`, no secret is passed as a build argument, the
runtime process is not root, and Prisma's client is generated inside the same `node_modules` tree the
runner copies, so the engine matches the schema in that commit.

### Why the image does not use `output: "standalone"`

Next.js's `standalone` output would shrink the image considerably, but it requires adding
`output: "standalone"` to `apps/web/next.config.ts` — the same file that governs the Vercel
deployment. That change is not behaviour-neutral on Vercel: it changes how the deployment is traced
and which files are emitted, and it would need to be verified against the production deployment
before it could be trusted. This workstream therefore leaves `next.config.ts` untouched and copies
the built app plus its resolved dependencies instead.

Consequences to accept until that decision is taken deliberately: the image carries the full pnpm
dependency tree, including dev dependencies, so it is much larger than a standalone image, and the
build relies on the builder and runner using identical absolute paths (`/app/apps/web`). Vercel's
Next.js preset does not use this `Dockerfile` at all, so the current deployment is unaffected by it.

## 2. Build

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="https://<project>.supabase.co" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="<anon key>" \
  --build-arg NEXT_PUBLIC_SITE_URL="https://optifeed.example.com" \
  -t optifeed-web:local .
```

| Build argument | Required | Why it must be a build argument |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes for a usable image | `NEXT_PUBLIC_*` values are inlined into the browser bundle at build time. Supplying it only at `docker run` leaves the client pointing at the placeholder. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes for a usable image | Same inlining rule. This key is public by design; it still must not be a server secret because it ships to browsers. |
| `NEXT_PUBLIC_SITE_URL` | No | Baked into `robots.txt`, `sitemap.xml` and the Open Graph/Twitter metadata. Defaults to `https://pakaonai.syntaxure.dev`. |

Everything else is runtime configuration. **Never** pass `DATABASE_URL`, `DIRECT_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `RESEND_API_KEY`, `TELEGRAM_BOT_TOKEN`,
`OPENCODE_GO_API_KEY` or `GEMINI_API_KEY` as build arguments: a build argument is recorded in the
image history and its value persists in the layer that used it.

Defaults exist so that a bare `docker build .` still completes; the resulting image points at
`https://build.invalid.supabase.co` and cannot authenticate anyone. That is deliberate — a loud
placeholder is better than a build that silently embeds the wrong project.

The build needs network access for two reasons: corepack downloads pnpm, and `next/font/google`
fetches the Inter font unless the build cache already has it. A fully air-gapped build is not
supported today.

The image never runs `prisma migrate deploy`. The repository's build script gates migrations on
`VERCEL_ENV=production`, which is unset outside Vercel, so building the image cannot mutate a
database. Migrations are an explicit deployment step (§3).

## 3. Run

```bash
cp apps/web/.env.example .env     # fill it in; this file is git-ignored
docker compose up --build
```

`docker-compose.yml` reads `.env` twice: for `${...}` interpolation of the build arguments and as the
container's `env_file`. Compose fails fast if `NEXT_PUBLIC_SUPABASE_URL` or
`NEXT_PUBLIC_SUPABASE_ANON_KEY` is missing, because an image built without them cannot sign anyone
in.

| Runtime variable | Required | Effect when missing |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Every data-backed page and route fails; `/api/health` returns 503, so the container reports unhealthy. |
| `DIRECT_URL` | For migrations | `prisma migrate deploy` fails. |
| `SUPABASE_SERVICE_ROLE_KEY` | For admin features | Invitations and user administration throw; ordinary sign-in still works. |
| `CRON_SECRET` | If cron is scheduled | Cron endpoints answer 403 and never run. |
| `NEXT_PUBLIC_BASE_URL` | For links and e-mail | Alert/export links lose their host; reminder and invite e-mail are skipped. |
| Provider keys (`RESEND_API_KEY`, `TELEGRAM_*`, `OPENCODE_GO_API_KEY`, `GEMINI_API_KEY`) | No | The matching feature degrades as described in [the environment matrix](./environment-matrix.md). |

Apply migrations once against the target database before starting a new image. The image's working
directory is `/app/apps/web`, which is where the Prisma schema and the local CLI live:

```bash
docker run --rm --env-file .env optifeed-web:local \
  ./node_modules/.bin/prisma migrate deploy
```

Readiness is `/api/health`: it runs `SELECT 1` and answers 503 when the database is unreachable, so
the image's `HEALTHCHECK` reports the container unhealthy rather than "running but broken".

### The optional Postgres service

`docker-compose.yml` includes a `db` service behind the `db` profile. It is **not** a self-contained
local stack. OptiFeed authenticates through Supabase Auth: `@supabase/ssr` sessions, `auth.users`
rows, the Admin API and `SUPABASE_SERVICE_ROLE_KEY`. A bare Postgres container provides none of that,
so with `--profile db` you can run Prisma migrations and inspect tables, but nobody can sign in.

For a working local stack, use the Supabase CLI (`supabase start`, which also needs Docker) and point
`DATABASE_URL`/`DIRECT_URL` at the ports it prints. A plain `postgres` service is sufficient only for
schema-level work such as `prisma migrate diff` or `prisma validate`.

## 4. What a real container run still needs

1. A Supabase project for Auth, or a running local Supabase stack. Postgres alone is not enough.
2. `docker build` executed with the real `NEXT_PUBLIC_*` values.
3. `prisma migrate deploy` run once against that database before the first start.
4. An e-mail sender (`RESEND_API_KEY`, `REMINDER_FROM_EMAIL`, `INVITE_FROM_EMAIL`) and
   `NEXT_PUBLIC_BASE_URL` if invitations and reminders must actually send.
5. `CRON_SECRET` plus an external scheduler calling `/api/cron/device-watch`, `/api/cron/crop-watch`
   and `/api/cron/jobs`. Inside Vercel these are scheduled by the platform; a container needs its own
   scheduler. Until one exists, dead-device alerts, reminders and the `ErrorEvent` retention sweep do
   not run.
6. `TELEGRAM_*` and the AI provider keys if those features are expected to work.

## 5. What this does not change

- `apps/web/next.config.ts` is untouched. No `output: "standalone"`, no new rewrite, no header change.
- `apps/web/vercel.json` is untouched. Vercel continues to deploy `main` and `staging` only, through
  the Git integration.
- No application behaviour changes. The only runtime-visible change in this workstream is that
  `robots.txt`, `sitemap.xml` and the Open Graph/Twitter metadata read `NEXT_PUBLIC_SITE_URL`, which
  defaults to `https://pakaonai.syntaxure.dev` — byte-for-byte today's output when it is unset.
- `.github/workflows/**` is untouched. CI does not build the image.

## 6. What is verified and what is not

| Claim | Status | Evidence |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` resolves the workspace | **Verified** | Install completed in 39.5 s from the local store, lockfile unchanged |
| Prisma client generates from the committed schema | **Verified** | `prisma generate` → `Generated Prisma Client (v6.19.3)` |
| `next/dist/bin/next` is the CLI entry and `next start` accepts `-H`/`-p` | **Verified** | `next start --help` on Next 16.4.2; `package.json#bin` points at `./dist/bin/next` |
| Every `COPY` path the Dockerfile takes from the build context exists | **Verified** | Path check against the working tree |
| `docker-compose.yml` is valid YAML with the intended services, profiles and arguments | **Verified** | Parsed with a YAML 2.x parser; structure inspected |
| Environment matrix matches the code | **Verified** | `process.env` sweep across `apps/web`, `scripts`, `prisma`, `e2e` |
| Env-driven site URL with production default | **Verified** | 10 unit tests; biome clean; `tsc --noEmit` exit 0 |
| `next build` succeeds with the image's placeholder environment | **Not verified** | Deferred: the host was under resource pressure (red level) while this branch was prepared. CI's `quality` job runs the equivalent `next build` with the same placeholders on every pull request. |
| The image builds | **Not verified** | Docker is not installed in the environment that wrote it |
| The container starts and serves traffic | **Not verified** | Same reason |
| `HEALTHCHECK` reports healthy | **Not verified** | Needs a running container and a reachable database |
| Prisma query engine resolves inside the runner | **Not verified** | Expected from Node 22 bookworm's OpenSSL 3 and the `openssl` package installed in the image; unproven until built |
| `next/image` optimisation works (sharp) | **Not verified** | `sharp` is in `ignoredBuiltDependencies`; the prebuilt binaries are expected to work, unproven until built |

## 7. Known limitations and follow-ups

- **No image build in CI.** Adding a `docker build` job is the next step; it requires a Docker-capable
  runner and, until the build is known-good, should not block merges.
- **Base image is tag-pinned, not digest-pinned.** `node:22-bookworm-slim` moves. Pinning a digest is
  the remaining reproducibility step and needs a Docker host to resolve and verify.
- **Image size.** No `standalone` output (see §1), so dev dependencies ship in the image.
- **No scheduler.** Cron endpoints need an external scheduler outside Vercel (§4).
- **`NEXT_PUBLIC_SITE_URL` is build-time.** Changing it requires rebuilding the image; it cannot be
  changed with a restart. This matches how Next.js inlines `NEXT_PUBLIC_*` values.
- **Two origin variables.** `NEXT_PUBLIC_BASE_URL` (outbound links, e-mail gating) and
  `NEXT_PUBLIC_SITE_URL` (crawler/metadata origin) overlap. A deployment usually sets both; see the
  environment matrix, §4.
