"""
Scoring service. Loads the champion scorecard and shadow XGBoost challenger at startup,
holds them in memory, and never returns a score without its model version attached.

    POST /score    score an applicant, champion + shadow challenger
    GET  /models   list loaded model versions and their offline metrics
    GET  /health   liveness + which models are loaded
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException

from .challenger import Challenger
from .config import settings
from .reason_codes import ReasonCodeTable
from .schemas import (
    ChallengerResponse,
    HealthResponse,
    ModelInfo,
    ModelsResponse,
    ReasonCode,
    ScoreRequest,
    ScoreResponse,
)
from .scorecard import Scorecard

logger = logging.getLogger("scoring-service")

_state: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    _state["scorecard"] = Scorecard(settings.scorecard_model_path)
    _state["challenger"] = Challenger(settings.challenger_model_path)
    _state["reason_codes"] = ReasonCodeTable(settings.reason_codes_path)
    logger.info(
        "loaded champion=%s challenger=%s",
        _state["scorecard"].model_version,
        _state["challenger"].model_version,
    )
    yield
    _state.clear()


app = FastAPI(title="CreditFlow Scoring Service", version="1.0.0", lifespan=lifespan)


@app.get("/health", response_model=HealthResponse)
def health():
    loaded = [k for k in ("scorecard", "challenger") if k in _state]
    return HealthResponse(status="ok" if len(loaded) == 2 else "degraded", models_loaded=loaded)


@app.get("/models", response_model=ModelsResponse)
def models():
    scorecard: Scorecard = _state["scorecard"]
    challenger: Challenger = _state["challenger"]
    return ModelsResponse(
        models=[
            ModelInfo(name=scorecard.model_version, kind="SCORECARD", loaded=True),
            ModelInfo(name=challenger.model_version, kind="CHALLENGER", loaded=True),
        ]
    )


@app.post("/score", response_model=ScoreResponse, response_model_by_alias=True)
def score(request: ScoreRequest):
    scorecard: Scorecard = _state["scorecard"]
    challenger: Challenger = _state["challenger"]
    reason_table: ReasonCodeTable = _state["reason_codes"]

    if request.model_version and request.model_version != scorecard.model_version:
        raise HTTPException(
            status_code=400,
            detail=f"model version {request.model_version} is not loaded; live champion is {scorecard.model_version}",
        )

    try:
        result = scorecard.score(request.features)
    except KeyError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    negative_contributions = [c for c in result.contributions if c.point_impact < 0]
    reason_codes = []
    for contribution in negative_contributions[: settings.reason_codes_top_n]:
        code, desc = reason_table.describe(contribution.feature)
        reason_codes.append(ReasonCode(code=code, desc=desc, point_impact=contribution.point_impact))

    challenger_response = None
    if challenger.has_all_fields(request.features):
        challenger_result = challenger.score(request.features)
        challenger_response = ChallengerResponse(
            score=challenger_result.score,
            probability_of_default=challenger_result.probability_of_default,
            model_version=challenger.model_version,
        )
    else:
        logger.info(
            "application %s missing challenger-only fields, skipping shadow score",
            request.application_id,
        )

    return ScoreResponse(
        score=result.score,
        probability_of_default=result.probability_of_default,
        risk_grade=result.risk_grade,
        reason_codes=reason_codes,
        model_version=scorecard.model_version,
        challenger=challenger_response,
    )
