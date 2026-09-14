# orchestrator

NestJS service. Ships the policy engine (versioned JSON policy, safe no-`eval` rule
evaluator, maker-checker, what-if simulator) and the full application pipeline: dedupe →
KYC → bureau (mocked, circuit breaker) → score → rules → limit/price → persist, with a
SHA-256 hash-chained append-only audit trail. The console and the chain-verify/replay
endpoints land in a later phase -- see `docs/build-plan.md`.

## Modules

- `common/rules-engine.*` — parses and evaluates policy rule expressions with
  [`expr-eval`](https://github.com/silentmatt/expr-eval) (never `eval`/`new Function`,
  since policy JSON is user-editable through the console). DECLINE short-circuits; REFER
  is sticky and lets every remaining rule still run so all reason codes get collected.
- `policy/policy.service.ts` — draft/activate/list a `PolicyVersion`; enforces
  maker-checker (`createdBy !== approvedBy`) at the service layer.
- `policy/policy-simulator.service.ts` — pure swap-set math: replays a set of historical
  applications against a draft policy and reports approval/refer/decline rate deltas plus
  exactly who flips outcome and why.

- `applications/stages/*` — one file per pipeline stage (dedupe, KYC, bureau + circuit
  breaker, scoring HTTP client, limit/pricing math), each independently unit-tested.
- `applications/applications.service.ts` — orchestrates the stages in order and persists
  every stage's `DecisionEvent` plus the `Decision` in one transaction. Runs SCORE before
  RULES (swapped from the plan's numbered list) because a `SCORE_FLOOR` rule needs
  `score.value` to already exist.
- `common/hash-chain.service.ts` — appends to a single global, advisory-lock-serialized
  hash chain (`hash = sha256(prevHash + canonical(payload))`) and can walk the whole
  chain to find the first tampered row.

## Endpoints

- `POST /policy` — create a DRAFT policy version.
- `GET /policy`, `GET /policy/:version`, `GET /policy/active?product=PL`
- `POST /policy/:version/activate` — `{ approvedBy }`, rejected if `approvedBy` matches
  the draft's `createdBy`.
- `POST /policy/simulate` — `{ product, rules, sampleSize? }`, replays the most recent
  `sampleSize` (default 10,000) decided applications for that product against the draft.
- `POST /applications` — `{ applicant: {...}, application: {...} }`, optional
  `Idempotency-Key` header. Runs the full pipeline and returns the decision.
- `GET /applications/:id` — application + decision + full ordered `DecisionEvent` trace.
- `GET /audit/verify` — walks the entire hash chain and reports the first tampered row,
  if any.
- `POST /decisions/:id/replay` — re-runs SCORE/RULES/LIMIT/PRICE against the exact policy
  and model version recorded on the decision (reusing the BUREAU data actually captured
  at the time, not a fresh bureau call — see `audit/replay.service.ts`) and diffs the
  result against what was stored.
- `GET /applications?status=&outcome=&reasonCode=&product=&scoreMin=&scoreMax=` — the
  credit-ops queue.
- `GET /decisions/stats?product=&days=` — approval rate over time, score distribution,
  reason-code frequency, decision latency p50/p95/p99, champion-vs-challenger score
  correlation. Powers the console dashboard.
- `POST /decisions/:id/override` — `{ newOutcome, justification (>=10 chars), proposedBy,
  approvedBy }`. Only a REFER can be overridden; rejected if `proposedBy === approvedBy`
  (maker-checker); logs an `OVERRIDE` event into the same hash chain as every other stage.

## A hash-chain gotcha worth knowing

`DecisionEvent.input`/`output` are `String` columns holding pre-canonicalized JSON text,
not Prisma `Json`/`jsonb`. That's deliberate, not an oversight: Postgres re-serializes
jsonb numbers through its own `numeric` formatting on read, which can round a
many-significant-digit float (e.g. `2000/120000` → `0.016666666666666666` in JS) to a
different decimal string than what was originally hashed (`...66667`) — an untampered row
would then fail verification, a false positive that defeats the whole point of the audit
log. Storing already-canonical text sidesteps this: the column is returned byte-for-byte,
so re-hashing always reproduces the original hash. Found by running the actual chain
verification against real data during this phase, not by inspection -- see the commit
history if you want the debugging trail.

## A calibration note for any policy you activate

This scorecard's point range tops out around **589**, not the 1000ish a textbook FICO-style
range suggests -- see `ml/scorecard/MODEL_CARD.md`. A `SCORE_FLOOR` rule copied verbatim
from the build plan's example (`score.value >= 620`) will decline *every* application,
since 620 is unreachable. Use a threshold inside the model's actual range (verified by
manual testing: roughly 500–589) -- e.g. 560 -- or nobody will ever get approved. The
Week 5 seed script uses a calibrated default for exactly this reason.

## Run it

```bash
cp .env.example .env   # point DATABASE_URL at a running Postgres
npm install             # from the repo root, so workspace packages link correctly
npx prisma migrate deploy --schema=../../packages/db/prisma/schema.prisma
npm run build --workspace=apps/orchestrator
node apps/orchestrator/dist/main.js
```

Or via `docker compose up` from the repo root, which wires Postgres, Redis, and every
service together.

## Test

```bash
npm test   # from apps/orchestrator -- unit tests only, no database required
```

The rules engine and simulator tests run against in-memory fixtures. `policy.service.spec.ts`
mocks Prisma to test the maker-checker business logic without a live database. Wiring
against a real Postgres was verified manually (create draft → reject same-user activation
→ activate with a different approver → confirm `GET /policy/active` → call
`POST /policy/simulate`).
