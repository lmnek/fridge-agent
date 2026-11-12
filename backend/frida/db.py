"""Jednoduché úložiště dokumentů nad SQLite.

Lednice v domácnosti má stovky záznamů, ne miliony, takže stačí jedna tabulka
`docs(collection, id, ts, data)` s JSONem. Pydantic modely se ukládají celé.
Když jednou bude potřeba Postgres, vymění se jen tahle třída.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, TypeVar

from pydantic import BaseModel

M = TypeVar("M", bound=BaseModel)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS docs (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    ts TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS docs_by_ts ON docs (collection, ts);
"""


def utcnow() -> datetime:
    return datetime.now(UTC)


class DocStore:
    def __init__(self, url_or_path: str | Path) -> None:
        path = str(url_or_path)
        if path.startswith("sqlite:///"):
            path = path.removeprefix("sqlite:///")
        self.path = path
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(_SCHEMA)

    # -- zápis -------------------------------------------------------------
    def put(self, collection: str, doc_id: str, data: BaseModel | dict[str, Any], ts: datetime | None = None) -> None:
        payload = data.model_dump(mode="json") if isinstance(data, BaseModel) else data
        stamp = (ts or utcnow()).isoformat()
        with self._lock:
            self._conn.execute(
                "INSERT INTO docs (collection, id, ts, data) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(collection, id) DO UPDATE SET ts = excluded.ts, data = excluded.data",
                (collection, doc_id, stamp, json.dumps(payload, ensure_ascii=False)),
            )

    def delete(self, collection: str, doc_id: str) -> bool:
        with self._lock:
            cur = self._conn.execute("DELETE FROM docs WHERE collection = ? AND id = ?", (collection, doc_id))
            return cur.rowcount > 0

    def clear(self, collection: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM docs WHERE collection = ?", (collection,))

    # -- čtení -------------------------------------------------------------
    def get_raw(self, collection: str, doc_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT data FROM docs WHERE collection = ? AND id = ?", (collection, doc_id)
            ).fetchone()
        return json.loads(row[0]) if row else None

    def get(self, collection: str, doc_id: str, model: type[M]) -> M | None:
        raw = self.get_raw(collection, doc_id)
        return model.model_validate(raw) if raw is not None else None

    def list_raw(
        self,
        collection: str,
        *,
        limit: int | None = None,
        newest_first: bool = True,
        since: datetime | None = None,
    ) -> list[dict[str, Any]]:
        sql = "SELECT data FROM docs WHERE collection = ?"
        args: list[Any] = [collection]
        if since is not None:
            sql += " AND ts >= ?"
            args.append(since.isoformat())
        sql += " ORDER BY ts " + ("DESC" if newest_first else "ASC")
        if limit is not None:
            sql += " LIMIT ?"
            args.append(limit)
        with self._lock:
            rows = self._conn.execute(sql, args).fetchall()
        return [json.loads(r[0]) for r in rows]

    def list(
        self,
        collection: str,
        model: type[M],
        *,
        limit: int | None = None,
        newest_first: bool = True,
        since: datetime | None = None,
    ) -> list[M]:
        return [
            model.model_validate(r)
            for r in self.list_raw(collection, limit=limit, newest_first=newest_first, since=since)
        ]

    def count(self, collection: str) -> int:
        with self._lock:
            return int(self._conn.execute("SELECT COUNT(*) FROM docs WHERE collection = ?", (collection,)).fetchone()[0])

    def put_many(self, collection: str, docs: Iterable[tuple[str, BaseModel | dict[str, Any]]]) -> None:
        for doc_id, data in docs:
            self.put(collection, doc_id, data)

    def close(self) -> None:
        with self._lock:
            self._conn.close()
