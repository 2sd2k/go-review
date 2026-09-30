import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException, Request
from starlette.responses import JSONResponse

from app.main import metrics, ready
from app.services.observability import observe_http, request_metrics


class ObservabilityTests(unittest.IsolatedAsyncioTestCase):
    async def test_request_log_and_metrics_use_route_not_raw_path(self):
        request = Request({"type": "http", "method": "GET",
                           "path": "/api/analysis/jobs/private-id", "headers": []})

        async def answer(_request):
            request.scope["route"] = type("Route", (), {"path": "/api/analysis/jobs/{job_id}"})()
            return JSONResponse({"ok": True})

        with patch("app.services.observability.logger.info") as log:
            response = await observe_http(request, answer)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.headers["X-Request-ID"]), 32)
        self.assertNotIn("private-id", log.call_args.args[1])
        self.assertTrue(any(item["route"] == "/api/analysis/jobs/{job_id}"
                            for item in request_metrics.snapshot()))

    async def test_readiness_requires_database_and_worker(self):
        with patch("app.main.get_job_store") as store, \
                patch("app.main.auth_configuration_ready", return_value=True):
            store.return_value.ping.return_value = True
            store.return_value.worker_alive.return_value = False
            with self.assertRaises(HTTPException) as offline:
                await ready()
            self.assertEqual(offline.exception.status_code, 503)
            store.return_value.worker_alive.return_value = True
            self.assertEqual((await ready())["status"], "ready")

    async def test_metrics_need_server_side_token(self):
        request = Request({"type": "http", "method": "GET", "headers": []})
        with patch.dict(os.environ, {"METRICS_TOKEN": ""}):
            with self.assertRaises(HTTPException) as disabled:
                await metrics(request)
            self.assertEqual(disabled.exception.status_code, 404)
        with patch.dict(os.environ, {"METRICS_TOKEN": "secret"}):
            with self.assertRaises(HTTPException) as denied:
                await metrics(request)
            self.assertEqual(denied.exception.status_code, 403)
            authorized = Request({"type": "http", "method": "GET",
                                  "headers": [(b"x-metrics-token", b"secret")]})
            self.assertIn("requests", await metrics(authorized))
