"""In-memory dataset store with on-disk persistence.

Datasets are kept hot in memory for fast operations and persisted to disk
(parquet + json metadata) so they survive process restarts. Each dataset also
keeps an undo history of recent versions.
"""
from __future__ import annotations

import json
import threading
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import joblib
import pandas as pd

from .config import DATA_DIR

_META_FILE = DATA_DIR / "datasets.json"
_MAX_HISTORY = 20


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class DatasetMeta:
    id: str
    name: str
    filename: str
    rows: int
    columns: int
    created_at: str
    updated_at: str
    owner: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class _Entry:
    meta: DatasetMeta
    df: pd.DataFrame
    history: List[pd.DataFrame] = field(default_factory=list)
    models: Dict[str, Any] = field(default_factory=dict)


class DatasetStore:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._entries: Dict[str, _Entry] = {}
        self._load_from_disk()

    # ------------------------------------------------------------------ disk
    def _parquet_path(self, dataset_id: str):
        return DATA_DIR / f"{dataset_id}.parquet"

    def _load_from_disk(self) -> None:
        if not _META_FILE.exists():
            return
        try:
            metas = json.loads(_META_FILE.read_text())
        except json.JSONDecodeError:
            return
        for m in metas:
            path = self._parquet_path(m["id"])
            if not path.exists():
                continue
            try:
                df = pd.read_parquet(path)
            except Exception:
                continue
            self._entries[m["id"]] = _Entry(meta=DatasetMeta(**m), df=df)

    def _persist_meta(self) -> None:
        metas = [e.meta.to_dict() for e in self._entries.values()]
        _META_FILE.write_text(json.dumps(metas, indent=2))

    def _persist_df(self, dataset_id: str) -> None:
        entry = self._entries[dataset_id]
        try:
            entry.df.to_parquet(self._parquet_path(dataset_id), index=False)
        except Exception:
            # Fallback to pickle when parquet engine struggles with dtypes.
            entry.df.to_pickle(self._parquet_path(dataset_id).with_suffix(".pkl"))

    def _model_path(self, dataset_id: str, model_id: str) -> Path:
        return DATA_DIR / f"{dataset_id}_{model_id}.joblib"

    # --------------------------------------------------------------- public
    def create(self, name: str, filename: str, df: pd.DataFrame,
               owner: Optional[str] = None) -> DatasetMeta:
        with self._lock:
            dataset_id = uuid.uuid4().hex
            meta = DatasetMeta(
                id=dataset_id,
                name=name,
                filename=filename,
                rows=int(df.shape[0]),
                columns=int(df.shape[1]),
                created_at=_now(),
                updated_at=_now(),
                owner=owner,
            )
            self._entries[dataset_id] = _Entry(meta=meta, df=df)
            self._persist_df(dataset_id)
            self._persist_meta()
            return meta

    def list(self, owner: Optional[str] = None) -> List[DatasetMeta]:
        with self._lock:
            metas = [e.meta for e in self._entries.values()]
            if owner is not None:
                metas = [m for m in metas if m.owner in (owner, None)]
            return sorted(metas, key=lambda m: m.updated_at, reverse=True)

    def get_meta(self, dataset_id: str) -> DatasetMeta:
        return self._require(dataset_id).meta

    def get_df(self, dataset_id: str) -> pd.DataFrame:
        return self._require(dataset_id).df

    def update_df(self, dataset_id: str, df: pd.DataFrame) -> DatasetMeta:
        with self._lock:
            entry = self._require(dataset_id)
            entry.history.append(entry.df.copy())
            if len(entry.history) > _MAX_HISTORY:
                entry.history.pop(0)
            entry.df = df
            entry.meta.rows = int(df.shape[0])
            entry.meta.columns = int(df.shape[1])
            entry.meta.updated_at = _now()
            self._persist_df(dataset_id)
            self._persist_meta()
            return entry.meta

    def undo(self, dataset_id: str) -> DatasetMeta:
        with self._lock:
            entry = self._require(dataset_id)
            if not entry.history:
                return entry.meta
            entry.df = entry.history.pop()
            entry.meta.rows = int(entry.df.shape[0])
            entry.meta.columns = int(entry.df.shape[1])
            entry.meta.updated_at = _now()
            self._persist_df(dataset_id)
            self._persist_meta()
            return entry.meta

    def delete(self, dataset_id: str) -> None:
        with self._lock:
            self._require(dataset_id)
            entry = self._entries[dataset_id]
            for model_id in list(entry.models.keys()):
                self._delete_model_locked(dataset_id, model_id)
            del self._entries[dataset_id]
            for p in (self._parquet_path(dataset_id),
                      self._parquet_path(dataset_id).with_suffix(".pkl")):
                if p.exists():
                    p.unlink()
            self._persist_meta()

    def set_model(self, dataset_id: str, model_id: str, model: Any,
                  info: Dict[str, Any]) -> None:
        with self._lock:
            entry = self._require(dataset_id)
            entry.models[model_id] = {**info, "model": model}
            path = self._model_path(dataset_id, model_id)
            try:
                joblib.dump(model, path)
            except Exception:
                pass

    def get_model(self, dataset_id: str, model_id: str) -> Optional[Any]:
        with self._lock:
            entry = self._require(dataset_id)
            cached = entry.models.get(model_id)
            if cached and "model" in cached:
                return cached["model"]
            path = self._model_path(dataset_id, model_id)
            if path.exists():
                try:
                    model = joblib.load(path)
                    info = cached.copy() if cached else {}
                    info["model"] = model
                    entry.models[model_id] = info
                    return model
                except Exception:
                    pass
            return None

    def get_model_info(self, dataset_id: str, model_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            entry = self._require(dataset_id)
            info = entry.models.get(model_id)
            if info is None:
                return None
            return {k: v for k, v in info.items() if k != "model"}

    def list_models(self, dataset_id: str) -> List[Dict[str, Any]]:
        with self._lock:
            entry = self._require(dataset_id)
            return [
                {**{k: v for k, v in info.items() if k != "model"}, "id": model_id}
                for model_id, info in entry.models.items()
            ]

    def delete_model(self, dataset_id: str, model_id: str) -> None:
        with self._lock:
            self._delete_model_locked(dataset_id, model_id)

    def _delete_model_locked(self, dataset_id: str, model_id: str) -> None:
        entry = self._entries[dataset_id]
        entry.models.pop(model_id, None)
        path = self._model_path(dataset_id, model_id)
        if path.exists():
            try:
                path.unlink()
            except Exception:
                pass

    def _require(self, dataset_id: str) -> _Entry:
        entry = self._entries.get(dataset_id)
        if entry is None:
            raise KeyError(dataset_id)
        return entry


store = DatasetStore()
