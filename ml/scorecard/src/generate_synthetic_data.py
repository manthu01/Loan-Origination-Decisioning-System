"""
Synthetic credit-application dataset generator.

CreditFlow's scorecard pipeline is written against the Home Credit Default Risk schema
(application_train.csv + aggregated bureau.csv features). Kaggle requires an
authenticated download, which this repo can't ship credentials for, so this generator
produces a same-shaped dataset with realistic feature-to-target correlations, letting the
full WOE/IV -> logistic scorecard -> XGBoost challenger pipeline run end to end without
external dependencies.

To use the real dataset instead: download application_train.csv and bureau.csv from
https://www.kaggle.com/c/home-credit-default-risk, place them under ml/scorecard/data/,
and point train_scorecard.py's DATA_PATH at them -- the feature names below were chosen
to line up with that schema so the swap is close to a no-op.

Run: python src/generate_synthetic_data.py
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

RNG_SEED = 42
N_APPLICATIONS = 60_000
# relative to this file's own location, not the caller's cwd -- train_scorecard.py's
# ROOT/DATA_PATH follow the same pattern for the same reason (CI invokes this with
# working-directory: ml/scorecard, a repo-root-relative string would resolve wrong there)
OUTPUT_PATH = Path(__file__).resolve().parents[1] / "data" / "applications.csv"

EMPLOYMENT_TYPES = ["SALARIED", "SELF_EMPLOYED", "SALARIED", "SALARIED", "GOVERNMENT"]
PRODUCTS = ["PL", "PL", "PL", "BL", "AUTO"]
EDUCATION = ["GRADUATE", "POST_GRADUATE", "UNDER_GRADUATE", "GRADUATE"]


def _clip(a: np.ndarray, lo: float, hi: float) -> np.ndarray:
    return np.clip(a, lo, hi)


def generate(n: int = N_APPLICATIONS, seed: int = RNG_SEED) -> pd.DataFrame:
    rng = np.random.default_rng(seed)

    age = _clip(rng.normal(35, 9, n), 21, 65).round(0)
    employment_type = rng.choice(EMPLOYMENT_TYPES, n)
    education = rng.choice(EDUCATION, n)
    product = rng.choice(PRODUCTS, n)

    # income correlates with age (early career -> plateau) and education
    base_income = 22_000 + (age.clip(21, 45) - 21) * 1400
    edu_bump = pd.Series(education).map(
        {"UNDER_GRADUATE": 0, "GRADUATE": 6000, "POST_GRADUATE": 14000}
    ).to_numpy()
    self_emp_noise = np.where(employment_type == "SELF_EMPLOYED", rng.normal(0, 18000, n), 0)
    monthly_income = _clip(base_income + edu_bump + self_emp_noise + rng.normal(0, 8000, n), 12000, 400000)

    employment_tenure_months = _clip(
        rng.exponential(36, n) + np.where(employment_type == "SELF_EMPLOYED", -6, 0), 0, 420
    ).round(0)

    num_dependents = rng.poisson(1.1, n).clip(0, 6)

    # bureau features
    tradelines = rng.poisson(2.5, n).clip(0, 15)
    oldest_tradeline_age_months = _clip(rng.exponential(48, n) * (tradelines > 0), 0, 300).round(0)
    credit_utilization = _clip(rng.beta(2, 3, n) * (tradelines > 0), 0, 1)
    enquiries_last_3m = rng.poisson(1.2, n).clip(0, 15)

    # latent risk index drives both dpd history and the target -- this is what makes the
    # dataset internally consistent instead of pure noise. Centered on its own population
    # mean so the calibration constants below hold regardless of upstream tweaks.
    latent_risk_raw = (
        -0.02 * (monthly_income / 1000 - 40)
        + 0.75 * credit_utilization
        + 0.22 * enquiries_last_3m
        - 0.03 * employment_tenure_months / 12
        - 0.012 * (age - 35)
        + 0.15 * num_dependents
        - 0.05 * (tradelines)
        + np.where(employment_type == "SELF_EMPLOYED", 0.3, 0)
    )
    latent_risk = latent_risk_raw - latent_risk_raw.mean() + rng.normal(0, 1.45, n)

    # ~10-14% of the population shows a 30+ DPD in the trailing 12 months, correlated
    # with the same latent risk factor
    dpd30_plus_last_12m = (rng.uniform(0, 1, n) < _sigmoid(latent_risk - 2.3)).astype(int) * rng.integers(1, 4, n)
    num_previous_defaults = rng.poisson(0.05 + 0.18 * _sigmoid(latent_risk - 1.8), n).clip(0, 5)

    requested_amount = _clip(monthly_income * rng.uniform(6, 30, n), 50_000, 4_000_000).round(-3)
    tenure_months = rng.choice([12, 24, 36, 48, 60], n, p=[0.1, 0.25, 0.3, 0.2, 0.15])
    obligations = _clip(monthly_income * rng.beta(2, 6, n), 0, monthly_income * 0.8).round(0)

    default_prob = _sigmoid(
        0.75 * latent_risk
        + 0.38 * dpd30_plus_last_12m
        + 0.32 * num_previous_defaults
        - 3.5  # calibrated to a ~7-8% base bad rate
    )
    target = (rng.uniform(0, 1, n) < default_prob).astype(int)

    application_date = pd.Timestamp("2024-01-01") + pd.to_timedelta(
        rng.integers(0, 730, n), unit="D"
    )

    df = pd.DataFrame(
        {
            "application_id": [f"APP{100000 + i}" for i in range(n)],
            "application_date": application_date,
            "age": age.astype(int),
            "employment_type": employment_type,
            "education": education,
            "product": product,
            "monthly_income": monthly_income.round(0),
            "employment_tenure_months": employment_tenure_months.astype(int),
            "num_dependents": num_dependents.astype(int),
            "requested_amount": requested_amount,
            "tenure_months": tenure_months.astype(int),
            "obligations": obligations,
            "tradelines": tradelines.astype(int),
            "oldest_tradeline_age_months": oldest_tradeline_age_months.astype(int),
            "credit_utilization": credit_utilization.round(4),
            "enquiries_last_3m": enquiries_last_3m.astype(int),
            "dpd30_plus_last_12m": dpd30_plus_last_12m.astype(int),
            "num_previous_defaults": num_previous_defaults.astype(int),
            "target": target,
        }
    ).sort_values("application_date").reset_index(drop=True)

    return df


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1 / (1 + np.exp(-x))


if __name__ == "__main__":
    data = generate()
    data.to_csv(OUTPUT_PATH, index=False)
    print(f"wrote {len(data):,} rows to {OUTPUT_PATH}")
    print(f"bad rate: {data['target'].mean():.4f}")
