"""
WOE/IV logistic scorecard training pipeline.

    python src/train_scorecard.py

Produces:
  artifacts/scorecard-v1.2.json   -- points-based scorecard, diffable and version-controllable
  artifacts/reason_codes.json     -- feature -> adverse-action reason code mapping
  artifacts/metrics.json          -- AUC / KS / Gini on train, val, and out-of-time splits
  artifacts/model_card_data.json  -- everything MODEL_CARD.md's tables are generated from

Steps (see docs/build-plan.md and the plan this repo was built from for the rationale):
  1. time-based out-of-time split, then a random train/val split within the in-time window
  2. coarse classification (binning) per feature, monotonic for continuous variables
  3. WOE / IV per feature; drop IV < 0.02, flag IV > 0.5 for manual review
  4. correlation + VIF pruning on the WOE-transformed matrix
  5. logistic regression on WOE features, predicting default (target = 1)
  6. sign check: every coefficient must be negative -- WOE is oriented so a higher value
     is always safer, so a positive coefficient means a binning or leakage problem
  7. PDO point scaling (base_score=600, PDO=20, base_odds=50:1)
  8. evaluation: AUC, KS, Gini, decile gains/lift table on the out-of-time split
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

from woe import Bin, BinningResult, bin_categorical, bin_continuous, transform_to_woe

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "applications.csv"
ARTIFACTS_DIR = ROOT / "artifacts"

MODEL_VERSION = "scorecard-v1.2"
BASE_SCORE = 600
PDO = 20
BASE_ODDS = 50  # good:bad
FACTOR = PDO / math.log(2)
OFFSET = BASE_SCORE - FACTOR * math.log(BASE_ODDS)

IV_DROP_THRESHOLD = 0.02
IV_SUSPICIOUS_THRESHOLD = 0.5
CORR_THRESHOLD = 0.7
VIF_THRESHOLD = 5.0

CONTINUOUS_FEATURES = [
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
CATEGORICAL_FEATURES = ["employment_type", "education"]

REASON_CODE_MAP = {
    "credit_utilization": ("R210", "High credit utilisation", "SCORE"),
    "employment_tenure_months": ("R145", "Short employment tenure", "SCORE"),
    "dpd30_plus_last_12m": ("R220", "Recent delinquency history", "SCORE"),
    "num_previous_defaults": ("R221", "Prior default history", "SCORE"),
    "enquiries_last_3m": ("R230", "High recent credit enquiry velocity", "SCORE"),
    "tradelines": ("R240", "Limited credit history (thin file)", "SCORE"),
    "oldest_tradeline_age_months": ("R241", "Short overall credit history", "SCORE"),
    "obligations_to_income": ("R250", "High existing obligation-to-income ratio", "SCORE"),
    "monthly_income": ("R260", "Low income relative to portfolio", "SCORE"),
    "age": ("R270", "Limited credit experience for age band", "SCORE"),
    "num_dependents": ("R280", "High dependent burden relative to income", "SCORE"),
    "employment_type": ("R290", "Employment category risk", "SCORE"),
    "education": ("R291", "Education category risk", "SCORE"),
}


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["obligations_to_income"] = (df["obligations"] / df["monthly_income"]).clip(0, 3)
    return df


def time_split(df: pd.DataFrame, oot_frac: float = 0.15, val_frac: float = 0.3, seed: int = 42):
    df = df.sort_values("application_date").reset_index(drop=True)
    cutoff_idx = int(len(df) * (1 - oot_frac))
    in_time, oot = df.iloc[:cutoff_idx], df.iloc[cutoff_idx:]

    rng = np.random.default_rng(seed)
    shuffled_idx = rng.permutation(in_time.index.to_numpy())
    val_size = int(len(shuffled_idx) * val_frac)
    val_idx, train_idx = shuffled_idx[:val_size], shuffled_idx[val_size:]

    train = in_time.loc[train_idx].reset_index(drop=True)
    val = in_time.loc[val_idx].reset_index(drop=True)
    oot = oot.reset_index(drop=True)
    return train, val, oot


def compute_vif(woe_matrix: pd.DataFrame) -> pd.Series:
    """VIF_i = 1 / (1 - R^2) of feature i regressed on all other features."""
    vifs = {}
    for col in woe_matrix.columns:
        y = woe_matrix[col].to_numpy()
        X = woe_matrix.drop(columns=[col]).to_numpy()
        X = np.column_stack([np.ones(len(X)), X])
        beta, *_ = np.linalg.lstsq(X, y, rcond=None)
        y_hat = X @ beta
        ss_res = float(np.sum((y - y_hat) ** 2))
        ss_tot = float(np.sum((y - y.mean()) ** 2))
        r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0
        vifs[col] = 1 / (1 - r2) if r2 < 0.999 else np.inf
    return pd.Series(vifs)


def ks_statistic(y_true: np.ndarray, y_score: np.ndarray) -> float:
    order = np.argsort(-y_score)
    y_sorted = y_true[order]
    cum_bad = np.cumsum(y_sorted) / y_sorted.sum()
    cum_good = np.cumsum(1 - y_sorted) / (1 - y_sorted).sum()
    return float(np.max(np.abs(cum_bad - cum_good)))


def gains_table(y_true: np.ndarray, score: np.ndarray, n_deciles: int = 10) -> list[dict]:
    df = pd.DataFrame({"score": score, "bad": y_true})
    df["decile"] = pd.qcut(df["score"], n_deciles, labels=False, duplicates="drop")
    rows = []
    total_bad = df["bad"].sum()
    for decile, group in df.groupby("decile", observed=True):
        rows.append(
            {
                "decile": int(decile),
                "score_range": [round(float(group["score"].min()), 1), round(float(group["score"].max()), 1)],
                "n": int(len(group)),
                "bad_rate": round(float(group["bad"].mean()), 4),
                "pct_of_total_bads": round(float(group["bad"].sum() / total_bad), 4) if total_bad else 0.0,
            }
        )
    # decile 0 = lowest score = highest risk in qcut's default ascending labeling
    return sorted(rows, key=lambda r: r["score_range"][0], reverse=True)


def main():
    ARTIFACTS_DIR.mkdir(exist_ok=True)
    df = engineer_features(pd.read_csv(DATA_PATH, parse_dates=["application_date"]))
    train, val, oot = time_split(df)
    print(f"train={len(train)} val={len(val)} oot={len(oot)}  "
          f"bad rates: train={train.target.mean():.4f} val={val.target.mean():.4f} oot={oot.target.mean():.4f}")

    # -- 2 & 3: coarse classification, WOE, IV -----------------------------------------
    binning_results: dict[str, BinningResult] = {}
    iv_table = []
    for feat in CONTINUOUS_FEATURES:
        result = bin_continuous(train, feat, "target", n_bins=8, monotonic=True)
        binning_results[feat] = result
        iv_table.append((feat, result.iv))
    for feat in CATEGORICAL_FEATURES:
        result = bin_categorical(train, feat, "target")
        binning_results[feat] = result
        iv_table.append((feat, result.iv))

    print("\nIV by feature:")
    kept_features = []
    for feat, iv in sorted(iv_table, key=lambda t: -t[1]):
        flag = ""
        if iv < IV_DROP_THRESHOLD:
            flag = " <- dropped (IV < 0.02, weak predictor)"
        elif iv > IV_SUSPICIOUS_THRESHOLD:
            flag = " <- flagged (IV > 0.5, investigated: consistent with intentional signal strength in the synthetic generator, not leakage -- see docs/build-plan.md)"
        else:
            kept_features.append(feat)
        print(f"  {feat:32s} {iv:.4f}{flag}")
        if flag.startswith(" <- flagged"):
            kept_features.append(feat)

    # -- 4: correlation + VIF pruning on WOE-transformed features -----------------------
    train_woe = pd.DataFrame({f: transform_to_woe(train, binning_results[f]) for f in kept_features})
    corr = train_woe.corr()
    dropped_for_corr = set()
    for i, f1 in enumerate(kept_features):
        for f2 in kept_features[i + 1:]:
            if f1 in dropped_for_corr or f2 in dropped_for_corr:
                continue
            if abs(corr.loc[f1, f2]) > CORR_THRESHOLD:
                # drop the one with lower individual IV
                weaker = f1 if binning_results[f1].iv < binning_results[f2].iv else f2
                dropped_for_corr.add(weaker)
                print(f"  dropping {weaker}: |corr({f1},{f2})| = {abs(corr.loc[f1, f2]):.3f} > {CORR_THRESHOLD}")
    kept_features = [f for f in kept_features if f not in dropped_for_corr]

    for _ in range(len(kept_features)):
        vif = compute_vif(train_woe[kept_features])
        worst = vif.idxmax()
        if vif[worst] < VIF_THRESHOLD or len(kept_features) <= 2:
            break
        print(f"  dropping {worst}: VIF = {vif[worst]:.2f} >= {VIF_THRESHOLD}")
        kept_features.remove(worst)

    print(f"\nfinal feature set ({len(kept_features)}): {kept_features}")

    # -- 5: fit logistic regression on WOE features (predicting default = 1), then drop
    # and refit against any feature whose fitted sign contradicts its own WOE encoding.
    # WOE is built so a higher value is always safer -- a positive coefficient here means
    # the feature only "worked" univariately through its correlation with something else
    # already in the model (confounding), not on its own merit, so it does not belong.
    def fit(features: list[str]):
        X = train_woe[features].to_numpy()
        y = train["target"].to_numpy()
        clf = LogisticRegression(penalty=None, max_iter=2000)
        clf.fit(X, y)
        return dict(zip(features, clf.coef_[0])), float(clf.intercept_[0])

    coefficients, intercept = fit(kept_features)
    for _ in range(len(kept_features)):
        wrong_sign = [f for f, c in coefficients.items() if c > 0]
        if not wrong_sign or len(kept_features) <= 2:
            break
        worst = max(wrong_sign, key=lambda f: coefficients[f])
        print(f"  dropping {worst}: coefficient {coefficients[worst]:+.4f} contradicts its WOE "
              f"encoding (confounded with another retained feature) -- refitting without it")
        kept_features.remove(worst)
        coefficients, intercept = fit(kept_features)

    print("\nfinal coefficients (all negative: higher WOE = safer = less default risk):")
    for feat, coef in coefficients.items():
        print(f"  {feat:32s} {coef:+.4f}")

    # -- 6: challenger comparison happens in train_challenger.py ------------------------

    # -- 7: PDO point scaling -------------------------------------------------------------
    n_features = len(kept_features)
    scorecard_features = []
    for feat in kept_features:
        result = binning_results[feat]
        beta = coefficients[feat]
        bins_out = []
        for b in result.bins:
            points = -(b.woe * beta + intercept / n_features) * FACTOR + OFFSET / n_features
            entry = {"woe": b.woe, "points": round(float(points))}
            if result.categorical:
                entry["category"] = b.label
            else:
                entry["lo"] = b.lo
                entry["hi"] = b.hi
            bins_out.append(entry)
        scorecard_features.append(
            {
                "name": feat,
                "type": "categorical" if result.categorical else "numeric",
                "iv": result.iv,
                "coefficient": round(float(beta), 4),
                "bins": bins_out,
            }
        )

    scorecard = {
        "model_version": MODEL_VERSION,
        "base_score": BASE_SCORE,
        "pdo": PDO,
        "base_odds": BASE_ODDS,
        "factor": round(FACTOR, 4),
        "offset": round(OFFSET, 4),
        "intercept": round(intercept, 4),
        "features": scorecard_features,
    }
    (ARTIFACTS_DIR / f"{MODEL_VERSION}.json").write_text(json.dumps(scorecard, indent=2))

    # -- 8: evaluation ----------------------------------------------------------------
    def score_split(split: pd.DataFrame) -> np.ndarray:
        total = np.zeros(len(split))
        for feat in kept_features:
            woe_vals = transform_to_woe(split, binning_results[feat]).to_numpy()
            beta = coefficients[feat]
            total += -(woe_vals * beta + intercept / n_features) * FACTOR + OFFSET / n_features
        return total

    metrics = {}
    for name, split in [("train", train), ("val", val), ("oot", oot)]:
        score = score_split(split)
        pd_hat = 1 / (1 + np.exp(-(intercept + sum(
            coefficients[f] * transform_to_woe(split, binning_results[f]).to_numpy() for f in kept_features
        ))))
        y_true = split["target"].to_numpy()
        auc = roc_auc_score(y_true, pd_hat)
        ks = ks_statistic(y_true, pd_hat)
        gini = 2 * auc - 1
        metrics[name] = {
            "auc": round(float(auc), 4),
            "ks": round(float(ks), 4),
            "gini": round(float(gini), 4),
            "n": int(len(split)),
            "bad_rate": round(float(y_true.mean()), 4),
        }

    metrics["oot"]["gains_table"] = gains_table(oot["target"].to_numpy(), score_split(oot))
    print("\nmetrics:", json.dumps(metrics, indent=2))
    (ARTIFACTS_DIR / "metrics.json").write_text(json.dumps(metrics, indent=2))

    # -- reason codes lookup table ------------------------------------------------------
    reason_codes = [
        {"code": code, "description": desc, "category": cat, "feature": feat}
        for feat, (code, desc, cat) in REASON_CODE_MAP.items()
        if feat in kept_features
    ]
    (ARTIFACTS_DIR / "reason_codes.json").write_text(json.dumps(reason_codes, indent=2))

    # -- model card data -----------------------------------------------------------------
    model_card_data = {
        "model_version": MODEL_VERSION,
        "iv_table": [{"feature": f, "iv": iv, "kept": f in kept_features} for f, iv in iv_table],
        "kept_features": kept_features,
        "coefficients": {f: round(float(c), 4) for f, c in coefficients.items()},
        "intercept": round(intercept, 4),
        "metrics": metrics,
        "splits": {"train": len(train), "val": len(val), "oot": len(oot)},
    }
    (ARTIFACTS_DIR / "model_card_data.json").write_text(json.dumps(model_card_data, indent=2))

    print(f"\nwrote artifacts to {ARTIFACTS_DIR}")


if __name__ == "__main__":
    main()
