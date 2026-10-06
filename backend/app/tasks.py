"""To-dos and reminders, stored per user.

Mirrors the rules the desktop app has always used (src/shared/tasks.ts): completing a
task stamps completedAt, and moving a reminder clears remindedAt so it fires again.
JSON uses the desktop app's camelCase field names so the client needs no mapping.
"""
from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone

from .db import now_iso


def parse_time(value: str | None, assume_tz: timezone | None = None) -> str | None:
    """Any ISO-ish timestamp -> UTC ISO string. A value with no zone is read in assume_tz (default UTC)."""
    if value is None or not str(value).strip():
        return None
    text = str(value).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=assume_tz or timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat(timespec="seconds")


def to_json(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "notes": row["notes"],
        "done": bool(row["done"]),
        "createdAt": row["created_at"],
        "completedAt": row["completed_at"],
        "remindAt": row["remind_at"],
        "remindedAt": row["reminded_at"],
    }


ORDER = """
ORDER BY done ASC,
         CASE WHEN done = 1 THEN COALESCE(completed_at, created_at) END DESC,
         CASE WHEN remind_at IS NULL THEN 1 ELSE 0 END,
         remind_at ASC, created_at ASC
"""


def list_tasks(conn: sqlite3.Connection, user_id: int) -> list[dict]:
    return [to_json(r) for r in conn.execute(f"SELECT * FROM tasks WHERE user_id = ? {ORDER}", (user_id,))]


def get_task(conn: sqlite3.Connection, user_id: int, task_id: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id)).fetchone()


def create_task(conn: sqlite3.Connection, user_id: int, title: str, notes: str | None = None, remind_at: str | None = None) -> dict:
    task_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO tasks (id, user_id, title, notes, created_at, remind_at) VALUES (?, ?, ?, ?, ?, ?)",
        (task_id, user_id, title.strip(), (notes or "").strip() or None, now_iso(), parse_time(remind_at)),
    )
    return to_json(get_task(conn, user_id, task_id))


_UNSET = object()


def update_task(
    conn: sqlite3.Connection,
    user_id: int,
    task_id: str,
    *,
    title: str | None = None,
    notes: object = _UNSET,
    remind_at: object = _UNSET,
    done: bool | None = None,
    reminded: bool | None = None,
) -> dict | None:
    row = get_task(conn, user_id, task_id)
    if row is None:
        return None
    task = dict(row)
    if title and title.strip():
        task["title"] = title.strip()
    if notes is not _UNSET:
        task["notes"] = (str(notes).strip() or None) if notes else None
    if remind_at is not _UNSET:
        new_time = parse_time(remind_at)  # type: ignore[arg-type]
        if new_time != task["remind_at"]:
            task["remind_at"] = new_time
            task["reminded_at"] = None  # a moved reminder fires again
    if done is not None and bool(done) != bool(task["done"]):
        task["done"] = int(done)
        task["completed_at"] = now_iso() if done else None
    if reminded:
        task["reminded_at"] = now_iso()
    conn.execute(
        """
        UPDATE tasks SET title = ?, notes = ?, done = ?, completed_at = ?, remind_at = ?, reminded_at = ?
        WHERE id = ? AND user_id = ?
        """,
        (task["title"], task["notes"], task["done"], task["completed_at"], task["remind_at"], task["reminded_at"], task_id, user_id),
    )
    return to_json(get_task(conn, user_id, task_id))


def delete_task(conn: sqlite3.Connection, user_id: int, task_id: str) -> bool:
    return conn.execute("DELETE FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id)).rowcount > 0


def clear_completed(conn: sqlite3.Connection, user_id: int) -> int:
    return conn.execute("DELETE FROM tasks WHERE user_id = ? AND done = 1", (user_id,)).rowcount
