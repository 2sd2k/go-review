"""Small, cross-process SQLite queue for single-host analysis workers."""

from __future__ import annotations

import json
import os
import sqlite3
import time
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path
from uuid import uuid4

from app.models.schemas import AnalysisRequest, MoveAnalysis


class QueueFullError(Exception):
    pass


class AnalysisJobStore:
    def __init__(self, path: str | Path, max_active: int = 16):
        self.path = Path(path)
        self.max_active = max_active
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    request_json TEXT NOT NULL,
                    state TEXT NOT NULL,
                    total_moves INTEGER NOT NULL,
                    completed_count INTEGER NOT NULL DEFAULT 0,
                    worker_id TEXT,
                    error TEXT,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS jobs_state_created ON jobs(state, created_at);
                CREATE TABLE IF NOT EXISTS job_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
                    type TEXT NOT NULL,
                    payload_json TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS job_events_cursor ON job_events(job_id, id);
                CREATE TABLE IF NOT EXISTS job_results (
                    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
                    move_number INTEGER NOT NULL,
                    PRIMARY KEY(job_id, move_number)
                );
                CREATE TABLE IF NOT EXISTS workers (
                    id TEXT PRIMARY KEY,
                    last_seen REAL NOT NULL
                );
            """)

    @contextmanager
    def _connection(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def enqueue(self, request: AnalysisRequest) -> str:
        now = time.time()
        job_id = uuid4().hex
        with self._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            self._expire_stale_running(db, now)
            # Finished jobs are kept briefly for diagnostics, then reclaimed.
            db.execute("DELETE FROM jobs WHERE state IN ('complete', 'error', 'cancelled') AND updated_at < ?",
                       (now - 86_400,))
            active = db.execute("SELECT count(*) FROM jobs WHERE state IN ('queued', 'running')").fetchone()[0]
            if active >= self.max_active:
                raise QueueFullError("Analysis queue is full. Please try again later.")
            db.execute("""INSERT INTO jobs(id, request_json, state, total_moves, created_at, updated_at)
                          VALUES (?, ?, 'queued', ?, ?, ?)""",
                       (job_id, request.model_dump_json(), len(request.moves), now, now))
        return job_id

    def heartbeat(self, worker_id: str) -> None:
        with self._connection() as db:
            db.execute("""INSERT INTO workers(id, last_seen) VALUES (?, ?)
                          ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen""",
                       (worker_id, time.time()))

    def unregister_worker(self, worker_id: str) -> None:
        with self._connection() as db:
            db.execute("DELETE FROM workers WHERE id=?", (worker_id,))

    def worker_alive(self, worker_id: str | None = None, max_age: float = 15) -> bool:
        cutoff = time.time() - max_age
        with self._connection() as db:
            if worker_id is None:
                row = db.execute("SELECT 1 FROM workers WHERE last_seen >= ? LIMIT 1", (cutoff,)).fetchone()
            else:
                row = db.execute("SELECT 1 FROM workers WHERE id=? AND last_seen >= ?",
                                 (worker_id, cutoff)).fetchone()
        return row is not None

    def claim(self, worker_id: str):
        with self._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            now = time.time()
            db.execute("""INSERT INTO workers(id, last_seen) VALUES (?, ?)
                          ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen""",
                       (worker_id, now))
            self._expire_stale_running(db, now)
            row = db.execute("SELECT id, request_json FROM jobs WHERE state='queued' ORDER BY created_at LIMIT 1").fetchone()
            if row is None:
                return None
            db.execute("UPDATE jobs SET state='running', worker_id=?, updated_at=? WHERE id=?",
                       (worker_id, time.time(), row["id"]))
            return row["id"], AnalysisRequest.model_validate_json(row["request_json"])

    @staticmethod
    def _expire_stale_running(db: sqlite3.Connection, now: float) -> None:
        stale = db.execute("""SELECT jobs.id FROM jobs LEFT JOIN workers ON jobs.worker_id=workers.id
                              WHERE jobs.state='running' AND
                              (workers.last_seen IS NULL OR workers.last_seen < ?)""",
                           (now - 30,)).fetchall()
        for row in stale:
            error = "Analysis worker stopped. Please try again."
            db.execute("UPDATE jobs SET state='error', error=?, updated_at=? WHERE id=?",
                       (error, now, row["id"]))
            db.execute("INSERT INTO job_events(job_id, type, payload_json) VALUES (?, 'error', ?)",
                       (row["id"], json.dumps({"error": error})))

    def get_job(self, job_id: str):
        with self._connection() as db:
            row = db.execute("SELECT state, worker_id, total_moves, completed_count, error FROM jobs WHERE id=?",
                             (job_id,)).fetchone()
        return dict(row) if row else None

    def events_since(self, job_id: str, cursor: int) -> list[dict]:
        with self._connection() as db:
            rows = db.execute("""SELECT id, type, payload_json FROM job_events
                                 WHERE job_id=? AND id>? ORDER BY id LIMIT 64""",
                              (job_id, cursor)).fetchall()
        return [{"id": row["id"], "type": row["type"],
                 **json.loads(row["payload_json"])} for row in rows]

    def add_result(self, job_id: str, worker_id: str, analysis: MoveAnalysis) -> bool:
        with self._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            job = db.execute("SELECT state, worker_id, total_moves FROM jobs WHERE id=?", (job_id,)).fetchone()
            if job is None or job["state"] != "running" or job["worker_id"] != worker_id:
                return False
            total = job["total_moves"]
            if not 0 <= analysis.move_number <= total:
                raise ValueError("KataGo returned a turn outside the requested game")
            try:
                db.execute("INSERT INTO job_results(job_id, move_number) VALUES (?, ?)",
                           (job_id, analysis.move_number))
            except sqlite3.IntegrityError as error:
                raise ValueError("KataGo returned the same turn twice") from error
            db.execute("UPDATE jobs SET completed_count=completed_count+1, updated_at=? WHERE id=?",
                       (time.time(), job_id))
            db.execute("INSERT INTO job_events(job_id, type, payload_json) VALUES (?, 'result', ?)",
                       (job_id, json.dumps({"move_number": analysis.move_number, "total_moves": total,
                                            "analysis": analysis.model_dump(exclude_none=True)})))
        return True

    def _finish(self, job_id: str, state: str, event_type: str, payload: dict,
                worker_id: str | None = None) -> bool:
        with self._connection() as db:
            if worker_id is None:
                updated = db.execute("""UPDATE jobs SET state=?, error=?, updated_at=?
                                        WHERE id=? AND state IN ('queued', 'running')""",
                                     (state, payload.get("error"), time.time(), job_id))
            else:
                updated = db.execute("""UPDATE jobs SET state=?, error=?, updated_at=?
                                        WHERE id=? AND state='running' AND worker_id=?""",
                                     (state, payload.get("error"), time.time(), job_id, worker_id))
            if not updated.rowcount:
                return False
            db.execute("INSERT INTO job_events(job_id, type, payload_json) VALUES (?, ?, ?)",
                       (job_id, event_type, json.dumps(payload)))
        return True

    def complete(self, job_id: str, worker_id: str) -> bool:
        job = self.get_job(job_id)
        if not job:
            return False
        if job["completed_count"] != job["total_moves"] + 1:
            self.fail(job_id, "KataGo returned an incomplete review. Please retry.", worker_id)
            return False
        return self._finish(job_id, "complete", "complete", {"total_moves": job["total_moves"]}, worker_id)

    def fail(self, job_id: str, error: str, worker_id: str | None = None) -> bool:
        return self._finish(job_id, "error", "error", {"error": error}, worker_id)

    def cancel(self, job_id: str) -> bool:
        return self._finish(job_id, "cancelled", "cancelled", {})


@lru_cache(maxsize=1)
def get_job_store() -> AnalysisJobStore:
    default = Path(__file__).resolve().parents[2] / "analysis_jobs.sqlite3"
    return AnalysisJobStore(os.environ.get("ANALYSIS_JOB_DB", str(default)))
