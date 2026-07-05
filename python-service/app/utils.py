"""Serialization helpers that make pandas/numpy values JSON-safe."""
from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd


def safe_value(v: Any) -> Any:
    """Convert a single cell value into a JSON-serializable primitive."""
    if v is None:
        return None
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if isinstance(v, (pd.Timestamp,)):
        return v.isoformat()
    if pd.isna(v) is True:  # handles NaT and NaN scalars
        return None
    if isinstance(v, (np.ndarray,)):
        return [safe_value(x) for x in v.tolist()]
    return v


def df_to_records(df: pd.DataFrame) -> list[dict]:
    """Convert a DataFrame to a list of JSON-safe row dicts."""
    records: list[dict] = []
    cols = list(df.columns)
    for row in df.itertuples(index=False, name=None):
        records.append({col: safe_value(val) for col, val in zip(cols, row)})
    return records


def column_dtype(series: pd.Series) -> str:
    dt = str(series.dtype)
    if pd.api.types.is_integer_dtype(series):
        return "integer"
    if pd.api.types.is_float_dtype(series):
        return "float"
    if pd.api.types.is_bool_dtype(series):
        return "boolean"
    if pd.api.types.is_datetime64_any_dtype(series):
        return "datetime"
    if pd.api.types.is_object_dtype(series):
        return "string"
    return dt
