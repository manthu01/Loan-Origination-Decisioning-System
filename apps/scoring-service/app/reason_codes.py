import json
from pathlib import Path


class ReasonCodeTable:
    def __init__(self, path: Path):
        rows = json.loads(Path(path).read_text())
        self._by_feature = {r["feature"]: r for r in rows}

    def describe(self, feature: str) -> tuple[str, str]:
        row = self._by_feature.get(feature)
        if row is None:
            return "R999", f"Unmapped risk factor: {feature}"
        return row["code"], row["description"]
