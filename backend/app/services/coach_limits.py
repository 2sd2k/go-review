"""Small, process-local cost guardrails for the unauthenticated coach prototype."""

import math
import threading
import time
from collections import OrderedDict, deque
from typing import Callable, Deque, Dict, Optional

from fastapi import HTTPException


class CoachLimiter:
    """Bound model requests without pretending an IP address is a user account."""

    def __init__(
        self,
        per_client_limit: int = 20,
        global_limit: int = 100,
        max_in_flight: int = 2,
        window_seconds: int = 3600,
        repeat_capacity: int = 256,
        clock: Optional[Callable[[], float]] = None,
    ):
        if min(per_client_limit, global_limit, max_in_flight, window_seconds, repeat_capacity) < 1:
            raise ValueError('Coach limits must be positive.')
        self.per_client_limit = per_client_limit
        self.global_limit = global_limit
        self.max_in_flight = max_in_flight
        self.window_seconds = window_seconds
        self.repeat_capacity = repeat_capacity
        self._clock = clock or time.monotonic
        self._lock = threading.Lock()
        self._clients: Dict[str, Deque[float]] = {}
        self._global: Deque[float] = deque()
        self._repeats: OrderedDict[bytes, float] = OrderedDict()
        self._in_flight = 0

    def acquire(self, client: str, fingerprint: bytes) -> bool:
        """Reserve one request; return whether an identical request was seen recently."""
        with self._lock:
            now = self._clock()
            cutoff = now - self.window_seconds
            while self._global and self._global[0] <= cutoff:
                self._global.popleft()
            for key, times in list(self._clients.items()):
                while times and times[0] <= cutoff:
                    times.popleft()
                if not times:
                    del self._clients[key]
            while self._repeats and next(iter(self._repeats.values())) <= cutoff:
                self._repeats.popitem(last=False)

            client_times = self._clients.get(client)
            if client_times and len(client_times) >= self.per_client_limit:
                self._reject('This client has reached the coach request limit.',
                             client_times[0] + self.window_seconds - now)
            if len(self._global) >= self.global_limit:
                self._reject('The coach has reached its current request limit.',
                             self._global[0] + self.window_seconds - now)
            if self._in_flight >= self.max_in_flight:
                self._reject('The coach is handling other questions. Try again shortly.', 1)

            repeated = fingerprint in self._repeats
            self._repeats.pop(fingerprint, None)
            self._repeats[fingerprint] = now
            if len(self._repeats) > self.repeat_capacity:
                self._repeats.popitem(last=False)
            self._clients.setdefault(client, deque()).append(now)
            self._global.append(now)
            self._in_flight += 1
            return repeated

    def release(self) -> None:
        with self._lock:
            if self._in_flight < 1:
                raise RuntimeError('Coach request released without a reservation.')
            self._in_flight -= 1

    @staticmethod
    def _reject(message: str, retry_seconds: float) -> None:
        raise HTTPException(429, message, headers={'Retry-After': str(max(1, math.ceil(retry_seconds)))})
