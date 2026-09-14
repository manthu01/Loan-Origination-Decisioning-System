# Model card — scorecard-v1.2

## Overview

A WOE/IV-binned logistic regression scorecard predicting probability of default (PD) on a
personal-loan-style application, scaled to a points-based score (base 600, PDO 20, base
odds 50:1 good:bad). Trained and validated per `docs/build-plan.md` — see
`src/train_scorecard.py` for the full pipeline and `ml/scorecard/data/README` (below) for
the dataset caveat.

## Dataset

The pipeline is written against the Home Credit Default Risk schema
(`application_train.csv` + aggregated `bureau.csv` features) but runs, by default, on a
synthetic dataset (`src/generate_synthetic_data.py`, 60,000 rows, seeded) that reproduces
that schema with realistic feature-to-target correlations and a calibrated ~6.8% base bad
rate — Kaggle requires an authenticated download this repo can't ship credentials for. To
train on the real dataset instead, drop `application_train.csv` and `bureau.csv` under
`ml/scorecard/data/`, point `DATA_PATH` in `train_scorecard.py` at them, and re-run; the
feature names were chosen to line up with that schema.

## Split methodology

- **Out-of-time (OOT)**: the most recent 15% of applications by `application_date`,
  held out entirely from binning and fitting. Banks validate on a later period than they
  trained on because the population and macro environment drift — an in-sample split
  alone would overstate live performance.
- **Train / validation**: a random 70/30 split of the remaining in-time window,
  stratified implicitly by shuffling before the split.
- Sizes: train 35,700 / val 15,300 / OOT 9,000.

## Variables considered and IV

Coarse classification: 8 quantile bins per continuous variable, merged bottom-up until
the bad rate is monotonic across bins. IV below 0.02 is dropped as a non-predictor; IV
above 0.5 is flagged for manual review rather than dropped automatically.

| Feature | IV | Kept? | Note |
|---|---|---|---|
| dpd30_plus_last_12m | 0.598 | yes | Flagged (IV > 0.5) and investigated: this is the strongest deliberately-modeled risk driver in the generator, not a leakage artifact — see `docs/build-plan.md`. On the real Home Credit data, treat any IV this high as a leakage suspect first. |
| monthly_income | 0.093 | yes | |
| enquiries_last_3m | 0.036 | yes | |
| age | 0.046 | yes | Weak but retained; final coefficient is small (-0.045). |
| credit_utilization | 0.018 | no | Below IV threshold |
| num_dependents | 0.016 | no | Below IV threshold |
| education | 0.009 | no | Below IV threshold |
| employment_tenure_months | 0.006 | no | Below IV threshold |
| employment_type | 0.004 | no | Below IV threshold |
| tradelines | 0.004 | no | Below IV threshold |
| oldest_tradeline_age_months | 0.002 | no | Below IV threshold |
| obligations_to_income | 0.001 | no | Below IV threshold |
| num_previous_defaults | 0.000 | no | Below IV threshold — too sparse (mostly zero) for quantile binning to resolve; would need custom bin edges on the real dataset. |

`education` was also checked as a categorical WOE feature: its fitted coefficient
flipped sign (positive, i.e. "safer" WOE increasing default odds) once `monthly_income`
was in the model — a confounding effect, not a real relationship (education only affects
outcome through income in the generator) — so it was dropped by the sign-check refit step
rather than kept on the strength of its univariate IV alone. This is exactly the kind of
finding "check every coefficient sign makes business sense" is meant to catch.

Correlation/VIF pruning did not remove any of the four surviving features (max pairwise
|r| and VIF were both comfortably under threshold at that stage).

## Final feature set and coefficients

Logistic regression on WOE-transformed features, predicting default (target = 1). WOE is
oriented so a higher value is always the safer bin, so every coefficient below is expected
to be negative — a positive one would mean a binning error or leakage, and is the trigger
for the automatic drop-and-refit step described above.

| Feature | Coefficient |
|---|---|
| dpd30_plus_last_12m | -0.960 |
| monthly_income | -0.744 |
| enquiries_last_3m | -0.766 |
| age | -0.045 |

Intercept: -2.593

## Performance

| Split | AUC | KS | Gini | n | Bad rate |
|---|---|---|---|---|---|
| Train | 0.700 | 0.318 | 0.400 | 35,700 | 6.95% |
| Validation | 0.697 | 0.313 | 0.393 | 15,300 | 6.37% |
| Out-of-time | 0.710 | 0.305 | 0.420 | 9,000 | 6.74% |

KS 0.305 on out-of-time is inside the realistic 0.30–0.45 range for this kind of
scorecard — it did not degrade from train to OOT, which is the point of validating out of
time rather than only on a random holdout.

### Decile gains/lift (out-of-time)

| Decile (highest score → lowest) | Score range | n | Bad rate | % of total bads captured |
|---|---|---|---|---|
| 9 (safest) | 582.9–588.9 | 898 | 1.78% | 2.64% |
| 8 | 582.2–582.6 | 796 | 2.89% | 3.79% |
| 7 | 578.1–582.1 | 931 | 2.79% | 4.28% |
| 6 | 575.6–578.0 | 912 | 4.93% | 7.41% |
| 5 | 573.1–575.5 | 836 | 3.83% | 5.27% |
| 4 | 571.0–573.1 | 1,014 | 6.11% | 10.21% |
| 3 | 568.0–571.0 | 902 | 6.43% | 9.56% |
| 2 | 565.9–567.9 | 704 | 5.54% | 6.43% |
| 1 | 554.1–565.8 | 1,097 | 7.66% | 13.84% |
| 0 (riskiest) | 500.4–535.2 | 910 | 24.40% | 36.57% |

The riskiest decile (10% of the OOT population) contains 36.6% of all defaults at a
24.4% bad rate — a 3.5x lift over the 6.7% base rate, which is what a credit-ops team
would use to size the REFER/manual-review queue.

## Champion vs. challenger

An XGBoost model was trained on the same split and raw (non-WOE) numeric features as a
shadow challenger — categorical features (`employment_type`, `education`) were left out of
the challenger deliberately: their scorecard IV was negligible (0.004 and 0.009), and
dropping them keeps the serving side a plain float vector instead of needing pandas'
categorical dtype to reproduce XGBoost's split encoding at request time.

| Model | OOT AUC | OOT KS |
|---|---|---|
| Champion — scorecard-v1.2 (logistic, WOE) | 0.710 | 0.305 |
| Challenger — xgb-v0.4 | 0.747 | 0.400 |
| Gap | +0.037 AUC | |

XGBoost wins by ~3.7 points of AUC, in line with the 2–4 point gap the build plan
predicted for this class of problem.

### Why the scorecard ships as champion anyway

- **Reason codes fall out directly.** Each WOE bin's point contribution
  (`neutral_points - actual_points`) is the adverse-action reason by construction. XGBoost
  needs a post-hoc explainer (SHAP) bolted on, which is a second model to validate and
  monitor, not a property of the decision itself.
- **The coefficients are auditable by a model risk committee.** Four signed numbers and a
  set of monotonic bins are something a non-ML credit risk reviewer can actually inspect
  line by line. A 400-tree gradient-boosted ensemble is not, regardless of what SHAP says
  about it after the fact.
- **It degrades gracefully.** A logistic model on monotonically-binned WOE features fails
  smoothly outside its training distribution; a tree ensemble can behave arbitrarily
  outside the regions it saw split points for.
- **The AUC gap rarely survives out-of-time validation** in practice on real bureau data,
  where the extra AUC XGBoost finds in-sample is disproportionately in noisy interaction
  terms that don't hold up a year later — this synthetic dataset doesn't fully demonstrate
  that decay since it has no genuine regime shift, but it's the standard finding in
  published scorecard-vs-ML comparisons on real bureau data and the reason the industry
  still ships logistic regression for the champion slot.

XGBoost stays live in shadow mode: every request is scored by both models
(`POST /score` returns `challenger: {...}` alongside the champion result), so score
distributions can be compared on real traffic before any promotion decision.

## Artifacts

- `artifacts/scorecard-v1.2.json` — the points-based scorecard consumed by the scoring
  service.
- `artifacts/xgb-v0.4.json` — the XGBoost booster, shadow-mode only.
- `artifacts/reason_codes.json` — feature → adverse-action reason code mapping.
- `artifacts/metrics.json`, `artifacts/challenger_comparison.json`,
  `artifacts/model_card_data.json` — the raw numbers this document is generated from.
