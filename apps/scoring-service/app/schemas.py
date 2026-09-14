from pydantic import BaseModel, ConfigDict, Field

_ALIAS_CONFIG = ConfigDict(populate_by_name=True, protected_namespaces=())


class ScoreRequest(BaseModel):
    model_config = _ALIAS_CONFIG

    application_id: str = Field(alias="applicationId")
    features: dict
    model_version: str | None = Field(default=None, alias="modelVersion")


class ReasonCode(BaseModel):
    model_config = _ALIAS_CONFIG

    code: str
    desc: str
    point_impact: int = Field(serialization_alias="pointImpact")


class ChallengerResponse(BaseModel):
    model_config = _ALIAS_CONFIG

    score: int
    probability_of_default: float = Field(serialization_alias="probabilityOfDefault")
    model_version: str = Field(serialization_alias="modelVersion")


class ScoreResponse(BaseModel):
    model_config = _ALIAS_CONFIG

    score: int
    probability_of_default: float = Field(serialization_alias="probabilityOfDefault")
    risk_grade: str = Field(serialization_alias="riskGrade")
    reason_codes: list[ReasonCode] = Field(serialization_alias="reasonCodes")
    model_version: str = Field(serialization_alias="modelVersion")
    challenger: ChallengerResponse | None = None


class ModelInfo(BaseModel):
    name: str
    kind: str
    loaded: bool
    metrics: dict | None = None


class ModelsResponse(BaseModel):
    models: list[ModelInfo]


class HealthResponse(BaseModel):
    status: str
    models_loaded: list[str]
