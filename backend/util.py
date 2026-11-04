"""Small shared helpers for turning ``data.py``'s pandas/sqlite3.Row results
into JSON-safe dicts."""
from __future__ import annotations

import math
from typing import TYPE_CHECKING, Any

from fastapi import HTTPException

if TYPE_CHECKING:
    import pandas as pd


def clean_nan(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalise ``nan`` -> ``None`` and unwrap numpy scalars to native
    Python types, in place. ``DataFrame.to_dict(orient="records")`` and
    some ``sqlite3.Row`` numeric columns otherwise produce values that
    aren't valid JSON or that FastAPI's default encoder chokes on."""
    for row in records:
        for key, value in row.items():
            if hasattr(value, "item") and not isinstance(value, (str, bytes)):
                value = value.item()
            if isinstance(value, float) and math.isnan(value):
                value = None
            row[key] = value
    return records


def df_records(df: "pd.DataFrame") -> list[dict[str, Any]]:
    """A DataFrame as a JSON-safe list of dicts."""
    return clean_nan(df.to_dict(orient="records"))


def not_found(what: str, id_: object) -> HTTPException:
    return HTTPException(status_code=404, detail=f"{what} {id_!r} not found")
