import unittest

from fastapi import HTTPException

from app.services.coach_limits import CoachLimiter


class CoachLimiterTests(unittest.TestCase):
    def setUp(self):
        self.now = [100.0]
        self.limiter = CoachLimiter(per_client_limit=2, global_limit=3,
                                   max_in_flight=1, window_seconds=60,
                                   repeat_capacity=2, clock=lambda: self.now[0])

    def test_per_client_limit_and_window_reset(self):
        self.assertFalse(self.limiter.acquire('client-a', b'first'))
        self.limiter.release()
        self.assertTrue(self.limiter.acquire('client-a', b'first'))
        self.limiter.release()
        with self.assertRaises(HTTPException) as error:
            self.limiter.acquire('client-a', b'other')
        self.assertEqual(error.exception.status_code, 429)
        self.assertEqual(error.exception.headers['Retry-After'], '60')
        self.now[0] += 60
        self.assertFalse(self.limiter.acquire('client-a', b'other'))
        self.limiter.release()

    def test_global_limit_and_concurrency_do_not_consume_rejected_requests(self):
        self.limiter.acquire('a', b'one')
        with self.assertRaises(HTTPException) as busy:
            self.limiter.acquire('b', b'two')
        self.assertEqual(busy.exception.headers['Retry-After'], '1')
        self.limiter.release()
        self.limiter.acquire('b', b'two')
        self.limiter.release()
        self.limiter.acquire('c', b'three')
        self.limiter.release()
        with self.assertRaises(HTTPException) as full:
            self.limiter.acquire('d', b'four')
        self.assertEqual(full.exception.status_code, 429)
        self.assertIn('current request limit', full.exception.detail)

    def test_repeat_meter_is_bounded_without_storing_prompts(self):
        for fingerprint in (b'a', b'b', b'c'):
            self.limiter.acquire(fingerprint.decode(), fingerprint)
            self.limiter.release()
        self.assertEqual(list(self.limiter._repeats), [b'b', b'c'])
        self.assertLessEqual(len(self.limiter._clients), self.limiter.global_limit)
