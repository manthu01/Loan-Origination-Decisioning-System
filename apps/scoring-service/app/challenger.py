"""
Loads the shadow-mode XGBoost challenger and scores it alongside the champion scorecard.
Numeric features only -- see ml/scorecard/src/train_challenger.py for why categorical
features were left out of this model.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import xgboost as xgb

# Must match ml/scorecard/src/train_scorecard.py::CONTINUOUS_FEATURES and the column
# order the booster was trained on.
CHALLENGER_FEATURES = [
    "age",
    "monthly_income",
    "employment_tenure_months",
    "num_dependents",
    "tradelines",
    "oldest_tradeline_age_months",
    "credit_utilization",
    "enquiries_last_3m",
    "dpd30_plus_last_12m",
    "num_previous_defaults",
    "obligations_to_income",
]


@dataclass
class ChallengerResult:
    probability_of_default: float
    score: int


class Challenger:
    def __init__(self, path: Path, model_version: str = "xgb-v0.4"):
        self.model_version = model_version
        self.booster = xgb.Booster()
        self.booster.load_model(str(path))

    def required_fields(self) -> list[str]:
        return CHALLENGER_FEATURES

    def has_all_fields(self, applicant_features: dict) -> bool:
        return all(f in applicant_features for f in CHALLENGER_FEATURES)

    def score(self, applicant_features: dict) -> ChallengerResult:
        row = np.array([[float(applicant_features[f]) for f in CHALLENGER_FEATURES]])
        dmatrix = xgb.DMatrix(row, feature_names=CHALLENGER_FEATURES)
        pd_hat = float(self.booster.predict(dmatrix)[0])
        # same PDO scaling constants as the champion, so scores are on a comparable axis
        # for the champion/challenger score-correlation chart in the console dashboard
        return ChallengerResult(probability_of_default=pd_hat, score=_pd_to_indicative_score(pd_hat))


def _pd_to_indicative_score(pd_value: float, base_score: int = 600, factor: float = 28.8539) -> int:
    pd_value = min(max(pd_value, 1e-6), 1 - 1e-6)
    log_odds_good = -np.log(pd_value / (1 - pd_value))
    return round(base_score + factor * log_odds_good)
