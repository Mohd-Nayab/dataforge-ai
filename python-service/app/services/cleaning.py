"""Data cleaning operations executed against pandas DataFrames.

Each operation takes a DataFrame plus a params dict and returns a tuple of
(new_dataframe, message). Operations are pure: they never mutate the input.
"""
from __future__ import annotations

import re
from typing import Callable, Dict, List, Tuple

import numpy as np
import pandas as pd

Result = Tuple[pd.DataFrame, str]


def _cols(df: pd.DataFrame, params: dict) -> List[str]:
    cols = params.get("columns")
    if not cols:
        return list(df.columns)
    return [c for c in cols if c in df.columns]


def _numeric_cols(df: pd.DataFrame, params: dict) -> List[str]:
    cols = _cols(df, params)
    return [c for c in cols if pd.api.types.is_numeric_dtype(df[c])]


# --------------------------------------------------------------- operations
def remove_duplicates(df: pd.DataFrame, params: dict) -> Result:
    subset = params.get("columns") or None
    before = len(df)
    out = df.drop_duplicates(subset=subset).reset_index(drop=True)
    return out, f"Removed {before - len(out)} duplicate row(s)."


def drop_nulls(df: pd.DataFrame, params: dict) -> Result:
    how = params.get("how", "any")
    subset = params.get("columns") or None
    before = len(df)
    out = df.dropna(how=how, subset=subset).reset_index(drop=True)
    return out, f"Dropped {before - len(out)} row(s) containing nulls."


def fill_missing(df: pd.DataFrame, params: dict) -> Result:
    method = params.get("method", "mean")
    out = df.copy()
    cols = _cols(df, params)
    filled = 0
    for c in cols:
        s = out[c]
        n_missing = int(s.isna().sum())
        if n_missing == 0:
            continue
        if method == "mean" and pd.api.types.is_numeric_dtype(s):
            out[c] = s.fillna(s.mean())
        elif method == "median" and pd.api.types.is_numeric_dtype(s):
            out[c] = s.fillna(s.median())
        elif method == "mode":
            mode = s.mode()
            if not mode.empty:
                out[c] = s.fillna(mode.iloc[0])
        elif method == "ffill":
            out[c] = s.ffill()
        elif method == "bfill":
            out[c] = s.bfill()
        elif method == "constant":
            out[c] = s.fillna(params.get("value", 0))
        filled += n_missing
    return out, f"Filled {filled} missing value(s) using '{method}'."


def remove_special_chars(df: pd.DataFrame, params: dict) -> Result:
    pattern = params.get("pattern", r"[^A-Za-z0-9\s]")
    out = df.copy()
    cols = [c for c in _cols(df, params) if pd.api.types.is_object_dtype(out[c])]
    for c in cols:
        out[c] = out[c].astype("string").str.replace(pattern, "", regex=True)
    return out, f"Removed special characters from {len(cols)} column(s)."


def trim_spaces(df: pd.DataFrame, params: dict) -> Result:
    out = df.copy()
    cols = [c for c in _cols(df, params) if pd.api.types.is_object_dtype(out[c])]
    for c in cols:
        out[c] = out[c].astype("string").str.strip()
    return out, f"Trimmed whitespace in {len(cols)} column(s)."


def change_case(df: pd.DataFrame, params: dict) -> Result:
    case = params.get("case", "lower")
    out = df.copy()
    cols = [c for c in _cols(df, params) if pd.api.types.is_object_dtype(out[c])]
    for c in cols:
        s = out[c].astype("string")
        if case == "lower":
            out[c] = s.str.lower()
        elif case == "upper":
            out[c] = s.str.upper()
        elif case == "title":
            out[c] = s.str.title()
    return out, f"Applied {case}-case to {len(cols)} column(s)."


def remove_outliers(df: pd.DataFrame, params: dict) -> Result:
    method = params.get("method", "iqr")
    cols = _numeric_cols(df, params)
    if not cols:
        return df, "No numeric columns selected for outlier removal."
    mask = pd.Series(True, index=df.index)
    if method == "iqr":
        for c in cols:
            q1, q3 = df[c].quantile(0.25), df[c].quantile(0.75)
            iqr = q3 - q1
            lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
            mask &= df[c].between(lo, hi) | df[c].isna()
    elif method == "zscore":
        thresh = float(params.get("threshold", 3.0))
        for c in cols:
            std = df[c].std(ddof=0)
            if std == 0 or pd.isna(std):
                continue
            z = (df[c] - df[c].mean()) / std
            mask &= (z.abs() <= thresh) | df[c].isna()
    before = len(df)
    out = df[mask].reset_index(drop=True)
    return out, f"Removed {before - len(out)} outlier row(s) using {method}."


def normalize(df: pd.DataFrame, params: dict) -> Result:
    method = params.get("method", "minmax")
    cols = _numeric_cols(df, params)
    out = df.copy()
    for c in cols:
        s = out[c].astype(float)
        if method == "minmax":
            rng = s.max() - s.min()
            out[c] = (s - s.min()) / rng if rng else 0.0
        elif method == "standard":
            std = s.std(ddof=0)
            out[c] = (s - s.mean()) / std if std else 0.0
    return out, f"Normalized {len(cols)} column(s) using {method} scaling."


def label_encode(df: pd.DataFrame, params: dict) -> Result:
    out = df.copy()
    cols = [c for c in _cols(df, params) if pd.api.types.is_object_dtype(out[c])]
    for c in cols:
        out[c] = out[c].astype("category").cat.codes
    return out, f"Label-encoded {len(cols)} column(s)."


def one_hot_encode(df: pd.DataFrame, params: dict) -> Result:
    cols = [c for c in _cols(df, params) if pd.api.types.is_object_dtype(df[c])]
    if not cols:
        return df, "No categorical columns selected for one-hot encoding."
    out = pd.get_dummies(df, columns=cols)
    return out, f"One-hot encoded {len(cols)} column(s); now {out.shape[1]} columns."


def change_dtype(df: pd.DataFrame, params: dict) -> Result:
    target = params.get("dtype", "string")
    cols = _cols(df, params)
    out = df.copy()
    mapping: Dict[str, Callable[[pd.Series], pd.Series]] = {
        "string": lambda s: s.astype("string"),
        "int": lambda s: pd.to_numeric(s, errors="coerce").astype("Int64"),
        "float": lambda s: pd.to_numeric(s, errors="coerce").astype(float),
        "datetime": lambda s: pd.to_datetime(s, errors="coerce"),
        "boolean": lambda s: s.astype("boolean"),
    }
    fn = mapping.get(target)
    if fn is None:
        return df, f"Unsupported dtype '{target}'."
    for c in cols:
        out[c] = fn(out[c])
    return out, f"Converted {len(cols)} column(s) to {target}."


def rename_column(df: pd.DataFrame, params: dict) -> Result:
    old, new = params.get("old"), params.get("new")
    if not old or not new or old not in df.columns:
        return df, "Provide valid 'old' and 'new' column names."
    out = df.rename(columns={old: new})
    return out, f"Renamed '{old}' to '{new}'."


def split_column(df: pd.DataFrame, params: dict) -> Result:
    col, delim = params.get("column"), params.get("delimiter", ",")
    if not col or col not in df.columns:
        return df, "Provide a valid 'column' to split."
    out = df.copy()
    parts = out[col].astype("string").str.split(re.escape(delim), expand=True)
    for i in range(parts.shape[1]):
        out[f"{col}_{i + 1}"] = parts[i]
    return out, f"Split '{col}' into {parts.shape[1]} column(s)."


def merge_columns(df: pd.DataFrame, params: dict) -> Result:
    cols = params.get("columns") or []
    sep = params.get("separator", " ")
    new = params.get("new", "merged")
    cols = [c for c in cols if c in df.columns]
    if len(cols) < 2:
        return df, "Select at least two columns to merge."
    out = df.copy()
    out[new] = out[cols].astype("string").agg(sep.join, axis=1)
    return out, f"Merged {len(cols)} columns into '{new}'."


def drop_columns(df: pd.DataFrame, params: dict) -> Result:
    cols = [c for c in (params.get("columns") or []) if c in df.columns]
    out = df.drop(columns=cols)
    return out, f"Dropped {len(cols)} column(s)."


OPERATIONS: Dict[str, Callable[[pd.DataFrame, dict], Result]] = {
    "remove_duplicates": remove_duplicates,
    "drop_nulls": drop_nulls,
    "fill_missing": fill_missing,
    "remove_special_chars": remove_special_chars,
    "trim_spaces": trim_spaces,
    "change_case": change_case,
    "remove_outliers": remove_outliers,
    "normalize": normalize,
    "label_encode": label_encode,
    "one_hot_encode": one_hot_encode,
    "change_dtype": change_dtype,
    "rename_column": rename_column,
    "split_column": split_column,
    "merge_columns": merge_columns,
    "drop_columns": drop_columns,
}


def apply_operation(df: pd.DataFrame, op: str, params: dict) -> Result:
    fn = OPERATIONS.get(op)
    if fn is None:
        raise ValueError(f"Unknown operation '{op}'")
    return fn(df, params or {})


def auto_clean(df: pd.DataFrame) -> Tuple[pd.DataFrame, List[str]]:
    """Apply a sensible default cleaning pipeline and report what changed."""
    log: List[str] = []
    out = df
    out, msg = remove_duplicates(out, {})
    log.append(msg)
    out, msg = trim_spaces(out, {})
    log.append(msg)
    # Fill numeric NaNs with median, categorical with mode.
    num_cols = [c for c in out.columns if pd.api.types.is_numeric_dtype(out[c])]
    cat_cols = [c for c in out.columns if pd.api.types.is_object_dtype(out[c])]
    if num_cols:
        out, msg = fill_missing(out, {"method": "median", "columns": num_cols})
        log.append(msg)
    if cat_cols:
        out, msg = fill_missing(out, {"method": "mode", "columns": cat_cols})
        log.append(msg)
    return out, log
