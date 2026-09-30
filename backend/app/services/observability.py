"""Bounded, privacy-conscious API counters and structured request logs."""

from __future__ import annotations

import json
import logging
import threading
import time
from collections import defaultdict
from uuid import uuid4

from fastapi import Request
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)


class RequestMetrics:
    def __init__(self):
        self._lock = threading.Lock()
        self._requests = defaultdict(int)
        self._duration_ms = defaultdict(int)

    def record(self, method: str, route: str, status: int, elapsed_ms: int) -> None:
        # Route templates, not raw paths, keep cardinality bounded and avoid
        # persisting user-controlled URLs or job identifiers.
        key = (method, route, status)
        with self._lock:
            self._requests[key] += 1
            self._duration_ms[key] += elapsed_ms

    def snapshot(self) -> list[dict]:
        with self._lock:
            return [{"method": method, "route": route, "status": status,
                     "count": count, "total_ms": self._duration_ms[(method, route, status)]}
                    for (method, route, status), count in sorted(self._requests.items())]


request_metrics = RequestMetrics()


async def observe_http(request: Request, call_next):
    request_id = uuid4().hex
    started = time.monotonic()
    try:
        response = await call_next(request)
    except Exception:
        elapsed_ms = round((time.monotonic() - started) * 1000)
        logger.exception("api_error %s", json.dumps({"request_id": request_id,
                         "method": request.method, "elapsed_ms": elapsed_ms}))
        response = JSONResponse({"detail": "Internal server error", "request_id": request_id}, status_code=500)
    elapsed_ms = round((time.monotonic() - started) * 1000)
    route = getattr(request.scope.get("route"), "path", "unmatched")
    request_metrics.record(request.method, route, response.status_code, elapsed_ms)
    logger.info("api_request %s", json.dumps({"request_id": request_id,
                "method": request.method, "route": route,
                "status": response.status_code, "elapsed_ms": elapsed_ms}, separators=(",", ":")))
    response.headers["X-Request-ID"] = request_id
    return response
