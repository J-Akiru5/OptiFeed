## What problem does this solve?

<!-- The behaviour that is broken, missing, or risky. Link the issue/task if one exists. -->

## What changed?

<!-- Bullet the actual changes. Keep the PR scoped to one reviewable task. -->

## How was it verified?

<!--
Paste the commands you actually ran and their result. Do not claim a check you
did not run. "CI will catch it" is not verification.
-->

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build` (only if the build script is safe for your environment)
- [ ] Manual check / screenshots:

## Database and migration impact

<!--
- [ ] No schema, migration, or seed changes
OR
- [ ] Schema/migration changed — list the migration folder(s) and say whether
      every statement is additive (no DROP / TRUNCATE / destructive ALTER).
      Destructive migrations need Jeff's explicit approval and a backup.
-->

## Environment and configuration impact

<!--
New/removed env vars, Vercel settings, Supabase policies, cron jobs, firmware
tokens. Write "none" when there is genuinely none.
-->

## Known limitations / follow-up work

<!-- Anything intentionally left out, and what will happen next. -->

## Checklist

- [ ] Branch was created from the latest `develop` and is scoped to one task
- [ ] No `.env`, token, service-role key, or other secret is included
- [ ] Shared contracts (schema, migrations, API shapes, auth helpers) were
      coordinated with the other developer if both sides touch them
- [ ] Commits use Conventional Commit messages
- [ ] Target branch is `develop` (release PRs targeting `staging`/`main` are
      raised only by the release owner)
