# OptiFeed

Smart shrimp feeding management.

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Database & Auth:** Supabase (Postgres + Auth)
- **ORM:** Prisma
- **i18n:** next-intl (English + Hiligaynon)
- **Styling:** Tailwind CSS 4
- **UI Components:** shadcn/ui
- **Monorepo:** pnpm workspaces
- **Linting/Formatting:** Biome
- **Git Hooks:** Husky + lint-staged + commitlint

## Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Copy `apps/web/.env.example` to `apps/web/.env` and fill in your Supabase credentials:
   - `DATABASE_URL` (pooled connection)
   - `DIRECT_URL` (direct connection for migrations)
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

3. Generate the Prisma client:
   ```bash
   pnpm prisma:generate
   ```

4. Run database migrations:
   ```bash
   pnpm prisma:migrate
   ```

5. Start the development server:
   ```bash
   pnpm dev
   ```

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start the Next.js dev server |
| `pnpm build` | Build the Next.js app for production |
| `pnpm lint` | Run Biome lint checks |
| `pnpm lint:fix` | Run Biome lint checks with auto-fixes |
| `pnpm format` | Format files with Biome |
| `pnpm prisma:generate` | Generate the Prisma client |
| `pnpm prisma:migrate` | Run Prisma migrations |
| `pnpm typecheck` | Run TypeScript checks across the workspace |

## Branch workflow

Development moves through four stages; only two of them deploy.

```
feature/* ──PR──▶ develop ──PR──▶ staging ──PR + Jeff──▶ main
                     │              │                     │
               validate only   staging deploy      production deploy
```

- Work on a short-lived branch from `develop`; open PRs **into `develop`**.
- `develop` is the shared integration branch and never deploys.
- `staging` is the default branch and the release candidate; it deploys the
  staging environment.
- `main` is production and is only advanced by a PR from `staging`, approved
  and merged by Jeff.

Full rules: [`CONTRIBUTING.md`](./CONTRIBUTING.md).
Pipeline details, deployment policy, and known blockers:
[`docs/deployment-workflow.md`](./docs/deployment-workflow.md).

## Contributing

Start with [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the workflow, then
[`HANDOFF.md`](./HANDOFF.md) for repository orientation and the database safety
rules. Never run `prisma migrate reset` against production.
