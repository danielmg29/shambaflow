"""
ShambaFlow — Custom Middleware
Request logging and audit trail middleware
"""

import logging
import time
from urllib.parse import parse_qsl, urlencode
from django.http import HttpRequest, HttpResponse
from django.utils.deprecation import MiddlewareMixin

logger = logging.getLogger('shambaflow')
REDACTED_QUERY_KEYS = {"token", "access_token", "refresh", "refresh_token"}


def _safe_request_path(request: HttpRequest) -> str:
    query_items = []
    for key, value in parse_qsl(request.META.get("QUERY_STRING", ""), keep_blank_values=True):
        if key.lower() in REDACTED_QUERY_KEYS:
            query_items.append((key, "[redacted]"))
        else:
            query_items.append((key, value))

    if not query_items:
        return request.path
    return f"{request.path}?{urlencode(query_items, doseq=True)}"


class RequestLoggingMiddleware(MiddlewareMixin):
    """
    Logs all HTTP requests for debugging and audit purposes.
    Records request method, path, response status, and duration.
    """
    
    def process_request(self, request: HttpRequest) -> None:
        """Store start time when request begins."""
        request._start_time = time.time()
        safe_path = _safe_request_path(request)
        
        # Log incoming request
        logger.info(
            f"Request started: {request.method} {safe_path} "
            f"from {request.META.get('REMOTE_ADDR', 'unknown')} "
            f"User: {getattr(request.user, 'id', 'anonymous')}"
        )
    
    def process_response(self, request: HttpRequest, response: HttpResponse) -> HttpResponse:
        """Log response details when request completes."""
        if hasattr(request, '_start_time'):
            duration = time.time() - request._start_time
            safe_path = _safe_request_path(request)
            
            # Log completion
            logger.info(
                f"Request completed: {request.method} {safe_path} "
                f"Status: {response.status_code} "
                f"Duration: {duration:.3f}s "
                f"User: {getattr(request.user, 'id', 'anonymous')}"
            )
        
        return response
