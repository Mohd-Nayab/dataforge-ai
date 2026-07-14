"""Join / merge two in-memory datasets into a new dataset."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import pandas as pd

from ..store import store
from ..utils import safe_value


VALID_HOW = {"inner", "left", "right", "outer"}


def join_datasets(
    left_id: str,
    right_id: str,
    left_on: str,
    right_on: str,
    how: str = "inner",
    suffixes: Optional[List[str]] = None,
    name: Optional[str] = None,
) -> Dict[str, Any]:
    how = (how or "inner").lower()
    if how not in VALID_HOW:
        raise ValueError(f"Invalid join type '{how}'. Use: {', '.join(sorted(VALID_HOW))}")

    left = store.get_df(left_id)
    right = store.get_df(right_id)
    left_meta = store.get_meta(left_id)
    right_meta = store.get_meta(right_id)

    if left_on not in left.columns:
        raise ValueError(f"Left key '{left_on}' not found in dataset '{left_meta.name}'.")
    if right_on not in right.columns:
        raise ValueError(f"Right key '{right_on}' not found in dataset '{right_meta.name}'.")

    sfx = tuple(suffixes or ["_x", "_y"])
    if len(sfx) != 2:
        raise ValueError("suffixes must be a list of two strings, e.g. ['_left', '_right'].")

    merged = left.merge(right, how=how, left_on=left_on, right_on=right_on, suffixes=sfx)

    out_name = name or f"{left_meta.name}_join_{right_meta.name}"
    meta = store.create(
        name=out_name,
        filename=f"{out_name}.parquet",
        df=merged,
        owner=left_meta.owner,
    )

    return {
        "meta": meta.to_dict(),
        "message": (
            f"Joined '{left_meta.name}' ({how}) '{right_meta.name}' on "
            f"{left_on}={right_on} → {meta.rows:,} rows × {meta.columns} cols."
        ),
        "how": how,
        "left_on": left_on,
        "right_on": right_on,
        "left_rows": int(len(left)),
        "right_rows": int(len(right)),
        "result_rows": int(len(merged)),
        "sample": [
            {k: safe_value(v) for k, v in row.items()}
            for row in merged.head(5).to_dict(orient="records")
        ],
    }
