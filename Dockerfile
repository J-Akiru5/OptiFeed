# OptiFeed web application (Next.js 16 + Prisma 6 inside a pnpm workspace).
#
# Multi-stage build:
#   deps     installs the workspace from the frozen lockfile (manifests only)
#   builder  generates the Prisma client and runs `next build`
#   runner   non-root runtime with the built app and its dependencies
#
# Build with the public configuration the browser bundle needs:
#
#   docker build \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co \
#     --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key> \
#     -t optifeed-web .
#
# `NEXT_PUBLIC_*` values are inlined into the client bundle at build time, so
# they must be supplied here, not only at `docker run`. Server-side secrets
# (DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY, API keys) must never be build args:
# they are read from the environment at runtime.
#
# Status: this file has never been built in the development environment that
# produced it (no Docker installed). See docs/operations/deployment.md.

# Base image is tag-pinned to the Node 22 Debian bookworm slim line. Pinning a
# digest as well is the remaining reproducibility step; it needs a Docker host
# to resolve and verify, and is recorded as a follow-up.
FROM node:22-bookworm-slim AS base

ENV NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    HUSKY=0

# openssl: Prisma needs it to select the right query engine and to run the CLI.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# pnpm comes from corepack; the version is the one pinned by the root
# package.json "packageManager" field (pnpm@10.33.3), so there is a single
# source of truth and no duplicated version literal to drift.
RUN corepack enable

WORKDIR /app

# ---------------------------------------------------------------------------
# deps: resolve and install the workspace with the lockfile unchanged.
# ---------------------------------------------------------------------------
FROM base AS deps

# The schema is not in the build context yet, so skip @prisma/client's
# postinstall generate. The builder generates the client explicitly, after the
# source copy, against the schema in this commit.
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/config/package.json ./packages/config/package.json

RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# builder: generate the Prisma client, then compile the app.
# ---------------------------------------------------------------------------
FROM deps AS builder

COPY . .

# The client is generated inside the same node_modules tree the runner copies,
# so @prisma/client and its engine match the schema in this commit.
RUN pnpm --filter web exec prisma generate

# Public, non-secret configuration. Defaults keep a bare `docker build` working
# (and pointing at an unreachable placeholder) instead of failing the build.
ARG NEXT_PUBLIC_SITE_URL=""
ARG NEXT_PUBLIC_SUPABASE_URL="https://build.invalid.supabase.co"
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY="build-time-placeholder-anon-key"

# `next build` is used directly (not `pnpm build`) so the image never runs
# `prisma migrate deploy`: migrations are an explicit deployment step, not a
# side effect of building. The dummy database URLs mirror CI's build
# environment so no build-time Prisma import fails on a missing variable; they
# point at a non-existent local host and nothing connects to them. They are
# scoped to this single RUN and are not part of any layer's environment.
RUN NEXT_PUBLIC_SITE_URL="${NEXT_PUBLIC_SITE_URL}" \
    NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL}" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY}" \
    DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build" \
    DIRECT_URL="postgresql://build:build@127.0.0.1:5432/build" \
    pnpm --filter web exec next build

# ---------------------------------------------------------------------------
# runner: least-privilege runtime.
# ---------------------------------------------------------------------------
FROM base AS runner

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /app

RUN groupadd --gid 1001 nodejs \
 && useradd --uid 1001 --gid nodejs --create-home --shell /usr/sbin/nologin nextjs

# The workspace layout must stay identical to the builder's: pnpm's per-package
# node_modules are symlinks into the root virtual store, and Next records
# absolute paths in .next/required-server-files.json.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder --chown=nextjs:nodejs /app/packages ./packages

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next ./apps/web/.next
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/prisma ./apps/web/prisma
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/i18n ./apps/web/i18n
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/messages ./apps/web/messages
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/next.config.ts ./apps/web/next.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/tsconfig.json ./apps/web/tsconfig.json

USER nextjs

WORKDIR /app/apps/web

EXPOSE 3000

# Readiness, not just liveness: /api/health runs `SELECT 1` and answers 503 when
# the database is unreachable.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
