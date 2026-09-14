"""
Loads a points-based scorecard artifact (see ml/scorecard/MODEL_CARD.md for how it's
trained) and scores applicants against it. Kept dependency-free (no numpy/pandas needed
for a single-applicant scoring path) so the hot path stays simple and fast.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

# PD ranges -> risk grade, from the risk-based pricing grid. D is a decline grade, not
# priced -- the rules engine (SCORE_FLOOR) is what actually declines on it, this label is
# informational on the score response either way.
RISK_GRADE_BANDS: list[tuple[float, str]] = [
    (0.01, "A1"),
    (0.02, "A2"),
    (0.035, "B1"),
    (0.05, "B2"),
    (0.08, "C1"),
    (0.12, "C2"),
    (float("inf"), "D"),
]


def risk_grade_for_pd(pd_value: float) -> str:
    for upper, grade in RISK_GRADE_BANDS:
        if pd_value < upper:
            return grade
    return "D"


@dataclass
class FeatureBin:
    lo: float | None
    hi: float | None
    woe: float
    points: int
    category: str | None = None

    def matches(self, value) -> bool:
        if self.category is not None:
            return str(value) == self.category
        lo = -math.inf if self.lo is None else self.lo
        hi = math.inf if self.hi is None else self.hi
        return lo <= float(value) < hi


@dataclass
class ScorecardFeature:
    name: str
    type: str
    coefficient: float
    bins: list[FeatureBin]

    def bin_for(self, value) -> FeatureBin:
        for b in self.bins:
            if b.matches(value):
                return b
        # training bins are contiguous and open-ended at both edges, so this only fires
        # for a non-numeric/NaN input -- treat it as the riskiest bin rather than raising
        return self.bins[-1]


class Scorecard:
    def __init__(self, path: Path):
        raw = json.loads(Path(path).read_text())
        self.model_version: str = raw["model_version"]
        self.base_score: int = raw["base_score"]
        self.pdo: int = raw["pdo"]
        self.base_odds: int = raw["base_odds"]
        self.factor: float = raw["factor"]
        self.offset: float = raw["offset"]
        self.intercept: float = raw["intercept"]
        self.features: list[ScorecardFeature] = [
            ScorecardFeature(
                name=f["name"],
                type=f["type"],
                coefficient=f["coefficient"],
                bins=[
                    FeatureBin(
                        lo=b.get("lo"), hi=b.get("hi"), woe=b["woe"], points=b["points"],
                        category=b.get("category"),
                    )
                    for b in f["bins"]
                ],
            )
            for f in raw["features"]
        ]
        self.n_features = len(self.features)
        # neutral (WOE=0) point contribution is identical across every feature by
        # construction of the PDO scaling formula -- see MODEL_CARD.md
        self.neutral_points_per_feature = (
            -(self.intercept / self.n_features) * self.factor + self.offset / self.n_features
        )

    def required_fields(self) -> list[str]:
        return [f.name for f in self.features]

    def score(self, applicant_features: dict) -> "ScoreResult":
        missing = [f.name for f in self.features if f.name not in applicant_features]
        if missing:
            raise KeyError(f"missing required scorecard features: {missing}")

        contributions = []
        total_points = 0.0
        log_odds_bad = self.intercept
        for feature in self.features:
            value = applicant_features[feature.name]
            b = feature.bin_for(value)
            total_points += b.points
            log_odds_bad += feature.coefficient * b.woe
            point_impact = round(b.points - self.neutral_points_per_feature)
            contributions.append(FeatureContribution(feature.name, point_impact))

        probability_of_default = 1 / (1 + math.exp(-log_odds_bad))
        score = round(total_points)
        contributions.sort(key=lambda c: c.point_impact)  # most negative first
        return ScoreResult(
            score=score,
            probability_of_default=probability_of_default,
            risk_grade=risk_grade_for_pd(probability_of_default),
            contributions=contributions,
        )


@dataclass
class FeatureContribution:
    feature: str
    point_impact: int


@dataclass
class ScoreResult:
    score: int
    probability_of_default: float
    risk_grade: str
    contributions: list[FeatureContribution]
