"""Two-level cache for LLM answers: an in-process LRU in front of a persistent SQLite table.

Vision calls are the slowest and most rate-limited part of Alfred, so the same
question on the same screen (same perceptual hash) is answered from cache.
"""
from __future__ import annotations

import hashlib
import json
import threading
from collections import OrderedDict
from datetime import datetime, timedelta, timezone

from . import config
from .db import get_db, now_iso

_MEMORY_LIMIT = 256
_memory: OrderedDict[str, tuple[datetime, dict]] = OrderedDict()
_lock = threading.Lock()
stats = {"memory_hits": 0, "db_hits": 0, "misses": 0}


def make_key(*parts: object) -> str:
    blob = json.dumps(parts, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()


def get(key: str) -> dict | None:
    now = datetime.now(timezone.utc)
    with _lock:
        entry = _memory.get(key)
        if entry and entry[0] > now:
            _memory.move_to_end(key)
            stats["memory_hits"] += 1
            return entry[1]

    with get_db() as conn:
        row = conn.execute(
            "SELECT response, expires_at FROM llm_cache WHERE cache_key = ?", (key,)
        ).fetchone()
        if row is None or datetime.fromisoformat(row["expires_at"]) <= now:
            stats["misses"] += 1
            return None
        conn.execute("UPDATE llm_cache SET hits = hits + 1 WHERE cache_key = ?", (key,))

    value = json.loads(row["response"])
    _remember(key, datetime.fromisoformat(row["expires_at"]), value)
    stats["db_hits"] += 1
    return value


def put(key: str, value: dict, ttl_seconds: int | None = None) -> None:
    ttl = config.CACHE_TTL_SECONDS if ttl_seconds is None else ttl_seconds
    expires = datetime.now(timezone.utc) + timedelta(seconds=ttl)
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO llm_cache (cache_key, response, created_at, expires_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(cache_key) DO UPDATE SET response = excluded.response, expires_at = excluded.expires_at
            """,
            (key, json.dumps(value), now_iso(), expires.isoformat(timespec="seconds")),
        )
    _remember(key, expires, value)


def _remember(key: str, expires: datetime, value: dict) -> None:
    with _lock:
        _memory[key] = (expires, value)
        _memory.move_to_end(key)
        while len(_memory) > _MEMORY_LIMIT:
            _memory.popitem(last=False)


def purge_expired() -> int:
    with get_db() as conn:
        deleted = conn.execute("DELETE FROM llm_cache WHERE expires_at <= ?", (now_iso(),)).rowcount
    now = datetime.now(timezone.utc)
    with _lock:
        for key in [k for k, (exp, _) in _memory.items() if exp <= now]:
            del _memory[key]
    return deleted


def summary() -> dict:
    with get_db() as conn:
        row = conn.execute("SELECT COUNT(*) AS entries, COALESCE(SUM(hits), 0) AS hits FROM llm_cache").fetchone()
    return {"entries": row["entries"], "persistent_hits": row["hits"], "memory_entries": len(_memory), **stats}


def clear_memory() -> None:
    with _lock:
        _memory.clear()
