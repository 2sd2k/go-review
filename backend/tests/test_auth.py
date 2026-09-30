import io
import json
import os
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException, Request

from app.services.auth import authenticate_http, authenticate_token


class AuthTests(unittest.IsolatedAsyncioTestCase):
    async def test_local_mode_needs_no_token(self):
        with patch.dict(os.environ, {"SUPABASE_URL": "", "SUPABASE_PUBLISHABLE_KEY": "",
                                     "AUTH_REQUIRED": "0"}):
            self.assertIsNone(await authenticate_token(None))

    async def test_configured_mode_requires_verified_token(self):
        user_id = str(uuid4())
        response = io.BytesIO(json.dumps({"id": user_id}).encode())
        config = {"SUPABASE_URL": "https://project.supabase.co",
                  "SUPABASE_PUBLISHABLE_KEY": "public-key", "AUTH_REQUIRED": "1"}
        with patch.dict(os.environ, config), patch("app.services.auth.urlopen") as open_url:
            with self.assertRaises(HTTPException) as missing:
                await authenticate_token(None)
            self.assertEqual(missing.exception.status_code, 401)
            open_url.return_value.__enter__.return_value = response
            request = Request({"type": "http", "headers": [(b"authorization", b"Bearer a.b.c")]})
            self.assertEqual(await authenticate_http(request), user_id)
            sent = open_url.call_args.args[0]
            self.assertEqual(sent.full_url, "https://project.supabase.co/auth/v1/user")
            self.assertEqual(sent.get_header("Authorization"), "Bearer a.b.c")
            self.assertEqual(sent.get_header("Apikey"), "public-key")

    async def test_invalid_token_and_incomplete_config_fail_closed(self):
        with patch.dict(os.environ, {"SUPABASE_URL": "https://project.supabase.co",
                                     "SUPABASE_PUBLISHABLE_KEY": "", "AUTH_REQUIRED": "1"}):
            with self.assertRaises(HTTPException) as config:
                await authenticate_token("a.b.c")
            self.assertEqual(config.exception.status_code, 503)
        with patch.dict(os.environ, {"SUPABASE_URL": "https://project.supabase.co",
                                     "SUPABASE_PUBLISHABLE_KEY": "public-key"}):
            with self.assertRaises(HTTPException) as invalid:
                await authenticate_token("not-a-jwt")
            self.assertEqual(invalid.exception.status_code, 401)
