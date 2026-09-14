# CreditFlow — Digital Loan Origination & Credit Decisioning Platform

> [Design doc](docs/design-doc.md) · [Build plan](docs/build-plan.md) · [Measured metrics](docs/measured-metrics.md) · [Interview prep](docs/interview-prep.md)

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

Fully built and verified end to end against a real Postgres/Redis/scoring-service stack
in a running browser, not just unit tests: the scorecard, the scoring service, the rules
engine + versioned policy + what-if simulator, the full orchestration pipeline, the
hash-chained audit log + replay, and the credit-ops console. Seeded with 500+ applications
run through the real pipeline for demo content. See [`docs/build-plan.md`](docs/build-plan.md)
for the phase-by-phase history, including two real bugs found by using the built system
and fixed along the way.

Known gaps: only the `PL` product has a seeded policy (`BL`/`AUTO` policies would need
their own rule sets — the engine supports it, none are authored); the applicant portal
was cut per the build plan's own priority order (Swagger/the console's queue is the front
door); no cloud deployment is provisioned (Docker Compose + CI are real, standing up
Vercel/Render/Neon/Upstash accounts needs credentials this repo doesn't hold).

## Architecture

See [`docs/design-doc.md`](docs/design-doc.md#architecture).

## Repo layout

```
apps/
  scoring-service/   FastAPI — loads the scorecard, serves /score, /models, /health
  orchestrator/      NestJS — dedupe, KYC, bureau, rules, scoring, limit/pricing,
                      hash-chained audit log, replay, queue/dashboard/override endpoints
  console/           Next.js — credit-ops console (queue, case detail, policy editor,
                      dashboard)
packages/
  db/                Prisma schema shared by the orchestrator and seed script
ml/
  scorecard/         WOE/IV scorecard training pipeline + XGBoost challenger
scripts/
  seed.js            Seeds realistic applications through the real pipeline
docs/
  design-doc.md
  build-plan.md
  measured-metrics.md
  interview-prep.md
```

## Local setup

```bash
cp .env.example .env
docker compose up
node scripts/seed.js 500   # populate the console/dashboard/simulator with real content
```

Console: http://localhost:3000 · Orchestrator API: http://localhost:3001 · Scoring
service: http://localhost:8000.

## Model documentation

See [`ml/scorecard/MODEL_CARD.md`](ml/scorecard/MODEL_CARD.md): variables used, IV
table, performance metrics (KS 0.305, Gini 0.420, AUC 0.710 out-of-time), decile
gains/lift table, and validation approach.

## Design decisions and trade-offs

Documented inline in [`docs/design-doc.md`](docs/design-doc.md) and in the model card —
notably why the platform ships a WOE/IV logistic scorecard as champion with an XGBoost
challenger in shadow mode rather than shipping XGBoost directly, and why the hash-chained
audit log stores event payloads as pre-canonicalized text rather than native `jsonb` (a
real bug found and fixed during this build — see `apps/orchestrator/README.md`).

## What breaks at 100x scale

At the current measured throughput (~15 req/s, bureau-mock-latency-bound — see
[`docs/measured-metrics.md`](docs/measured-metrics.md)), 100x is ~1,500 req/s, which
nothing here is close to sustaining today, but the bottleneck ordering is:

1. **The bureau mock's artificial 200–800ms latency times concurrency** is the actual
   ceiling right now — a real bureau's SLA would set the real number, and it's very
   unlikely to be zero-latency either. Fix: this is exactly the kind of dependency a real
   system would call in parallel with other non-dependent stages, or cache aggressively
   (Redis is already provisioned for this).
2. **The global hash chain's advisory lock serializes every `DecisionEvent` write**
   across every concurrent request, by design — the whole point is one chain proving
   nothing anywhere was altered. At 100x steady load this is the first thing to profile
   before assuming it's fine; a per-shard chain (e.g. per policy product) with a periodic
   cross-shard checkpoint would trade a slightly weaker single-chain guarantee for real
   write concurrency.
3. **The orchestrator itself is stateless** (Postgres + Redis hold all state), so it
   scales horizontally behind a load balancer without any code change — this is not the
   bottleneck.
4. **Scoring service is a pure in-memory lookup**, no external calls, sub-20ms warm — also
   not the bottleneck; it scales the same way the orchestrator does.

Full write-up with the actual numbers this reasoning is based on:
[`docs/measured-metrics.md`](docs/measured-metrics.md).

## Resume entry

Substitute your own live-demo link once deployed; every other number below is measured,
not aspirational (see [`docs/measured-metrics.md`](docs/measured-metrics.md) and
[`ml/scorecard/MODEL_CARD.md`](ml/scorecard/MODEL_CARD.md) for how).

> **CreditFlow — Digital Loan Origination & Credit Decisioning Platform** ([GitHub](https://github.com/manthu01/Loan-Origination-Decisioning-System))
> Next.js, NestJS, TypeScript, FastAPI, Python, PostgreSQL, Prisma, Redis, Docker, scikit-learn, XGBoost
>
> Architected an end-to-end loan origination system processing applications through a
> configurable decisioning pipeline — deduplication, KYC validation, bureau enrichment
> with circuit-breaker fallback, rule evaluation, and risk scoring — returning
> APPROVE/REFER/DECLINE outcomes with adverse-action reason codes, FOIR-derived limits,
> and risk-grade-based pricing.
>
> Built a versioned JSON-DSL policy engine (safe expression evaluation, no `eval`)
> enabling credit-policy changes without redeployment under maker-checker approval,
> paired with a what-if simulator that replays historical applications against draft
> policies in 417ms and reports swap-set composition before activation.
>
> Developed a WOE/IV-based logistic scorecard (KS 0.305, Gini 0.420, AUC 0.710,
> validated out-of-time) with PDO point scaling and point-delta-derived reason codes,
> running an XGBoost challenger in shadow mode for champion/challenger evaluation
> (Pearson r = 0.96 on live-scored pairs); implemented a SHA-256 hash-chained
> append-only audit log enabling deterministic decision replay against the exact policy
> and model version in force — including diagnosing and fixing a Postgres jsonb
> serialization bug that could otherwise produce false tamper verdicts.
