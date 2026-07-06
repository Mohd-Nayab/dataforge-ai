"""Read-only SQL query engine over a dataset, powered by DuckDB.

The active dataset is exposed as a table named ``data`` (alias ``dataset``),
and also by its sanitized dataset name (e.g. ``company_records``).
Only a single read-only statement (SELECT / WITH) is permitted, and DuckDB's
external access is disabled so queries cannot touch the filesystem or network.
"""
from __future__ import annotations

import re
from typing import Tuple

import duckdb
import pandas as pd

from ..cache import cached_query
from ..utils import column_dtype, df_to_records

# Statements that must never run against the engine.
_FORBIDDEN = re.compile(
    r"\b(insert|update|delete|drop|create|alter|attach|detach|copy|export|import|"
    r"install|load|pragma|set|call|vacuum|checkpoint|truncate|grant|revoke)\b",
    re.IGNORECASE,
)


class SqlError(ValueError):
    """Raised when a query is rejected or fails to execute."""


def _normalize(query: str) -> str:
    q = query.strip()
    # Allow a single trailing semicolon; reject multi-statement queries.
    if q.endswith(";"):
        q = q[:-1].rstrip()
    if ";" in q:
        raise SqlError("Only a single statement is allowed (remove extra ';').")
    return q


def _validate(query: str) -> None:
    if not query:
        raise SqlError("Query is empty.")
    head = query.lstrip().lower()
    if not (head.startswith("select") or head.startswith("with")):
        raise SqlError("Only read-only SELECT / WITH queries are permitted.")
    if _FORBIDDEN.search(query):
        raise SqlError("Query contains a disallowed (write/DDL) keyword.")


def _sanitize_table_name(name: str) -> str:
    """Convert a dataset name into a valid DuckDB table identifier."""
    cleaned = re.sub(r"[^0-9a-zA-Z_]", "_", name.strip()).lower()
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    if not cleaned or cleaned[0].isdigit():
        cleaned = f"ds_{cleaned or 'dataset'}"
    return cleaned


@cached_query
def run_query(
    dataset_id: str, df: pd.DataFrame, query: str, limit: int = 1000, dataset_name: str = "dataset"
) -> dict:
    sql = _normalize(query)
    _validate(sql)

    limit = max(1, min(int(limit), 5000))

    con = duckdb.connect(database=":memory:")
    try:
        # Hard-disable any filesystem / network access for safety.
        con.execute("SET enable_external_access=false;")
        con.register("data", df)
        con.register("dataset", df)
        # Also expose the dataset by its sanitized name so users can write intuitive queries.
        con.register(_sanitize_table_name(dataset_name), df)
        try:
            result = con.execute(sql).fetch_df()
        except Exception as e:  # noqa: BLE001 - surface a clean message to the client
            raise SqlError(str(e).strip().splitlines()[0] if str(e) else "Query failed.")
    finally:
        con.close()

    total = len(result)
    truncated = total > limit
    page = result.head(limit)

    columns = [{"name": str(c), "dtype": column_dtype(page[c])} for c in page.columns]
    return {
        "columns": columns,
        "rows": df_to_records(page),
        "row_count": int(total),
        "truncated": bool(truncated),
        "limit": limit,
    }
