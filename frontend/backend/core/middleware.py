"""
ShambaFlow — Custom Middleware
Request logging and audit trail middleware
"""

import logging
import time
from typing import Callable
from django.http import HttpRequest, HttpResponse
from django.utils.deprecation import MiddlewareMixin

logger = logging.getLogger('shambaflow')


class RequestLoggingMiddleware(MiddlewareMixin):
    """
    Logs all HTTP requests for debugging and audit purposes.
    Records request method, path, response status, and duration.
    """
    
    def process_request(self, request: HttpRequest) -> None:
        """Store start time when request begins."""
        request._start_time = time.time()
        
        # Log incoming request
        logger.info(
            f"Request started: {request.method} {request.get_full_path()} "
            f"from {request.META.get('REMOTE_ADDR', 'unknown')} "
            f"User: {getattr(request.user, 'id', 'anonymous')}"
        )
    
    def process_response(self, request: HttpRequest, response: HttpResponse) -> HttpResponse:
        """Log response details when request completes."""
        if hasattr(request, '_start_time'):
            duration = time.time() - request._start_time
            
            # Log completion
            logger.info(
                f"Request completed: {request.method} {request.get_full_path()} "
                f"Status: {response.status_code} "
                f"Duration: {duration:.3f}s "
                f"User: {getattr(request.user, 'id', 'anonymous')}"
            )
        
        return response
