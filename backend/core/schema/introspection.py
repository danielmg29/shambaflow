"""
ShambaFlow — Schema Introspection API
Adaptive Convergence: Schema-Driven Development (SDD)

The backend defines data structures ONCE.
The frontend fetches this schema and auto-generates forms, tables, and filters.
Zero manual synchronisation between backend and frontend field definitions.
"""

import logging
from typing import Dict, Any, List, Type, Optional
from functools import lru_cache
from django.apps import apps
from django.db.models import Model
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.views.decorators.cache import cache_page
from django.core.cache import cache
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from drf_spectacular.utils import extend_schema

logger = logging.getLogger('shambaflow')

# Models excluded from public schema endpoint
# (internal Django models that the frontend doesn't need to know about)
_EXCLUDED_MODELS = {
    'LogEntry', 'Permission', 'Group', 'ContentType',
    'Session', 'OutstandingToken', 'BlacklistedToken',
}

# Map Django internal field types to frontend-friendly type names
_FIELD_TYPE_MAP = {
    'CharField':           'string',
    'TextField':           'text',
    'CKEditor5Field':      'richtext',
    'IntegerField':        'integer',
    'BigIntegerField':     'integer',
    'PositiveIntegerField': 'integer',
    'PositiveSmallIntegerField': 'integer',
    'SmallIntegerField':   'integer',
    'DecimalField':        'decimal',
    'FloatField':          'float',
    'BooleanField':        'boolean',
    'NullBooleanField':    'boolean',
    'DateField':           'date',
    'DateTimeField':       'datetime',
    'TimeField':           'time',
    'EmailField':          'email',
    'URLField':            'url',
    'UUIDField':           'uuid',
    'JSONField':           'json',
    'FileField':           'file',
    'ImageField':          'image',
    'SlugField':           'slug',
    'ForeignKey':          'relation',
    'OneToOneField':       'relation',
    'ManyToManyField':     'relation_many',
}


def get_field_info(field) -> Optional[Dict[str, Any]]:
    """
    Extract structured schema info from a single Django model field.
    Returns None for fields that should not be exposed to the frontend.
    """
    # Skip reverse relations and auto-created fields
    if not hasattr(field, 'column') and not field.is_relation:
        return None

    field_type_name = type(field).__name__
    frontend_type   = _FIELD_TYPE_MAP.get(field_type_name, 'string')

    info: Dict[str, Any] = {
        'name':        field.name,
        'type':        frontend_type,
        'django_type': field_type_name,
        'required':    not getattr(field, 'blank', True) and not getattr(field, 'null', True),
        'null':        getattr(field, 'null', False),
        'blank':       getattr(field, 'blank', True),
        'editable':    getattr(field, 'editable', True),
        'primary_key': getattr(field, 'primary_key', False),
        'unique':      getattr(field, 'unique', False),
        'help_text':   str(field.help_text) if field.help_text else '',
        'verbose_name': str(field.verbose_name) if hasattr(field, 'verbose_name') else field.name,
    }

    # ── String fields ──────────────────────────────────────────
    if hasattr(field, 'max_length') and field.max_length:
        info['max_length'] = field.max_length

    # ── Choices / enums ────────────────────────────────────────
    if hasattr(field, 'choices') and field.choices:
        info['choices'] = [
            {'value': choice[0], 'label': str(choice[1])}
            for choice in field.choices
        ]

    # ── Numeric bounds ─────────────────────────────────────────
    if hasattr(field, 'max_digits'):
        info['max_digits'] = field.max_digits
    if hasattr(field, 'decimal_places'):
        info['decimal_places'] = field.decimal_places

    # ── Default value ─────────────────────────────────────────
    if hasattr(field, 'default') and field.default is not field.__class__.default:
        try:
            default = field.default() if callable(field.default) else field.default
            info['default'] = str(default) if default is not None else None
        except Exception:
            info['default'] = None

    # ── Relation fields ────────────────────────────────────────
    if field.is_relation:
        info['related_model'] = field.related_model.__name__ if field.related_model else None
        info['related_app']   = (
            field.related_model._meta.app_label if field.related_model else None
        )
        info['many'] = field.many_to_many or getattr(field, 'one_to_many', False)

    return info


def get_model_schema(model_class: Type[Model]) -> Dict[str, Any]:
    """
    Extract the complete schema for one Django model.
    Called by the schema introspection API endpoint.
    """
    fields_schema: List[Dict[str, Any]] = []

    for field in model_class._meta.get_fields():
        # Skip reverse accessors (e.g., member_set on Cooperative)
        if hasattr(field, 'field') and not field.concrete:
            continue

        field_info = get_field_info(field)
        if field_info:
            fields_schema.append(field_info)

    return {
        'model_name':           model_class.__name__,
        'app_label':            model_class._meta.app_label,
        'table_name':           model_class._meta.db_table,
        'verbose_name':         str(model_class._meta.verbose_name),
        'verbose_name_plural':  str(model_class._meta.verbose_name_plural),
        'ordering':             list(model_class._meta.ordering or []),
        'fields':               fields_schema,
        'field_count':          len(fields_schema),
    }


@lru_cache(maxsize=128)
def _get_cached_model_schema(app_label: str, model_name: str) -> Dict[str, Any]:
    """LRU-cached schema extraction. Cache lives for process lifetime."""
    model_class = apps.get_model(app_label, model_name)
    return get_model_schema(model_class)


# ── API VIEWS ──────────────────────────────────────────────────────

@extend_schema(tags=['schema'], summary='Get schema for a single model')
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_schema_view(request, model_name: str):
    """
    GET /api/schema/{model_name}

    Returns the full field schema for the named model.
    The Next.js frontend uses this to auto-generate forms and tables.
    Results are Redis-cached for 24h.
    """
    cache_key = f'schema:model:{model_name}'
    cached    = cache.get(cache_key)
    if cached:
        return JsonResponse(cached)

    # Search across all installed apps
    found_model = None
    for model in apps.get_models():
        if model.__name__.lower() == model_name.lower():
            found_model = model
            break

    if not found_model:
        return JsonResponse({'error': f"Model '{model_name}' not found."}, status=404)

    schema = get_model_schema(found_model)
    cache.set(cache_key, schema, timeout=86400)   # 24h
    return JsonResponse(schema)


@extend_schema(tags=['schema'], summary='Get schema for all ShambaFlow models')
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_all_schemas_view(request):
    """
    GET /api/schema/all

    Returns schemas for all non-excluded models.
    Used by the frontend to build its dynamic routing and component registry.
    """
    cache_key = 'schema:all'
    cached    = cache.get(cache_key)
    if cached:
        return JsonResponse(cached)

    schemas: Dict[str, Any] = {}
    for model in apps.get_models():
        if model.__name__ in _EXCLUDED_MODELS or model._meta.abstract:
            continue
        if model._meta.app_label in ('admin', 'auth', 'contenttypes', 'sessions'):
            continue
        schemas[model.__name__] = get_model_schema(model)

    result = {
        'schema_count': len(schemas),
        'schemas':      schemas,
    }
    cache.set(cache_key, result, timeout=86400)
    return JsonResponse(result)


@extend_schema(tags=['schema'], summary='Get validation rules for a model')
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_validation_rules_view(request, model_name: str):
    """
    GET /api/schema/{model_name}/validation

    Returns lightweight field validation rules.
    The Next.js useValidation hook consumes this for client-side validation.
    """
    found_model = None
    for model in apps.get_models():
        if model.__name__.lower() == model_name.lower():
            found_model = model
            break

    if not found_model:
        return JsonResponse({'error': f"Model '{model_name}' not found."}, status=404)

    rules: Dict[str, Any] = {}
    for field in found_model._meta.get_fields():
        if not hasattr(field, 'column'):
            continue

        field_rules: Dict[str, Any] = {
            'required': not getattr(field, 'blank', True) and not getattr(field, 'null', True),
            'type':     _FIELD_TYPE_MAP.get(type(field).__name__, 'string'),
        }

        if hasattr(field, 'max_length') and field.max_length:
            field_rules['maxLength'] = field.max_length

        if hasattr(field, 'validators'):
            for validator in field.validators:
                if hasattr(validator, 'limit_value'):
                    if 'min' not in field_rules:
                        field_rules['min'] = validator.limit_value
                    else:
                        field_rules['max'] = validator.limit_value
                if hasattr(validator, 'regex'):
                    field_rules['pattern'] = validator.regex.pattern

        if hasattr(field, 'choices') and field.choices:
            field_rules['choices'] = [c[0] for c in field.choices]

        rules[field.name] = field_rules

    return JsonResponse({'model': model_name, 'rules': rules})