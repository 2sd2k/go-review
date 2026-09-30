import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException

from app.services.shared_quotas import SharedCoachQuota


class SharedQuotaTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "quotas.sqlite3"
        self.now = [1000.0]

    def quota(self):
        return SharedCoachQuota(self.path, per_user_hour=2, global_hour=3,
                                max_in_flight=1, window_seconds=60,
                                lease_seconds=20,
                                clock=lambda: self.now[0])

    def test_limits_are_shared_across_instances_and_reset_after_window(self):
        first, second = self.quota(), self.quota()
        lease = first.acquire("user-a")
        with self.assertRaises(HTTPException) as busy:
            second.acquire("user-b")
        self.assertEqual(busy.exception.headers["Retry-After"], "1")
        first.release(lease)
        second.release(second.acquire("user-a"))
        with self.assertRaises(HTTPException) as per_user:
            first.acquire("user-a")
        self.assertEqual(per_user.exception.status_code, 429)
        second.release(second.acquire("user-b"))
        with self.assertRaises(HTTPException) as global_limit:
            first.acquire("user-c")
        self.assertIn("current request limit", global_limit.exception.detail)
        self.now[0] += 60
        first.release(first.acquire("user-a"))

    def test_crashed_lease_expires_without_erasing_hourly_usage(self):
        first, second = self.quota(), self.quota()
        first.acquire("user-a")
        self.now[0] += 21
        second.release(second.acquire("user-b"))
        first.release(first.acquire("user-a"))
        with self.assertRaises(HTTPException):
            first.acquire("user-a")
