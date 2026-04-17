"""
ShambaFlow — Dynamic Field Definition API Views
================================================
Endpoints that expose the cooperative-owned field registry to the frontend.

All endpoints are cooperative-scoped.  The requesting user must belong to
the cooperative identified in the request body / query params.

Auth: DRF JWT — @api_view + @permission_classes([IsAuthenticated]) ensures
the JWT token is validated before any view body runs.  request.user is
always a real authenticated user inside these views.

Endpoints
─────────
GET  /api/form-builder/dynamic-fields/
     ?cooperative_id=<uuid>&target_model=<model>
     → list all active field definitions for this (coop, model)

POST /api/form-builder/dynamic-fields/
     Body: { cooperative_id, target_model, label, display_type, ... }
     → register a new field; runs full semantic duplicate check first

GET  /api/form-builder/dynamic-fields/<id>/
     → retrieve single definition

PATCH /api/form-builder/dynamic-fields/<id>/
     → update mutable properties (label, help_text, options, etc.)

DELETE /api/form-builder/dynamic-fields/<id>/
     → soft-delete (is_active = False); field_key preserved permanently

GET  /api/form-builder/dynamic-fields/check/
     ?cooperative_id=<uuid>&target_model=<model>&label=<label>
     → pre-flight conflict check (called while user is typing)
     → 200 always; read is_conflict to decide whether to block submit

GET  /api/form-builder/dynamic-fields/schema/<TARGET_MODEL>/
     ?cooperative_id=<uuid>
     → merged skeleton discriminator field + all cooperative-defined fields
"""

from __future__ import annotations

from django.core.exceptions import ValidationError
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.services.field_registry import (
    check_label_conflict,
    deactivate_field,
    get_field_schema,
    preview_field_semantics,
    register_field,
    slugify_to_field_key,
    update_field,
    DuplicateFieldError,
    FieldLockedError,
)


# ── Cooperative access guard ───────────────────────────────────────────────────

def _assert_cooperative_access(user, cooperative_id: str) -> str | None:
    """
    Return None if the authenticated user belongs to this cooperative.
    Return an error message string if access is denied.
    """
    try:
        user_coop = str(user.cooperative_id)
    except AttributeError:
        return "Your account is not linked to a cooperative."
    if user_coop != str(cooperative_id):
        return "You do not have access to this cooperative's field registry."
    return None


def _serialize_dfd(dfd) -> dict:
    data = {
        "id":               str(dfd.id),
        "cooperative_id":   str(dfd.cooperative_id),
        "target_model":     dfd.target_model,
        "field_key":        dfd.field_key,
        "label":            dfd.label,
        "display_type":     dfd.display_type,
        "tag":              dfd.tag,
        "is_required":      dfd.is_required,
        "is_locked":        dfd.is_locked,
        "is_active":        dfd.is_active,
        "help_text":        dfd.help_text_display,
        "placeholder":      dfd.placeholder,
        "options":          dfd.options or [],
        "validation_rules": dfd.validation_rules or {},
        "created_at":       dfd.created_at.isoformat(),
        "updated_at":       dfd.updated_at.isoformat(),
    }
    if hasattr(dfd, "template_sync"):
        data["template_sync"] = dfd.template_sync
    return data


# ══════════════════════════════════════════════════════════════════
#  LIST + CREATE
# ══════════════════════════════════════════════════════════════════

@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def dynamic_fields_list_view(request):

    # ── GET: list ────────────────────────────────────────────────────────────
    if request.method == "GET":
        cooperative_id = request.GET.get("cooperative_id")
        target_model   = request.GET.get("target_model")

        if not cooperative_id:
            return Response({"error": "cooperative_id is required."}, status=400)

        access_err = _assert_cooperative_access(request.user, cooperative_id)
        if access_err:
            return Response({"error": access_err}, status=403)

        include_inactive = request.GET.get("include_inactive", "").lower() == "true"

        fields = get_field_schema(cooperative_id, target_model, include_inactive)
        return Response({
            "cooperative_id": cooperative_id,
            "target_model":   target_model,
            "count":          len(fields),
            "fields":         fields,
        })

    # ── POST: create ─────────────────────────────────────────────────────────
    body = request.data

    cooperative_id = body.get("cooperative_id")
    target_model   = body.get("target_model")
    label          = (body.get("label") or "").strip()

    if not cooperative_id:
        return Response({"error": "cooperative_id is required."}, status=400)
    if not target_model:
        return Response({"error": "target_model is required."}, status=400)
    if not label:
        return Response({"error": "label is required."}, status=400)

    access_err = _assert_cooperative_access(request.user, cooperative_id)
    if access_err:
        return Response({"error": access_err}, status=403)

    try:
        dfd = register_field(
            cooperative_id    = cooperative_id,
            target_model      = target_model,
            label             = label,
            display_type      = body.get("display_type", "text"),
            tag               = body.get("tag", "INFORMATIONAL"),
            is_required       = bool(body.get("is_required", False)),
            help_text_display = body.get("help_text", ""),
            placeholder       = body.get("placeholder", ""),
            options           = body.get("options", []),
            validation_rules  = body.get("validation_rules", {}),
            field_key         = body.get("field_key") or None,
            created_by_id     = request.user.id,
        )
    except DuplicateFieldError as exc:
        return Response(
            {
                "error":              "duplicate_field",
                "conflict_type":      exc.result.conflict_type,
                "conflicting_labels": exc.result.conflicting_labels,
                "message":            exc.result.message,
            },
            status=409,
        )
    except ValidationError as exc:
        return Response(
            {"error": "validation_error", "detail": exc.message},
            status=400,
        )

    return Response(
        _serialize_dfd(dfd),
        status=201,
    )


# ══════════════════════════════════════════════════════════════════
#  RETRIEVE + UPDATE + DELETE
# ══════════════════════════════════════════════════════════════════

@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def dynamic_field_detail_view(request, dfd_id: str):

    try:
        from core.models import DynamicFieldDefinition
        dfd = DynamicFieldDefinition.objects.get(pk=dfd_id)
    except DynamicFieldDefinition.DoesNotExist:
        return Response({"error": "Field definition not found."}, status=404)

    access_err = _assert_cooperative_access(request.user, str(dfd.cooperative_id))
    if access_err:
        return Response({"error": access_err}, status=403)

    # ── GET ──────────────────────────────────────────────────────────────────
    if request.method == "GET":
        return Response(_serialize_dfd(dfd))

    # ── PATCH ────────────────────────────────────────────────────────────────
    if request.method == "PATCH":
        body = request.data

        try:
            updated = update_field(
                dfd_id            = dfd_id,
                label             = body.get("label"),
                display_type      = body.get("display_type"),
                tag               = body.get("tag"),
                is_required       = body.get("is_required"),
                help_text_display = body.get("help_text"),
                placeholder       = body.get("placeholder"),
                options           = body.get("options"),
                validation_rules  = body.get("validation_rules"),
            )
        except DuplicateFieldError as exc:
            return Response(
                {
                    "error":              "duplicate_field",
                    "conflict_type":      exc.result.conflict_type,
                    "conflicting_labels": exc.result.conflicting_labels,
                    "message":            exc.result.message,
                },
                status=409,
            )
        except FieldLockedError as exc:
            return Response({"error": str(exc)}, status=409)
        except ValidationError as exc:
            return Response(
                {"error": "validation_error", "detail": exc.message},
                status=400,
            )

        return Response(_serialize_dfd(updated))

    # ── DELETE (soft) ────────────────────────────────────────────────────────
    if request.method == "DELETE":
        deactivate_field(dfd_id)
        return Response({
            "message": (
                f'Field "{dfd.label}" has been deactivated. '
                f'Its key "{dfd.field_key}" is preserved permanently '
                f'and all historical data remains intact.'
            ),
            "field": _serialize_dfd(dfd),
        })


# ══════════════════════════════════════════════════════════════════
#  PRE-FLIGHT CONFLICT CHECK  (called while user types)
# ══════════════════════════════════════════════════════════════════

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def dynamic_field_check_view(request):
    """
    Pre-flight check: is a label safe to register?

    Query params:
      cooperative_id  (required)
      target_model    (required)
      label           (required)
      exclude_id      (optional — omit when creating, pass dfd UUID when editing)

    Returns 200 always.  Read response.is_conflict.

    Response:
    {
        "is_conflict":        bool,
        "conflict_type":      str,
        "conflicting_labels": list[str],
        "message":            str,
        "suggested_key":      str,
        "semantic_issues":    list[dict],
        "error_count":        int,
        "warning_count":      int,
        "can_save":           bool,
    }
    """
    cooperative_id = request.GET.get("cooperative_id")
    target_model   = request.GET.get("target_model")
    label          = (request.GET.get("label") or "").strip()
    exclude_id     = request.GET.get("exclude_id") or None
    display_type   = (request.GET.get("display_type") or "text").strip()

    if not cooperative_id or not target_model or not label:
        return Response(
            {"error": "cooperative_id, target_model, and label are all required."},
            status=400,
        )

    access_err = _assert_cooperative_access(request.user, cooperative_id)
    if access_err:
        return Response({"error": access_err}, status=403)

    result = check_label_conflict(cooperative_id, target_model, label, exclude_id=exclude_id)
    semantic_issues = preview_field_semantics(
        cooperative_id=cooperative_id,
        target_model=target_model,
        label=label,
        display_type=display_type,
        exclude_id=exclude_id,
    )
    error_count = sum(1 for issue in semantic_issues if issue["severity"] == "ERROR")
    warning_count = sum(1 for issue in semantic_issues if issue["severity"] == "WARNING")
    return Response({
        "is_conflict":        result.is_conflict,
        "conflict_type":      result.conflict_type,
        "conflicting_labels": result.conflicting_labels,
        "message":            result.message,
        "suggested_key":      slugify_to_field_key(label),
        "semantic_issues":    semantic_issues,
        "error_count":        error_count,
        "warning_count":      warning_count,
        "can_save":           error_count == 0,
    })


# ══════════════════════════════════════════════════════════════════
#  FULL SCHEMA  (for Form Builder editor)
#  Returns skeleton discriminator field + all cooperative-defined fields
# ══════════════════════════════════════════════════════════════════

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def dynamic_field_schema_view(request, target_model: str):
    """
    Return the merged schema for a (cooperative, target_model):
      - The skeleton discriminator field (system-defined, read-only)
      - All cooperative-defined active DynamicFieldDefinitions

    Query params:
      cooperative_id  (required)
    """
    cooperative_id = request.GET.get("cooperative_id")
    if not cooperative_id:
        return Response({"error": "cooperative_id is required."}, status=400)

    access_err = _assert_cooperative_access(request.user, cooperative_id)
    if access_err:
        return Response({"error": access_err}, status=403)

    _SKELETONS: dict[str, dict] = {
        "MEMBER": {
            "field_key":    "member_number",
            "label":        "Member Number",
            "display_type": "text",
            "is_system":    True,
            "is_required":  True,
            "help_text":    "System-assigned member identifier. Unique within this cooperative.",
            "editable":     False,
        },
        "PRODUCTION": {
            "field_key":    "record_date",
            "label":        "Record Date",
            "display_type": "date",
            "is_system":    True,
            "is_required":  True,
            "help_text":    "Date of the production event. Required for analytics.",
            "editable":     False,
        },
        "LIVESTOCK": {
            "field_key":    "event_type",
            "label":        "Event Type",
            "display_type": "dropdown",
            "is_system":    True,
            "is_required":  True,
            "help_text":    "Category of livestock event.",
            "options":      [
                "VACCINATION", "TREATMENT", "DISEASE", "ROUTINE_CHECK",
                "BIRTH", "DEATH", "SALE", "PURCHASE", "OTHER",
            ],
            "editable":     False,
        },
        "GOVERNANCE": {
            "field_key":    "record_type",
            "label":        "Record Type",
            "display_type": "dropdown",
            "is_system":    True,
            "is_required":  True,
            "help_text":    "Category of governance record.",
            "options":      ["MEETING", "RESOLUTION", "AUDIT", "CERTIFICATE", "OTHER"],
            "editable":     False,
        },
        "FINANCE": {
            "field_key":    "category",
            "label":        "Category",
            "display_type": "dropdown",
            "is_system":    True,
            "is_required":  True,
            "help_text":    "Financial record category.",
            "options":      [
                "CONTRIBUTION", "LOAN_REPAY", "SAVINGS",
                "REVENUE", "EXPENDITURE", "DIVIDEND", "OTHER",
            ],
            "editable":     False,
        },
        "LAND": {
            "field_key":    "member",
            "label":        "Member",
            "display_type": "relation",
            "is_system":    True,
            "is_required":  True,
            "help_text":    "Member who owns this land parcel.",
            "editable":     False,
        },
        "HERD": {
            "field_key":    "member",
            "label":        "Member",
            "display_type": "relation",
            "is_system":    True,
            "is_required":  True,
            "help_text":    "Member who owns this herd.",
            "editable":     False,
        },
    }

    skeleton = _SKELETONS.get(target_model.upper())
    cooperative_fields = get_field_schema(cooperative_id, target_model)

    return Response({
        "target_model":       target_model,
        "cooperative_id":     cooperative_id,
        "skeleton_field":     skeleton,
        "cooperative_fields": cooperative_fields,
        "total_fields":       (1 if skeleton else 0) + len(cooperative_fields),
    })
