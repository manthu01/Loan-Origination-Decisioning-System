# scoring-service

FastAPI service that loads the champion scorecard and shadow XGBoost challenger from
`artifacts/` and serves scoring requests. Small surface area, high reliability — see
`ml/scorecard/MODEL_CARD.md` for how the models were trained.

## Endpoints

- `POST /score` — `{ applicationId, features: {...}, modelVersion? }` →  score,
  probability of default, risk grade, top adverse-action reason codes, and (when the
  applicant payload includes the challenger's fields) a shadow `challenger` result.
- `GET /models` — loaded model versions.
- `GET /health` — liveness + which models are loaded.

`features` must include at minimum the champion's required fields: `dpd30_plus_last_12m`,
`monthly_income`, `age`, `enquiries_last_3m`. Including the challenger's additional
fields (see `app/challenger.py::CHALLENGER_FEATURES`) also returns a shadow score;
otherwise `challenger` is `null` and the request still succeeds — the champion decision
never depends on the challenger being scoreable.

## Run it

```bash
python -m venv .venv && source .venv/Scripts/activate   # or .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

## Test

```bash
python -m pytest tests/ -v
```

## Updating models

Re-run the training pipeline in `ml/scorecard/` and copy the resulting
`scorecard-v1.2.json` / `xgb-v0.4.json` / `reason_codes.json` into `artifacts/`. A model
version bump (e.g. `scorecard-v1.3.json`) requires updating `app/config.py`'s default
path — this is intentionally not automatic, since a new champion is a deploy decision,
not a file-drop.
