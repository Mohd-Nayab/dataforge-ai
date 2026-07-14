"""Polars-backed file parsing for fast loading of large datasets.

The Polars loader is used as a fast path when the client asks for the `polars`
engine on upload. Once loaded, the resulting Polars DataFrame is converted to
pandas for storage so that all downstream services continue to work unchanged.
"""
from __future__ import annotations

import io
import json

import polars as pl

from .loader import UnsupportedFileError


def load_polars_dataframe(filename: str, content: bytes) -> pl.DataFrame:
    name = filename.lower()
    buffer = io.BytesIO(content)

    if name.endswith(".csv") or name.endswith(".txt"):
        try:
            return pl.read_csv(buffer)
        except Exception:
            buffer.seek(0)
            return pl.read_csv(buffer, separator=",", infer_schema_length=1000)

    if name.endswith(".tsv"):
        return pl.read_csv(buffer, separator="\t")

    if name.endswith(".psv"):
        return pl.read_csv(buffer, separator="|")

    if name.endswith(".xlsx") or name.endswith(".xls"):
        import pandas as pd
        return pl.from_pandas(pd.read_excel(buffer))

    if name.endswith(".ods"):
        import pandas as pd
        return pl.from_pandas(pd.read_excel(buffer, engine="odf"))

    if name.endswith(".json"):
        try:
            return pl.read_json(buffer)
        except Exception:
            buffer.seek(0)
            data = json.loads(content.decode("utf-8"))
            if isinstance(data, dict):
                data = [data]
            return pl.from_dicts(data)

    if name.endswith(".parquet"):
        return pl.read_parquet(buffer)

    if name.endswith(".feather") or name.endswith(".arrow"):
        return pl.read_ipc(buffer)

    # Formats not natively supported by polars — fall back to pandas
    _pandas_fallback = {
        ".xml", ".html", ".htm", ".orc", ".dta", ".sas7bdat",
        ".sav", ".pkl", ".pickle", ".h5", ".hdf5",
    }
    if any(name.endswith(ext) for ext in _pandas_fallback):
        import pandas as pd
        from .loader import load_dataframe
        return pl.from_pandas(load_dataframe(filename, content))

    raise UnsupportedFileError(
        f"Unsupported file type for '{filename}' with Polars engine. "
        "Supported: csv, tsv, psv, txt, xlsx, xls, ods, json, xml, html, "
        "parquet, feather, arrow, orc, dta, sas7bdat, sav, pkl, pickle, h5, hdf5."
    )


def polars_to_pandas(df: pl.DataFrame):
    """Convert Polars DataFrame to pandas, normalising column names to strings."""
    pdf = df.to_pandas()
    pdf.columns = [str(c) for c in pdf.columns]
    return pdf
