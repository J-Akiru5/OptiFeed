# Device polling at scale (#731) — plan

**Status: the device-scale work below is deferred; the browser-side adaptive cadence landed
in #731 (§9).**
Owner: Jeff. Prepared: 2026-11-04. Related: #731, #725 (cron), #729 (alerting),
`docs/performance/README.md`.

This plan exists so the decision and the trigger points are written down. It does **not**
recommend doing the work now: the system has about five devices, the database is 21 MB, and
there is no current cost or latency problem. The first scaling wall is the polling model, not
Postgres.

## 1. What the current system does

Each feeder calls two endpoints every 5 seconds:

- `GET /api/feed-command`
- `GET /api/schedule-sync`

Every feed poll also runs a lazy-expiry `updateMany` on `FeedRequest`. The rate limiter allows
20 requests per minute per device per endpoint.

| Devices | Requests/day | Lazy-expiry writes/day |
| --- | --- | --- |
| 5 (today) | ~173k | ~8.6k |
| 50 | ~1.7M | ~86k |
| 500 | ~17.3M | ~864k |
| 1,000 | ~34.6M | ~1.7M |
| 10,000 | ~346M | ~17M |

At ~1,000 devices the dominant cost is Vercel function invocations and DB writes (~400 req/s
sustained). At 10,000 it is an architectural wall. None of these numbers has been validated by a
load test.

## 2. Decisions that must be made before implementation

1. **12-month device target.** Without a target, the transport cannot be chosen. Suggested
   starting point: 100 devices for the next 12 months; revisit at 50.
2. **Monthly budget** for function invocations and database time.
3. **Acceptable feed-command latency.** Today it is up to 5 seconds. If 10–15 seconds is
   acceptable, the cheapest fix is to reduce the poll rate.
4. **Firmware flexibility.** Can the poll interval or telemetry batch size be changed from the
   server without reflashing every unit? If not, a firmware release is part of the cost.
5. **Push transport appetite.** MQTT/WebSocket is the long-term answer, but it adds a broker,
   authentication, firmware work and operational ownership. It is not a small change.

## 3. Options

| Option | Effort | Impact | Trade-off |
| --- | --- | --- | --- |
| **A. Move lazy expiry to cron** | Low (1–2 days) | Removes one write from every feed poll | No latency change; needs the cron to be reliable |
| **B. Reduce poll frequency** (5s → 10–15s) | Low/medium, firmware-dependent | Halves/thirds request count | Slower feed-command delivery |
| **C. Batch telemetry** (send N minutes of heartbeats in one request) | Medium | Large reduction in heartbeat requests | Firmware change; needs replay/ordering rules |
| **D. Push transport** (MQTT/WebSocket) | High (weeks–months) | Near-zero idle polls, lower latency | Broker, auth, firmware, ops, cost |
| **E. Hybrid** (poll for commands, batch telemetry, cron expiry) | Medium | Best cost/benefit before 1,000 devices | More moving parts than A+B |

## 4. Recommended path

**Now (5 devices): do nothing.** Keep the current poll. Record this plan and revisit at the
first trigger.

**At ~50 devices or the first cost warning:**
- Move lazy expiry to the cron (option A). This is the cheapest, lowest-risk win.
- If firmware supports it and 10 seconds is acceptable, reduce the poll to 10 seconds (option B).

**At ~200–500 devices:**
- Batch telemetry (option C) and keep the poll for commands.
- Re-measure function invocations and DB writes.

**At ~1,000 devices:**
- Choose push transport (D) or a dedicated worker/queue, unless the target is lower.
- Do not cross 1,000 devices on the current model without a load test.

## 5. Load-test plan (when the target is chosen)

- Simulate N devices against a disposable environment, never production.
- Measure: function invocations, p50/p95 latency, DB writes, error rate, and monthly cost.
- Workload: mixed heartbeat, feed poll, schedule poll, occasional feed command.
- Acceptance: p95 under 1 second for device polls, error rate under 0.1 %, cost inside the
  agreed budget, no duplicate feed commands.
- Record the results in `docs/performance/README.md` with the tree SHA and date.

## 6. Trigger checklist

- [ ] Device count reaches 50, or monthly function cost crosses the agreed budget.
- [ ] Decide whether 10–15 second command latency is acceptable.
- [ ] Confirm the firmware can change its poll interval server-side.
- [ ] Implement A (+ B if acceptable).
- [ ] Re-measure.
- [ ] At 200–500, implement C.
- [ ] At 1,000, choose D or a dedicated worker; run the load test first.

## 7. What is explicitly not in this plan

- No code changes, schema changes, migrations or deployments in this branch.
- No change to the 5-second firmware poll today (the browser-side cadence is separate; see §9).
- No MQTT/WebSocket implementation until the target and budget are agreed.

## 8. Owner decision

**Decision requested:** choose a 12-month device target and whether the cheap option A (cron
expiry) should be scheduled now or at the 50-device trigger. Everything else waits for the
target.

## 9. Owner decision (2026-11-04): adaptive browser cadence

**Decision: adaptive interval. No protocol change, no firmware change.**

The firmware poll (two endpoints every 5 s) is unchanged: it is compiled into the unit and
this decision explicitly excludes a firmware release, so the arithmetic in §1 still applies.
What changed is the browser side, in one place — `apps/web/lib/live/poll-policy.ts`:

| Tier | When | Interval |
| --- | --- | --- |
| fast | tab visible **and** a feed request is `pending`/`dispatched` | 5 s |
| idle | tab visible, nothing waiting on the unit | 30 s |
| hidden | tab not visible | no timer; an immediate poll on `visibilitychange` |

Per open surface, derived from the policy's own `livePollDelayMs()` and asserted with simulated
timers in `apps/web/lib/__tests__/use-adaptive-poll.test.tsx` (not a production load test):

| Surface | Before | After, idle | After, feed pending |
| --- | --- | --- | --- |
| Device viewer / large screen (`GET /api/devices/{id}/state`) | 15 s → 240 req/h | 30 s → 120 req/h | 5 s → 720 req/h |
| Dashboard tab (`router.refresh()`) | 30 s → 120 req/h | 30 s → 120 req/h | 5 s → 720 req/h |

The fast tier is bounded by the in-flight window — the unit claims the request on its next poll
and reports the dispense — so it is a short burst after an action, not a new steady state. A
hidden tab now schedules no timer at all.

This does not move the device request arithmetic in §1: the firmware poll is still the load at
scale, and the trigger points in §4 stand.
