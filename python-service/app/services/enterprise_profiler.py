"""Enterprise-grade dataset profiling and quality scoring.

Provides:
- Semantic type detection (email, phone, date, currency, percentage, etc.)
- Rich column-level statistics (variance, median, mode, cardinality, entropy, etc.)
- Dataset-level quality scores (completeness, consistency, validity, accuracy, uniqueness, integrity)
- Correlation matrix and pattern analysis

For large datasets, expensive non-aggregated work is performed on a sampled subset
(default 10,000 rows) while preserving aggregate accuracy.
"""
from __future__ import annotations

import math
import re
from collections import Counter
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Semantic type detection
# ---------------------------------------------------------------------------

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_URL_RE = re.compile(r"^https?://[^\s]+$", re.IGNORECASE)
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

# Common patterns used for semantic type detection.
_PATTERNS: Dict[str, re.Pattern] = {
    "email": _EMAIL_RE,
    "url": _URL_RE,
    "uuid": _UUID_RE,
    "boolean": re.compile(r"^(true|false|yes|no|1|0|y|n)$", re.IGNORECASE),
    "percentage": re.compile(r"^[-+]?\s*\d+(?:\.\d+)?\s*%$"),
    # Currency requires an explicit symbol or thousands separator so plain integers don't match.
    "currency": re.compile(r"^[-+]?\s*(?:[€£$¥]\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?)\s*[€£$¥]?$"),
    "zip_us": re.compile(r"^\d{5}(?:-\d{4})?$"),
    "zip_uk": re.compile(r"^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$", re.IGNORECASE),
    "phone": re.compile(r"^(\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}$"),
    "ipv4": re.compile(r"^(\d{1,3}\.){3}\d{1,3}$"),
    "gender": re.compile(r"^(male|female|m|f|other|prefer not to say)$", re.IGNORECASE),
}

# Common country names (short, high-value list) for semantic detection.
_COUNTRY_NAMES = {
    "afghanistan", "albania", "algeria", "argentina", "australia", "austria", "bangladesh",
    "belgium", "brazil", "bulgaria", "canada", "chile", "china", "colombia", "croatia",
    "czech republic", "denmark", "egypt", "estonia", "ethiopia", "finland", "france",
    "germany", "ghana", "greece", "hong kong", "hungary", "india", "indonesia", "iran",
    "iraq", "ireland", "israel", "italy", "japan", "jordan", "kenya", "kuwait", "latvia",
    "lebanon", "lithuania", "malaysia", "mexico", "morocco", "nepal", "netherlands",
    "new zealand", "nigeria", "norway", "pakistan", "peru", "philippines", "poland",
    "portugal", "qatar", "romania", "russia", "saudi arabia", "serbia", "singapore",
    "slovakia", "slovenia", "south africa", "south korea", "spain", "sri lanka", "sweden",
    "switzerland", "taiwan", "thailand", "turkey", "ukraine", "united arab emirates",
    "united kingdom", "united states", "usa", "us", "uk", "uae", "vietnam",
}

_US_STATE_NAMES = {
    "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut",
    "delaware", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa",
    "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan",
    "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "new hampshire",
    "new jersey", "new mexico", "new york", "north carolina", "north dakota", "ohio",
    "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota",
    "tennessee", "texas", "utah", "vermont", "virginia", "washington", "west virginia",
    "wisconsin", "wyoming",
}

# Common missing-value sentinels.
_MISSING_SENTINELS = {"", " ", "nan", "na", "n/a", "none", "null", "nil", "missing",
                      "unknown", "undefined", "?", "-", "_", "0", "0.0", "(blank)", "[blank]"}


def _sample(df: pd.DataFrame, n: int = 10_000) -> pd.DataFrame:
    """Return a representative sample for expensive non-aggregated operations."""
    if len(df) <= n:
        return df
    return df.sample(n=n, random_state=42)


def _entropy(values: pd.Series) -> Optional[float]:
    """Shannon entropy of a categorical series."""
    if values.empty:
        return None
    counts = values.value_counts(dropna=True)
    total = counts.sum()
    if total == 0:
        return None
    probs = counts / total
    return float(-(probs * np.log2(probs)).sum())


def _uniqueness_ratio(s: pd.Series) -> float:
    n = len(s)
    if n == 0:
        return 0.0
    return float(s.nunique(dropna=True) / n)


def _detect_semantic_type(s: pd.Series, sample: pd.Series) -> Tuple[str, float]:
    """Return the detected semantic type and confidence score."""
    name = str(s.name).lower()
    non_null = sample.dropna().astype(str)
    if non_null.empty:
        return "empty", 1.0

    total = len(non_null)

    # Pattern-based detection.
    def match_ratio(pattern: re.Pattern) -> float:
        return (non_null.str.match(pattern).sum()) / total

    if "email" in name or match_ratio(_PATTERNS["email"]) >= 0.8:
        return "email", 0.95 if "email" in name else match_ratio(_PATTERNS["email"])
    if "url" in name or "website" in name or match_ratio(_PATTERNS["url"]) >= 0.8:
        return "url", 0.95 if ("url" in name or "website" in name) else match_ratio(_PATTERNS["url"])
    if match_ratio(_PATTERNS["uuid"]) >= 0.9:
        return "uuid", match_ratio(_PATTERNS["uuid"])
    if match_ratio(_PATTERNS["percentage"]) >= 0.8:
        return "percentage", match_ratio(_PATTERNS["percentage"])
    if match_ratio(_PATTERNS["currency"]) >= 0.8:
        return "currency", match_ratio(_PATTERNS["currency"])
    if "phone" in name or "mobile" in name or "contact" in name or match_ratio(_PATTERNS["phone"]) >= 0.8:
        return "phone", 0.9 if any(k in name for k in ("phone", "mobile", "contact")) else match_ratio(_PATTERNS["phone"])
    if "zip" in name or "postal" in name or "pincode" in name:
        return "zip", 0.85
    if match_ratio(_PATTERNS["ipv4"]) >= 0.9:
        return "ipv4", match_ratio(_PATTERNS["ipv4"])
    if "gender" in name or "sex" in name or match_ratio(_PATTERNS["gender"]) >= 0.8:
        return "gender", 0.95 if any(k in name for k in ("gender", "sex")) else match_ratio(_PATTERNS["gender"])
    if "country" in name or "nation" in name:
        sample_lower = non_null.str.lower()
        matched = sample_lower.isin(_COUNTRY_NAMES).sum()
        ratio = matched / total
        if ratio >= 0.7:
            return "country", ratio
    if "state" in name or "province" in name or "region" in name:
        sample_lower = non_null.str.lower()
        matched = sample_lower.isin(_US_STATE_NAMES).sum()
        ratio = matched / total
        if ratio >= 0.5:
            return "state", ratio
    if "name" in name or "first" in name or "last" in name or "full_name" in name:
        return "name", 0.75
    if "address" in name or "street" in name or "city" in name:
        return "address", 0.75
    if "date" in name or "time" in name or "dob" in name or "birth" in name:
        return "date", 0.75
    if name == "id" or name.endswith("_id") or name.startswith("id_") or "identifier" in name or name.endswith("_key"):
        return "id", 0.9
    if match_ratio(_PATTERNS["boolean"]) >= 0.8:
        return "boolean", match_ratio(_PATTERNS["boolean"])

    # Numeric vs categorical heuristic.
    numeric_ratio = pd.to_numeric(non_null, errors="coerce").notna().sum() / total
    if numeric_ratio >= 0.9:
        return "numeric", numeric_ratio
    if _uniqueness_ratio(s) <= 0.05:
        return "categorical", 0.8
    return "text", 0.6


def _date_parse_ratio(s: pd.Series) -> float:
    """Ratio of values that can be parsed as dates."""
    try:
        parsed = pd.to_datetime(s.dropna().astype(str), errors="coerce")
        return float(parsed.notna().sum() / len(parsed)) if len(parsed) else 0.0
    except Exception:
        return 0.0


def _missing_sentinel_ratio(s: pd.Series) -> float:
    """Ratio of values that are common missing-value sentinels."""
    as_str = s.dropna().astype(str).str.strip().str.lower()
    if as_str.empty:
        return 0.0
    return float(as_str.isin(_MISSING_SENTINELS).sum() / len(as_str))


def _pattern_signature(values: pd.Series) -> Optional[str]:
    """Return a simplified pattern signature for the most common value."""
    if values.empty:
        return None
    top = values.value_counts(dropna=True).head(1)
    if top.empty:
        return None
    example = str(top.index[0])
    return re.sub(r"\d", "9", re.sub(r"[a-zA-Z]", "A", re.sub(r"\s", " ", example)))


def _column_profile(s: pd.Series, n: int) -> Dict[str, Any]:
    missing = int(s.isna().sum())
    missing_pct = round(missing / n * 100, 2) if n else 0.0
    unique = int(s.nunique(dropna=True))
    duplicate_count = int((s.duplicated()).sum()) if hasattr(s, "duplicated") else 0
    sentinel_ratio = _missing_sentinel_ratio(s)

    base = {
        "name": str(s.name),
        "pandas_dtype": str(s.dtype),
        "missing": missing,
        "missing_pct": missing_pct,
        "unique": unique,
        "duplicate_count": duplicate_count,
        "uniqueness_ratio": round(_uniqueness_ratio(s), 4),
        "entropy": round(_entropy(s), 4) if _entropy(s) is not None else None,
        "sentinel_missing_pct": round(sentinel_ratio * 100, 2),
    }

    # Semantic detection on a sample.
    sample = _sample(s.to_frame(), n=10_000).iloc[:, 0]
    semantic_type, confidence = _detect_semantic_type(s, sample)
    base["semantic_type"] = semantic_type
    base["semantic_confidence"] = round(confidence, 4)

    # Date parsing check.
    if semantic_type == "date" or pd.api.types.is_object_dtype(s):
        date_ratio = _date_parse_ratio(sample)
        if date_ratio >= 0.7 and semantic_type != "date":
            base["semantic_type"] = "date"
            base["semantic_confidence"] = round(date_ratio, 4)
        base["date_parse_ratio"] = round(date_ratio, 4)

    # Numeric stats.
    numeric_values = pd.to_numeric(sample, errors="coerce")
    if numeric_values.notna().sum() > 0:
        desc = numeric_values.describe()
        base.update({
            "min": safe_json(desc.get("min")),
            "max": safe_json(desc.get("max")),
            "mean": safe_json(round(desc.get("mean"), 4)) if pd.notna(desc.get("mean")) else None,
            "median": safe_json(round(numeric_values.median(), 4)) if pd.notna(numeric_values.median()) else None,
            "mode": safe_json(numeric_values.mode().iloc[0]) if not numeric_values.mode().empty else None,
            "variance": safe_json(round(numeric_values.var(ddof=0), 4)) if pd.notna(numeric_values.var(ddof=0)) else None,
            "std": safe_json(round(desc.get("std"), 4)) if pd.notna(desc.get("std")) else None,
            "outlier_count_zscore": int((np.abs((numeric_values - numeric_values.mean()) / numeric_values.std(ddof=0)) > 3).sum())
            if numeric_values.std(ddof=0) and not pd.isna(numeric_values.std(ddof=0)) else 0,
        })

    # Categorical / text stats.
    if pd.api.types.is_object_dtype(s) or pd.api.types.is_string_dtype(s) or base["semantic_type"] in ("categorical", "gender", "country", "state"):
        vc = sample.value_counts(dropna=True)
        if not vc.empty:
            base["top"] = str(vc.index[0])
            base["top_count"] = int(vc.iloc[0])
            base["top_pct"] = round(base["top_count"] / len(sample) * 100, 2) if len(sample) else 0.0
        base["pattern_signature"] = _pattern_signature(sample)
        # Length stats.
        lengths = sample.astype(str).str.len()
        if not lengths.empty:
            base["min_length"] = int(lengths.min())
            base["max_length"] = int(lengths.max())
            base["mean_length"] = round(float(lengths.mean()), 2)

    return base


def safe_json(value: Any) -> Any:
    """Convert a value into a JSON-safe representation."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    if isinstance(value, (np.integer, np.floating)):
        return value.item()
    if isinstance(value, (np.datetime64, pd.Timestamp)):
        return str(value)
    return value


def correlation_matrix(df: pd.DataFrame) -> Dict[str, Dict[str, Any]]:
    """Pearson correlation matrix for numeric columns."""
    numeric_df = df.select_dtypes(include=[np.number])
    if numeric_df.empty or numeric_df.shape[1] < 2:
        return {}
    corr = numeric_df.corr(numeric_only=True)
    return {row: {col: safe_json(corr.at[row, col]) for col in corr.columns} for row in corr.index}


def dataset_quality_scores(df: pd.DataFrame) -> Dict[str, Any]:
    """Compute six quality dimensions plus an overall score."""
    n = len(df)
    total_cells = n * df.shape[1] if df.shape[1] else 0
    missing_cells = int(df.isna().sum().sum()) if total_cells else 0

    completeness = max(0.0, 1.0 - (missing_cells / total_cells if total_cells else 0))

    # Duplicates impact uniqueness.
    dup_count = int(df.duplicated().sum())
    uniqueness = max(0.0, 1.0 - (dup_count / n if n else 0))

    # Validity: simple numeric + email checks.
    validity_checks = 0
    validity_passed = 0
    for col in df.columns:
        s = df[col]
        name = col.lower()
        if pd.api.types.is_numeric_dtype(s):
            validity_checks += 1
            # Check for impossible negative values in common columns.
            if any(k in name for k in ("age", "price", "amount", "qty", "quantity", "count", "salary")):
                if int((s.dropna() < 0).sum()) == 0:
                    validity_passed += 1
        elif pd.api.types.is_object_dtype(s):
            if "email" in name:
                non_null = s.dropna().astype(str)
                if not non_null.empty:
                    validity_checks += 1
                    if int((non_null.str.match(_EMAIL_RE)).sum()) == len(non_null):
                        validity_passed += 1
    validity = (validity_passed / validity_checks) if validity_checks else 1.0

    # Consistency: standardize sentinel ratio.
    sentinel_total = 0.0
    for col in df.columns:
        sentinel_total += _missing_sentinel_ratio(df[col])
    avg_sentinel = sentinel_total / len(df.columns) if len(df.columns) else 0.0
    consistency = max(0.0, 1.0 - avg_sentinel)

    # Accuracy: placeholder heuristic based on outlier presence and missing sentinels.
    # Real accuracy would require reference data; here we use 1 - (sentinel + missing) blend.
    accuracy = max(0.0, 1.0 - (avg_sentinel + (missing_cells / total_cells if total_cells else 0)) / 2)

    # Integrity: check for ID-like columns with unique constraint.
    id_integrity = []
    for col in df.columns:
        name = col.lower()
        if any(k in name for k in ("id", "identifier", "key", "code")):
            s = df[col].dropna()
            if not s.empty:
                id_integrity.append(float(s.nunique() / len(s)))
    integrity = sum(id_integrity) / len(id_integrity) if id_integrity else 1.0

    scores = {
        "completeness": round(completeness * 100, 2),
        "consistency": round(consistency * 100, 2),
        "validity": round(validity * 100, 2),
        "accuracy": round(accuracy * 100, 2),
        "uniqueness": round(uniqueness * 100, 2),
        "integrity": round(integrity * 100, 2),
    }
    scores["overall"] = round(sum(scores.values()) / len(scores), 2)
    return scores


def profile_dataset(df: pd.DataFrame, sample_size: int = 10_000) -> Dict[str, Any]:
    """Return a detailed enterprise profile of the dataset."""
    n = len(df)
    total_cells = n * df.shape[1] if df.shape[1] else 0
    missing_cells = int(df.isna().sum().sum())
    duplicate_rows = int(df.duplicated().sum())
    memory_kb = round(df.memory_usage(deep=True).sum() / 1024, 2)

    columns = [_column_profile(df[c], n) for c in df.columns]

    return {
        "rows": int(n),
        "columns": int(df.shape[1]),
        "total_cells": int(total_cells),
        "missing_cells": missing_cells,
        "missing_pct": round(missing_cells / total_cells * 100, 2) if total_cells else 0.0,
        "duplicate_rows": duplicate_rows,
        "duplicate_pct": round(duplicate_rows / n * 100, 2) if n else 0.0,
        "memory_kb": memory_kb,
        "memory_mb": round(memory_kb / 1024, 2),
        "quality_scores": dataset_quality_scores(df),
        "columns_detail": columns,
        "correlation_matrix": correlation_matrix(df),
        "sample_size": min(n, sample_size),
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }
