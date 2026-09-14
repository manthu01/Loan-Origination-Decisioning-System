import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


SCORECARD_FIELDS = {
    "dpd30_plus_last_12m": 0,
    "monthly_income": 55000,
    "age": 30,
    "enquiries_last_3m": 1,
}

CHALLENGER_ONLY_FIELDS = {
    "employment_tenure_months": 24,
    "num_dependents": 1,
    "tradelines": 2,
    "oldest_tradeline_age_months": 36,
    "credit_utilization": 0.4,
    "num_previous_defaults": 0,
    "obligations_to_income": 0.2,
}


def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert set(body["models_loaded"]) == {"scorecard", "challenger"}


def test_models(client):
    response = client.get("/models")
    assert response.status_code == 200
    kinds = {m["kind"] for m in response.json()["models"]}
    assert kinds == {"SCORECARD", "CHALLENGER"}


def test_score_without_challenger_fields(client):
    response = client.post(
        "/score",
        json={"applicationId": "APP1", "features": SCORECARD_FIELDS},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["modelVersion"] == "scorecard-v1.2"
    assert isinstance(body["score"], int)
    assert 0 <= body["probabilityOfDefault"] <= 1
    assert body["riskGrade"] in {"A1", "A2", "B1", "B2", "C1", "C2", "D"}
    assert body["challenger"] is None


def test_score_with_challenger_fields_and_reason_codes(client):
    response = client.post(
        "/score",
        json={"applicationId": "APP2", "features": {**SCORECARD_FIELDS, **CHALLENGER_ONLY_FIELDS}},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["challenger"] is not None
    assert body["challenger"]["modelVersion"] == "xgb-v0.4"
    # reason codes, if any, must be sorted most-negative-impact first
    impacts = [rc["pointImpact"] for rc in body["reasonCodes"]]
    assert impacts == sorted(impacts)
    assert all(i < 0 for i in impacts)


def test_score_missing_field_returns_422(client):
    response = client.post(
        "/score",
        json={"applicationId": "APP3", "features": {"monthly_income": 40000}},
    )
    assert response.status_code == 422


def test_riskier_applicant_scores_lower(client):
    safe = client.post("/score", json={"applicationId": "SAFE", "features": {
        "dpd30_plus_last_12m": 0, "monthly_income": 90000, "age": 42, "enquiries_last_3m": 0,
    }}).json()
    risky = client.post("/score", json={"applicationId": "RISKY", "features": {
        "dpd30_plus_last_12m": 3, "monthly_income": 15000, "age": 23, "enquiries_last_3m": 5,
    }}).json()
    assert safe["score"] > risky["score"]
    assert safe["probabilityOfDefault"] < risky["probabilityOfDefault"]
