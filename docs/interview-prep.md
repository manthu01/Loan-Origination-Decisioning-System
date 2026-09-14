# Interview questions this project invites

Answers grounded in what's actually in this repo — file references so you can go deeper
live if asked to.

**Why logistic regression over XGBoost when XGBoost has higher AUC?**
Reason codes fall out of the WOE point deltas directly — `points_ij - neutral_points` is
the adverse-action reason by construction (`apps/scoring-service/app/scorecard.py`).
XGBoost needs a bolted-on explainer (SHAP), which is a second model to validate. The
coefficients are four signed numbers a model risk committee can read line by line; a
gradient-boosted ensemble isn't. It degrades gracefully outside its training
distribution; a tree ensemble doesn't. See `ml/scorecard/MODEL_CARD.md`'s trade-off note
for the measured gap (+3.7 AUC points here) and why it ships in shadow mode instead.

**What is the KS statistic and what is a good value?**
Kolmogorov-Smirnov — the maximum separation between the cumulative good and cumulative
bad distributions across score deciles. This scorecard measures **0.305 on out-of-time**
(`ml/scorecard/MODEL_CARD.md`), inside the realistic 0.30–0.45 range for this kind of
model. Below ~0.2 the model isn't separating risk meaningfully; above ~0.5 on a first
pass, suspect leakage before celebrating.

**How do you generate reason codes from a scorecard?**
For each feature, `neutral_points - actual_points` (the point contribution relative to a
WOE=0 baseline). Rank ascending (most negative first), map the worst offenders through a
`reason_codes.json` table to a code and a customer-facing description. Same mechanism
banks use for real adverse-action notices. Implementation:
`apps/scoring-service/app/scorecard.py::Scorecard.score`.

**What is FOIR and why cap it at 55%?**
Fixed Obligation to Income Ratio — total EMI obligations (existing + proposed) divided by
income. 55% is an industry-typical ceiling; above it, a borrower's committed obligations
leave too thin a margin against income shocks. Enforced as a policy rule
(`FOIR_CAP`, REFER not DECLINE — see `apps/orchestrator/README.md`'s sample policy) and
used again directly in limit sizing (`LimitPricingService.price`:
`maxEmi = monthlyIncome * foirCap - existingObligations`).

**Why is policy stored as data rather than code?**
Credit policy changes weekly; redeploying the app for a threshold change is a
non-starter in a regulated institution. Storing policy as versioned JSON
(`PolicyVersion.rules`) means a threshold change is a new row, not a deploy — and it's
independently auditable and diffable. Evaluated with `expr-eval`, deliberately never
`eval()`/`new Function()`, since policy JSON is user-editable through the console and
arbitrary code execution would be one bad policy edit away
(`RulesEngineService` — see the test that specifically attempts a sandbox-escape
expression and asserts it's rejected).

**What happens if the bureau is down?**
Three options exist in general: fail the request, decision on absent data, or route to
manual review. This ships option three: `BureauClientService` wraps the call in a circuit
breaker (`CircuitBreaker`, 5 consecutive failures → OPEN, 30s cooldown → one trial call),
and either way — call failure or open circuit — returns `available: 0` rather than
throwing. A `BUREAU_UNAVAILABLE` policy rule reads that flag and REFERs with a distinct
reason code (`R500`) for manual bureau pull, rather than silently scoring on missing
data or failing the applicant's request outright.

**How do you know a policy change will not tank your approval rate?**
`POST /policy/simulate` — replays a draft policy against real historical applications
without writing any decisions, and reports the swap set: not just an aggregate delta but
*exactly which applicants* flip outcome and why (`PolicySimulatorService`). Measured
runtime: 417ms replaying 573 real applications (`docs/measured-metrics.md`).

**What is a swap set?**
Who specifically changes outcome between the current and draft policy — split into
"approved now declined" (who you lose) and "declined now approved" (who you gain), plus
a breakdown of which new rule caused each loss. Credit teams live and die by this
analysis before signing off on a policy change; an aggregate "-4% approval rate" number
alone doesn't tell you if you just lost your best customers or your worst.

**How do you detect model drift after deployment?**
Not implemented here, but the natural extension: Population Stability Index (PSI) on the
score distribution and on individual WOE bins, comparing a rolling window against the
training population. The champion/challenger shadow-scoring infrastructure
(`Decision.challengerScore`, `GET /decisions/stats`'s champion-vs-challenger correlation)
is exactly the plumbing PSI monitoring would sit on top of — every decision already
carries both scores.

**Why hash-chain the audit log instead of just timestamping?**
A timestamp proves *when* a row was written, not that it hasn't been altered since.
`hash = sha256(prevHash + canonical(payload))` on every `DecisionEvent`
(`HashChainService`) means tampering with any historical row breaks its own hash and
every hash after it — `GET /audit/verify` walks the whole chain and reports the first
break. Real gotcha hit while building this: `input`/`output` are stored as pre-
canonicalized TEXT, not native `jsonb` — Postgres re-serializes jsonb numbers through its
own formatting on read, which can change a many-digit float's decimal string and produce
a false "tampered" verdict on a row nobody touched. See the commit that fixed it and
`apps/orchestrator/README.md`'s write-up.

**How would this scale to 50,000 applications per day?**
~35/minute sustained, well within what a single orchestrator instance handles even at
this project's current bureau-mock-dominated latency (p95 792ms — see
`docs/measured-metrics.md`; a real bureau's actual SLA would set the real number). The
orchestrator is stateless per request (Postgres and Redis hold all state), so it
horizontally scales trivially behind a load balancer. The likely first real bottleneck at
that volume: the single global hash chain's `pg_advisory_xact_lock` serializes every
`DecisionEvent` write across every concurrent request — deliberate, since the audit log's
integrity guarantee depends on it, but it caps write concurrency. At 50k/day that's not
close to binding (≈0.6/sec average), but it's the first thing to profile before assuming
otherwise, and the first architectural trade-off to revisit if this system needed to
handle continuous high-concurrency bursts rather than steady throughput.
