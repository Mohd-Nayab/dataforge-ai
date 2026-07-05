"""AI chat assistant.

Maps natural-language instructions to concrete data operations. Falls back to
an optional Ollama LLM for free-form explanations when available, otherwise
returns a deterministic rule-based answer.
"""
from __future__ import annotations

import re
from typing import Optional

import httpx
import pandas as pd

from ..config import OLLAMA_BASE_URL, OLLAMA_MODEL
from . import analytics, profiling


def _find_column(df: pd.DataFrame, text: str) -> Optional[str]:
    for col in df.columns:
        if col.lower() in text.lower():
            return col
    return None


def handle(df: pd.DataFrame, message: str) -> dict:
    """Return a structured response describing an action or insight.

    Response shape:
      { "reply": str, "action": Optional[str], "params": dict, "data": Any }
    """
    text = message.lower().strip()

    # --- operation intents (the frontend can apply these) ---------------
    if any(k in text for k in ("remove duplicate", "drop duplicate", "deduplicate")):
        return {"reply": "I'll remove duplicate rows from the dataset.",
                "action": "remove_duplicates", "params": {}}

    if "missing" in text or "null" in text or "fill" in text:
        if "drop" in text or "remove" in text:
            return {"reply": "I'll drop rows containing missing values.",
                    "action": "drop_nulls", "params": {"how": "any"}}
        return {"reply": "I'll fill missing values using the median (numeric) / mode (categorical).",
                "action": "auto_fill", "params": {}}

    if "outlier" in text or "anomal" in text:
        return {"reply": "I'll remove outliers using the IQR method.",
                "action": "remove_outliers", "params": {"method": "iqr"}}

    if "correlation" in text or "correlate" in text:
        return {"reply": "Here is the correlation matrix for numeric columns.",
                "action": None, "data": analytics.correlation(df)}

    if "summary" in text or "describe" in text or "explain" in text or "overview" in text:
        prof = profiling.profile(df)
        reply = (f"This dataset has {prof['rows']} rows and {prof['columns']} columns. "
                 f"{prof['duplicate_rows']} duplicate rows and "
                 f"{prof['missing_pct']}% missing cells were detected.")
        return {"reply": reply, "action": None, "data": prof}

    if "bar chart" in text or "top" in text:
        col = _find_column(df, text) or (analytics.categorical_columns(df) or [None])[0]
        if col:
            return {"reply": f"Here is a breakdown of '{col}'.",
                    "action": None, "data": analytics.value_counts(df, col)}

    if "histogram" in text or "distribution" in text:
        col = _find_column(df, text) or (analytics.numeric_columns(df) or [None])[0]
        if col:
            return {"reply": f"Here is the distribution of '{col}'.",
                    "action": None, "data": analytics.histogram(df, col)}

    # --- fallback: try Ollama, else generic help -----------------------
    llm = _ask_ollama(df, message)
    if llm:
        return {"reply": llm, "action": None}

    return {
        "reply": ("I can clean data (remove duplicates, fill missing values, drop "
                  "outliers), explain the dataset, and build charts (histogram, bar, "
                  "correlation). Try: 'remove duplicates', 'explain this dataset', or "
                  "'show correlation matrix'."),
        "action": None,
    }


def _ask_ollama(df: pd.DataFrame, message: str) -> Optional[str]:
    schema = ", ".join(f"{c} ({df[c].dtype})" for c in df.columns[:30])
    prompt = (
        "You are a data analyst assistant. The dataset columns are: "
        f"{schema}. It has {len(df)} rows. Answer concisely.\n\nUser: {message}"
    )
    try:
        resp = httpx.post(
            f"{OLLAMA_BASE_URL}/api/generate",
            json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False},
            timeout=20.0,
        )
        if resp.status_code == 200:
            return resp.json().get("response", "").strip() or None
    except Exception:
        return None
    return None
