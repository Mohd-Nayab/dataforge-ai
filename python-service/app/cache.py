"""Lightweight in-memory result cache for expensive, repeatable queries.

The cache is intentionally simple: it stores results keyed by the normalized
query plus dataset identity. Any operation that mutates a dataset (cleaning,
column transforms, etc.) should invalidate that dataset's cache entries.
"""
from __future__ import annotations

from collections import OrderedDict
from functools import wraps
from typing import Any, Callable


class _LRUCache:
    def __init__(self, maxsize: int = 256):
        self.maxsize = maxsize
        self._store: OrderedDict[str, Any] = OrderedDict()

    def get(self, key: str) -> Any | None:
        if key not in self._store:
            return None
        self._store.move_to_end(key)
        return self._store[key]

    def set(self, key: str, value: Any) -> None:
        self._store[key] = value
        self._store.move_to_end(key)
        while len(self._store) > self.maxsize:
            self._store.popitem(last=False)

    def invalidate_dataset(self, dataset_id: str) -> int:
        removed = 0
        prefix = f"ds:{dataset_id}:"
        for key in list(self._store.keys()):
            if key.startswith(prefix):
                del self._store[key]
                removed += 1
        return removed

    def stats(self) -> dict:
        return {"size": len(self._store), "maxsize": self.maxsize}


query_cache = _LRUCache(maxsize=256)


def cache_key(dataset_id: str, query: str, limit: int) -> str:
    return f"ds:{dataset_id}:q:{query.strip().casefold()}:l:{limit}"


def cached_query(func: Callable[..., dict]) -> Callable[..., dict]:
    """Decorator that caches SQL query results by dataset_id + query + limit.

    The wrapped function must accept (dataset_id, df, query, limit, ...) in that order.
    """

    @wraps(func)
    def wrapper(dataset_id: str, df: Any, query: str, limit: int = 1000, *args: Any, **kwargs: Any) -> dict:
        key = cache_key(dataset_id, query, limit)
        cached = query_cache.get(key)
        if cached is not None:
            cached["cached"] = True
            return cached

        result = func(dataset_id, df, query, limit, *args, **kwargs)
        result["cached"] = False
        query_cache.set(key, result.copy())
        return result

    return wrapper
