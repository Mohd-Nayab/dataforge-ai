"""Column statistics, data profiling, and a validation rule engine."""
from __future__ import annotations

import re
from typing import List

import numpy as np
import pandas as pd

from ..utils import column_dtype, safe_value

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_URL_RE = re.compile(r"^https?://[^\s]+$", re.IGNORECASE)


def column_stats(df: pd.DataFrame) -> List[dict]:
    stats: List[dict] = []
    n = len(df)
    for col in df.columns:
        s = df[col]
        missing = int(s.isna().sum())
        info = {
            "name": col,
            "dtype": column_dtype(s),
            "missing": missing,
            "missing_pct": round(missing / n * 100, 2) if n else 0.0,
            "unique": int(s.nunique(dropna=True)),
        }
        if pd.api.types.is_numeric_dtype(s):
            desc = s.describe()
            info.update({
                "min": safe_value(desc.get("min")),
                "max": safe_value(desc.get("max")),
                "mean": safe_value(round(desc.get("mean"), 4)) if pd.notna(desc.get("mean")) else None,
                "std": safe_value(round(desc.get("std"), 4)) if pd.notna(desc.get("std")) else None,
                "median": safe_value(s.median()),
            })
        else:
            top = s.value_counts(dropna=True).head(1)
            if not top.empty:
                info["top"] = safe_value(top.index[0])
                info["top_count"] = int(top.iloc[0])
        stats.append(info)
    return stats


def profile(df: pd.DataFrame) -> dict:
    n = len(df)
    total_cells = n * df.shape[1] if df.shape[1] else 0
    missing_cells = int(df.isna().sum().sum())
    return {
        "rows": int(n),
        "columns": int(df.shape[1]),
        "duplicate_rows": int(df.duplicated().sum()),
        "missing_cells": missing_cells,
        "missing_pct": round(missing_cells / total_cells * 100, 2) if total_cells else 0.0,
        "memory_kb": round(df.memory_usage(deep=True).sum() / 1024, 2),
        "columns_detail": column_stats(df),
    }


def validate(df: pd.DataFrame) -> List[dict]:
    """Run a battery of validation rules and return detected issues."""
    issues: List[dict] = []
    n = len(df)

    dup = int(df.duplicated().sum())
    if dup:
        issues.append({"rule": "duplicate_rows", "severity": "warning",
                       "message": f"{dup} duplicate row(s) detected."})

    for col in df.columns:
        s = df[col]
        missing = int(s.isna().sum())
        if missing:
            pct = round(missing / n * 100, 2) if n else 0
            issues.append({"rule": "missing_values", "column": col,
                           "severity": "warning" if pct < 30 else "error",
                           "message": f"{missing} missing value(s) ({pct}%) in '{col}'."})

        if pd.api.types.is_object_dtype(s):
            non_null = s.dropna().astype(str)
            # Leading/trailing spaces
            spaced = int((non_null != non_null.str.strip()).sum())
            if spaced:
                issues.append({"rule": "whitespace", "column": col, "severity": "info",
                               "message": f"{spaced} value(s) in '{col}' have leading/trailing spaces."})
            # Email-looking column
            lname = col.lower()
            if "email" in lname and len(non_null):
                bad = int((~non_null.str.match(_EMAIL_RE)).sum())
                if bad:
                    issues.append({"rule": "invalid_email", "column": col, "severity": "error",
                                   "message": f"{bad} invalid email(s) in '{col}'."})
            if ("url" in lname or "website" in lname) and len(non_null):
                bad = int((~non_null.str.match(_URL_RE)).sum())
                if bad:
                    issues.append({"rule": "invalid_url", "column": col, "severity": "warning",
                                   "message": f"{bad} invalid URL(s) in '{col}'."})

        if pd.api.types.is_numeric_dtype(s):
            neg = int((s < 0).sum())
            lname = col.lower()
            if neg and any(k in lname for k in ("price", "amount", "qty", "quantity", "age", "count")):
                issues.append({"rule": "negative_values", "column": col, "severity": "warning",
                               "message": f"{neg} negative value(s) in '{col}'."})
            std = s.std(ddof=0)
            if std and not pd.isna(std):
                z = ((s - s.mean()) / std).abs()
                out = int((z > 3).sum())
                if out:
                    issues.append({"rule": "outliers", "column": col, "severity": "info",
                                   "message": f"{out} potential outlier(s) in '{col}' (z>3)."})

    if not issues:
        issues.append({"rule": "clean", "severity": "success",
                       "message": "No data quality issues detected."})
    return issues
