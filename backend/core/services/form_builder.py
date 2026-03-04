"""
ShambaFlow — Form Builder Service
core/services/form_builder.py

This service owns the full lifecycle of cooperative-defined forms:
  • template creation and versioning
  • field management and model-field introspection
  • semantic validation (delegates to form_semantic.py)
  • form submission → creates a REAL row in the target model table
  • FormSubmission as an audit trail (not the data store)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HOW SUBMISSION WORKS

  1. The Chair activates a FormTemplate (target_model = 'ProductionRecord').
  2. A helper opens the form and fills in the fields.
  3. process_form_submission() is called with:
       template:      FormTemplate instance
       raw_user_data: {form_field_id: user_entered_value}
       submitted_by:  User instance (the helper)
       injected_ctx:  {"cooperative_id": ..., "recorded_by_id": ...}
  4. Service maps each form field → target model column.
  5. Validates required fields and type coercions.
  6. Calls target_model_class(**kwargs); instance.full_clean(); instance.save()
  7. Creates FormSubmission (audit trail) with the raw payload and the
     created record's primary key.
  8. Triggers capacity recalculation if any CAPACITY-tagged field was submitted.

NO FormFieldValue rows are created. The data lives in the real table.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

import logging
import uuid as _uuid
from decimal import Decimal, InvalidOperation
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

from django.apps import apps
from django.db import transaction
from django.utils import timezone

logger = logging.getLogger("shambaflow")


# ══════════════════════════════════════════════════════════════════
#  DISPLAY TYPE → PYTHON TYPE COERCERS
# ══════════════════════════════════════════════════════════════════

def _coerce_text(value: Any) -> str:
    return str(value).strip()


def _coerce_number(value: Any) -> int:
    try:
        return int(str(value).strip())
    except (ValueError, TypeError):
        raise ValueError(f"'{value}' is not a valid whole number.")


def _coerce_decimal(value: Any) -> Decimal:
    try:
        return Decimal(str(value).strip())
    except InvalidOperation:
        raise ValueError(f"'{value}' is not a valid decimal number.")


def _coerce_boolean(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    s = str(value).strip().lower()
    if s in {"true", "1", "yes", "on", "y"}:
        return True
    if s in {"false", "0", "no", "off", "n"}:
        return False
    raise ValueError(f"'{value}' is not a valid boolean (yes/no).")


def _coerce_date(value: Any) -> date:
    if isinstance(value, date):
        return value
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(str(value).strip(), fmt).date()
        except ValueError:
            continue
    raise ValueError(
        f"'{value}' could not be parsed as a date. Use YYYY-MM-DD format."
    )


def _coerce_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    for fmt in (
        "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(str(value).strip(), fmt)
        except ValueError:
            continue
    raise ValueError(
        f"'{value}' could not be parsed as a datetime. Use YYYY-MM-DDTHH:MM:SS format."
    )


_DISPLAY_TYPE_COERCERS = {
    "text":         _coerce_text,
    "textarea":     _coerce_text,
    "rich_text":    _coerce_text,
    "number":       _coerce_number,
    "decimal":      _coerce_decimal,
    "boolean":      _coerce_boolean,
    "date":         _coerce_date,
    "datetime":     _coerce_datetime,
    "dropdown":     _coerce_text,
    "multi_select": lambda v: [s.strip() for s in str(v).split(",") if s.strip()],
    "file_upload":  lambda v: v,    # File objects passed through directly
    "image_upload": lambda v: v,
    "gps":          _coerce_text,   # "lat,lng" string
}


# ══════════════════════════════════════════════════════════════════
#  TEMPLATE MANAGEMENT
# ══════════════════════════════════════════════════════════════════

def create_form_template(
    cooperative,
    name: str,
    target_model: str,
    created_by,
    description: str = "",
    is_default: bool = False,
    initial_fields: Optional[List[Dict[str, Any]]] = None,
):
    """
    Create a new FormTemplate in DRAFT status.

    cooperative:    Cooperative instance
    target_model:   one of FormTemplate.TargetModel values
    initial_fields: optional list of field dicts (same keys as FormField model)

    After creation, the Chair should:
      1. Add / edit FormFields via add_form_field() / update_form_field()
      2. Call trigger_semantic_validation() to check for issues
      3. Call activate_template() when ready
    """
    from core.models import FormTemplate

    template = FormTemplate.objects.create(
        cooperative=cooperative,
        name=name,
        target_model=target_model,
        description=description,
        is_default=is_default,
        version=1,
        created_by=created_by,
        status=FormTemplate.Status.DRAFT,
    )

    if initial_fields:
        for i, field_data in enumerate(initial_fields):
            field_data.setdefault("field_order", i)
            _create_field(template, field_data)
        _refresh_model_required_flags(template)

    logger.info(
        "FormTemplate created | %s | %s | by %s",
        cooperative.name, name, created_by.email,
    )
    return template


def create_new_template_version(
    template,
    updated_by,
    change_note: str = "",
    new_field_definitions: Optional[List[Dict[str, Any]]] = None,
):
    """
    Create a new version of an existing template.

    The old template is set to INACTIVE.
    The new template is DRAFT, ready for editing then activation.
    All fields are cloned unless new_field_definitions is provided.
    """
    from core.models import FormTemplate, FormField

    old_template = template

    # Deactivate old
    old_template.status    = FormTemplate.Status.INACTIVE
    old_template.is_default = False
    old_template.save(update_fields=["status", "is_default"])

    # Clone template metadata
    new_template = FormTemplate.objects.create(
        cooperative=old_template.cooperative,
        name=old_template.name,
        target_model=old_template.target_model,
        description=old_template.description,
        is_default=True,
        version=old_template.version + 1,
        parent_version=old_template,
        created_by=updated_by,
        change_note=change_note,
        status=FormTemplate.Status.DRAFT,
        field_defaults=old_template.field_defaults.copy(),
    )

    # Clone fields
    source_fields = new_field_definitions or [
        {
            "label":               f.label,
            "display_type":        f.display_type,
            "tag":                 f.tag,
            "field_order":         f.field_order,
            "placeholder":         f.placeholder,
            "help_text":           f.help_text,
            "is_required":         f.is_required,
            "default_value":       f.default_value,
            "maps_to_model_field": f.maps_to_model_field,
            "options":             f.options,
            "validation_rules":    f.validation_rules,
            "conditional_rule":    f.conditional_rule,
        }
        for f in FormField.objects.filter(template=old_template).order_by("field_order")
    ]

    for field_data in source_fields:
        _create_field(new_template, field_data)

    _refresh_model_required_flags(new_template)

    logger.info(
        "New template version | %s v%d → v%d | by %s",
        new_template.name, old_template.version, new_template.version, updated_by.email,
    )
    return new_template


def add_form_field(template, field_data: Dict[str, Any]):
    """Add a single field to a DRAFT template."""
    from core.models import FormTemplate

    if template.status not in (FormTemplate.Status.DRAFT, FormTemplate.Status.HAS_ISSUES):
        raise ValueError(
            f"Cannot add fields to a template with status '{template.status}'. "
            "Create a new version first."
        )
    _validate_maps_to_model_field(template, field_data["maps_to_model_field"])
    field = _create_field(template, field_data)
    _refresh_model_required_flags(template)
    return field


def update_form_field(field, field_data: Dict[str, Any]):
    """Update a form field on a non-active template."""
    from core.models import FormTemplate, FormFieldSemanticIssue

    template = field.template
    if template.status == FormTemplate.Status.ACTIVE:
        raise ValueError(
            "Cannot edit fields on an active template. Create a new version first."
        )

    if "maps_to_model_field" in field_data:
        _validate_maps_to_model_field(template, field_data["maps_to_model_field"])

    for key, value in field_data.items():
        setattr(field, key, value)
    field.full_clean()
    field.save()

    # Clear stale semantic issues; re-run before activation
    FormFieldSemanticIssue.objects.filter(template=template).delete()
    template.status = FormTemplate.Status.DRAFT
    template.has_blocking_errors = False
    template.save(update_fields=["status", "has_blocking_errors"])

    _refresh_model_required_flags(template)
    return field


def remove_form_field(field) -> None:
    """Delete a form field from a non-active template."""
    from core.models import FormTemplate, FormFieldSemanticIssue

    template = field.template
    if template.status == FormTemplate.Status.ACTIVE:
        raise ValueError(
            "Cannot remove fields from an active template. Create a new version first."
        )
    field.delete()
    FormFieldSemanticIssue.objects.filter(template=template).delete()
    template.status = FormTemplate.Status.DRAFT
    template.has_blocking_errors = False
    template.save(update_fields=["status", "has_blocking_errors"])
    _refresh_model_required_flags(template)


def trigger_semantic_validation(template) -> Dict[str, Any]:
    """
    Run the semantic validation engine on the template.
    Returns a summary dict for the API response.
    """
    from core.models import FormTemplate
    from core.services.form_semantic import run_semantic_validation

    template.status = FormTemplate.Status.VALIDATING
    template.save(update_fields=["status"])

    issues = run_semantic_validation(template)
    template.refresh_from_db()

    error_count   = sum(1 for i in issues if i["severity"] == "ERROR")
    warning_count = sum(1 for i in issues if i["severity"] == "WARNING")

    return {
        "template_id":   str(template.id),
        "template_name": template.name,
        "status":        template.status,
        "can_activate":  not template.has_blocking_errors,
        "total_issues":  len(issues),
        "error_count":   error_count,
        "warning_count": warning_count,
        "issues":        issues,
    }


# ══════════════════════════════════════════════════════════════════
#  FORM INTROSPECTION — what the UI needs to render the form
# ══════════════════════════════════════════════════════════════════

def get_form_render_schema(template) -> Dict[str, Any]:
    """Return the complete JSON schema the frontend uses to render the form."""
    from core.models import FormField

    fields = FormField.objects.filter(template=template).order_by("field_order")

    return {
        "template_id":   str(template.id),
        "template_name": template.name,
        "target_model":  template.target_model,
        "version":       template.version,
        "is_active":     template.is_active,
        "fields": [
            {
                "id":                  str(f.id),
                "label":               f.label,
                "display_type":        f.display_type,
                "tag":                 f.tag,
                "is_required":         f.is_required,
                "is_model_required":   f.is_model_required,
                "placeholder":         f.placeholder,
                "help_text":           f.help_text,
                "default_value":       f.default_value,
                "options":             f.options,
                "validation_rules":    f.validation_rules,
                "conditional_rule":    f.conditional_rule,
                "maps_to_model_field": f.maps_to_model_field,
                "field_order":         f.field_order,
            }
            for f in fields
        ],
    }


def get_writable_model_fields(target_model_key: str) -> List[Dict[str, Any]]:
    """
    Return all writable fields on the target model that a Chair can include
    in a form. Used to populate the field-picker UI in the Form Builder.

    Returns:
        list of {field_name, django_type, verbose_name, required, null, choices}
    """
    from core.models import FORM_BUILDER_TARGET_MODELS

    model_name = FORM_BUILDER_TARGET_MODELS.get(target_model_key)
    if not model_name:
        raise ValueError(f"Unknown target model key: '{target_model_key}'")

    model_class = apps.get_model("core", model_name)
    result      = []
    skip_fields = {"id", "created_at", "updated_at"}

    for field in model_class._meta.get_fields():
        if not hasattr(field, "column"):
            continue
        if not getattr(field, "editable", True):
            continue
        if field.name in skip_fields:
            continue

        choices = None
        if hasattr(field, "choices") and field.choices:
            choices = [{"value": c[0], "label": str(c[1])} for c in field.choices]

        result.append({
            "field_name":   field.name,
            "django_type":  type(field).__name__,
            "verbose_name": str(getattr(field, "verbose_name", field.name)),
            "required": (
                not getattr(field, "null", True)
                and not getattr(field, "blank", True)
                and not (
                    hasattr(field, "default")
                    and field.default is not field.__class__.default
                )
            ),
            "null":       getattr(field, "null", True),
            "choices":    choices,
            "max_length": getattr(field, "max_length", None),
        })

    return sorted(result, key=lambda f: f["field_name"])


# ══════════════════════════════════════════════════════════════════
#  FORM SUBMISSION — creates the actual DB record
# ══════════════════════════════════════════════════════════════════

@transaction.atomic
def process_form_submission(
    template,
    raw_user_data: Dict[str, Any],
    submitted_by,
    injected_context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Process a form submission and create a real record in the target model.

    Parameters
    ──────────
    template:
        The ACTIVE FormTemplate being submitted.

    raw_user_data:
        {form_field_id (str uuid): user_entered_value}
        Keys are UUID strings of FormField objects.

    submitted_by:
        The User (helper or chair) who submitted the form.

    injected_context:
        Values NOT on the form but required by the model.
        E.g. {"cooperative_id": <uuid>, "recorded_by_id": <uuid>,
              "member_id": <uuid>}
        Merged with template.field_defaults. Context takes priority.

    Returns
    ───────
    {
        "status":              "SUCCESS" | "FAILED",
        "created_model":       "ProductionRecord",
        "created_record_id":   "<uuid>",
        "submission_id":       "<uuid>",
        "validation_errors":   [],
        "error_detail":        "",
    }
    """
    from core.models import FormField, FormSubmission

    if not template.is_active:
        raise ValueError(
            f"Form template '{template.name}' is not active. "
            "Only active templates can receive submissions."
        )

    model_class = template.target_model_class
    if model_class is None:
        raise ValueError(
            f"Target model class not found for template '{template.name}'."
        )

    model_name = model_class.__name__
    field_map  = {
        str(f.id): f
        for f in FormField.objects.filter(template=template)
    }

    # ── 1. Build model kwargs ──────────────────────────────────────
    model_kwargs:      Dict[str, Any]        = {}
    validation_errors: List[Dict[str, str]] = []

    # Lowest priority: template field_defaults
    model_kwargs.update(template.field_defaults)

    # Higher priority: injected context (cooperative, recorded_by, etc.)
    if injected_context:
        model_kwargs.update(injected_context)

    # User-supplied values (coerced to correct Python types)
    for field_id_str, raw_value in raw_user_data.items():
        form_field = field_map.get(field_id_str)
        if form_field is None:
            logger.warning("Submitted unknown field id %s — skipping", field_id_str)
            continue

        is_empty = raw_value is None or str(raw_value).strip() == ""

        # Required check
        if form_field.is_required and is_empty:
            validation_errors.append({
                "field_label": form_field.label,
                "message":     f'"{form_field.label}" is required.',
            })
            continue

        # Skip empty optional fields
        if is_empty:
            continue

        # Coerce
        coercer = _DISPLAY_TYPE_COERCERS.get(form_field.display_type, _coerce_text)
        try:
            coerced = coercer(raw_value)
        except (ValueError, TypeError) as exc:
            validation_errors.append({
                "field_label": form_field.label,
                "message":     str(exc),
            })
            continue

        model_kwargs[form_field.maps_to_model_field] = coerced

    if validation_errors:
        return {
            "status":            "FAILED",
            "created_model":     model_name,
            "created_record_id": None,
            "submission_id":     None,
            "validation_errors": validation_errors,
            "error_detail":      f"{len(validation_errors)} validation error(s).",
        }

    # ── 2. Create the real model record ───────────────────────────
    raw_payload_for_audit = {k: str(v) for k, v in model_kwargs.items()}
    submission_status     = "SUCCESS"
    error_detail          = ""
    created_record        = None

    try:
        instance = model_class(**model_kwargs)
        instance.full_clean()
        instance.save()
        created_record = instance
    except Exception as exc:
        logger.exception(
            "Form submission DB write failed | template=%s | user=%s",
            template.name,
            submitted_by.email,
        )
        submission_status = "FAILED"
        error_detail      = str(exc)

    # ── 3. Write audit trail (always, even on failure) ─────────────
    submission = FormSubmission.objects.create(
        template=template,
        cooperative=template.cooperative,
        created_model=model_name,
        created_record_id=(
            created_record.pk if created_record else _uuid.uuid4()
        ),
        submitted_by=submitted_by,
        raw_payload=raw_payload_for_audit,
        status=submission_status,
        error_detail=error_detail,
    )

    if submission_status == "FAILED":
        return {
            "status":            "FAILED",
            "created_model":     model_name,
            "created_record_id": None,
            "submission_id":     str(submission.id),
            "validation_errors": [],
            "error_detail":      error_detail,
        }

    # ── 4. Trigger capacity recalculation if CAPACITY fields submitted ─
    _maybe_trigger_capacity(template, raw_user_data, field_map)

    logger.info(
        "Form submission success | template=%s | %s id=%s | by=%s",
        template.name, model_name, created_record.pk, submitted_by.email,
    )

    return {
        "status":            "SUCCESS",
        "created_model":     model_name,
        "created_record_id": str(created_record.pk),
        "submission_id":     str(submission.id),
        "validation_errors": [],
        "error_detail":      "",
    }


# ══════════════════════════════════════════════════════════════════
#  AUDIT TRAIL RETRIEVAL
# ══════════════════════════════════════════════════════════════════

def get_submission_audit_trail(
    cooperative,
    target_model_name: Optional[str] = None,
    record_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Return FormSubmission audit entries for a cooperative, optionally
    filtered by target model class name or specific record id.
    """
    from core.models import FormSubmission

    qs = FormSubmission.objects.filter(
        cooperative=cooperative
    ).select_related("template", "submitted_by")

    if target_model_name:
        qs = qs.filter(created_model=target_model_name)
    if record_id:
        qs = qs.filter(created_record_id=record_id)

    return [
        {
            "submission_id": str(s.id),
            "template_name": s.template.name,
            "target_model":  s.created_model,
            "record_id":     str(s.created_record_id),
            "submitted_by":  s.submitted_by.full_name if s.submitted_by else None,
            "submitted_at":  s.submitted_at.isoformat(),
            "status":        s.status,
            "error_detail":  s.error_detail,
        }
        for s in qs.order_by("-submitted_at")[:200]
    ]


# ══════════════════════════════════════════════════════════════════
#  PRIVATE HELPERS
# ══════════════════════════════════════════════════════════════════

def _create_field(template, field_data: Dict[str, Any]):
    """Internal: create a FormField, validating the model mapping first."""
    from core.models import FormField

    field_data = dict(field_data)   # shallow copy to avoid mutating caller's dict

    if "maps_to_model_field" in field_data:
        _validate_maps_to_model_field(template, field_data["maps_to_model_field"])

    field = FormField(template=template, **field_data)
    field.full_clean()
    field.save()
    return field


def _validate_maps_to_model_field(template, field_name: str) -> None:
    """
    Raise ValueError if field_name is not a real column on the target model.
    The error message lists available fields to aid the Chair.
    """
    model_class = template.target_model_class
    if model_class is None:
        return

    all_names = {
        f.name for f in model_class._meta.get_fields()
        if hasattr(f, "column")
    }

    if field_name not in all_names:
        available = sorted(all_names)
        raise ValueError(
            f'"{field_name}" is not a field on {model_class.__name__}. '
            f"Available fields: {', '.join(available[:15])}"
            + ("..." if len(available) > 15 else "")
        )


def _refresh_model_required_flags(template) -> None:
    """
    Update FormField.is_model_required for every field on the template.
    Called after any add / update / remove of a field.
    """
    from core.models import FormField
    from core.services.form_semantic import (
        get_model_field_info,
        _AUTO_POPULATED_FIELDS,
    )

    model_class = template.target_model_class
    if model_class is None:
        return

    model_name  = model_class.__name__
    field_info  = get_model_field_info(model_class)
    auto_fields = _AUTO_POPULATED_FIELDS.get(model_name, set())

    for form_field in FormField.objects.filter(template=template):
        col  = form_field.maps_to_model_field
        if col not in field_info:
            continue
        info = field_info[col]
        is_required = (
            not info["null"]
            and not info["has_default"]
            and col not in auto_fields
            and not info["primary_key"]
        )
        if form_field.is_model_required != is_required:
            form_field.is_model_required = is_required
            form_field.save(update_fields=["is_model_required"])


def _maybe_trigger_capacity(template, raw_user_data, field_map) -> None:
    """Trigger capacity recalculation if any CAPACITY-tagged field was submitted."""
    from core.services.capacity_engine import trigger_capacity_recalculation

    capacity_touched = any(
        field_map[fid].tag == "CAPACITY"
        for fid in raw_user_data
        if fid in field_map
    )
    if capacity_touched:
        trigger_capacity_recalculation(template.cooperative)