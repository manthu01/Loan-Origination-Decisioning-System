# Build plan

This project is built in phases, each shipped as a working, committed increment rather
than a single big bang. The rules engine, scorecard, orchestrator, and audit log are the
signal; the two frontends are polish and are cut first if time runs short.

## Phase order (priority — never cut a phase to reach a later one)

1. ✅ **Data model & infra scaffold** — Prisma schema, docker-compose, monorepo layout.
2. ✅ **Credit scorecard** — WOE/IV logistic scorecard + XGBoost challenger, exported as
   `scorecard-v1.2.json`. KS 0.305 / Gini 0.420 / AUC 0.710 out-of-time.
3. ✅ **Scoring service (FastAPI)** — `/score`, `/models`, `/health`, reason-code derivation,
   shadow-mode challenger.
4. ✅ **Rules engine + policy versioning + what-if simulator** — the differentiator. Policy as
   versioned JSON data, safe expression evaluation (no `eval`), maker-checker on
   activation, swap-set analysis on draft policies.
5. ✅ **Orchestrator (NestJS)** — dedupe, KYC, bureau mock with circuit breaker, rules
   evaluation, scoring call, limit/pricing math, persistence, idempotency keys.
6. ✅ **Audit log & replay** — SHA-256 hash-chained `DecisionEvent` rows, chain verification
   endpoint, deterministic replay against the exact policy/model version in force.
7. ✅ **Credit-ops console (Next.js)** — queue, case detail, manual review under
   maker-checker, policy editor with simulator, dashboard.
8. ✅ **CI/CD, seed data, README polish** — GitHub Actions per-app lint/test/build, a seed
   script that runs realistic applications through the real pipeline, measured metrics,
   interview prep. Applicant portal and actual cloud deployment cut per this plan's own
   priority order below — Swagger/the console's own queue is the front door, and
   deployment needs real cloud credentials this repo doesn't hold.

Every phase above was verified against a real running stack (Postgres, Redis, the actual
scoring service, and — for the console — a real browser), not just unit tests. Two real
bugs surfaced exactly that way and got fixed: a Postgres jsonb float round-trip issue
that could produce a false tamper verdict in the audit chain, and the policy simulator
replaying applicant context without the derived `age` field. See the git history for
both — this is worth saying explicitly because it's the difference between "the tests
pass" and "the thing works."

## Why this order

A bank interviewer does not care that there's a pretty portal if the policy engine is
hardcoded, or if the audit trail can't prove what happened. The scorecard and rules engine
carry the credit-domain signal; the orchestrator and audit log carry the engineering
signal. Everything else is presentation.

## What's simulated vs. real

- **Bureau service**: mocked (200–800ms latency, 2% timeout rate, 1% 500-error rate) —
  building a real bureau integration isn't the point of the exercise, simulating its failure
  modes is.
- **Credit dataset**: the scorecard pipeline is written against the Home Credit Default
  Risk schema (`application_train.csv` + `bureau.csv`) and will use it when present under
  `ml/scorecard/data/`. A synthetic generator with the same schema and realistic feature
  correlations ships alongside it so the pipeline is runnable and demoable without a
  Kaggle account.
- **Deployment**: Docker Compose and CI configs are real; actually standing up Vercel /
  Render / Neon / Upstash accounts is a manual step for whoever runs this, since it needs
  real credentials this repo doesn't hold.
- **Multi-product policy**: the rules engine and data model support any product
  (`PL`/`BL`/`AUTO`), but only `PL` has a seeded policy — `scripts/seed.js` only submits
  `PL` applications for exactly this reason. Authoring `BL`/`AUTO` policies is a content
  task, not an engineering one; the plumbing is there.
