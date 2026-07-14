"""Security utilities for the data engine.

Provides:
- File validation (size, extension, MIME type)
- Rate limiting middleware
- Security headers middleware
"""
from __future__ import annotations

import os
import time
from collections import defaultdict, deque
from typing import Any, Deque, Dict, Optional

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware


# ---------------------------------------------------------------------------
# File validation
# ---------------------------------------------------------------------------

MAX_FILE_SIZE_MB = 200
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

ALLOWED_EXTENSIONS = {
    ".csv", ".tsv", ".psv", ".txt", ".xlsx", ".xls", ".ods",
    ".json", ".xml", ".html", ".htm",
    ".parquet", ".feather", ".arrow",
    ".orc", ".pkl", ".pickle",
    ".dta", ".sas7bdat", ".sav",
    ".h5", ".hdf5",
}

ALLOWED_MIME_TYPES = {
    "text/csv", "text/plain", "text/tab-separated-values",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/json", "application/xml", "text/xml",
    "text/html",
    "application/octet-stream",
    "application/vnd.apache.parquet", "application/parquet",
    "application/vnd.apache.arrow.file",
    "application/orc",
    "application/x-pickle",
    "application/x-stata", "application/x-sas",
    "application/x-spss-sav",
    "application/x-hdf5", "application/hdf5",
    "inode/x-empty",  # empty file edge case
}


class FileValidationError(Exception):
    """Raised when a file fails validation."""
    pass


def validate_file(filename: str, content: bytes, content_type: str = "") -> None:
    """Validate file size, extension, and MIME type.

    Raises FileValidationError with a descriptive message if validation fails.
    """
    # Check file size
    size_mb = len(content) / (1024 * 1024)
    if len(content) > MAX_FILE_SIZE_BYTES:
        raise FileValidationError(
            f"File size {size_mb:.1f} MB exceeds maximum allowed {MAX_FILE_SIZE_MB} MB."
        )

    if len(content) == 0:
        raise FileValidationError("File is empty.")

    # Check extension
    ext = os.path.splitext(filename.lower())[1]
    if ext not in ALLOWED_EXTENSIONS:
        raise FileValidationError(
            f"File type '{ext}' is not supported. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )

    # Check MIME type if provided (loose check — some clients send wrong types)
    if content_type and content_type not in ALLOWED_MIME_TYPES:
        # Don't reject outright — just warn via exception only for clearly wrong types
        if content_type.startswith("image/") or content_type.startswith("video/"):
            raise FileValidationError(
                f"File content type '{content_type}' is not a supported data format."
            )


# ---------------------------------------------------------------------------
# Rate limiting middleware
# ---------------------------------------------------------------------------

class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple in-memory rate limiter using sliding window.

    Limits requests per IP address within a configurable time window.
    """

    def __init__(self, app: Any, window_seconds: int = 60,
                 max_requests: int = 200,
                 excluded_paths: Optional[set] = None) -> None:
        super().__init__(app)
        self.window_seconds = window_seconds
        self.max_requests = max_requests
        self.excluded_paths = excluded_paths or {"/", "/health", "/docs", "/openapi.json", "/redoc"}
        self._requests: Dict[str, Deque[float]] = defaultdict(deque)

    def _get_client_ip(self, request: Request) -> str:
        # Use the direct connection IP to prevent spoofing via X-Forwarded-For.
        # In production behind a trusted proxy, configure the proxy to set this header
        # and enable trusted proxy handling — but never trust it blindly.
        return request.client.host if request.client else "unknown"

    async def dispatch(self, request: Request, call_next: Any) -> Response:
        path = request.url.path
        if path in self.excluded_paths:
            return await call_next(request)

        client_ip = self._get_client_ip(request)
        now = time.time()
        window_start = now - self.window_seconds

        # Clean old entries
        req_deque = self._requests[client_ip]
        while req_deque and req_deque[0] < window_start:
            req_deque.popleft()

        if len(req_deque) >= self.max_requests:
            return JSONResponse(
                status_code=429,
                content={
                    "detail": f"Rate limit exceeded: {self.max_requests} requests per "
                              f"{self.window_seconds}s. Please try again later."
                },
                headers={
                    "Retry-After": str(self.window_seconds),
                    "X-RateLimit-Limit": str(self.max_requests),
                    "X-RateLimit-Remaining": "0",
                }
            )

        req_deque.append(now)
        remaining = self.max_requests - len(req_deque)

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(self.max_requests)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response


# ---------------------------------------------------------------------------
# Security headers middleware
# ---------------------------------------------------------------------------

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses."""

    async def dispatch(self, request: Request, call_next: Any) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        return response
