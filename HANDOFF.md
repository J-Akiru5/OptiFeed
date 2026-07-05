# Handoff

This document orients contributors to the OptiFeed scaffold.

## Structure

```
.
├── apps/web              # Next.js App Router application
│   ├── app/[locale]/     # i18n-routed pages (landing, login, dashboard)
│   ├── components/       # Stub components (locale switcher, notification bell, chat bubble)
│   ├── i18n/             # next-intl routing and request config
│   ├── lib/supabase/     # Browser + server Supabase clients
│   ├── messages/         # Translation files (en, hil)
│   └── prisma/           # Prisma schema and seed stub
├── packages/config       # Shared config (TS base config)
├── packages/types        # Shared TypeScript types (stub)
├── packages/ui           # Shared UI components (stub)
└── .github/workflows/    # CI/CD pipelines
```

## Where Features Live

- **Dashboard pages:** `apps/web/app/[locale]/(dashboard)/dashboard/...`
- **Auth:** `apps/web/app/[locale]/login/page.tsx` + `apps/web/lib/supabase/`
- **Data layer:** `apps/web/prisma/schema.prisma`
- **Translations:** `apps/web/messages/en.json` and `apps/web/messages/hil.json`
- **Design tokens:** `apps/web/app/globals.css`

## Next Steps

The full feature task list lives in the project's planning docs. Each stub file contains a `// TODO(karl):` comment describing exactly what is missing.
