# OptiFeed — Handoff to Karl

Scaffold release: **v1.0.0** (tag on `develop`) — Next.js + Supabase + Prisma + next-intl, structure and design tokens finalized, no feature logic implemented yet. That's your job from here.

## Branch & workflow rules — read this before writing any code

1. Work exclusively on the `Karl` branch. It's already created and branched from `develop` — do not create additional personal branches unless a task explicitly calls for isolating something large and risky (ask first).
2. Never push directly to `develop` or `main`. Every change reaches `develop` through a pull request from `Karl`, reviewed before merge.
3. Before starting each task below, sync first: `git checkout Karl && git pull origin develop --rebase` (or merge, if rebasing gets messy with your history — just don't let `Karl` drift far behind `develop`).
4. Keep PRs small and scoped to one task from the list below. A PR titled "Log Sample form + volume preview" is reviewable; a PR titled "various fixes" is not.
5. Before opening a PR, locally run: `pnpm lint`, `pnpm build`, and any tests that exist. If any of these fail, fix it before requesting review — the CI workflow will block the PR anyway, but don't rely on CI to catch what you could catch first.
6. Write commit messages as Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`) — the changelog and any future automated versioning depends on this being consistent.
7. Never commit `.env`, `.env.local`, or any Supabase service-role key. Use `.env.example` as the reference for what variables you need locally.
8. `main` is off-limits to you entirely — it's promoted from `develop` only by Jeff, only when a milestone is reviewed and approved. You should never need to touch it.
9. Every `// TODO(karl):` comment in the scaffold marks a specific gap — search for these first in a file before assuming you need to build something from scratch.

## Task list — build these in this order

1. **Prisma seed data** (`prisma/seed.ts`) — one demo farmer/pond/device (online, hopper 82%), 3–4 biomass log entries over the last month, ~2 weeks of feeding events including exactly one "missed" status, a trending-downward FCR history. Match the values already described in the design/rebuild planning docs.
2. **Dashboard Home** — wire the hero (next feeding time + device connectivity), FCR sparkline, and secondary cards to real Supabase/Prisma data via a Server Component.
3. **Log Sample form** — build the form, wire it to the `saveBiomassLog` Server Action and `volumeCalc.ts`, implement the live "this will set your next feeding to ~Xg" preview before submit.
4. **Feeding History + Growth/FCR screens** — list + charts, Server Components reading Prisma data directly.
5. **Schedule screen** — pause/resume toggle, "Feed Now" manual override with a confirm step, both via Server Actions.
6. **Notifications** — implement the Supabase Realtime subscription so a new `Notification` row live-updates the bell badge and (for `critical` tier) the sticky banner. Keep the visual tiering exactly as designed — Critical = sticky banner + bell, Warning/Success = toast + bell only.
7. **Chat bubble** — rule-based responses scoped to: next feeding time, how to log a sample, current FCR, and why a feeding was missed — answered from the same data sources as the dashboard, not a general-purpose model.
8. **Settings** — feeding rate / feeds-per-day fields (update the `Pond` record), language toggle using the existing next-intl setup, logout.
9. **i18n content** — replace the placeholder Hiligaynon strings in `messages/hil.json` with real translations once the above screens have real, final copy (don't translate placeholder text — wait until the English copy is final).

Each task's definition of done: builds clean, passes lint, and has something concrete to point to (a screenshot, a passing test, or a short screen recording) — not just a claim that it works.

---

**Repo:** `J-Akiru5/OptiFeed`  
**Default branch:** `develop` — protected, PR-before-merge policy  
**Karl's branch:** `Karl` — already created and pushed, branch from `develop`  
**Release tag:** `v1.0.0` (annotated, on `develop`)
