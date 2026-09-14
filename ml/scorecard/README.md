# Credit scorecard

WOE/IV logistic scorecard + XGBoost shadow challenger. See
[`MODEL_CARD.md`](./MODEL_CARD.md) for variables, IV table, performance metrics, and the
logistic-vs-XGBoost trade-off note.

## Run it

```bash
cd ml/scorecard
python -m venv .venv && source .venv/Scripts/activate   # or .venv/bin/activate on macOS/Linux
pip install -r requirements.txt

python src/generate_synthetic_data.py   # writes data/applications.csv
python src/train_scorecard.py           # writes artifacts/scorecard-v1.2.json + metrics
python src/train_challenger.py          # writes artifacts/xgb-v0.4.json + comparison
```

## Layout

```
src/
  generate_synthetic_data.py   Home-Credit-schema synthetic dataset (see MODEL_CARD.md)
  woe.py                       WOE/IV binning, monotonic merge, correlation-safe transform
  train_scorecard.py           full scorecard pipeline: bin -> IV -> corr/VIF -> fit -> scale -> evaluate
  train_challenger.py          XGBoost on the same split, for the champion/challenger comparison
artifacts/
  scorecard-v1.2.json          points-based scorecard consumed by apps/scoring-service
  xgb-v0.4.json                XGBoost booster, shadow-mode only
  reason_codes.json            feature -> adverse-action reason code mapping
  metrics.json                 AUC / KS / Gini / gains table per split
  challenger_comparison.json   champion vs. challenger AUC comparison
  model_card_data.json         raw numbers MODEL_CARD.md is generated from
data/
  applications.csv             gitignored -- regenerate with generate_synthetic_data.py
```

## Using the real Home Credit dataset instead

Download `application_train.csv` and `bureau.csv` from
[Kaggle's Home Credit Default Risk competition](https://www.kaggle.com/c/home-credit-default-risk),
place them under `data/`, and point `DATA_PATH` in `train_scorecard.py` at them. Feature
names in the synthetic generator were chosen to line up with that schema.
