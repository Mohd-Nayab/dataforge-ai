"""Parse uploaded files into pandas DataFrames."""
from __future__ import annotations

import io
import json
from typing import Tuple

import pandas as pd


class UnsupportedFileError(Exception):
    pass


def load_dataframe(filename: str, content: bytes) -> pd.DataFrame:
    name = filename.lower()
    buffer = io.BytesIO(content)

    if name.endswith(".csv") or name.endswith(".txt"):
        try:
            return pd.read_csv(buffer)
        except Exception:
            buffer.seek(0)
            return pd.read_csv(buffer, sep=None, engine="python")

    if name.endswith(".xlsx") or name.endswith(".xls"):
        return pd.read_excel(buffer)

    if name.endswith(".json"):
        try:
            return pd.read_json(buffer)
        except ValueError:
            buffer.seek(0)
            data = json.loads(content.decode("utf-8"))
            if isinstance(data, dict):
                data = [data]
            return pd.json_normalize(data)

    if name.endswith(".parquet"):
        return pd.read_parquet(buffer)

    if name.endswith(".feather"):
        return pd.read_feather(buffer)

    raise UnsupportedFileError(
        f"Unsupported file type for '{filename}'. Supported: csv, txt, xlsx, xls, "
        "json, parquet, feather."
    )
