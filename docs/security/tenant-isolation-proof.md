# Two-tenant isolation proof (#711)

Read-only proof that `optifeed_app` sees one tenant at a time and cannot read
another tenant's `Pond`, `FeedEvent` or `Notification` rows. It is the gate
before switching `DATABASE_URL`.

## What it does

For each of two farm IDs (`User.farmId` login slugs) it runs:

1. the same counts through the privileged connection;
2. the same counts through `optifeed_app` with `app.farm_ids` set to that farm;
3. a cross-tenant `Pond` count that must be `0`.

It never inserts, updates or deletes.

## Run it

```bash
DATABASE_URL="postgresql://postgres:...@<staging-host>:5432/postgres" \
APP_DATABASE_URL="postgresql://optifeed_app:<password>@<staging-host>:5432/postgres" \
TENANT_PROOF_CONFIRM=yes \
node scripts/security/tenant-isolation-proof.mjs \
  --farm-a demo-farmer-1 \
  --farm-b tenant2-admin
```

- Use a **staging copy**, never production.
- A loopback database does not need `TENANT_PROOF_CONFIRM`.
- The app-role password is never committed; set it in the shell or the
  deployment secret manager.
- The script uses `@prisma/client` and only needs the two URLs.

## When to run

1. After Phase 1 and Phase 2 migrations are applied on the staging copy.
2. After the app-side `withTenant` routes are deployed to that copy.
3. Before switching `DATABASE_URL` in the maintenance window.
4. Again after the switch, through the normal app smoke test.

If any count differs or a cross-tenant count is non-zero, **do not switch**.
