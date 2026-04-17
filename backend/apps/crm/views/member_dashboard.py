"""
Member mini-dashboard views.

Each member has a personal data workspace:
  - analytics summarised from all member-scoped CRM records
  - tab data for production, livestock, governance, finance, land, and herds
  - template metadata for member-context form entry
"""

from __future__ import annotations

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import Member
from core.services.member_context import get_member_context_defaults
from apps.crm.services.collection import (
    get_cooperative,
    get_crm_config,
    get_member_dashboard_payload,
    get_member_records,
    get_member_templates,
    has_crm_permission,
    save_record,
)


RECORD_TYPE_TO_SLUG = {
    "production": "production",
    "livestock": "livestock",
    "governance": "governance",
    "financial": "finance",
    "finance": "finance",
    "land": "land",
    "herd": "herds",
    "herds": "herds",
}


def _get_member_or_404(cooperative_id: str, member_id: str) -> tuple | tuple[None, Response]:
    cooperative = get_cooperative(cooperative_id)
    if not cooperative:
        return None, Response({"error": "Cooperative not found."}, status=404)

    member = Member.objects.filter(pk=member_id, cooperative=cooperative).first()
    if not member:
        return None, Response({"error": "Member not found."}, status=404)

    return (cooperative, member), None


def _can_access_member_module(user, cooperative, model_slug: str, action: str = "view") -> bool:
    config = get_crm_config(model_slug)
    return has_crm_permission(user, cooperative, config.permission_module, action)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def member_dashboard_view(request, cooperative_id: str, member_id: str):
    result, error = _get_member_or_404(cooperative_id, member_id)
    if error:
        return error

    cooperative, member = result
    if not has_crm_permission(request.user, cooperative, "MEMBERS", "view"):
        return Response({"error": "Permission denied."}, status=403)

    return Response(get_member_dashboard_payload(cooperative, member, request.user))


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def member_records_view(request, cooperative_id: str, member_id: str, record_type: str):
    result, error = _get_member_or_404(cooperative_id, member_id)
    if error:
        return error

    cooperative, member = result
    if not has_crm_permission(request.user, cooperative, "MEMBERS", "view"):
        return Response({"error": "Permission denied."}, status=403)

    model_slug = RECORD_TYPE_TO_SLUG.get(record_type.lower())
    if model_slug is None:
        return Response({"error": f"Unsupported record type: {record_type}"}, status=400)
    if not _can_access_member_module(request.user, cooperative, model_slug, "view"):
        return Response({"error": "Permission denied."}, status=403)

    try:
        page = max(1, int(request.query_params.get("page", 1)))
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = max(1, min(100, int(request.query_params.get("page_size", 20))))
    except (TypeError, ValueError):
        page_size = 20
    search = request.query_params.get("search", "").strip()
    filters = {
        key: value
        for key, value in request.query_params.items()
        if key not in {"page", "page_size", "search"} and value not in (None, "")
    }

    result = get_member_records(
        cooperative,
        member,
        model_slug,
        page=page,
        page_size=page_size,
        search=search,
        filters=filters,
    )
    result["record_type"] = model_slug
    return Response(result)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def member_form_templates_view(request, cooperative_id: str, member_id: str):
    result, error = _get_member_or_404(cooperative_id, member_id)
    if error:
        return error

    cooperative, member = result
    if not has_crm_permission(request.user, cooperative, "MEMBERS", "view"):
        return Response({"error": "Permission denied."}, status=403)

    defaults = get_member_context_defaults(member)
    templates = [
        template
        for template in get_member_templates(cooperative, request.user)
        if template.get("permissions", {}).get("can_view") or template.get("permissions", {}).get("can_create")
    ]
    for template in templates:
        template["member_context"] = {
            "member_id": str(member.id),
            "member_number": member.member_number,
            "member_name": member.get_display_name(),
            "defaults": defaults,
        }

    return Response(
        {
            "member": {
                "id": str(member.id),
                "member_number": member.member_number,
                "display_name": member.get_display_name(),
                "status": member.status,
                "created_at": member.created_at.isoformat(),
                "extra_data": member.extra_data or {},
            },
            "templates": templates,
            "total": len(templates),
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def member_form_update_handler(request, cooperative_id: str, pk: str):
    result, error = _get_member_or_404(cooperative_id, pk)
    if error:
        return error

    cooperative, member = result
    if not has_crm_permission(request.user, cooperative, "MEMBERS", "edit"):
        return Response({"error": "Permission denied."}, status=403)

    try:
        saved = save_record(cooperative, request.user, "members", dict(request.data), instance=member)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=400)
    except Exception as exc:  # noqa: BLE001 - surface validation/runtime issues
        return Response({"error": f"Update failed: {exc}"}, status=400)

    return Response(
        {
            "success": True,
            "message": "Member updated successfully.",
            "member": saved,
        }
    )
