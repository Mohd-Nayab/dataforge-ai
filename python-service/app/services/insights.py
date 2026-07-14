"""Auto-generated data insights from a DataFrame."""
from __future__ import annotations

from typing import Any, Dict, List

import numpy as np
import pandas as pd

from ..utils import safe_value
from . import analytics, profiling


def generate(df: pd.DataFrame, max_insights: int = 12) -> Dict[str, Any]:
    """Return ranked natural-language insights about the dataset."""
    insights: List[Dict[str, Any]] = []
    if df.empty:
        return {"insights": [], "summary": "Dataset is empty."}

    prof = profiling.profile(df)
    num = analytics.numeric_columns(df)
    cat = analytics.categorical_columns(df)

    insights.append({
        "id": "shape",
        "severity": "info",
        "title": "Dataset shape",
        "detail": f"{prof['rows']:,} rows × {prof['columns']} columns "
                  f"({len(num)} numeric, {len(cat)} categorical).",
        "metric": {"rows": prof["rows"], "columns": prof["columns"]},
    })

    if prof["duplicate_rows"] > 0:
        pct = round(100 * prof["duplicate_rows"] / max(prof["rows"], 1), 1)
        insights.append({
            "id": "duplicates",
            "severity": "warning" if pct >= 5 else "info",
            "title": "Duplicate rows detected",
            "detail": f"{prof['duplicate_rows']:,} duplicate rows ({pct}%). "
                      "Consider removing them in Cleaning Studio.",
            "metric": {"count": prof["duplicate_rows"], "pct": pct},
        })

    if prof["missing_pct"] > 0:
        sev = "error" if prof["missing_pct"] >= 20 else "warning" if prof["missing_pct"] >= 5 else "info"
        insights.append({
            "id": "missing",
            "severity": sev,
            "title": "Missing values",
            "detail": f"{prof['missing_cells']:,} missing cells ({prof['missing_pct']}% of all cells).",
            "metric": {"cells": prof["missing_cells"], "pct": prof["missing_pct"]},
        })

    # Per-column missing hotspots
    for col in df.columns:
        miss = int(df[col].isna().sum())
        if miss == 0:
            continue
        pct = round(100 * miss / max(len(df), 1), 1)
        if pct >= 10:
            insights.append({
                "id": f"missing_{col}",
                "severity": "warning" if pct < 40 else "error",
                "title": f"High missing rate in '{col}'",
                "detail": f"{miss:,} missing values ({pct}%).",
                "metric": {"column": col, "count": miss, "pct": pct},
            })

    # Strong correlations
    if len(num) >= 2:
        corr = df[num].corr(numeric_only=True)
        pairs = []
        for i, a in enumerate(corr.columns):
            for b in corr.columns[i + 1:]:
                val = corr.loc[a, b]
                if pd.notna(val) and abs(float(val)) >= 0.7:
                    pairs.append((a, b, float(val)))
        pairs.sort(key=lambda x: abs(x[2]), reverse=True)
        for a, b, val in pairs[:5]:
            insights.append({
                "id": f"corr_{a}_{b}",
                "severity": "info",
                "title": f"Strong correlation: {a} ↔ {b}",
                "detail": f"Pearson r = {val:.3f} ({'positive' if val > 0 else 'negative'}).",
                "metric": {"a": a, "b": b, "r": round(val, 3)},
            })

    # Skewed numeric columns
    for col in num[:12]:
        s = df[col].dropna()
        if len(s) < 5:
            continue
        skew = float(s.skew())
        if abs(skew) >= 1.5:
            insights.append({
                "id": f"skew_{col}",
                "severity": "info",
                "title": f"Skewed distribution: '{col}'",
                "detail": f"Skewness = {skew:.2f}. Consider log transform or robust scaling.",
                "metric": {"column": col, "skew": round(skew, 3)},
            })

    # Cardinality extremes
    for col in cat[:15]:
        nunique = int(df[col].nunique(dropna=True))
        if nunique == 1:
            insights.append({
                "id": f"const_{col}",
                "severity": "warning",
                "title": f"Constant column '{col}'",
                "detail": "Only one unique value — may be safe to drop.",
                "metric": {"column": col, "unique": 1},
            })
        elif nunique > max(50, int(0.5 * len(df))):
            insights.append({
                "id": f"highcard_{col}",
                "severity": "info",
                "title": f"High cardinality: '{col}'",
                "detail": f"{nunique:,} unique values — likely an ID or free-text field.",
                "metric": {"column": col, "unique": nunique},
            })
        elif 2 <= nunique <= 12:
            top = df[col].value_counts(dropna=True).head(1)
            if not top.empty:
                name, cnt = top.index[0], int(top.iloc[0])
                pct = round(100 * cnt / max(len(df), 1), 1)
                insights.append({
                    "id": f"top_{col}",
                    "severity": "info",
                    "title": f"Dominant category in '{col}'",
                    "detail": f"'{safe_value(name)}' appears {cnt:,} times ({pct}%).",
                    "metric": {"column": col, "value": safe_value(name), "count": cnt, "pct": pct},
                })

    # Outlier density (IQR)
    for col in num[:10]:
        s = df[col].dropna()
        if len(s) < 8:
            continue
        q1, q3 = float(s.quantile(0.25)), float(s.quantile(0.75))
        iqr = q3 - q1
        if iqr <= 0:
            continue
        lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        n_out = int(((s < lo) | (s > hi)).sum())
        pct = round(100 * n_out / max(len(s), 1), 1)
        if n_out > 0 and pct >= 2:
            insights.append({
                "id": f"outlier_{col}",
                "severity": "warning" if pct >= 5 else "info",
                "title": f"Outliers in '{col}'",
                "detail": f"{n_out:,} values outside IQR fences ({pct}%).",
                "metric": {"column": col, "count": n_out, "pct": pct, "low": lo, "high": hi},
            })

    # Rank: error > warning > info, keep max
    order = {"error": 0, "warning": 1, "info": 2}
    insights.sort(key=lambda x: (order.get(x["severity"], 9), x["title"]))
    insights = insights[:max_insights]

    summary_bits = [
        f"{prof['rows']:,} rows",
        f"{prof['columns']} columns",
        f"{prof['missing_pct']}% missing",
        f"{prof['duplicate_rows']} duplicates",
    ]
    return {
        "summary": " · ".join(summary_bits),
        "insight_count": len(insights),
        "insights": insights,
    }
