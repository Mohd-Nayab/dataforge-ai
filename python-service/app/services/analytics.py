"""Analytics helpers: histograms, aggregations, correlation matrix."""
from __future__ import annotations

from typing import List, Optional

import numpy as np
import pandas as pd

from ..utils import safe_value


def numeric_columns(df: pd.DataFrame) -> List[str]:
    return [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]


def categorical_columns(df: pd.DataFrame) -> List[str]:
    return [c for c in df.columns
            if pd.api.types.is_object_dtype(df[c]) or pd.api.types.is_bool_dtype(df[c])]


def histogram(df: pd.DataFrame, column: str, bins: int = 20) -> dict:
    if column not in df.columns or not pd.api.types.is_numeric_dtype(df[column]):
        return {"column": column, "bins": []}
    s = df[column].dropna()
    if s.empty:
        return {"column": column, "bins": []}
    counts, edges = np.histogram(s, bins=bins)
    data = [
        {"bin": f"{round(float(edges[i]), 2)}", "count": int(counts[i])}
        for i in range(len(counts))
    ]
    return {"column": column, "bins": data}


def value_counts(df: pd.DataFrame, column: str, top: int = 15) -> dict:
    if column not in df.columns:
        return {"column": column, "data": []}
    vc = df[column].value_counts(dropna=True).head(top)
    data = [{"name": safe_value(idx), "value": int(val)} for idx, val in vc.items()]
    return {"column": column, "data": data}


def correlation(df: pd.DataFrame) -> dict:
    num = numeric_columns(df)
    if len(num) < 2:
        return {"columns": num, "matrix": []}
    corr = df[num].corr(numeric_only=True).round(3)
    matrix = []
    for r in corr.index:
        for c in corr.columns:
            matrix.append({"x": c, "y": r, "value": safe_value(corr.loc[r, c])})
    return {"columns": list(corr.columns), "matrix": matrix}


def aggregate(df: pd.DataFrame, group_by: str, metric: str,
              agg: str = "sum", top: int = 20) -> dict:
    if group_by not in df.columns or metric not in df.columns:
        return {"data": []}
    if not pd.api.types.is_numeric_dtype(df[metric]):
        return {"data": []}
    grouped = getattr(df.groupby(group_by)[metric], agg)()
    grouped = grouped.sort_values(ascending=False).head(top)
    data = [{"name": safe_value(idx), "value": safe_value(val)}
            for idx, val in grouped.items()]
    return {"group_by": group_by, "metric": metric, "agg": agg, "data": data}


def overview(df: pd.DataFrame) -> dict:
    """A ready-made analytics payload for the dashboard."""
    num = numeric_columns(df)
    cat = categorical_columns(df)
    payload = {
        "kpis": {
            "rows": int(len(df)),
            "columns": int(df.shape[1]),
            "numeric_columns": len(num),
            "categorical_columns": len(cat),
        },
        "numeric_columns": num,
        "categorical_columns": cat,
        "histogram": histogram(df, num[0]) if num else None,
        "category_breakdown": value_counts(df, cat[0]) if cat else None,
        "correlation": correlation(df) if len(num) >= 2 else None,
    }
    return payload
