from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ARTIFACTS_DIR = Path(__file__).resolve().parents[1] / "artifacts"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", protected_namespaces=())

    scorecard_model_path: Path = ARTIFACTS_DIR / "scorecard-v1.2.json"
    challenger_model_path: Path = ARTIFACTS_DIR / "xgb-v0.4.json"
    reason_codes_path: Path = ARTIFACTS_DIR / "reason_codes.json"
    reason_codes_top_n: int = 5


settings = Settings()
