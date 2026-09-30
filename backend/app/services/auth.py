"""Verify Supabase access tokens with the project's Auth service.

The browser's session data is never trusted as an identity by itself. The
project's /auth/v1/user endpoint verifies the token and returns its user ID.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from uuid import UUID

from fastapi import HTTPException, Request as FastAPIRequest


def auth_enabled() -> bool:
    return bool(os.getenv("SUPABASE_URL") or os.getenv("SUPABASE_PUBLISHABLE_KEY")
                or os.getenv("AUTH_REQUIRED") == "1")


def _project_config() -> tuple[str, str]:
    base_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    publishable_key = os.getenv("SUPABASE_PUBLISHABLE_KEY", "")
    parsed = urlsplit(base_url)
    if not (base_url and publishable_key and parsed.scheme == "https" and parsed.hostname
            and parsed.path in ("", "/") and not parsed.username and not parsed.password
            and not parsed.query and not parsed.fragment):
        raise HTTPException(503, "Sign-in is not configured correctly on the backend.")
    return base_url, publishable_key


def auth_configuration_ready() -> bool:
    if not auth_enabled():
        return True
    try:
        _project_config()
    except HTTPException:
        return False
    return True


def _verify_token(token: str) -> str:
    if len(token) > 8192 or not re.fullmatch(r"[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){2}", token):
        raise HTTPException(401, "Invalid access token.", headers={"WWW-Authenticate": "Bearer"})
    base_url, publishable_key = _project_config()
    request = Request(
        f"{base_url}/auth/v1/user",
        headers={"apikey": publishable_key, "Authorization": f"Bearer {token}"},
    )
    try:
        with urlopen(request, timeout=10) as response:
            raw = response.read(65_537)
        if len(raw) > 65_536:
            raise ValueError("oversized user response")
        user = json.loads(raw)
        user_id = str(UUID(user["id"]))
        if user_id != user["id"]:
            raise ValueError("non-canonical user ID")
        return user_id
    except HTTPError as error:
        if error.code in (401, 403):
            raise HTTPException(401, "Sign in again to continue.",
                                headers={"WWW-Authenticate": "Bearer"}) from error
        raise HTTPException(503, "Sign-in verification is temporarily unavailable.") from error
    except URLError as error:
        raise HTTPException(503, "Sign-in verification is temporarily unavailable.") from error
    except (ValueError, KeyError, TypeError, UnicodeDecodeError) as error:
        raise HTTPException(503, "Sign-in verification returned an invalid response.") from error


async def authenticate_token(token: str | None) -> str | None:
    if not auth_enabled():
        return None
    if not token:
        raise HTTPException(401, "Sign in to continue.", headers={"WWW-Authenticate": "Bearer"})
    return await asyncio.to_thread(_verify_token, token)


async def authenticate_http(request: FastAPIRequest) -> str | None:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    return await authenticate_token(token if scheme.lower() == "bearer" else None)
