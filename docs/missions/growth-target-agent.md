# Mission: target-weight growth plan + permissioned agent (pre-defense)

## Objective

Make OptiFeed able to run a grow-out cycle against a target harvest weight and date, adjust feeding automatically within a strict safety envelope, and let the assistant create/edit the records needed to do it.

Primary success metric: hit the target weight and reduce FCR / feed cost.

## Decisions (from owner, 2026-10-25)

- Timeline: pre-defense (defense is 2026-10-28).
- Feeding lever: `% of body weight` is the planning input; device `grams per feeding` is the execution lever.
- Adjustment rule: at most **10% per 15 days**, driven by a biomass sample.
- Everything must be editable: cycle, target, pond profile, biomass samples.
- Cycle creation: full crop cycle, not calendar-only.
- Users: owner and farmer/operator with authentication and existing permissions.
- Stocking count is entered by the farmer; pond area/depth is required to show stocking density.
- Target policy: show the gap and recommend an adjustment inside the 10% envelope; do not silently move harvest dates. The farmer can edit dates/weights.

## Hard constraint: no production schema change before defense

Vercel preview deployments share the production database, and migrations only run on a production (`main`) deployment. A new column would therefore need a production migration, which is a separate owner decision.

For the pre-defense slice, pond area, average depth and feed price are stored in the existing `Pond.notificationPrefs` JSON under a `profile` key. This is a deliberate temporary bridge; a proper migration is the first post-defense task.

## Scope

### In scope

1. Pond profile (area, average depth, feed price) editable in pond settings; stocking density shown in the cycle form.
2. Pure growth-plan engine:
   - target trajectory, expected weight vs actual, on-track/behind
   - required daily gain, feed and feeding rate
   - recommended grams per feeding
   - 10%/15-day adjustment envelope
   - device per-meal capacity check
   - density advisory
   - feed budget and estimated cost
   - confidence and reasons
3. Growth plan card on the Growth page with apply action.
4. Biomass samples editable/deletable, with revalidation.
5. Assistant actions over existing server actions:
   - read growth plan/cycle/pond state
   - create/update full crop cycle (calendar events included)
   - apply growth plan with confirmation
6. English and Hiligaynon strings.
7. Unit tests for the plan math and adjustment guards; CI green.

### Out of scope for this slice

- Automatic harvest-date changes.
- Multi-pond batch commands.
- Free-form database access by the model.
- Production schema migration (post-defense).
- Full native tool-calling provider support; the agent uses a structured JSON planner over the existing text-completion API.

## Architecture

- `lib/growth-plan.ts` — pure planning math, no Prisma.
- `lib/pond-profile.ts` — JSON bridge for area/depth/feed price.
- `lib/actions/growth-plan.ts` — permissioned apply action, server-side recompute, audit.
- `lib/actions/biomass.ts` — edit/delete actions.
- `components/growth/GrowthPlanCard.tsx` — plan UI + confirm/apply.
- `lib/chat/agent.ts` — structured JSON planner for read/write intents.
- `lib/actions/chat-agent.ts` — validates and executes confirmed actions.
- `components/chat/ChatActionCard.tsx` — preview + confirm/cancel.

## Safety rules

- The LLM never computes the feeding number; it only extracts intent/arguments.
- Every write revalidates permissions, pond ownership, ranges and current state server-side.
- Apply is capped at ±10% and blocked until 15 days after the last plan adjustment.
- The device per-meal cap (currently 1,000 g) is a hard limit; the plan must flag infeasible targets.
- No silent harvest-date or target-weight changes.

## Status

- [x] Mission defined
- [x] Pond profile + density (JSON bridge; migration deferred)
- [x] Growth-plan engine + tests
- [x] Growth plan UI + apply
- [x] Editable biomass samples (batch page)
- [x] Chat agent actions + confirmation UI (create/update cycle, apply plan)
- [ ] CI + deploy to develop
- [ ] Post-defense: proper pond-profile migration

## Verification

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `npx next build` via CI.
- Focused unit tests for plan math and guardrails.
- Manual/e2e demo: create a cycle through the assistant, log a sample, see the plan, apply an adjustment, verify the audit event.
