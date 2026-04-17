"""
ShambaFlow – Form Submission Pipeline  (v2 — custom-field aware)
=================================================================
Converts a validated FormTemplate submission into a real DB row
in the target model, then writes a FormSubmission audit record.

Flow:
  1. raw payload  {field_key: submitted_value}
  2. Validate template is ACTIVE and belongs to this cooperative
  3. Split FormFields into:
       real   → maps_to_model_field is an existing model column
       custom → maps_to_model_field is a snake_case key stored in extra_data
  4. Type-coerce each real field value to match the Django field type
  5. Lightly coerce each custom value for JSON storage
  6. Merge field_defaults + inject system fields (cooperative, recorded_by…)
  7. If custom values exist and the model has extra_data, set kwargs["extra_data"]
  8. Create and save the target model instance
  9. Write FormSubmission as an immutable audit record
 10. Return (target_instance, form_submission)

No payment logic.  Real data in real tables.
extra_data is part of the model row — not a separate EAV store.
"""

import json
import logging
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from django.apps import apps
from django.db import transaction
from django.utils import timezone

from core.models import FormTemplate, FormField, FormSubmission
from core.services.form_semantic import FORM_BUILDER_TARGET_MODELS
from core.services.field_registry import lock_fields_for_template

logger = logging.getLogger(__name__)

_AUTO_FIELD_SENTINEL = "__auto__"
_UNRESOLVED = object()


# ══════════════════════════════════════════════════════════════════
#  MODEL RESOLUTION
# ══════════════════════════════════════════════════════════════════

def _get_target_model(model_name: str):
    """
    Resolve a model class from the core app.
    Falls back to a cross-app scan so this works even if core is refactored.
    """
    try:
        return apps.get_model("core", model_name)
    except LookupError:
        pass
    for m in apps.get_models():
        if m.__name__ == model_name:
            return m
    return None


# ══════════════════════════════════════════════════════════════════
#  TYPE COERCION — real model columns
# ══════════════════════════════════════════════════════════════════

def _coerce_value(value: Any, field) -> Any:
    """
    Convert a raw submitted value to the correct Python type for a Django model field.
    Raises ValueError with a human-readable message on failure.
    """
    if value is None or value == "":
        return None

    ft = field.get_internal_type() if hasattr(field, "get_internal_type") else ""

    if ft in ("IntegerField", "PositiveIntegerField", "PositiveSmallIntegerField",
              "SmallIntegerField", "BigIntegerField"):
        try:
            return int(float(str(value)))
        except (ValueError, TypeError):
            raise ValueError(f'"{field.name}" expects a whole number, got: {value!r}')

    if ft in ("DecimalField", "FloatField"):
        try:
            return Decimal(str(value))
        except InvalidOperation:
            raise ValueError(f'"{field.name}" expects a decimal number, got: {value!r}')

    if ft in ("BooleanField", "NullBooleanField"):
        if isinstance(value, bool):
            return value
        return str(value).lower() in ("true", "1", "yes", "on")

    if ft == "DateField":
        if isinstance(value, date):
            return value
        try:
            return date.fromisoformat(str(value)[:10])
        except (ValueError, TypeError):
            raise ValueError(f'"{field.name}" expects YYYY-MM-DD, got: {value!r}')

    if ft == "DateTimeField":
        if isinstance(value, datetime):
            return value
        try:
            return datetime.fromisoformat(str(value))
        except (ValueError, TypeError):
            raise ValueError(f'"{field.name}" expects ISO datetime, got: {value!r}')

    if ft == "JSONField":
        if isinstance(value, (list, dict)):
            return value
        try:
            return json.loads(str(value))
        except json.JSONDecodeError:
            raise ValueError(f'"{field.name}" expects JSON, got: {value!r}')

    if ft in ("FileField", "ImageField"):
        return value  # caller passes InMemoryUploadedFile directly

    return str(value)


# ══════════════════════════════════════════════════════════════════
#  TYPE COERCION — custom fields stored in extra_data
# ══════════════════════════════════════════════════════════════════

def _coerce_custom_value(value: Any, display_type: str) -> Any:
    """
    Light coercion for custom field values stored in extra_data (JSONB).

    We apply best-effort type coercion so the stored value has the right
    Python type. We never raise — invalid input falls back to a string.
    """
    if value is None or value == "":
        return None

    if display_type == "number":
        try:
            return int(float(str(value)))
        except (ValueError, TypeError):
            return str(value)

    if display_type == "decimal":
        try:
            return float(Decimal(str(value)))
        except (InvalidOperation, ValueError, TypeError):
            return str(value)

    if display_type == "boolean":
        if isinstance(value, bool):
            return value
        return str(value).lower() in ("true", "1", "yes", "on")

    if display_type in ("dropdown", "multi_select"):
        if isinstance(value, list):
            return value
        try:
            return json.loads(str(value))
        except (json.JSONDecodeError, TypeError):
            return str(value)

    if display_type == "gps":
        if isinstance(value, dict):
            return value
        try:
            return json.loads(str(value))
        except (json.JSONDecodeError, TypeError):
            return str(value)

    # text, textarea, date, datetime, file → store as string
    return str(value)


# ══════════════════════════════════════════════════════════════════
#  PAYLOAD → MODEL KWARGS
# ══════════════════════════════════════════════════════════════════

def _build_model_kwargs(
    template: FormTemplate,
    raw_payload: dict,
    submitting_user,
    cooperative,
) -> dict:
    """
    Map raw form payload to model-ready kwargs.

    Real fields  (is_custom_field=False):
      • Value is type-coerced against the Django model field.
      • Written directly as a model column.

    Custom fields (is_custom_field=True):
      • Value is lightly coerced for JSON compatibility.
      • Collected into extra_data_payload, then merged into
        kwargs["extra_data"] if the target model has that column.
      • If the model has no extra_data column, the value is silently
        skipped with a warning log (prevents crashes on older migrations).

    Raises ValueError with a human-readable message on any validation failure.
    """
    model_name = FORM_BUILDER_TARGET_MODELS.get(template.target_model)
    if not model_name:
        raise ValueError(f"Unknown target model: {template.target_model}")

    target_class = _get_target_model(model_name)
    if target_class is None:
        raise ValueError(
            f"Cannot resolve model class for '{template.target_model}'. "
            "Ensure the migration has been applied."
        )

    # Does this model support extra_data (migration applied)?
    try:
        target_class._meta.get_field("extra_data")
        has_extra_data = True
    except Exception:
        has_extra_data = False

    kwargs: dict[str, Any] = {}
    extra_data_payload: dict[str, Any] = {}
    errors: list[str] = []

    for ff in template.fields.all():
        key = ff.maps_to_model_field
        raw_value = raw_payload.get(key)

        # Required check
        if ff.is_required and (raw_value is None or raw_value == ""):
            errors.append(f'"{ff.label}" is required.')
            continue

        if raw_value is None or raw_value == "":
            continue

        if ff.is_custom_field:
            # ── Custom field: route to extra_data ────────────────────────
            if has_extra_data:
                extra_data_payload[key] = _coerce_custom_value(
                    raw_value, ff.display_type
                )
            else:
                logger.warning(
                    "Custom field '%s' submitted but %s has no extra_data column. "
                    "Run: python manage.py migrate",
                    key, target_class.__name__,
                )
        else:
            # ── Real field: route to model column ─────────────────────────
            try:
                model_field = target_class._meta.get_field(key)
                kwargs[key] = _coerce_value(raw_value, model_field)
            except Exception as exc:
                errors.append(str(exc))

    if errors:
        raise ValueError("Validation errors: " + "; ".join(errors))

    _merge_template_defaults(kwargs, template.field_defaults or {}, submitting_user, cooperative)

    # Inject system-managed fields (probe the model, never hard-code)
    for fname, fvalue in [
        ("cooperative",  cooperative),
        ("recorded_by",  submitting_user),
        ("added_by",     submitting_user),
    ]:
        try:
            target_class._meta.get_field(fname)
            kwargs.setdefault(fname, fvalue)
        except Exception:
            pass

    # Inject extra_data when there are custom values
    if extra_data_payload and has_extra_data:
        # Merge with any existing extra_data default (usually {})
        existing = dict(kwargs.get("extra_data") or {})
        existing.update(extra_data_payload)
        kwargs["extra_data"] = existing

    _normalize_member_binding(template, cooperative, raw_payload, kwargs)

    return kwargs


def _resolve_auto_default(field_name: str, submitting_user, cooperative) -> Any:
    """Resolve a template field_defaults '__auto__' placeholder to a real value."""
    auto_values = {
        "cooperative": cooperative,
        "cooperative_id": getattr(cooperative, "id", None),
        "recorded_by": submitting_user,
        "recorded_by_id": getattr(submitting_user, "id", None),
        "added_by": submitting_user,
        "added_by_id": getattr(submitting_user, "id", None),
        "submitted_by": submitting_user,
        "submitted_by_id": getattr(submitting_user, "id", None),
    }
    return auto_values.get(field_name, _UNRESOLVED)


def _merge_template_defaults(
    kwargs: dict[str, Any],
    field_defaults: dict[str, Any],
    submitting_user,
    cooperative,
) -> None:
    """
    Merge template.field_defaults into model kwargs, resolving '__auto__'
    placeholders to the appropriate runtime object or id value.
    """
    for field_name, value in field_defaults.items():
        if value == _AUTO_FIELD_SENTINEL:
            resolved = _resolve_auto_default(field_name, submitting_user, cooperative)
            if resolved is _UNRESOLVED:
                logger.warning(
                    "Ignoring unresolved auto field_default '%s' on template submission.",
                    field_name,
                )
                continue
            kwargs.setdefault(field_name, resolved)
            continue
        kwargs.setdefault(field_name, value)


def _normalize_member_binding(
    template: FormTemplate,
    cooperative,
    raw_payload: dict,
    kwargs: dict,
) -> None:
    """
    Normalise member ownership across all form submissions.

    LAND / HERD models use a real member FK.
    PRODUCTION / LIVESTOCK / GOVERNANCE / FINANCE store canonical member keys in extra_data.
    """
    from core.models import Member

    member_id = raw_payload.get("member_id") or raw_payload.get("member")
    member_number = raw_payload.get("member_number")
    member = None

    if member_id:
        member = Member.objects.filter(pk=member_id, cooperative=cooperative).first()
    elif member_number:
        member = Member.objects.filter(member_number=member_number, cooperative=cooperative).first()

    if template.target_model in {"LAND", "HERD"}:
        if member is None:
            raise ValueError("member_number is required for member land and herd records.")
        kwargs["member"] = member
        extra_data = dict(kwargs.get("extra_data") or {})
        extra_data["member_id"] = str(member.id)
        extra_data["member_number"] = member.member_number
        extra_data["member_name"] = member.get_display_name()
        kwargs["extra_data"] = extra_data
        return

    if template.target_model not in {"PRODUCTION", "LIVESTOCK", "GOVERNANCE", "FINANCE"}:
        return

    extra_data = dict(kwargs.get("extra_data") or {})
    requested_scope = raw_payload.get("collection_scope") or extra_data.get("collection_scope")
    scope = str(requested_scope).upper() if requested_scope else ("MEMBER" if member else "COOPERATIVE")
    if scope == "MEMBER" and member is None:
        raise ValueError("member_number is required when collection_scope is MEMBER.")

    extra_data["collection_scope"] = scope
    if scope == "MEMBER" and member is not None:
        extra_data["member_id"] = str(member.id)
        extra_data["member_number"] = member.member_number
        extra_data["member_name"] = member.get_display_name()
    else:
        extra_data.pop("member_id", None)
        extra_data.pop("member_number", None)
        extra_data.pop("member_name", None)
    kwargs["extra_data"] = extra_data


# ══════════════════════════════════════════════════════════════════
#  MAIN ENTRY POINT
# ══════════════════════════════════════════════════════════════════

@transaction.atomic
def submit_form(
    template: FormTemplate,
    raw_payload: dict,
    submitting_user,
    cooperative,
) -> tuple:
    """
    Submit a FormTemplate — create a real DB row in the target model.

    Returns: (target_instance, form_submission)

    On failure the atomic transaction rolls back; a FAILED audit record
    is written outside the block so it survives the rollback.

    Raises:
        ValueError  — invalid payload or template not ACTIVE
        RuntimeError — unexpected DB error on save
    """
    if template.status != FormTemplate.Status.ACTIVE:
        raise ValueError(
            f"Template '{template.name}' is not ACTIVE "
            f"(status: {template.status}). Cannot accept submissions."
        )
    if str(template.cooperative_id) != str(cooperative.id):
        raise ValueError("Template does not belong to this cooperative.")

    model_name = FORM_BUILDER_TARGET_MODELS.get(template.target_model)
    if not model_name:
        raise ValueError(f"Cannot resolve target model for '{template.target_model}'.")

    target_class = _get_target_model(model_name)
    if target_class is None:
        raise ValueError(f"Model '{model_name}' could not be located.")

    try:
        kwargs = _build_model_kwargs(template, raw_payload, submitting_user, cooperative)
    except ValueError as exc:
        _write_failed_submission(template, cooperative, submitting_user, raw_payload, str(exc))
        raise

    try:
        instance = target_class(**kwargs)
        instance.full_clean()
        instance.save()
    except Exception as exc:
        msg = str(exc)
        logger.error("submit_form failed for template %s: %s", template.id, msg)
        _write_failed_submission(template, cooperative, submitting_user, raw_payload, msg)
        raise RuntimeError(f"Failed to save record: {msg}") from exc

    submission = FormSubmission.objects.create(
        template          = template,
        cooperative       = cooperative,
        created_model     = target_class.__name__,
        created_record_id = instance.pk,
        submitted_by      = submitting_user,
        raw_payload       = _safe_serialise(raw_payload),
        status            = FormSubmission.SubmissionStatus.SUCCESS,
    )

    logger.info(
        "Submission %s: created %s(%s) via template '%s'",
        submission.id, target_class.__name__, instance.pk, template.name,
    )

    # Lock any custom field definitions that were just used for the first time.
    # This prevents field_key renaming after data exists.
    try:
        newly_locked = lock_fields_for_template(template.id)
        if newly_locked:
            logger.info(
                "Locked %d DynamicFieldDefinition(s) after first submission for template '%s'",
                newly_locked, template.name,
            )
    except Exception as exc:
        # Non-fatal — don't fail the submission over a lock failure
        logger.warning("Could not lock custom fields after submission %s: %s", submission.id, exc)

    return instance, submission


# ══════════════════════════════════════════════════════════════════
#  HELPERS
# ══════════════════════════════════════════════════════════════════

def _write_failed_submission(
    template, cooperative, user, raw_payload: dict, error_detail: str
) -> None:
    """Write a FAILED audit record outside any transaction."""
    import uuid as _uuid
    try:
        FormSubmission.objects.create(
            template          = template,
            cooperative       = cooperative,
            created_model     = template.target_model,
            created_record_id = _uuid.uuid4(),
            submitted_by      = user,
            raw_payload       = _safe_serialise(raw_payload),
            status            = FormSubmission.SubmissionStatus.FAILED,
            error_detail      = error_detail[:2000],
        )
    except Exception as exc:
        logger.error("Could not write FAILED audit record: %s", exc)


def _safe_serialise(payload: dict) -> dict:
    """Prepare payload for JSONField storage — stringify non-JSON-serialisable values."""
    safe = {}
    for key, value in payload.items():
        if isinstance(value, (Decimal, date, datetime)):
            safe[key] = str(value)
        elif isinstance(value, bytes):
            safe[key] = "<binary>"
        else:
            try:
                json.dumps(value)
                safe[key] = value
            except (TypeError, ValueError):
                safe[key] = str(value)
    return safe


def update_form(
    template: FormTemplate,
    raw_payload: dict,
    submitting_user,
    cooperative,
    existing_instance,
) -> tuple:
    """
    Update an existing record using form template data.
    
    Similar to submit_form but updates an existing instance instead of creating new.
    
    Returns: (updated_instance, form_submission)
    
    Raises:
        ValueError  — invalid payload or template not ACTIVE
        RuntimeError — unexpected DB error on save
    """
    if template.status != FormTemplate.Status.ACTIVE:
        raise ValueError(
            f"Template '{template.name}' is not ACTIVE "
            f"(status: {template.status}). Cannot accept submissions."
        )
    if str(template.cooperative_id) != str(cooperative.id):
        raise ValueError("Template does not belong to this cooperative.")

    model_name = FORM_BUILDER_TARGET_MODELS.get(template.target_model)
    if not model_name:
        raise ValueError(f"Cannot resolve target model for '{template.target_model}'")

    target_class = _get_target_model(model_name)
    if target_class is None:
        raise ValueError(f"Model '{model_name}' could not be located.")

    # Does this model support extra_data (migration applied)?
    try:
        target_class._meta.get_field("extra_data")
        has_extra_data = True
    except Exception:
        has_extra_data = False

    kwargs: dict[str, Any] = {}
    extra_data_payload: dict[str, Any] = {}
    errors: list[str] = []

    for ff in template.fields.all():
        key = ff.maps_to_model_field
        raw_value = raw_payload.get(key)

        # Required check
        if ff.is_required and (raw_value is None or raw_value == ""):
            errors.append(f'"{ff.label}" is required.')
            continue

        if raw_value is None or raw_value == "":
            continue

        if ff.is_custom_field:
            # ── Custom field: route to extra_data ────────────────────────
            if has_extra_data:
                extra_data_payload[key] = _coerce_custom_value(
                    raw_value, ff.display_type
                )
            else:
                logger.warning(
                    "Custom field '%s' submitted but %s has no extra_data column. "
                    "Run: python manage.py migrate",
                    key, target_class.__name__,
                )
        else:
            # ── Real field: route to model column ─────────────────────────
            try:
                model_field = target_class._meta.get_field(key)
                coerced = _coerce_value(raw_value, model_field)
                kwargs[key] = coerced
            except Exception as exc:
                errors.append(str(exc))

    if errors:
        raise ValueError(f"Validation failed: {'; '.join(errors)}")

    _merge_template_defaults(kwargs, template.field_defaults or {}, submitting_user, cooperative)

    for fname, fvalue in [
        ("cooperative", cooperative),
        ("recorded_by", submitting_user),
        ("added_by", submitting_user),
    ]:
        try:
            target_class._meta.get_field(fname)
            kwargs.setdefault(fname, fvalue)
        except Exception:
            pass

    # Merge extra_data if present
    if extra_data_payload and has_extra_data:
        # Merge with any existing extra_data
        existing = dict(existing_instance.extra_data or {})
        existing.update(extra_data_payload)
        kwargs["extra_data"] = existing

    try:
        # Update the existing instance instead of creating new
        for key, value in kwargs.items():
            setattr(existing_instance, key, value)
        existing_instance.full_clean()
        existing_instance.save()
    except Exception as exc:
        msg = str(exc)
        logger.error("update_form failed for template %s: %s", template.id, msg)
        _write_failed_submission(template, cooperative, submitting_user, raw_payload, msg)
        raise RuntimeError(f"Failed to update record: {msg}") from exc

    submission = FormSubmission.objects.create(
        template          = template,
        cooperative       = cooperative,
        created_model     = target_class.__name__,
        created_record_id = existing_instance.pk,
        submitted_by      = submitting_user,
        raw_payload       = _safe_serialise(raw_payload),
        status            = FormSubmission.SubmissionStatus.SUCCESS,
    )

    logger.info(
        "Submission %s: updated %s(%s) via template '%s'",
        submission.id, target_class.__name__, existing_instance.pk, template.name,
    )

    # Lock any custom field definitions that were just used for first time.
    try:
        newly_locked = lock_fields_for_template(template.id)
        if newly_locked:
            logger.info(
                "Locked %d DynamicFieldDefinition(s) after first submission for template '%s'",
                newly_locked, template.name,
            )
    except Exception as exc:
        # Non-fatal — don't fail the submission over a lock failure
        logger.warning("Could not lock custom fields after submission %s: %s", submission.id, exc)

    return existing_instance, submission


def submit_form_with_member_context(
    template_id: str,
    cooperative_id: str,
    member_id: str,
    payload: dict,
    user,
) -> tuple[Any, FormSubmission]:
    """
    Submit a form with member context pre-filled.
    This is a convenience wrapper around submit_form() that adds member defaults.
    """
    from core.models import Member
    from core.services.member_context import get_member_context_defaults
    from core.models import Cooperative

    # Get the member
    try:
        member = Member.objects.get(pk=member_id, cooperative_id=cooperative_id)
    except Member.DoesNotExist:
        raise ValueError(f"Member {member_id} not found in cooperative {cooperative_id}")

    try:
        template = FormTemplate.objects.get(pk=template_id, cooperative_id=cooperative_id)
    except FormTemplate.DoesNotExist:
        raise ValueError(f"Template {template_id} not found in cooperative {cooperative_id}")

    try:
        cooperative = Cooperative.objects.get(pk=cooperative_id)
    except Cooperative.DoesNotExist:
        raise ValueError(f"Cooperative {cooperative_id} not found")

    # Get member defaults
    member_defaults = get_member_context_defaults(member)
    member_defaults.setdefault("collection_scope", "MEMBER")

    # Merge member defaults with user payload (payload takes precedence)
    enhanced_payload = {**member_defaults, **payload}

    supplemental_defaults = _resolve_member_context_submission_defaults(template, enhanced_payload)
    if supplemental_defaults:
        enhanced_payload.update(supplemental_defaults)

    original_field_defaults = template.field_defaults
    template.field_defaults = {**dict(template.field_defaults or {}), **supplemental_defaults}
    try:
        # Submit the form with enhanced payload
        return submit_form(template, enhanced_payload, user, cooperative)
    finally:
        template.field_defaults = original_field_defaults


def _resolve_member_context_submission_defaults(
    template: FormTemplate,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """
    Backfill required discriminator fields for member-context quick capture.

    Member quick-capture forms can expose required system discriminator fields
    even when the template itself does not persist them as FormField rows.
    When that happens we bridge the value into the submission through
    template.field_defaults for this request only.
    """
    from apps.crm.services.collection import TARGET_TO_MODEL_SLUG, get_crm_config

    model_slug = TARGET_TO_MODEL_SLUG.get(template.target_model)
    if not model_slug:
        return {}

    config = get_crm_config(model_slug)
    if config.member_binding != "extra":
        return {}

    discriminator_key = config.discriminator.field_key
    mapped_fields = set(template.fields.values_list("maps_to_model_field", flat=True))
    if discriminator_key in mapped_fields:
        return {}

    value = payload.get(discriminator_key)
    if value not in (None, ""):
        return {discriminator_key: value}

    if template.target_model == "PRODUCTION":
        return {discriminator_key: timezone.localdate().isoformat()}

    raise ValueError(f'"{config.discriminator.label}" is required.')


def get_submission_history(
    template: FormTemplate,
    page: int = 1,
    page_size: int = 20,
) -> dict:
    """Paginated submission history for a template."""
    from django.core.paginator import Paginator
    qs = (
        FormSubmission.objects
        .filter(template=template)
        .select_related("submitted_by")
        .order_by("-submitted_at")
    )
    paginator = Paginator(qs, page_size)
    page_obj  = paginator.get_page(page)
    return {
        "data": [
            {
                "id":                str(s.id),
                "created_model":     s.created_model,
                "created_record_id": str(s.created_record_id),
                "submitted_by":      s.submitted_by.full_name if s.submitted_by else None,
                "submitted_at":      s.submitted_at.isoformat(),
                "status":            s.status,
                "error_detail":      s.error_detail or None,
            }
            for s in page_obj.object_list
        ],
        "page":        page,
        "total_pages": paginator.num_pages,
        "total_count": paginator.count,
    }
