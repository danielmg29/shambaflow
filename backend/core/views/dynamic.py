"""
ShambaFlow — Dynamic CRUD View Handler
Adaptive Convergence: Zero-Redundancy Principle (ZRP)

ONE set of endpoints handles ALL models.
No duplicate ViewSets. No repetitive serializer chains.
Model → Repository → Response. Three layers only.
"""

import json
import logging
from functools import lru_cache
from typing import Any, Dict

from django.http import JsonResponse
from django.apps import apps
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.core.exceptions import ValidationError, PermissionDenied
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from drf_spectacular.utils import extend_schema

from core.repositories import create_repository, get_repository
from core.schema.introspection import get_model_schema
from core.validation.validator import validate_data

logger = logging.getLogger('shambaflow')

# Models the dynamic endpoint will NOT serve
# (sensitive or logic-heavy models have dedicated views)
_PROTECTED_MODELS = {
    'User', 'Cooperative', 'Bid', 'Tender', 'Notification',
    'ReputationLedger', 'CapacityMetric',
    'LogEntry', 'Permission', 'Group', 'ContentType', 'Session',
}

# App label to search within
_APP_LABELS = ['core', 'apps.identity', 'apps.crm', 'apps.marketplace', 'apps.reputation']


def _resolve_model(model_name: str):
    """
    Resolve a model name to its class.
    Searches across all ShambaFlow app labels.
    Returns (model_class, None) or (None, error_response).
    """
    if model_name in _PROTECTED_MODELS:
        return None, JsonResponse(
            {'error': f"Model '{model_name}' requires a dedicated endpoint."},
            status=403
        )

    for app_label in _APP_LABELS:
        try:
            return apps.get_model(app_label, model_name), None
        except LookupError:
            continue

    # Try all apps as fallback
    for model in apps.get_models():
        if model.__name__.lower() == model_name.lower():
            return model, None

    return None, JsonResponse({'error': f"Model '{model_name}' not found."}, status=404)


def _parse_filters(request) -> Dict[str, Any]:
    """Extract filter params from query string, excluding pagination params."""
    reserved = {'page', 'page_size', 'order_by', 'format'}
    return {k: v for k, v in request.GET.items() if k not in reserved}


def _get_pagination(request) -> tuple:
    """Parse page and page_size from request."""
    try:
        page      = max(1, int(request.GET.get('page', 1)))
        page_size = min(200, max(1, int(request.GET.get('page_size', 50))))
    except (TypeError, ValueError):
        page, page_size = 1, 50
    return page, page_size


# ══════════════════════════════════════════════════════════════════
#  COLLECTION ENDPOINT  /api/{model_name}
# ══════════════════════════════════════════════════════════════════

@extend_schema(tags=['schema'], summary='Dynamic list / create for any model')
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def dynamic_crud_handler(request: Request, model_name: str):
    """
    GET  /api/{model_name}          → Paginated list with optional filters
    POST /api/{model_name}          → Create a new instance

    Query params (GET):
      ?page=1&page_size=50          Pagination
      ?field_name=value             Filter by any field
      ?order_by=-created_at         Ordering (prefix - for DESC)
    """
    model_class, err = _resolve_model(model_name)
    if err:
        return err

    repo = create_repository(model_class)

    # ── GET: list ──────────────────────────────────────────────
    if request.method == 'GET':
        filters   = _parse_filters(request)
        order_by  = request.GET.get('order_by', '-created_at')
        page, page_size = _get_pagination(request)

        try:
            result = repo['get_all'](
                filters=filters or None,
                order_by=[order_by] if order_by else None,
                page=page,
                page_size=page_size,
            )
            return JsonResponse(result, safe=False)

        except Exception as e:
            logger.exception('Dynamic GET failed | model=%s | filters=%s', model_name, filters)
            return JsonResponse({'error': 'Failed to retrieve data.', 'detail': str(e)}, status=500)

    # ── POST: create ───────────────────────────────────────────
    if request.method == 'POST':
        try:
            data = json.loads(request.body) if request.body else {}
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON body.'}, status=400)

        # Schema-driven validation
        is_valid, errors = validate_data(model_class, data)
        if not is_valid:
            return JsonResponse({'error': 'Validation failed.', 'errors': errors}, status=400)

        try:
            instance = repo['create'](data)
            return JsonResponse({'id': str(instance.pk), 'created': True}, status=201)

        except ValidationError as e:
            return JsonResponse({'error': 'Validation failed.', 'errors': e.message_dict}, status=400)
        except Exception as e:
            logger.exception('Dynamic POST failed | model=%s', model_name)
            return JsonResponse({'error': 'Failed to create record.', 'detail': str(e)}, status=500)


# ══════════════════════════════════════════════════════════════════
#  DETAIL ENDPOINT  /api/{model_name}/{pk}
# ══════════════════════════════════════════════════════════════════

@extend_schema(tags=['schema'], summary='Dynamic retrieve / update / delete for any model instance')
@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def dynamic_detail_handler(request: Request, model_name: str, pk: str):
    """
    GET    /api/{model_name}/{pk}   → Retrieve one instance
    PUT    /api/{model_name}/{pk}   → Full update
    PATCH  /api/{model_name}/{pk}   → Partial update
    DELETE /api/{model_name}/{pk}   → Delete
    """
    model_class, err = _resolve_model(model_name)
    if err:
        return err

    repo = create_repository(model_class)

    # ── GET: retrieve ──────────────────────────────────────────
    if request.method == 'GET':
        instance = repo['get_by_id'](pk)
        if not instance:
            return JsonResponse({'error': 'Not found.'}, status=404)

        # Serialize: exclude private/internal fields
        data = {
            k: v for k, v in instance.__dict__.items()
            if not k.startswith('_')
        }
        return JsonResponse(data)

    # ── PUT / PATCH: update ────────────────────────────────────
    if request.method in ('PUT', 'PATCH'):
        try:
            data = json.loads(request.body) if request.body else {}
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON body.'}, status=400)

        if request.method == 'PUT':
            # Full update — validate entire payload
            is_valid, errors = validate_data(model_class, data)
            if not is_valid:
                return JsonResponse({'error': 'Validation failed.', 'errors': errors}, status=400)
            instance = repo['update'](pk, data)
        else:
            # Partial update — skip full validation
            instance = repo['partial_update'](pk, data)

        if not instance:
            return JsonResponse({'error': 'Not found.'}, status=404)

        return JsonResponse({'id': str(instance.pk), 'updated': True})

    # ── DELETE ─────────────────────────────────────────────────
    if request.method == 'DELETE':
        success = repo['delete'](pk)
        if not success:
            return JsonResponse({'error': 'Not found.'}, status=404)
        return JsonResponse({'deleted': True}, status=200)
