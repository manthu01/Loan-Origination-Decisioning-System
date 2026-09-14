# Build plan

This project is built in phases, each shipped as a working, committed increment rather
than a single big bang. The rules engine, scorecard, orchestrator, and audit log are the
signal; the two frontends are polish and are cut first if time runs short.

## Phase order (priority — never cut a phase to reach a later one)

1. **Data model & infra scaffold** — Prisma schema, docker-compose, monorepo layout.
2. **Credit scorecard** — WOE/IV logistic scorecard + XGBoost challenger, exported as
   `scorecard-v1.2.json`.
3. **Scoring service (FastAPI)** — `/score`, `/models`, `/health`, reason-code derivation,
   shadow-mode challenger.
4. **Rules engine + policy versioning + what-if simulator** — the differentiator. Policy as
   versioned JSON data, safe expression evaluation (no `eval`), maker-checker on
   activation, swap-set analysis on draft policies.
5. **Orchestrator (NestJS)** — dedupe, KYC, bureau mock with circuit breaker, rules
   evaluation, scoring call, limit/pricing math, persistence, idempotency keys.
6. **Audit log & replay** — SHA-256 hash-chained `DecisionEvent` rows, chain verification
   endpoint, deterministic replay against the exact policy/model version in force.
7. **Credit-ops console (Next.js)** — queue, case detail, manual review under
   maker-checker, policy editor with simulator, dashboard.
8. **Applicant portal, CI/CD, seed data, deploy** — lowest priority; Swagger UI is an
   acceptable front door if the portal is cut.

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
