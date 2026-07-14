"""Parse uploaded files into pandas DataFrames."""
from __future__ import annotations

import io
import json

import pandas as pd


class UnsupportedFileError(Exception):
    pass


def load_dataframe(filename: str, content: bytes) -> pd.DataFrame:
    name = filename.lower()
    buffer = io.BytesIO(content)

    # --- Delimited text formats ---
    if name.endswith(".csv") or name.endswith(".txt"):
        try:
            return pd.read_csv(buffer)
        except Exception:
            buffer.seek(0)
            return pd.read_csv(buffer, sep=None, engine="python")

    if name.endswith(".tsv"):
        return pd.read_csv(buffer, sep="\t")

    if name.endswith(".psv"):
        return pd.read_csv(buffer, sep="|")

    # --- Spreadsheet formats ---
    if name.endswith(".xlsx") or name.endswith(".xls"):
        return pd.read_excel(buffer)

    if name.endswith(".ods"):
        return pd.read_excel(buffer, engine="odf")

    # --- Structured / semi-structured ---
    if name.endswith(".json"):
        try:
            return pd.read_json(buffer)
        except ValueError:
            buffer.seek(0)
            data = json.loads(content.decode("utf-8"))
            if isinstance(data, dict):
                data = [data]
            return pd.json_normalize(data)

    if name.endswith(".xml"):
        return pd.read_xml(buffer)

    if name.endswith(".html") or name.endswith(".htm"):
        tables = pd.read_html(buffer)
        if not tables:
            raise UnsupportedFileError(f"No tables found in '{filename}'")
        return tables[0]

    # --- Columnar / binary formats ---
    if name.endswith(".parquet"):
        return pd.read_parquet(buffer)

    if name.endswith(".feather") or name.endswith(".arrow"):
        return pd.read_feather(buffer)

    if name.endswith(".orc"):
        return pd.read_orc(buffer)

    # --- Statistical package formats ---
    if name.endswith(".dta"):
        return pd.read_stata(buffer)

    if name.endswith(".sas7bdat"):
        return pd.read_sas(buffer, format="sas7bdat")

    if name.endswith(".sav"):
        return pd.read_spss(buffer)

    # --- Python serialization ---
    if name.endswith(".pkl") or name.endswith(".pickle"):
        return pd.read_pickle(buffer)

    # --- Scientific formats ---
    if name.endswith(".h5") or name.endswith(".hdf5"):
        return pd.read_hdf(buffer)

    raise UnsupportedFileError(
        f"Unsupported file type for '{filename}'. Supported: csv, tsv, psv, txt, "
        "xlsx, xls, ods, json, xml, html, parquet, feather, arrow, orc, "
        "dta, sas7bdat, sav, pkl, pickle, h5, hdf5."
    )
