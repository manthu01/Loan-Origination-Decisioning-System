# Measured metrics

Real numbers, measured against this implementation — not placeholders. Reproduce with
`node scripts/seed.js <count>` against a running stack (`docker compose up`), then hit
the endpoints below yourself.

## Scorecard (out-of-time test set)

| Metric | Value |
|---|---|
| AUC | 0.710 |
| KS | 0.305 |
| Gini | 0.420 |
| Champion vs. challenger AUC gap | +0.037 (XGBoost) |

See [`ml/scorecard/MODEL_CARD.md`](../ml/scorecard/MODEL_CARD.md) for the full
methodology, IV table, and gains table.

## Decision pipeline latency

Measured via `GET /decisions/stats` over 573 real applications submitted through the
actual `POST /applications` pipeline (`node scripts/seed.js 500`), each one running real
dedupe, KYC, a bureau call, a real HTTP round trip to the scoring service, rule
evaluation, and limit/pricing.

| Percentile | Latency |
|---|---|
| p50 | 524 ms |
| p95 | 792 ms |
| p99 | 822 ms |

**This is bureau-latency-dominated, not compute-dominated** — the bureau mock is
deliberately configured with 200–800ms of simulated network latency (see
`apps/orchestrator/src/applications/stages/bureau.service.ts`), which is by far the
largest component of every request. The rest of the pipeline (dedupe, KYC, rule
evaluation, limit/pricing) runs in low single-digit milliseconds; the scoring service
call itself typically completes in well under 20ms once warm (see
`apps/scoring-service` — it's a pure in-memory lookup with no external calls). If this
were fronting a real bureau with production latency characteristics, this number would
reflect that dependency, not this platform's own overhead — which is the honest way to
read it rather than the flattering one.

## Champion vs. challenger

Pearson correlation between champion and challenger scores across 546 paired live
decisions: **r = 0.959**. Both models are directionally consistent, as expected — they're
scoring the same underlying risk, just with different feature transforms and different
explainability trade-offs (see the scorecard model card for why the logistic model ships
as champion despite the AUC gap).

## What-if simulator runtime

`POST /policy/simulate` replaying all 573 seeded applications (requested `sampleSize:
10000`; capped at what actually exists): **417ms**. At this rate, replaying the plan's
target 10,000 applications would extrapolate to roughly 7 seconds — dominated by the
Postgres round trip fetching applications/decisions/events, not the in-memory rule
evaluation itself, which is sub-millisecond per application (see
`RulesEngineService.evaluate`, no I/O).

## Throughput

Seeding 500 applications at a concurrency of 20 completed in 33.4s end to end (≈15
requests/sec sustained), including 0 failures. Given the latency section above, this
ceiling is set by the bureau mock's artificial delay times the concurrency, not by the
orchestrator, database, or scoring service — a `k6`/`autocannon` run against a build with
a real (or zero-latency) bureau would show meaningfully higher throughput. That
follow-up load test is a natural next step, not done here, since the current bottleneck
is a simulated dependency, not this system.

## Audit chain integrity

`GET /audit/verify` reports `valid: true` across all 573 seeded decisions' worth of
`DecisionEvent` rows (well over 3,000 individual hash-chained events across the BUREAU,
SCORE, RULES, LIMIT, PRICE, and PERSIST stages) — the whole chain, not a sample.
