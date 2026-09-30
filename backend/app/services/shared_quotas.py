"""SQLite-backed coach quotas shared by API processes on one host."""

from __future__ import annotations

import math
import os
import sqlite3
import time
from functools import lru_cache
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException


class SharedCoachQuota:
    def __init__(self, path: str | Path, per_user_hour: int = 20,
                 global_hour: int = 100, max_in_flight: int = 2,
                 window_seconds: int = 3600, lease_seconds: int = 180,
                 clock=None):
        if min(per_user_hour, global_hour, max_in_flight, window_seconds, lease_seconds) < 1:
            raise ValueError("Coach quotas must be positive")
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.per_user_hour = per_user_hour
        self.global_hour = global_hour
        self.max_in_flight = max_in_flight
        self.window_seconds = window_seconds
        self.lease_seconds = lease_seconds
        self.clock = clock or time.time
        with self._connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS coach_quota_requests (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    active_until REAL
                );
                CREATE INDEX IF NOT EXISTS coach_quota_user_time
                    ON coach_quota_requests(user_id, created_at);
                CREATE INDEX IF NOT EXISTS coach_quota_time
                    ON coach_quota_requests(created_at);
            """)

    def _connection(self):
        return sqlite3.connect(self.path, timeout=5)

    def acquire(self, user_id: str) -> str:
        now = self.clock()
        with self._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM coach_quota_requests WHERE created_at <= ? AND (active_until IS NULL OR active_until <= ?)",
                       (now - self.window_seconds, now))
            user_count, oldest_user = db.execute(
                "SELECT count(*), min(created_at) FROM coach_quota_requests WHERE user_id=? AND created_at>?",
                (user_id, now - self.window_seconds)).fetchone()
            if user_count >= self.per_user_hour:
                self._reject("You have reached the coach request limit.",
                             oldest_user + self.window_seconds - now)
            global_count, oldest_global = db.execute(
                "SELECT count(*), min(created_at) FROM coach_quota_requests WHERE created_at>?",
                (now - self.window_seconds,)).fetchone()
            if global_count >= self.global_hour:
                self._reject("The coach has reached its current request limit.",
                             oldest_global + self.window_seconds - now)
            active = db.execute("SELECT count(*) FROM coach_quota_requests WHERE active_until>?",
                                (now,)).fetchone()[0]
            if active >= self.max_in_flight:
                self._reject("The coach is handling other questions. Try again shortly.", 1)
            lease_id = uuid4().hex
            db.execute("INSERT INTO coach_quota_requests(id, user_id, created_at, active_until) VALUES (?, ?, ?, ?)",
                       (lease_id, user_id, now, now + self.lease_seconds))
        return lease_id

    def release(self, lease_id: str) -> None:
        with self._connection() as db:
            db.execute("UPDATE coach_quota_requests SET active_until=NULL WHERE id=?", (lease_id,))

    @staticmethod
    def _reject(message: str, retry_seconds: float) -> None:
        raise HTTPException(429, message, headers={"Retry-After": str(max(1, math.ceil(retry_seconds)))})


@lru_cache(maxsize=1)
def get_shared_coach_quota() -> SharedCoachQuota:
    from app.services.analysis_jobs import get_job_store

    return SharedCoachQuota(
        get_job_store().path,
        per_user_hour=int(os.getenv("COACH_REQUESTS_PER_USER_HOUR", "20")),
        global_hour=int(os.getenv("COACH_REQUESTS_GLOBAL_HOUR", "100")),
        max_in_flight=int(os.getenv("COACH_MAX_IN_FLIGHT", "2")),
    )
