"""
ShambaFlow – Form Builder Views
================================
Adaptive Convergence: functional views, no ViewSets, no OOP.

Permission model:
  Chair → full access (bypasses all checks)
  Helper → governed by RolePermission[FORM_BUILDER]:
    can_view            → read templates, fields, issues
    can_create/can_edit → add/edit templates and fields
    can_edit_templates  → activate templates (high-impact: goes live)
  Buyer / Platform → 403

Endpoints:
  GET/POST   /api/form-builder/{cid}/templates/
  GET/PUT/DEL /api/form-builder/{cid}/templates/{tid}/
  POST        /api/form-builder/{cid}/templates/{tid}/validate/
  POST        /api/form-builder/{cid}/templates/{tid}/activate/
  POST        /api/form-builder/{cid}/templates/{tid}/duplicate/
  GET/POST    /api/form-builder/{cid}/templates/{tid}/fields/
  POST        /api/form-builder/{cid}/templates/{tid}/fields/reorder/
  GET/PUT/DEL /api/form-builder/{cid}/templates/{tid}/fields/{fid}/
  GET         /api/form-builder/{cid}/templates/{tid}/issues/
  POST        /api/form-builder/{cid}/templates/{tid}/issues/{iid}/acknowledge/
  POST        /api/form-builder/{cid}/submit/{tid}/
  GET         /api/form-builder/{cid}/templates/{tid}/submissions/
  GET         /api/form-builder/model-fields/{target}/
"""

from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import Max
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

import re

from core.models import (
    Cooperative, FormField, FormFieldSemanticIssue, FormSubmission, FormTemplate,
    User,
)
from core.services.form_semantic import (
    FORM_BUILDER_TARGET_MODELS,
    get_model_fields_info,
    refresh_template_semantic_state,
    slugify_to_field_key,
    validate_custom_key,
)
from core.services.form_submission import get_submission_history, submit_form, submit_form_with_member_context


# ══════════════════════════════════════════════════════════════════
#  GUARDS
# ══════════════════════════════════════════════════════════════════

def _get_coop(cooperative_id: str):
    try:
        return Cooperative.objects.get(pk=cooperative_id)
    except (Cooperative.DoesNotExist, Exception):
        return None


def _check_perm(user: User, coop: Cooperative, action: str) -> bool:
    """action: 'view' | 'create' | 'edit' | 'delete' | 'activate'"""
    if user.is_chair and str(user.cooperative_id) == str(coop.id):
        return True
    if not user.is_helper or str(user.cooperative_id) != str(coop.id):
        return False
    if action == "activate":
        return user.has_cooperative_permission("FORM_BUILDER", "can_edit_templates")
    return user.has_cooperative_permission("FORM_BUILDER", f"can_{action}")


def _deny(msg: str = "perform this action") -> Response:
    return Response({"error": f"Permission denied: {msg}."}, status=403)


# ══════════════════════════════════════════════════════════════════
#  SERIALISERS  (plain dicts — no DRF Serializer classes)
# ══════════════════════════════════════════════════════════════════

def _ser_issue(iss: FormFieldSemanticIssue) -> dict:
    return {
        "id":                   str(iss.id),
        "issue_type":           iss.issue_type,
        "severity":             iss.severity,
        "description":          iss.description,
        "suggestion":           iss.suggestion,
        "is_acknowledged":      iss.is_acknowledged,
        "acknowledged_at":      iss.acknowledged_at.isoformat() if iss.acknowledged_at else None,
        "acknowledged_by":      iss.acknowledged_by.full_name if iss.acknowledged_by else None,
        "affected_field":       str(iss.affected_field_id) if iss.affected_field_id else None,
        "affected_field_label": iss.affected_field.label if iss.affected_field_id else None,
        "conflicting_field":    str(iss.conflicting_field_id) if iss.conflicting_field_id else None,
        "conflicting_field_label": iss.conflicting_field.label if iss.conflicting_field_id else None,
        "affected_field_id":    str(iss.affected_field_id) if iss.affected_field_id else None,
        "conflicting_field_id": str(iss.conflicting_field_id) if iss.conflicting_field_id else None,
        "can_be_acknowledged":  iss.can_be_acknowledged,
        "is_blocking":          iss.is_blocking,
    }


def _ser_field(field: FormField, with_issues: bool = False) -> dict:
    d = {
        "id":                   str(field.id),
        "label":                field.label,
        "display_type":         field.display_type,
        "tag":                  field.tag,
        "field_order":          field.field_order,
        "placeholder":          field.placeholder,
        "help_text":            field.help_text,
        "is_required":          field.is_required,
        "is_model_required":    field.is_model_required,
        "default_value":        field.default_value,
        "maps_to_model_field":  field.maps_to_model_field,
        "is_custom_field":      field.is_custom_field,
        "options":              field.options,
        "validation_rules":     field.validation_rules,
        "conditional_rule":     field.conditional_rule,
        "created_at":           field.created_at.isoformat(),
        "updated_at":           field.updated_at.isoformat(),
    }
    if with_issues:
        d["issues"] = [_ser_issue(i) for i in field.semantic_issues.all()]
    return d


def _ser_template(t: FormTemplate, with_fields: bool = False, with_issues: bool = False) -> dict:
    d = {
        "id":                   str(t.id),
        "name":                 t.name,
        "target_model":         t.target_model,
        "target_model_display": t.get_target_model_display(),
        "description":          t.description,
        "status":               t.status,
        "status_display":       t.get_status_display(),
        "is_default":           t.is_default,
        "version":              t.version,
        "parent_version_id":    str(t.parent_version_id) if t.parent_version_id else None,
        "has_blocking_errors":  t.has_blocking_errors,
        "field_defaults":       t.field_defaults,
        "change_note":          t.change_note,
        "created_by":           t.created_by.full_name if t.created_by else None,
        "created_at":           t.created_at.isoformat(),
        "updated_at":           t.updated_at.isoformat(),
        "field_count":          t.fields.count(),
        "issue_count":          t.semantic_issues.filter(is_acknowledged=False).count(),
        "error_count":          t.semantic_issues.filter(severity="ERROR").count(),
        "warning_count":        t.semantic_issues.filter(severity="WARNING", is_acknowledged=False).count(),
    }
    if with_fields:
        d["fields"] = [
            _ser_field(f, with_issues=with_issues)
            for f in t.fields.order_by("field_order", "created_at", "id").prefetch_related("semantic_issues")
        ]
    if with_issues and not with_fields:
        d["issues"] = [
            _ser_issue(i)
            for i in t.semantic_issues.select_related("affected_field", "conflicting_field")
            .order_by("severity", "issue_type")
        ]
    return d


# ══════════════════════════════════════════════════════════════════
#  VALIDATION PERSISTENCE
# ══════════════════════════════════════════════════════════════════

def _persist_issues(template: FormTemplate, new_issues: list[dict]) -> None:
    """
    Smart merge:
    - Delete stale unacknowledged issues
    - Preserve acknowledged WARNINGs whose (type, field, conflicting) still appear
    - Create new issue records for everything else
    - Update template.has_blocking_errors and template.status
    """
    def sig(d):
        return (d["issue_type"], d.get("affected_field_id"), d.get("conflicting_field_id"))

    new_sigs = {sig(i) for i in new_issues}

    existing = list(template.semantic_issues.all())
    keep_ids = set()
    for ex in existing:
        ex_sig = (
            ex.issue_type,
            str(ex.affected_field_id) if ex.affected_field_id else None,
            str(ex.conflicting_field_id) if ex.conflicting_field_id else None,
        )
        if ex.is_acknowledged and ex.severity == "WARNING" and ex_sig in new_sigs:
            keep_ids.add(str(ex.id))

    template.semantic_issues.exclude(id__in=keep_ids).delete()

    already = set()
    for ex in existing:
        if str(ex.id) in keep_ids:
            already.add((
                ex.issue_type,
                str(ex.affected_field_id) if ex.affected_field_id else None,
                str(ex.conflicting_field_id) if ex.conflicting_field_id else None,
            ))

    for issue in new_issues:
        if sig(issue) in already:
            continue

        affected = None
        if issue.get("affected_field_id"):
            try:
                affected = FormField.objects.get(pk=issue["affected_field_id"])
            except FormField.DoesNotExist:
                continue  # field deleted mid-validation

        # MISSING_REQUIRED has no affected_field — that's intentional
        if affected is None and issue["issue_type"] != "MISSING_REQUIRED":
            continue

        conflicting = None
        if issue.get("conflicting_field_id"):
            try:
                conflicting = FormField.objects.get(pk=issue["conflicting_field_id"])
            except FormField.DoesNotExist:
                pass

        FormFieldSemanticIssue.objects.create(
            template          = template,
            affected_field    = affected,
            conflicting_field = conflicting,
            issue_type        = issue["issue_type"],
            severity          = issue["severity"],
            description       = issue["description"],
            suggestion        = issue.get("suggestion", ""),
        )

    any_errors = template.semantic_issues.filter(severity="ERROR").exists()
    template.has_blocking_errors = any_errors
    if any_errors:
        template.status = FormTemplate.Status.HAS_ISSUES
    elif template.status in (FormTemplate.Status.VALIDATING, FormTemplate.Status.HAS_ISSUES):
        template.status = FormTemplate.Status.DRAFT
    template.save(update_fields=["has_blocking_errors", "status"])


# ══════════════════════════════════════════════════════════════════
#  MODEL FIELDS INTROSPECTION
# ══════════════════════════════════════════════════════════════════

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def model_fields_view(request, target_model: str):
    """GET /api/form-builder/model-fields/{target_model}/"""
    key = target_model.upper()
    if key not in FORM_BUILDER_TARGET_MODELS:
        return Response({
            "error": f'Unknown target model "{key}".',
            "valid_targets": list(FORM_BUILDER_TARGET_MODELS.keys()),
        }, status=400)

    fields_info = get_model_fields_info(key)

    # Mark already-mapped if template_id provided
    template_id = request.query_params.get("template_id")
    already_mapped: set = set()
    if template_id:
        already_mapped = set(
            FormField.objects.filter(template_id=template_id)
            .values_list("maps_to_model_field", flat=True)
        )
    for fi in fields_info:
        fi["is_already_mapped"] = fi["field_name"] in already_mapped

    return Response({
        "target_model": key,
        "model_name":   FORM_BUILDER_TARGET_MODELS[key],
        "fields":       fields_info,
        "total":        len(fields_info),
    })


# ══════════════════════════════════════════════════════════════════
#  TEMPLATE LIST + CREATE
# ══════════════════════════════════════════════════════════════════

@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def template_list_view(request, cooperative_id: str):
    """GET/POST /api/form-builder/{cid}/templates/"""
    coop = _get_coop(cooperative_id)
    if not coop:
        return Response({"error": "Cooperative not found."}, status=404)
    user: User = request.user

    if request.method == "GET":
        if not _check_perm(user, coop, "view"):
            return _deny("view templates")
        qs = FormTemplate.objects.filter(cooperative=coop)
        target = (request.query_params.get("target_model") or "").upper()
        if target:
            qs = qs.filter(target_model=target)
        status_f = (request.query_params.get("status") or "").upper()
        if status_f:
            qs = qs.filter(status=status_f)
        qs = qs.select_related("created_by").order_by("target_model", "-version")
        page      = int(request.query_params.get("page", 1))
        page_size = int(request.query_params.get("page_size", 30))
        paginator = Paginator(qs, page_size)
        page_obj  = paginator.get_page(page)
        return Response({
            "data":        [_ser_template(t) for t in page_obj.object_list],
            "page":        page,
            "total_pages": paginator.num_pages,
            "total_count": paginator.count,
        })

    # POST
    if not _check_perm(user, coop, "create"):
        return _deny("create templates")
    name         = (request.data.get("name") or "").strip()
    target_model = (request.data.get("target_model") or "").upper()
    if not name:
        return Response({"error": "name is required."}, status=400)
    if target_model not in FORM_BUILDER_TARGET_MODELS:
        return Response({"error": f'Invalid target_model "{target_model}".', "valid": list(FORM_BUILDER_TARGET_MODELS)}, status=400)

    template = FormTemplate.objects.create(
        cooperative  = coop,
        name         = name,
        target_model = target_model,
        description  = request.data.get("description", ""),
        status       = FormTemplate.Status.DRAFT,
        version      = 1,
        created_by   = user,
    )
    return Response(_ser_template(template), status=201)


# ══════════════════════════════════════════════════════════════════
#  TEMPLATE DETAIL + UPDATE + DELETE
# ══════════════════════════════════════════════════════════════════

@api_view(["GET", "PUT", "DELETE"])
@permission_classes([IsAuthenticated])
def template_detail_view(request, cooperative_id: str, template_id: str):
    """GET/PUT/DEL /api/form-builder/{cid}/templates/{tid}/"""
    coop = _get_coop(cooperative_id)
    if not coop:
        return Response({"error": "Cooperative not found."}, status=404)
    try:
        tmpl = FormTemplate.objects.select_related("created_by", "parent_version").get(pk=template_id, cooperative=coop)
    except FormTemplate.DoesNotExist:
        return Response({"error": "Template not found."}, status=404)
    user: User = request.user

    if request.method == "GET":
        if not _check_perm(user, coop, "view"):
            return _deny("view templates")
        avail = get_model_fields_info(tmpl.target_model)
        mapped = {f.maps_to_model_field for f in tmpl.fields.all()}
        for fi in avail:
            fi["is_already_mapped"] = fi["field_name"] in mapped
        data = _ser_template(tmpl, with_fields=True, with_issues=True)
        data["available_model_fields"] = avail
        data["submission_count"] = FormSubmission.objects.filter(template=tmpl).count()
        return Response(data)

    if request.method == "PUT":
        if not _check_perm(user, coop, "edit"):
            return _deny("edit templates")
        if tmpl.status == FormTemplate.Status.ACTIVE:
            return Response({"error": "Active templates cannot be edited. Duplicate to create a new version."}, status=400)
        for attr in ("name", "description", "change_note", "is_default", "field_defaults"):
            if attr in request.data:
                val = request.data[attr]
                if attr == "is_default":
                    val = bool(val)
                setattr(tmpl, attr, val)
        tmpl.save()
        return Response(_ser_template(tmpl, with_fields=True))

    # DELETE
    if not _check_perm(user, coop, "delete"):
        return _deny("delete templates")
    if tmpl.status == FormTemplate.Status.ACTIVE:
        return Response({"error": "Deactivate the template before deleting it."}, status=400)
    if FormSubmission.objects.filter(template=tmpl).exists():
        return Response({"error": "Templates with submissions cannot be deleted. Deactivate instead."}, status=400)
    tmpl.delete()
    return Response({"message": "Template deleted."}, status=204)


# ══════════════════════════════════════════════════════════════════
#  VALIDATE
# ══════════════════════════════════════════════════════════════════

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def template_validate_view(request, cooperative_id: str, template_id: str):
    """POST /api/form-builder/{cid}/templates/{tid}/validate/"""
    coop = _get_coop(cooperative_id)
    if not coop:
        return Response({"error": "Cooperative not found."}, status=404)
    try:
        tmpl = FormTemplate.objects.get(pk=template_id, cooperative=coop)
    except FormTemplate.DoesNotExist:
        return Response({"error": "Template not found."}, status=404)
    if not _check_perm(request.user, coop, "edit"):
        return _deny("validate templates")
    if tmpl.fields.count() == 0:
        return Response({"error": "Add at least one field before validating."}, status=400)

    tmpl.status = FormTemplate.Status.VALIDATING
    tmpl.save(update_fields=["status"])

    refresh_template_semantic_state(tmpl)
    tmpl.refresh_from_db()

    issues = [
        _ser_issue(i)
        for i in tmpl.semantic_issues
        .select_related("affected_field", "conflicting_field")
        .order_by("severity", "issue_type")
    ]
    return Response({
        "status":              tmpl.status,
        "template_status":     tmpl.status,
        "has_blocking_errors": tmpl.has_blocking_errors,
        "issue_count":         len(issues),
        "error_count":         sum(1 for i in issues if i["severity"] == "ERROR"),
        "warning_count":       sum(1 for i in issues if i["severity"] == "WARNING"),
        "issues":              issues,
        "can_activate":        not tmpl.has_blocking_errors,
    })


# ══════════════════════════════════════════════════════════════════
#  ACTIVATE
# ══════════════════════════════════════════════════════════════════

@api_view(["POST"])
@permission_classes([IsAuthenticated])
@transaction.atomic
def template_activate_view(request, cooperative_id: str, template_id: str):
    """POST /api/form-builder/{cid}/templates/{tid}/activate/"""
    coop = _get_coop(cooperative_id)
    if not coop:
        return Response({"error": "Cooperative not found."}, status=404)
    try:
        tmpl = FormTemplate.objects.get(pk=template_id, cooperative=coop)
    except FormTemplate.DoesNotExist:
        return Response({"error": "Template not found."}, status=404)
    if not _check_perm(request.user, coop, "activate"):
        return _deny("activate templates")
    if tmpl.fields.count() == 0:
        return Response({"error": "A template must have at least one field to activate."}, status=400)

    # Always re-run validation as the final safety gate
    refresh_template_semantic_state(tmpl)
    tmpl.refresh_from_db()

    if tmpl.has_blocking_errors:
        blocking = [_ser_issue(i) for i in tmpl.semantic_issues.filter(severity="ERROR")]
        return Response({"error": "Cannot activate: unresolved errors exist.", "blocking_issues": blocking}, status=400)

    # Document auto-injected fields in field_defaults
    all_fields   = {fi["field_name"] for fi in get_model_fields_info(tmpl.target_model)}
    covered      = set(tmpl.fields.values_list("maps_to_model_field", flat=True))
    auto_fields  = {"cooperative", "recorded_by", "added_by"}
    defaults     = dict(tmpl.field_defaults or {})
    for af in auto_fields:
        if af in (all_fields - covered):
            defaults.setdefault(af, "__auto__")
    tmpl.field_defaults = defaults

    # Deactivate existing active template for same (coop, target_model)
    FormTemplate.objects.filter(
        cooperative=coop, target_model=tmpl.target_model, status=FormTemplate.Status.ACTIVE,
    ).exclude(pk=tmpl.pk).update(status=FormTemplate.Status.INACTIVE, is_default=False)

    # Assign as default if none exists
    if not FormTemplate.objects.filter(cooperative=coop, target_model=tmpl.target_model, is_default=True, status=FormTemplate.Status.ACTIVE).exists():
        tmpl.is_default = True

    tmpl.status = FormTemplate.Status.ACTIVE
    tmpl.save(update_fields=["status", "is_default", "field_defaults"])
    return Response({"message": f'"{tmpl.name}" is now ACTIVE.', "template": _ser_template(tmpl)})


# ══════════════════════════════════════════════════════════════════
#  DUPLICATE
# ══════════════════════════════════════════════════════════════════

@api_view(["POST"])
@permission_classes([IsAuthenticated])
@transaction.atomic
def template_duplicate_view(request, cooperative_id: str, template_id: str):
    """POST /api/form-builder/{cid}/templates/{tid}/duplicate/"""
    coop = _get_coop(cooperative_id)
    if not coop:
        return Response({"error": "Cooperative not found."}, status=404)
    try:
        src = FormTemplate.objects.get(pk=template_id, cooperative=coop)
    except FormTemplate.DoesNotExist:
        return Response({"error": "Template not found."}, status=404)
    if not _check_perm(request.user, coop, "create"):
        return _deny("duplicate templates")

    new_name = (request.data.get("name") or f"{src.name} (Copy)").strip()
    note     = request.data.get("change_note", f"Duplicated from v{src.version}")

    new_tmpl = FormTemplate.objects.create(
        cooperative    = coop,
        name           = new_name,
        target_model   = src.target_model,
        description    = src.description,
        status         = FormTemplate.Status.DRAFT,
        version        = src.version + 1,
        parent_version = src,
        created_by     = request.user,
        change_note    = note,
        field_defaults = dict(src.field_defaults or {}),
        is_default     = False,
    )
    for f in src.fields.order_by("field_order"):
        FormField.objects.create(
            template=new_tmpl, label=f.label, display_type=f.display_type,
            tag=f.tag, field_order=f.field_order, placeholder=f.placeholder,
            help_text=f.help_text, is_required=f.is_required,
            is_model_required=f.is_model_required, default_value=f.default_value,
            maps_to_model_field=f.maps_to_model_field,
            is_custom_field=f.is_custom_field,
            options=list(f.options or []),
            validation_rules=dict(f.validation_rules or {}),
            conditional_rule=dict(f.conditional_rule or {}),
        )
    return Response(_ser_template(new_tmpl, with_fields=True), status=201)


# ══════════════════════════════════════════════════════════════════
#  FIELD LIST + CREATE
# ══════════════════════════════════════════════════════════════════

def _get_tmpl(cooperative_id: str, template_id: str):
    coop = _get_coop(cooperative_id)
    if not coop:
        return coop, None
    try:
        return coop, FormTemplate.objects.get(pk=template_id, cooperative=coop)
    except FormTemplate.DoesNotExist:
        return coop, None


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def field_list_view(request, cooperative_id: str, template_id: str):
    """GET/POST /api/form-builder/{cid}/templates/{tid}/fields/"""
    coop, tmpl = _get_tmpl(cooperative_id, template_id)
    if not coop:
        return Response({"error": "Cooperative not found."}, status=404)
    if not tmpl:
        return Response({"error": "Template not found."}, status=404)
    user: User = request.user

    if request.method == "GET":
        if not _check_perm(user, coop, "view"):
            return _deny("view fields")
        return Response([_ser_field(f, with_issues=True) for f in tmpl.fields.order_by("field_order", "created_at", "id").prefetch_related("semantic_issues")])

    # POST
    if not _check_perm(user, coop, "create"):
        return _deny("add fields")
    if tmpl.status == FormTemplate.Status.ACTIVE:
        return Response({"error": "Cannot add fields to an ACTIVE template. Duplicate it first."}, status=400)

    label            = (request.data.get("label") or "").strip()
    display_type     = request.data.get("display_type", "text")
    is_custom_field  = bool(request.data.get("is_custom_field", False))

    if not label:
        return Response({"error": "label is required."}, status=400)

    # ── Resolve maps_to_model_field ────────────────────────────────────────
    #
    # Auto-detection rule:
    #   If the caller did not explicitly pass is_custom_field=False AND the
    #   supplied maps_to_model_field is not a real column on the target Django
    #   model, treat it as a custom field (stored in extra_data).
    #
    #   This covers the common case where the frontend sends a DFD field_key
    #   (e.g. "member_phone_number") without explicitly setting is_custom_field.
    #
    raw_mf = (request.data.get("maps_to_model_field") or "").strip()
    caller_explicitly_said_not_custom = (
        "is_custom_field" in request.data and not is_custom_field
    )

    if not is_custom_field and not caller_explicitly_said_not_custom and raw_mf:
        # Probe the model: if the column does not exist, it must be a custom key.
        target_class = tmpl.target_model_class
        if target_class:
            try:
                target_class._meta.get_field(raw_mf)
                # Field exists on the model -> keep is_custom_field=False
            except Exception:
                # Column not found -> auto-promote to custom field
                is_custom_field = True

    if is_custom_field:
        # Custom field: key provided by user or auto-derived from label
        raw_key = raw_mf or slugify_to_field_key(label)
        key_error = validate_custom_key(raw_key)
        if key_error:
            return Response({"error": key_error}, status=400)
        maps_to_model_field = raw_key
        is_model_required = False
        try:
            from core.models import DynamicFieldDefinition
            dfd = DynamicFieldDefinition.objects.get(
                cooperative=tmpl.cooperative,
                target_model=tmpl.target_model,
                field_key=maps_to_model_field,
                is_active=True,
            )
            label = dfd.label
            display_type = dfd.display_type
            tag = dfd.tag
        except DynamicFieldDefinition.DoesNotExist:
            tag = request.data.get("tag", "INFORMATIONAL")
    else:
        # Real field: must map to an existing model column
        maps_to_model_field = raw_mf
        if not maps_to_model_field:
            return Response({"error": "maps_to_model_field is required."}, status=400)
        target_class = tmpl.target_model_class
        is_model_required = False
        if target_class:
            try:
                mf = target_class._meta.get_field(maps_to_model_field)
                is_model_required = (
                    not getattr(mf, "null", True)
                    and not getattr(mf, "blank", True)
                    and str(type(getattr(mf, "default", None)))
                    == "<class 'django.db.models.fields.NOT_PROVIDED'>"
                )
            except Exception:
                return Response(
                    {"error": f'"{maps_to_model_field}" is not a valid field on {tmpl.target_model}.'},
                    status=400,
                )

    if tmpl.fields.filter(maps_to_model_field=maps_to_model_field).exists():
        return Response(
            {"error": f'A field mapping to "{maps_to_model_field}" already exists in this template.'},
            status=400,
        )

    field_order = request.data.get("field_order", None)
    if field_order is None:
        field_order = (tmpl.fields.aggregate(m=Max("field_order")).get("m") or 0) + 1
    else:
        try:
            field_order = int(field_order)
        except (TypeError, ValueError):
            return Response({"error": "field_order must be an integer."}, status=400)

    field = FormField.objects.create(
        template=tmpl, label=label, display_type=display_type,
        tag=tag if is_custom_field else request.data.get("tag", "INFORMATIONAL"),
        field_order=field_order,
        placeholder=request.data.get("placeholder", ""),
        help_text=request.data.get("help_text", ""),
        is_required=bool(request.data.get("is_required", False)),
        is_model_required=is_model_required,
        is_custom_field=is_custom_field,
        default_value=request.data.get("default_value", ""),
        maps_to_model_field=maps_to_model_field,
        options=request.data.get("options", []),
        validation_rules=request.data.get("validation_rules", {}),
        conditional_rule=request.data.get("conditional_rule", {}),
    )
    # Reset to DRAFT whenever schema changes
    if tmpl.status not in (FormTemplate.Status.DRAFT,):
        tmpl.status = FormTemplate.Status.DRAFT
        tmpl.save(update_fields=["status"])

    return Response(_ser_field(field), status=201)


# ══════════════════════════════════════════════════════════════════
#  FIELD DETAIL + UPDATE + DELETE
# ══════════════════════════════════════════════════════════════════

@api_view(["GET", "PUT", "DELETE"])
@permission_classes([IsAuthenticated])
@transaction.atomic
def field_detail_view(request, cooperative_id: str, template_id: str, field_id: str):
    """GET/PUT/DEL /api/form-builder/{cid}/templates/{tid}/fields/{fid}/"""
    coop, tmpl = _get_tmpl(cooperative_id, template_id)
    if not coop:
        return Response({"error": "Cooperative not found."}, status=404)
    if not tmpl:
        return Response({"error": "Template not found."}, status=404)
    try:
        field = FormField.objects.get(pk=field_id, template=tmpl)
    except FormField.DoesNotExist:
        return Response({"error": "Field not found."}, status=404)
    user: User = request.user

    if request.method == "GET":
        if not _check_perm(user, coop, "view"):
            return _deny("view fields")
        return Response(_ser_field(field, with_issues=True))

    if tmpl.status == FormTemplate.Status.ACTIVE:
        return Response({"error": "Cannot modify fields on an ACTIVE template. Duplicate it first."}, status=400)

    if request.method == "PUT":
        if not _check_perm(user, coop, "edit"):
            return _deny("edit fields")
        registry_dfd = None
        if field.is_custom_field:
            try:
                from core.models import DynamicFieldDefinition
                registry_dfd = DynamicFieldDefinition.objects.get(
                    cooperative=tmpl.cooperative,
                    target_model=tmpl.target_model,
                    field_key=field.maps_to_model_field,
                    is_active=True,
                )
            except DynamicFieldDefinition.DoesNotExist:
                registry_dfd = None

        for attr in ("label", "display_type", "tag", "field_order", "placeholder",
                     "help_text", "is_required", "default_value", "options",
                     "validation_rules", "conditional_rule"):
            if attr in request.data:
                setattr(field, attr, request.data[attr])
        if "maps_to_model_field" in request.data:
            new_mf = request.data["maps_to_model_field"].strip()
            if new_mf != field.maps_to_model_field:
                if tmpl.fields.filter(maps_to_model_field=new_mf).exclude(pk=field.pk).exists():
                    return Response({"error": f'Another field already maps to "{new_mf}".'}, status=400)
                target_class = tmpl.target_model_class
                if target_class:
                    try:
                        mf_obj = target_class._meta.get_field(new_mf)
                        # Real model column: update required flag
                        field.is_model_required = (
                            not getattr(mf_obj, "null", True)
                            and not getattr(mf_obj, "blank", True)
                            and str(type(getattr(mf_obj, "default", None))) == "<class 'django.db.models.fields.NOT_PROVIDED'>"
                        )
                        field.is_custom_field = False
                    except Exception:
                        # Not a model column -> treat as a custom field (DFD key)
                        field.is_custom_field = True
                        field.is_model_required = False
                field.maps_to_model_field = new_mf
                if field.is_custom_field:
                    try:
                        from core.models import DynamicFieldDefinition
                        registry_dfd = DynamicFieldDefinition.objects.get(
                            cooperative=tmpl.cooperative,
                            target_model=tmpl.target_model,
                            field_key=field.maps_to_model_field,
                            is_active=True,
                        )
                    except DynamicFieldDefinition.DoesNotExist:
                        registry_dfd = None

        if field.is_custom_field and registry_dfd is not None:
            field.label = registry_dfd.label
            field.display_type = registry_dfd.display_type
            field.tag = registry_dfd.tag

        field.save()
        if tmpl.status not in (FormTemplate.Status.DRAFT,):
            tmpl.status = FormTemplate.Status.DRAFT
            tmpl.save(update_fields=["status"])
        return Response(_ser_field(field, with_issues=True))

    # DELETE
    if not _check_perm(user, coop, "delete"):
        return _deny("delete fields")
    if field.is_model_required:
        if field.maps_to_model_field not in (tmpl.field_defaults or {}):
            if not tmpl.fields.exclude(pk=field.pk).filter(maps_to_model_field=field.maps_to_model_field).exists():
                return Response({"error": f'Cannot delete "{field.label}": "{field.maps_to_model_field}" is required and not in field_defaults.'}, status=400)
    field.delete()
    tmpl.status = FormTemplate.Status.DRAFT
    tmpl.save(update_fields=["status"])
    return Response({"message": "Field deleted."}, status=204)


# ══════════════════════════════════════════════════════════════════
#  FIELD REORDER
# ══════════════════════════════════════════════════════════════════

@api_view(["POST"])
@permission_classes([IsAuthenticated])
@transaction.atomic
def field_reorder_view(request, cooperative_id: str, template_id: str):
    """POST /api/form-builder/{cid}/templates/{tid}/fields/reorder/"""
    coop, tmpl = _get_tmpl(cooperative_id, template_id)
    if not coop:
        return Response({"error": "Cooperative not found."}, status=404)
    if not tmpl:
        return Response({"error": "Template not found."}, status=404)
    if not _check_perm(request.user, coop, "edit"):
        return _deny("reorder fields")
    if tmpl.status == FormTemplate.Status.ACTIVE:
        return Response({"error": "Cannot reorder fields on an ACTIVE template."}, status=400)
    if not isinstance(request.data, list):
        return Response({"error": "Expected a list of {id, field_order} objects."}, status=400)
    for item in request.data:
        try:
            FormField.objects.filter(pk=item["id"], template=tmpl).update(field_order=int(item["field_order"]))
        except (KeyError, TypeError, ValueError):
            return Response({"error": f"Invalid item: {item}"}, status=400)
    return Response([_ser_field(f) for f in tmpl.fields.order_by("field_order", "created_at", "id")])


# ══════════════════════════════════════════════════════════════════
#  ISSUES
# ══════════════════════════════════════════════════════════════════

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def issues_list_view(request, cooperative_id: str, template_id: str):
    """GET /api/form-builder/{cid}/templates/{tid}/issues/"""
    coop, tmpl = _get_tmpl(cooperative_id, template_id)
    if not coop:
        return Response({"error": "Cooperative not found."}, status=404)
    if not tmpl:
        return Response({"error": "Template not found."}, status=404)
    if not _check_perm(request.user, coop, "view"):
        return _deny("view issues")
    sv = (request.query_params.get("severity") or "").upper()
    qs = tmpl.semantic_issues.select_related("affected_field", "conflicting_field").order_by("severity", "issue_type")
    if sv in ("ERROR", "WARNING"):
        qs = qs.filter(severity=sv)
    issues = [_ser_issue(i) for i in qs]
    return Response({
        "issues":        issues,
        "error_count":   sum(1 for i in issues if i["severity"] == "ERROR"),
        "warning_count": sum(1 for i in issues if i["severity"] == "WARNING"),
        "can_activate":  not tmpl.has_blocking_errors,
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def issue_acknowledge_view(request, cooperative_id: str, template_id: str, issue_id: str):
    """POST /api/form-builder/{cid}/templates/{tid}/issues/{iid}/acknowledge/"""
    coop, tmpl = _get_tmpl(cooperative_id, template_id)
    if not coop:
        return Response({"error": "Cooperative not found."}, status=404)
    if not tmpl:
        return Response({"error": "Template not found."}, status=404)
    try:
        issue = FormFieldSemanticIssue.objects.get(pk=issue_id, template=tmpl)
    except FormFieldSemanticIssue.DoesNotExist:
        return Response({"error": "Issue not found."}, status=404)
    if not _check_perm(request.user, coop, "edit"):
        return _deny("acknowledge issues")
    if issue.severity == "ERROR":
        return Response({"error": "ERRORs cannot be acknowledged — they must be fixed."}, status=400)
    if issue.is_acknowledged:
        return Response({"message": "Already acknowledged.", "issue": _ser_issue(issue)})
    issue.is_acknowledged = True
    issue.acknowledged_by = request.user
    issue.acknowledged_at = timezone.now()
    issue.save(update_fields=["is_acknowledged", "acknowledged_by", "acknowledged_at"])
    if not tmpl.semantic_issues.filter(severity="ERROR").exists():
        tmpl.has_blocking_errors = False
        if tmpl.status == FormTemplate.Status.HAS_ISSUES:
            tmpl.status = FormTemplate.Status.DRAFT
        tmpl.save(update_fields=["has_blocking_errors", "status"])
    return Response({"message": "Warning acknowledged.", "issue": _ser_issue(issue)})


# ══════════════════════════════════════════════════════════════════
#  FORM SUBMISSION
# ══════════════════════════════════════════════════════════════════

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def form_submit_view(request, cooperative_id: str, template_id: str):
    """POST /api/form-builder/{cid}/submit/{tid}/"""
    coop = _get_coop(cooperative_id)
    if not coop:
        return Response({"error": "Cooperative not found."}, status=404)
    try:
        tmpl = FormTemplate.objects.get(pk=template_id, cooperative=coop)
    except FormTemplate.DoesNotExist:
        return Response({"error": "Template not found."}, status=404)
    user: User = request.user
    module_map = {
        "MEMBER": "MEMBERS", "PRODUCTION": "PRODUCTION", "LIVESTOCK": "LIVESTOCK",
        "GOVERNANCE": "GOVERNANCE", "FINANCE": "FINANCE", "LAND": "MEMBERS", "HERD": "MEMBERS",
    }
    crm_module = module_map.get(tmpl.target_model, "MEMBERS")
    if not (user.is_chair or user.has_cooperative_permission(crm_module, "can_create")):
        return _deny("submit this form")
    try:
        instance, submission = submit_form(tmpl, dict(request.data), user, coop)
    except (ValueError, RuntimeError) as exc:
        return Response({"error": str(exc)}, status=400)
    return Response({
        "message":           "Record created successfully.",
        "submission_id":     str(submission.id),
        "created_model":     submission.created_model,
        "created_record_id": str(submission.created_record_id),
    }, status=201)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def form_submit_with_member_context_view(request, cooperative_id: str, template_id: str, member_id: str):
    """POST /api/form-builder/{cid}/submit/{tid}/member/{mid}/"""
    coop = _get_coop(cooperative_id)
    if not coop:
        return Response({"error": "Cooperative not found."}, status=404)
    try:
        tmpl = FormTemplate.objects.get(pk=template_id, cooperative=coop)
    except FormTemplate.DoesNotExist:
        return Response({"error": "Template not found."}, status=404)
    
    # Verify member exists and belongs to this cooperative
    try:
        from core.models import Member
        member = Member.objects.get(pk=member_id, cooperative=coop)
    except Member.DoesNotExist:
        return Response({"error": "Member not found."}, status=404)
    
    user: User = request.user
    module_map = {
        "MEMBER": "MEMBERS", "PRODUCTION": "PRODUCTION", "LIVESTOCK": "LIVESTOCK",
        "GOVERNANCE": "GOVERNANCE", "FINANCE": "FINANCE", "LAND": "MEMBERS", "HERD": "MEMBERS",
    }
    crm_module = module_map.get(tmpl.target_model, "MEMBERS")
    if not (user.is_chair or user.has_cooperative_permission(crm_module, "can_create")):
        return _deny("submit this form")
    
    try:
        instance, submission = submit_form_with_member_context(
            tmpl.id, coop.id, member.id, dict(request.data), user
        )
    except (ValueError, RuntimeError) as exc:
        return Response({"error": str(exc)}, status=400)
    
    return Response({
        "message":           "Record created successfully with member context.",
        "submission_id":     str(submission.id),
        "created_model":     submission.created_model,
        "created_record_id": str(submission.created_record_id),
        "member_context": {
            "member_id": str(member.id),
            "member_number": member.member_number,
            "member_name": member.get_display_name(),
        },
    }, status=201)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def submission_history_view(request, cooperative_id: str, template_id: str):
    """GET /api/form-builder/{cid}/templates/{tid}/submissions/"""
    coop, tmpl = _get_tmpl(cooperative_id, template_id)
    if not coop:
        return Response({"error": "Cooperative not found."}, status=404)
    if not tmpl:
        return Response({"error": "Template not found."}, status=404)
    if not _check_perm(request.user, coop, "view"):
        return _deny("view submissions")
    page      = int(request.query_params.get("page", 1))
    page_size = int(request.query_params.get("page_size", 20))
    return Response(get_submission_history(tmpl, page, page_size))


# ══════════════════════════════════════════════════════════════════════════════
# FIELD REGISTRY ENDPOINTS
# Moved from core/views/dynamic_fields.py — merged here so all form-builder
# views live in one module, matching the pattern of form_semantic.py and
# form_submission.py both living under core/services/.
#
# Additional imports needed for this section:
# ══════════════════════════════════════════════════════════════════════════════

import uuid as _uuid
from django.core.exceptions import ValidationError as _ValidationError

from core.services.field_registry import (   # renamed from dynamic_fields.py
    check_label_conflict,
    deactivate_field,
    get_field_schema,
    register_field,
    slugify_to_field_key,
    update_field,
    DuplicateFieldError,
    FieldLockedError,
)


# ── Shared auth helper (scoped to registry endpoints) ─────────────────────────

def _registry_assert_coop_access(user, cooperative_id: str) -> str | None:
    """Return an error message string if the user cannot access this cooperative."""
    from apps.cooperatives.models import Cooperative
    try:
        coop = Cooperative.objects.get(id=cooperative_id)
    except Cooperative.DoesNotExist:
        return "Cooperative not found."
    if user.cooperative_id != coop.id:
        return "You do not have access to this cooperative."
    return None


# ── GET/POST /api/form-builder/dynamic-fields/ ────────────────────────────────

@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def dynamic_fields_list_view(request):
    """
    GET  → list active (or all) DFDs for a (cooperative, target_model) pair.
    POST → register a new field definition; runs semantic duplicate check first.
    """
    if request.method == "GET":
        cooperative_id   = request.GET.get("cooperative_id", "").strip()
        target_model     = request.GET.get("target_model",   "").strip().upper()
        include_inactive = request.GET.get("include_inactive", "false").lower() == "true"

        if not cooperative_id or not target_model:
            return Response(
                {"error": "cooperative_id and target_model are required."},
                status=400,
            )

        err = _registry_assert_coop_access(request.user, cooperative_id)
        if err:
            return Response({"error": err}, status=403)

        fields = get_field_schema(
            cooperative_id=cooperative_id,
            target_model=target_model,
            include_inactive=include_inactive,
        )
        return Response({"fields": fields})

    # POST — register new field
    data           = request.data
    cooperative_id = data.get("cooperative_id", "").strip()
    target_model   = data.get("target_model",   "").strip().upper()
    label          = data.get("label",          "").strip()

    if not all([cooperative_id, target_model, label]):
        return Response(
            {"error": "cooperative_id, target_model and label are required."},
            status=400,
        )

    err = _registry_assert_coop_access(request.user, cooperative_id)
    if err:
        return Response({"error": err}, status=403)

    try:
        dfd = register_field(
            cooperative_id   = cooperative_id,
            target_model     = target_model,
            label            = label,
            display_type     = data.get("display_type",  "text"),
            tag              = data.get("tag",           "INFORMATIONAL"),
            is_required      = bool(data.get("is_required",  False)),
            help_text        = data.get("help_text",    ""),
            placeholder      = data.get("placeholder",  ""),
            options          = data.get("options",      []),
            validation_rules = data.get("validation_rules", {}),
            field_key        = data.get("field_key"),           # optional override
            created_by_id    = request.user.id,
        )
        return Response(_serialize_dfd(dfd), status=201)

    except DuplicateFieldError as e:
        return Response(
            {
                "type":               "duplicate_field",
                "conflict_type":      e.conflict_type,
                "conflicting_labels": e.conflicting_labels,
                "message":            str(e),
            },
            status=409,
        )
    except _ValidationError as e:
        return Response({"error": e.message}, status=400)


# ── GET/PATCH/DELETE /api/form-builder/dynamic-fields/<dfd_id>/ ───────────────

@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def dynamic_field_detail_view(request, dfd_id: str):
    from apps.form_builder.models import DynamicFieldDefinition
    try:
        dfd = DynamicFieldDefinition.objects.get(id=dfd_id)
    except DynamicFieldDefinition.DoesNotExist:
        return Response({"error": "Field definition not found."}, status=404)

    err = _registry_assert_coop_access(request.user, str(dfd.cooperative_id))
    if err:
        return Response({"error": err}, status=403)

    if request.method == "GET":
        return Response(_serialize_dfd(dfd))

    if request.method == "PATCH":
        try:
            updated = update_field(
                dfd_id           = str(dfd.id),
                label            = request.data.get("label"),
                display_type     = request.data.get("display_type"),
                tag              = request.data.get("tag"),
                is_required      = request.data.get("is_required"),
                help_text        = request.data.get("help_text"),
                placeholder      = request.data.get("placeholder"),
                options          = request.data.get("options"),
                validation_rules = request.data.get("validation_rules"),
            )
            return Response(_serialize_dfd(updated))
        except DuplicateFieldError as e:
            return Response(
                {
                    "type":               "duplicate_field",
                    "conflict_type":      e.conflict_type,
                    "conflicting_labels": e.conflicting_labels,
                    "message":            str(e),
                },
                status=409,
            )
        except FieldLockedError as e:
            return Response({"error": str(e)}, status=400)

    if request.method == "DELETE":
        deactivate_field(str(dfd.id))
        return Response(
            {"message": f"Field '{dfd.label}' deactivated. Key '{dfd.field_key}' is preserved."},
            status=200,
        )


# ── GET /api/form-builder/dynamic-fields/check/ ───────────────────────────────

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def dynamic_field_check_view(request):
    """
    Pre-flight duplicate label check — called on debounce as the user types.
    Always returns HTTP 200; read `is_conflict` in the response body.
    """
    cooperative_id = request.GET.get("cooperative_id", "").strip()
    target_model   = request.GET.get("target_model",   "").strip().upper()
    label          = request.GET.get("label",          "").strip()
    exclude_id     = request.GET.get("exclude_id",     "").strip() or None

    if not all([cooperative_id, target_model, label]):
        return Response(
            {
                "is_conflict":        False,
                "conflict_type":      "none",
                "conflicting_labels": [],
                "message":            "Provide cooperative_id, target_model and label.",
                "suggested_key":      slugify_to_field_key(label) if label else "",
            }
        )

    err = _registry_assert_coop_access(request.user, cooperative_id)
    if err:
        return Response({"error": err}, status=403)

    result = check_label_conflict(
        cooperative_id = cooperative_id,
        target_model   = target_model,
        label          = label,
        exclude_id     = exclude_id,
    )
    return Response(result)


# ── GET /api/form-builder/dynamic-fields/schema/<target_model>/ ───────────────

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def dynamic_field_schema_view(request, target_model: str):
    """
    Returns the skeleton field + all cooperative DFDs for a (coop, model) pair.
    Used by the template editor to populate the Field Registry picker.
    """
    from apps.crm.models import (
        Member, ProductionRecord, LivestockHealthLog,
        GovernanceRecord, FinancialRecord,
        MemberLandRecord, MemberHerdRecord,
    )

    cooperative_id = request.GET.get("cooperative_id", "").strip()
    if not cooperative_id:
        return Response({"error": "cooperative_id is required."}, status=400)

    err = _registry_assert_coop_access(request.user, cooperative_id)
    if err:
        return Response({"error": err}, status=403)

    target_model = target_model.upper()

    SKELETON_FIELDS = {
        "MEMBER":     {"field_key": "member_number",   "label": "Member Number",    "display_type": "text",     "help_text": "Unique identifier for this member within the cooperative."},
        "PRODUCTION": {"field_key": "record_date",     "label": "Record Date",       "display_type": "date",     "help_text": "Date of this production record."},
        "LIVESTOCK":  {"field_key": "event_type",      "label": "Event Type",        "display_type": "dropdown", "help_text": "Type of livestock event (vaccination, disease, treatment, etc.).",
                       "options": ["VACCINATION", "DISEASE", "TREATMENT", "ROUTINE_CHECK", "OTHER"]},
        "GOVERNANCE": {"field_key": "record_type",     "label": "Record Type",       "display_type": "dropdown", "help_text": "Type of governance record.",
                       "options": ["MEETING", "RESOLUTION", "AUDIT", "CERTIFICATION", "OTHER"]},
        "FINANCE":    {"field_key": "category",        "label": "Category",          "display_type": "dropdown", "help_text": "Financial category for this record.",
                       "options": ["CONTRIBUTION", "REVENUE", "SAVINGS", "EXPENSE", "OTHER"]},
        "LAND":       {"field_key": "member",          "label": "Member",            "display_type": "relation", "help_text": "The member who owns or cultivates this land."},
        "HERD":       {"field_key": "member",          "label": "Member",            "display_type": "relation", "help_text": "The member who owns this herd."},
    }

    skeleton = SKELETON_FIELDS.get(target_model)
    skeleton_field = None
    if skeleton:
        skeleton_field = {
            **skeleton,
            "is_system":   True,
            "is_required": True,
            "editable":    False,
        }

    cooperative_fields = get_field_schema(
        cooperative_id   = cooperative_id,
        target_model     = target_model,
        include_inactive = False,
    )

    return Response({
        "target_model":       target_model,
        "cooperative_id":     cooperative_id,
        "skeleton_field":     skeleton_field,
        "cooperative_fields": cooperative_fields,
        "total_fields":       (1 if skeleton_field else 0) + len(cooperative_fields),
    })


# ── Serialiser helper ──────────────────────────────────────────────────────────

def _serialize_dfd(dfd) -> dict:
    return {
        "id":               str(dfd.id),
        "field_key":        dfd.field_key,
        "label":            dfd.label,
        "display_type":     dfd.display_type,
        "tag":              dfd.tag,
        "is_required":      dfd.is_required,
        "is_locked":        dfd.is_locked,
        "is_active":        dfd.is_active,
        "help_text":        dfd.help_text,
        "placeholder":      dfd.placeholder,
        "options":          dfd.options or [],
        "validation_rules": dfd.validation_rules or {},
        "created_at":       dfd.created_at.isoformat(),
    }
