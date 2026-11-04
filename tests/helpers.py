"""
Purpose: Small builders and a raw-SQL reader shared by the mx-inv tests.
Version: v1 (2026-09-24)
Scope: PRODUCTION - test tooling (tests/), not imported by the app.
Architecture: Used by tests/test_*.py on top of the per-test database from conftest.py.
    Builders go through data.py's public functions so the app's own rules apply; sql()
    reads the database directly, for read-back checks that must not trust the API.
"""
from __future__ import annotations

import datetime
import sqlite3
from typing import Any

import data

TODAY = datetime.date.today()


def d(days_from_today: int) -> str:
    """ISO date ``days_from_today`` days from today (negative = past)."""
    return (TODAY + datetime.timedelta(days=days_from_today)).isoformat()


def sql(query: str, params: tuple = ()) -> list[sqlite3.Row]:
    conn = sqlite3.connect(data.DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute(query, params).fetchall()
    finally:
        conn.close()


def one(query: str, params: tuple = ()) -> Any:
    """First column of the first row."""
    rows = sql(query, params)
    return rows[0][0] if rows else None


def system(name: str = "Engine", parent: str | None = None) -> str:
    data.create_system(name, parent_name=parent)
    return name


def days_task(name: str = "Change oil", period: int = 30, *, sys_name: str = "Engine",
              last_done: str | None = None, critical: bool = False, **kw: Any) -> int:
    if not sql("SELECT 1 FROM systems WHERE name = ?", (sys_name,)):
        system(sys_name)
    tid = data.create_task(sys_name, name, period=str(period), interval_type="days",
                           task_kind="recurring", **kw)
    if last_done:  # not an update_task field (only completions set it) - setup via SQL
        write("UPDATE tasks SET last_completed_date = ? WHERE task_id = ?", (last_done, tid))
    if critical:
        data.update_task(tid, is_critical=1)
    return tid


def write(query: str, params: tuple = ()) -> None:
    """Raw write for test SETUP only (state the API has no direct way to create)."""
    conn = sqlite3.connect(data.DB_PATH)
    try:
        conn.execute(query, params)
        conn.commit()
    finally:
        conn.close()


def container(name: str = "Bin A", ctype: str = "dry") -> int:
    comp = data.create_compartment(f"Comp for {name}")
    loc = data.add_location(f"Loc for {name}", comp)
    return data.add_container(loc, name, ctype)


def part(name: str = "Oil filter", unit: str = "ea") -> int:
    return data.create_item(name, "part", unit=unit)
