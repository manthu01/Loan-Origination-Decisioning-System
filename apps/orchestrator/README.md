# orchestrator

NestJS service. This phase ships the policy engine -- the project's differentiator:
policy as versioned JSON data, a safe (no-`eval`) rule evaluator, maker-checker on
activation, and a what-if simulator with swap-set analysis. The pipeline orchestration
(dedupe → KYC → bureau → rules → score → limit → price → persist) and the audit log land
in later phases -- see `docs/build-plan.md`.

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

## Endpoints

- `POST /policy` — create a DRAFT policy version.
- `GET /policy`, `GET /policy/:version`, `GET /policy/active?product=PL`
- `POST /policy/:version/activate` — `{ approvedBy }`, rejected if `approvedBy` matches
  the draft's `createdBy`.
- `POST /policy/simulate` — `{ product, rules, sampleSize? }`, replays the most recent
  `sampleSize` (default 10,000) decided applications for that product against the draft.

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
