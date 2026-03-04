"""
ShambaFlow — Schema-Driven Validator
Validates incoming data against Django model field definitions.
Used by the dynamic CRUD handler to enforce data integrity.
"""

from typing import Dict, Any, List, Tuple, Type
from django.db.models import Model
from django.core.exceptions import ValidationError


def validate_data(
    model_class: Type[Model],
    data: Dict[str, Any],
) -> Tuple[bool, List[Dict[str, str]]]:
    """
    Validate data against model field definitions.
    Returns (is_valid, errors_list).

    errors_list: [{"field": "name", "message": "This field is required."}]
    """
    errors: List[Dict[str, str]] = []

    # Get concrete fields (skip relations and reverse accessors)
    concrete_fields = {
        f.name: f for f in model_class._meta.get_fields()
        if hasattr(f, 'column')
    }

    for field_name, value in data.items():
        field = concrete_fields.get(field_name)
        if not field:
            continue   # Unknown field — let model.full_clean() catch it

        # ── Required check ────────────────────────────────────
        if not getattr(field, 'blank', True) and not getattr(field, 'null', True):
            if value is None or value == '':
                errors.append({
                    'field':   field_name,
                    'message': f'{getattr(field, "verbose_name", field_name)} is required.',
                })
                continue

        # ── Max length check ──────────────────────────────────
        if hasattr(field, 'max_length') and field.max_length and value:
            if len(str(value)) > field.max_length:
                errors.append({
                    'field':   field_name,
                    'message': (
                        f'{getattr(field, "verbose_name", field_name)} '
                        f'must not exceed {field.max_length} characters.'
                    ),
                })

    # ── Model-level full_clean ─────────────────────────────────
    instance = model_class()
    for k, v in data.items():
        if hasattr(instance, k):
            setattr(instance, k, v)

    try:
        instance.full_clean(
            exclude=[
                f.name for f in model_class._meta.get_fields()
                if hasattr(f, 'column') and f.name not in data
            ]
        )
    except ValidationError as e:
        for field, messages in e.message_dict.items():
            for msg in messages:
                errors.append({'field': field, 'message': msg})

    return len(errors) == 0, errors