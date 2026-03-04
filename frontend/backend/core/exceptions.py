"""
ShambaFlow — Custom Exception Handler
Standardizes API error responses across all endpoints
"""

import logging
from typing import Any, Dict
from rest_framework.views import exception_handler
from rest_framework.response import Response
from rest_framework import status
from django.http import Http404
from django.core.exceptions import PermissionDenied, ValidationError

logger = logging.getLogger('shambaflow')


def custom_exception_handler(exc: Exception, context: Dict[str, Any]) -> Response:
    """
    Custom exception handler for DRF that returns consistent error format.
    Handles common exceptions and provides structured error responses.
    """
    # Call DRF's default exception handler first
    response = exception_handler(exc, context)
    
    # If DRF couldn't handle it, create our own response
    if response is None:
        if isinstance(exc, Http404):
            response = Response(
                {'error': 'Resource not found.', 'detail': str(exc)},
                status=status.HTTP_404_NOT_FOUND
            )
        elif isinstance(exc, PermissionDenied):
            response = Response(
                {'error': 'Permission denied.', 'detail': str(exc)},
                status=status.HTTP_403_FORBIDDEN
            )
        elif isinstance(exc, ValidationError):
            response = Response(
                {'error': 'Validation failed.', 'detail': str(exc)},
                status=status.HTTP_400_BAD_REQUEST
            )
        else:
            # Log unexpected errors
            logger.exception(f"Unhandled exception: {exc}")
            response = Response(
                {'error': 'Internal server error.', 'detail': 'An unexpected error occurred.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
    
    # Ensure consistent error format
    if response is not None:
        custom_response_data = {
            'error': response.data.get('error', 'Error occurred'),
            'status_code': response.status_code,
        }
        
        # Include detail if available
        if 'detail' in response.data:
            custom_response_data['detail'] = response.data['detail']
        
        # Include field errors for validation errors
        if hasattr(response.data, 'items'):
            for key, value in response.data.items():
                if key != 'detail' and key != 'error':
                    custom_response_data[key] = value
        
        response.data = custom_response_data
    
    return response
