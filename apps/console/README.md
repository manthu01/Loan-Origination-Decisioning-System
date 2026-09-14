# console

Next.js (App Router) credit-ops console. Four pages, all client components hitting the
orchestrator's REST API directly (`NEXT_PUBLIC_API_BASE_URL`) — no server-side data
fetching or auth is set up, since there's no login flow in this project (see
`docs/build-plan.md` for what's in/out of scope).

- **Queue** (`/`) — applications filterable by status, outcome, reason code, and score
  band.
- **Case detail** (`/applications/[id]`) — application + decision, a "replay this
  decision" determinism check, manual override under maker-checker for a REFER, and the
  full hash-chained pipeline trace (expand any stage to see its input/output and hash).
- **Policy editor** (`/policy`) — edit draft policy JSON, run the what-if simulator
  against recent applications (approval-rate deltas, swap set), save a draft, activate it
  as a different user.
- **Dashboard** (`/dashboard`) — approval rate over time, score distribution, reason-code
  frequency, decision latency p50/p95/p99, champion-vs-challenger score correlation. Hand-
  rolled inline SVG charts, no charting library.

## Run it

```bash
cp .env.example .env   # point NEXT_PUBLIC_API_BASE_URL at the orchestrator
npm install             # from the repo root
npm run dev --workspace=apps/console
```

The orchestrator must have `app.enableCors()` reachable from wherever the console runs
(already on by default; set `CONSOLE_ORIGIN` on the orchestrator to restrict it in prod).

## Verified

Every page was exercised against a live orchestrator + scoring service + Postgres/Redis
in a real browser during this phase, not just built and assumed correct — the queue,
case detail (including a real manual override end to end), policy simulate, and
dashboard. Two real bugs surfaced this way and were fixed in the orchestrator, not the
console: the replay endpoint wasn't merging the scorecard's own reason codes into its
comparison (spurious "diverged" verdicts on every REFER/DECLINE), and the policy
simulator was replaying applicant context without the derived `age` field (every AGE_*
rule failed on every replayed record). See the orchestrator's git history for both.
