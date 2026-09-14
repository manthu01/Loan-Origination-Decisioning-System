"""
XGBoost challenger, trained on the same split as the logistic scorecard for a fair
champion/challenger AUC comparison. Ships in shadow mode only (see MODEL_CARD.md for why
the scorecard remains champion despite the AUC gap).

    python src/train_challenger.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import roc_auc_score

from train_scorecard import (
    CATEGORICAL_FEATURES,
    CONTINUOUS_FEATURES,
    engineer_features,
    ks_statistic,
    time_split,
)

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "applications.csv"
ARTIFACTS_DIR = ROOT / "artifacts"
MODEL_VERSION = "xgb-v0.4"


def main():
    df = engineer_features(pd.read_csv(DATA_PATH, parse_dates=["application_date"]))
    train, val, oot = time_split(df)

    feature_cols = CONTINUOUS_FEATURES + CATEGORICAL_FEATURES
    for col in CATEGORICAL_FEATURES:
        for split in (train, val, oot):
            split[col] = split[col].astype("category")

    def to_dmatrix(split: pd.DataFrame) -> xgb.DMatrix:
        return xgb.DMatrix(split[feature_cols], label=split["target"], enable_categorical=True)

    dtrain, dval, doot = to_dmatrix(train), to_dmatrix(val), to_dmatrix(oot)

    params = {
        "objective": "binary:logistic",
        "eval_metric": "auc",
        "max_depth": 4,
        "eta": 0.05,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "min_child_weight": 20,
        "seed": 42,
    }
    booster = xgb.train(
        params,
        dtrain,
        num_boost_round=400,
        evals=[(dtrain, "train"), (dval, "val")],
        early_stopping_rounds=30,
        verbose_eval=False,
    )

    metrics = {}
    for name, d, split in [("train", dtrain, train), ("val", dval, val), ("oot", doot, oot)]:
        p = booster.predict(d)
        y = split["target"].to_numpy()
        auc = roc_auc_score(y, p)
        ks = ks_statistic(y, p)
        metrics[name] = {"auc": round(float(auc), 4), "ks": round(float(ks), 4), "gini": round(float(2 * auc - 1), 4)}

    print(json.dumps(metrics, indent=2))

    booster.save_model(str(ARTIFACTS_DIR / f"{MODEL_VERSION}.json"))

    scorecard_metrics = json.loads((ARTIFACTS_DIR / "metrics.json").read_text())
    comparison = {
        "champion": {"model_version": "scorecard-v1.2", "oot": scorecard_metrics["oot"]["auc"]},
        "challenger": {"model_version": MODEL_VERSION, "oot": metrics["oot"]["auc"]},
        "auc_gap": round(metrics["oot"]["auc"] - scorecard_metrics["oot"]["auc"], 4),
        "challenger_metrics": metrics,
        "feature_importance": {
            k: round(float(v), 1) for k, v in
            sorted(booster.get_score(importance_type="gain").items(), key=lambda kv: -kv[1])
        },
    }
    (ARTIFACTS_DIR / "challenger_comparison.json").write_text(json.dumps(comparison, indent=2))
    print(f"\nAUC gap (challenger - champion, OOT): {comparison['auc_gap']:+.4f}")


if __name__ == "__main__":
    main()
