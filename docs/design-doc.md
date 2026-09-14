# Design doc — CreditFlow

## One paragraph

A loan application arrives through an API. It is deduplicated, KYC-validated, enriched
with bureau data, evaluated against a versioned policy rule set, scored by a credit risk
model, assigned a limit and a risk-based price, and returned as `APPROVE` / `REFER` /
`DECLINE` with machine-readable reason codes. Every decision is written to an
append-only, hash-chained audit log and can be replayed months later against the exact
policy version and model version that were live at the time. A credit-ops console lets a
non-engineer edit policy, simulate the impact of a change on historical applications, and
manually review referred cases under maker-checker approval.

## Why each piece matters to a bank

| Component | Why a bank interviewer cares |
|---|---|
| Policy as versioned data, not code | Credit policy changes weekly. Redeploying the app for a threshold change is a non-starter in a regulated institution. |
| What-if simulator | No credit head approves a policy change without knowing the projected approval-rate and bad-rate impact. |
| Reason codes on every decline | Regulatory requirement for adverse-action communication, and the most common reason black-box models get rejected in lending. |
| WOE/IV scorecard over raw XGBoost | Explainability and regulatory defensibility. The industry still ships logistic regression for exactly this reason. |
| Hash-chained audit log | Auditability. An inspection asks "why was this customer declined in March" and you must be able to answer exactly. |
| Idempotency keys | A retried application must not create a duplicate loan. Basic in payments, rarely done in student projects. |
| Maker-checker on manual overrides | Standard segregation-of-duties control in every bank. |

## Architecture

```
                    ┌────────────────────────┐   ┌──────────────────────────┐
                    │ Next.js applicant portal│   │ Next.js credit-ops console│
                    └───────────┬─────────────┘   └────────────┬─────────────┘
                                └───────────────┬───────────────┘
                                                 ▼
                                  ┌───────────────────────────┐
                                  │ NestJS API layer           │
                                  │ auth · idempotency · rate  │
                                  │ limiting                   │
                                  └─────────────┬──────────────┘
                                                 ▼
                                  ┌───────────────────────────┐
                                  │      Decision Orchestrator │
                                  └──┬────┬──────┬───────┬─────┘
                                     ▼    ▼      ▼       ▼
                                Dedupe  KYC   Bureau   Rules      ──calls──▶  Scoring (FastAPI)
                                svc     svc  (mock svc) Engine                scorecard.json +
                                                                              XGBoost challenger
                                     │      │      │       │                       │
                                     ▼      ▼      ▼       ▼                       ▼
                              ┌─────────────────────────────────────────────────────────┐
                              │           Redis (cache, idempotency)  ·  PostgreSQL      │
                              │  applications · decisions · decision_events (hash chain) │
                              │  policy_versions · model_versions · reason_codes · users │
                              └─────────────────────────────────────────────────────────┘
```

## Stack choice rationale

- **NestJS + TypeScript** for the orchestration layer — a module/DI structure maps
  cleanly onto a service-per-stage pipeline (dedupe → KYC → bureau → rules → score →
  limit → price → persist).
- **FastAPI + Python** for scoring only. The modelling ecosystem lives in Python, and
  keeping it a separate service is deliberate: model deploys and application deploys have
  different cadences and different owners in a real bank.
- **PostgreSQL** — relational integrity matters for financial records; Prisma for
  migrations and type-safe access.
- **Redis** — bureau response cache and the idempotency-key store.

## Data model

See [`packages/db/prisma/schema.prisma`](../packages/db/prisma/schema.prisma) for the
full schema. `DecisionEvent` is append-only by convention and by a Postgres rule that
rejects `UPDATE`/`DELETE` — see the migration that adds it.

## Full build plan

See [`docs/build-plan.md`](./build-plan.md) for the phase-by-phase plan and what's
simulated vs. real in this implementation.
