"""Lightweight forecasting service.

Supports:
- linear trend (scikit-learn LinearRegression over time index)
- moving_average (simple rolling average, extended forward)
- seasonal_naive (repeat last season of observations)

The caller provides a date column and an optional numeric target column. If no
target is provided, the forecast is a count of records per date.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression

from ..utils import safe_value


def _infer_date_col(df: pd.DataFrame) -> Optional[str]:
    for col in df.columns:
        if pd.api.types.is_datetime64_any_dtype(df[col]) or "date" in col.lower() or "time" in col.lower():
            return col
    return None


def _to_datetime_series(s: pd.Series) -> pd.Series:
    """Convert a column to datetime, coercing errors to NaT."""
    return pd.to_datetime(s, errors="coerce", infer_datetime_format=True)


def _prepare_series(df: pd.DataFrame, date_col: str, target_col: Optional[str] = None) -> pd.Series:
    """Return a daily time series indexed by date.

    If target_col is supplied and numeric, values are summed per day.
    If target_col is supplied but non-numeric, count is used.
    If target_col is None, count is used.
    """
    dates = _to_datetime_series(df[date_col])
    if dates.isna().all():
        raise ValueError(f"Date column '{date_col}' contains no parseable dates")

    df = df.copy()
    df["__date__"] = dates.dt.floor("D")
    df = df[df["__date__"].notna()]

    if target_col and target_col in df.columns and pd.api.types.is_numeric_dtype(df[target_col]):
        series = df.groupby("__date__")[target_col].sum()
    else:
        series = df.groupby("__date__").size()

    # Reindex to full daily range so the model sees real gaps.
    if len(series) == 0:
        raise ValueError("No valid date observations after aggregation")
    full_range = pd.date_range(start=series.index.min(), end=series.index.max(), freq="D")
    series = series.reindex(full_range, fill_value=0)
    series.index.name = "date"
    return series


def _forecast_linear(series: pd.Series, horizon: int) -> pd.Series:
    X = np.arange(len(series)).reshape(-1, 1)
    y = series.values
    model = LinearRegression().fit(X, y)
    future_X = np.arange(len(series), len(series) + horizon).reshape(-1, 1)
    preds = model.predict(future_X)
    idx = pd.date_range(start=series.index[-1] + timedelta(days=1), periods=horizon, freq="D")
    return pd.Series(np.maximum(preds, 0), index=idx)


def _forecast_ma(series: pd.Series, horizon: int, window: int = 7) -> pd.Series:
    window = min(window, len(series))
    base = series.rolling(window=window, min_periods=1).mean().iloc[-1]
    idx = pd.date_range(start=series.index[-1] + timedelta(days=1), periods=horizon, freq="D")
    return pd.Series([base] * horizon, index=idx)


def _forecast_seasonal_naive(series: pd.Series, horizon: int) -> pd.Series:
    season_len = min(7, len(series))
    cycle = series.iloc[-season_len:].values
    preds = [cycle[i % season_len] for i in range(horizon)]
    idx = pd.date_range(start=series.index[-1] + timedelta(days=1), periods=horizon, freq="D")
    return pd.Series(np.maximum(preds, 0), index=idx)


def _series_records(series: pd.Series) -> List[Dict[str, Any]]:
    return [
        {"date": d.isoformat(), "value": safe_value(v)}
        for d, v in series.items()
    ]


def forecast(df: pd.DataFrame, date_col: Optional[str] = None, target_col: Optional[str] = None,
             method: str = "linear", horizon: int = 7) -> Dict[str, Any]:
    if not date_col:
        date_col = _infer_date_col(df)
    if not date_col:
        raise ValueError("No date column found; please provide one")
    if date_col not in df.columns:
        raise ValueError(f"Date column '{date_col}' not found")

    series = _prepare_series(df, date_col, target_col)
    if len(series) < 2:
        raise ValueError("Need at least 2 observations to forecast")

    method = method.lower()
    if method == "linear":
        forecast_series = _forecast_linear(series, horizon)
    elif method == "moving_average":
        forecast_series = _forecast_ma(series, horizon)
    elif method == "seasonal_naive":
        forecast_series = _forecast_seasonal_naive(series, horizon)
    else:
        raise ValueError(f"Unsupported forecast method '{method}'")

    return {
        "date_col": date_col,
        "target_col": target_col,
        "method": method,
        "horizon": horizon,
        "historical": _series_records(series),
        "forecast": _series_records(forecast_series),
    }
