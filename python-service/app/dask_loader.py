"""Dask-backed file parsing for out-of-core loading of large datasets.

The Dask loader is used as an out-of-core fast path when the client asks for the
`dask` engine on upload. Once read, the Dask DataFrame is computed into a pandas
DataFrame for storage so that all downstream services continue to work unchanged.
"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

import dask.dataframe as dd

from .loader import UnsupportedFileError


def _temp_path(content: bytes, suffix: str) -> str:
    fd, path = tempfile.mkstemp(suffix=suffix)
    with open(fd, "wb") as f:
        f.write(content)
    return path


def load_dask_dataframe(filename: str, content: bytes):
    name = filename.lower()

    if name.endswith(".csv") or name.endswith(".txt"):
        path = _temp_path(content, ".csv")
        try:
            return dd.read_csv(path)
        except Exception:
            return dd.read_csv(path, sep=None, engine="python")

    if name.endswith(".xlsx") or name.endswith(".xls"):
        import pandas as pd
        path = _temp_path(content, ".xlsx")
        return dd.from_pandas(pd.read_excel(path), npartitions=1)

    if name.endswith(".json"):
        path = _temp_path(content, ".json")
        try:
            return dd.read_json(path)
        except Exception:
            data = json.loads(content.decode("utf-8"))
            if isinstance(data, dict):
                data = [data]
            return dd.from_pandas(__import__("pandas").json_normalize(data), npartitions=1)

    if name.endswith(".parquet"):
        path = _temp_path(content, ".parquet")
        return dd.read_parquet(path)

    if name.endswith(".feather"):
        import pandas as pd
        path = _temp_path(content, ".feather")
        return dd.from_pandas(pd.read_feather(path), npartitions=1)

    raise UnsupportedFileError(
        f"Unsupported file type for '{filename}' with Dask engine. "
        "Supported: csv, txt, xlsx, xls, json, parquet, feather."
    )
