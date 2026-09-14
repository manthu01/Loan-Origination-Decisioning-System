# CreditFlow — Digital Loan Origination & Credit Decisioning Platform

> [Design doc](docs/design-doc.md) · [Build plan](docs/build-plan.md)

A loan application arrives through an API. It is deduplicated, KYC-validated, enriched
with bureau data, evaluated against a versioned policy rule set, scored by a credit risk
model, assigned a limit and a risk-based price, and returned as `APPROVE` / `REFER` /
`DECLINE` with machine-readable reason codes. Every decision is written to an
append-only, hash-chained audit log and can be replayed months later against the exact
policy version and model version that were live at the time. A credit-ops console lets a
non-engineer edit policy, simulate the impact of a change on historical applications, and
manually review referred cases under maker-checker approval.

The versioned policy engine, the what-if simulator, and the replayable audit log are the
point of this project — see [why each piece matters to a bank](docs/design-doc.md#why-each-piece-matters-to-a-bank).

## Status

Under active build. See [`docs/build-plan.md`](docs/build-plan.md) for the phase order
and what's implemented so far.

## Architecture

See [`docs/design-doc.md`](docs/design-doc.md#architecture).

## Repo layout

```
apps/
  scoring-service/   FastAPI — loads the scorecard, serves /score, /models, /health
  orchestrator/      NestJS — dedupe, KYC, bureau, rules, limit/pricing, persistence
  console/           Next.js — credit-ops console (queue, case detail, policy editor)
packages/
  db/                Prisma schema shared by the orchestrator and seed scripts
ml/
  scorecard/         WOE/IV scorecard training pipeline + XGBoost challenger
docs/
  design-doc.md
  build-plan.md
```

## Local setup

```bash
cp .env.example .env
docker compose up
```

## Model documentation

See [`ml/scorecard/MODEL_CARD.md`](ml/scorecard/MODEL_CARD.md) once the scorecard phase
lands: variables used, IV table, performance metrics (KS, Gini, AUC), validation
approach.

## Design decisions and trade-offs

Documented inline in [`docs/design-doc.md`](docs/design-doc.md) and in the model card —
notably why the platform ships a WOE/IV logistic scorecard as champion with an XGBoost
challenger in shadow mode rather than shipping XGBoost directly.

## What breaks at 100x scale

To be written once the orchestrator and load-test numbers exist (see
`docs/build-plan.md`).
