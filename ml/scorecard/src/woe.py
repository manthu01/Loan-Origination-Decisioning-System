"""
WOE (weight of evidence) and IV (information value) binning utilities.

    WOE_bin = ln( (% of goods in bin) / (% of bads in bin) )
    IV      = sum_bin( (%goods_bin - %bads_bin) * WOE_bin )

"Good" = target == 0 (repaid), "bad" = target == 1 (defaulted), matching credit-industry
convention (this is the opposite sign convention from a plain sklearn `target==1` framing,
so keep it consistent everywhere a WOE sign is read).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

EPS = 0.5  # additive smoothing so an empty bin doesn't divide by zero


@dataclass
class Bin:
    lo: float | None
    hi: float | None
    label: str
    n_good: int
    n_bad: int
    woe: float
    iv_contribution: float


@dataclass
class BinningResult:
    feature: str
    bins: list[Bin]
    iv: float
    categorical: bool = False
    category_map: dict = field(default_factory=dict)


def _woe_and_iv(n_good: np.ndarray, n_bad: np.ndarray) -> tuple[np.ndarray, float]:
    total_good, total_bad = n_good.sum(), n_bad.sum()
    pct_good = (n_good + EPS) / (total_good + EPS * len(n_good))
    pct_bad = (n_bad + EPS) / (total_bad + EPS * len(n_bad))
    woe = np.log(pct_good / pct_bad)
    iv = float(((pct_good - pct_bad) * woe).sum())
    return woe, iv


def bin_continuous(
    df: pd.DataFrame, feature: str, target: str, n_bins: int = 8, monotonic: bool = True
) -> BinningResult:
    """Quantile-based coarse classification, optionally coerced to a monotonic bad-rate
    trend by merging adjacent bins that violate monotonicity. Ends at <= n_bins buckets.
    """
    x = df[feature].astype(float)
    y = df[target].astype(int)

    try:
        quantile_edges = pd.qcut(x, q=n_bins, duplicates="drop").cat.categories
    except ValueError:
        quantile_edges = pd.cut(x, bins=n_bins).cat.categories

    edges = sorted({e.left for e in quantile_edges} | {e.right for e in quantile_edges})
    edges[0], edges[-1] = -np.inf, np.inf

    bin_idx = pd.cut(x, bins=edges, include_lowest=True)
    grouped = y.groupby(bin_idx, observed=True).agg(["sum", "count"])
    grouped.columns = ["n_bad", "n_total"]
    grouped["n_good"] = grouped["n_total"] - grouped["n_bad"]
    grouped = grouped[grouped["n_total"] > 0].sort_index()

    if monotonic:
        grouped = _enforce_monotonic_bad_rate(grouped)

    n_good = grouped["n_good"].to_numpy()
    n_bad = grouped["n_bad"].to_numpy()
    woe, iv = _woe_and_iv(n_good, n_bad)

    bins = []
    for interval, g, b, w in zip(grouped.index, n_good, n_bad, woe):
        lo = None if interval.left == -np.inf else round(float(interval.left), 4)
        hi = None if interval.right == np.inf else round(float(interval.right), 4)
        label = f"({lo if lo is not None else '-inf'}, {hi if hi is not None else 'inf'}]"
        bins.append(Bin(lo=lo, hi=hi, label=label, n_good=int(g), n_bad=int(b), woe=round(float(w), 4),
                         iv_contribution=0.0))

    # attach per-bin IV contribution for the model card table
    total_good, total_bad = n_good.sum(), n_bad.sum()
    for b in bins:
        pct_g = (b.n_good + EPS) / (total_good + EPS * len(bins))
        pct_b = (b.n_bad + EPS) / (total_bad + EPS * len(bins))
        b.iv_contribution = round(float((pct_g - pct_b) * b.woe), 4)

    return BinningResult(feature=feature, bins=bins, iv=round(iv, 4))


def _enforce_monotonic_bad_rate(grouped: pd.DataFrame, max_iter: int = 50) -> pd.DataFrame:
    """Merge adjacent bins bottom-up until the bad rate is monotonic (non-decreasing or
    non-increasing -- whichever the data trends toward), which is what "monotonic binning"
    means in scorecard practice and what keeps a fitted coefficient sign business-sensible.
    """
    g = grouped.copy()
    for _ in range(max_iter):
        if len(g) <= 2:
            break
        bad_rate = g["n_bad"] / g["n_total"]
        diffs = np.diff(bad_rate.to_numpy())
        increasing = (diffs >= 0).sum() >= (diffs <= 0).sum()
        violation = None
        for i, d in enumerate(diffs):
            if (increasing and d < 0) or (not increasing and d > 0):
                violation = i
                break
        if violation is None:
            break
        # merge bin[violation] and bin[violation+1]
        idx_a, idx_b = g.index[violation], g.index[violation + 1]
        merged_interval = pd.Interval(idx_a.left, idx_b.right)
        merged_row = g.loc[[idx_a, idx_b]].sum()
        g = g.drop([idx_a, idx_b])
        g.loc[merged_interval] = merged_row
        g = g.sort_index()
    return g


def bin_categorical(df: pd.DataFrame, feature: str, target: str) -> BinningResult:
    y = df[target].astype(int)
    grouped = y.groupby(df[feature], observed=True).agg(["sum", "count"])
    grouped.columns = ["n_bad", "n_total"]
    grouped["n_good"] = grouped["n_total"] - grouped["n_bad"]

    n_good = grouped["n_good"].to_numpy()
    n_bad = grouped["n_bad"].to_numpy()
    woe, iv = _woe_and_iv(n_good, n_bad)

    category_map = {}
    bins = []
    total_good, total_bad = n_good.sum(), n_bad.sum()
    for cat, g, b, w in zip(grouped.index, n_good, n_bad, woe):
        pct_g = (g + EPS) / (total_good + EPS * len(grouped))
        pct_b = (b + EPS) / (total_bad + EPS * len(grouped))
        bins.append(
            Bin(lo=None, hi=None, label=str(cat), n_good=int(g), n_bad=int(b), woe=round(float(w), 4),
                iv_contribution=round(float((pct_g - pct_b) * w), 4))
        )
        category_map[str(cat)] = round(float(w), 4)

    return BinningResult(feature=feature, bins=bins, iv=round(iv, 4), categorical=True, category_map=category_map)


def transform_to_woe(df: pd.DataFrame, result: BinningResult) -> pd.Series:
    if result.categorical:
        return df[result.feature].astype(str).map(result.category_map).fillna(0.0)

    edges = [-np.inf] + [b.hi for b in result.bins[:-1]] + [np.inf]
    bin_idx = pd.cut(df[result.feature].astype(float), bins=edges, include_lowest=True)
    woe_by_label = {b.label: b.woe for b in result.bins}
    labels = [f"({lo if lo != -np.inf else '-inf'}, {hi if hi != np.inf else 'inf'}]"
              for lo, hi in zip(edges[:-1], edges[1:])]
    label_map = dict(zip(labels, [b.woe for b in result.bins]))
    return bin_idx.astype(str).map(label_map).astype(float)
