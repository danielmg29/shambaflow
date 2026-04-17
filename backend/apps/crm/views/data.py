"""
CRM data collection views.

These endpoints expose one consistent contract for all CRM models:
  /api/crm/<cooperative>/<model>/
  /api/crm/<cooperative>/<model>/<pk>/
  /api/crm/<cooperative>/<model>/schema/
  /api/crm/<cooperative>/<model>/import/
  /api/crm/<cooperative>/<model>/import/template/
  /api/crm/<cooperative>/<model>/export/
"""

from __future__ import annotations

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import Member
from apps.crm.services.collection import (
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    build_import_template_response,
    build_schema,
    delete_record,
    export_records,
    get_cooperative,
    get_model_permission_snapshot,
    get_model_analytics,
    has_crm_permission,
    import_records,
    list_records,
    parse_import_file,
    save_record,
    get_crm_config,
)


def _page_params(request) -> tuple[int, int]:
    try:
        page = max(1, int(request.query_params.get("page", 1)))
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = min(MAX_PAGE_SIZE, max(1, int(request.query_params.get("page_size", DEFAULT_PAGE_SIZE))))
    except (TypeError, ValueError):
        page_size = DEFAULT_PAGE_SIZE
    return page, page_size


def _request_filters(request) -> dict[str, str]:
    reserved = {
        "page",
        "page_size",
        "search",
        "order_by",
        "format",
        "dry_run",
    }
    return {
        key: value
        for key, value in request.query_params.items()
        if key not in reserved and value not in ("", None)
    }


def _member_context_from_request(cooperative, request) -> Member | None:
    member_id = request.query_params.get("member_id")
    member_number = request.query_params.get("member_number")
    if member_id:
        return Member.objects.filter(pk=member_id, cooperative=cooperative).first()
    if member_number:
        return Member.objects.filter(member_number=member_number, cooperative=cooperative).first()
    return None


def _permission_denied(action: str) -> Response:
    return Response({"error": f"Permission denied: cannot {action}."}, status=403)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def crm_schema_view(request, cooperative_id: str, model_slug: str):
    cooperative = get_cooperative(cooperative_id)
    if not cooperative:
        return Response({"error": "Cooperative not found."}, status=404)

    try:
        config = get_crm_config(model_slug)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=404)

    if not has_crm_permission(request.user, cooperative, config.permission_module, "view"):
        return _permission_denied("view this module")

    schema = build_schema(cooperative.id, model_slug)
    schema["permissions"] = get_model_permission_snapshot(request.user, cooperative, model_slug)
    return Response(schema)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def crm_analytics_view(request, cooperative_id: str, model_slug: str):
    cooperative = get_cooperative(cooperative_id)
    if not cooperative:
        return Response({"error": "Cooperative not found."}, status=404)

    try:
        config = get_crm_config(model_slug)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=404)

    if not has_crm_permission(request.user, cooperative, config.permission_module, "view"):
        return _permission_denied("view analytics in this module")

    result = get_model_analytics(
        cooperative,
        model_slug,
        search=request.query_params.get("search", ""),
        filters=_request_filters(request),
    )
    result["permissions"] = get_model_permission_snapshot(request.user, cooperative, model_slug)
    return Response(result)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def crm_collection_view(request, cooperative_id: str, model_slug: str):
    cooperative = get_cooperative(cooperative_id)
    if not cooperative:
        return Response({"error": "Cooperative not found."}, status=404)

    try:
        config = get_crm_config(model_slug)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=404)

    if request.method == "GET":
        if not has_crm_permission(request.user, cooperative, config.permission_module, "view"):
            return _permission_denied("view records in this module")
        page, page_size = _page_params(request)
        result = list_records(
            cooperative,
            model_slug,
            page=page,
            page_size=page_size,
            search=request.query_params.get("search", ""),
            filters=_request_filters(request),
            order_by=request.query_params.get("order_by"),
        )
        result["permissions"] = get_model_permission_snapshot(request.user, cooperative, model_slug)
        return Response(result)

    if not has_crm_permission(request.user, cooperative, config.permission_module, "create"):
        return _permission_denied("create records in this module")

    try:
        saved = save_record(cooperative, request.user, model_slug, dict(request.data))
    except ValueError as exc:
        return Response({"error": str(exc)}, status=400)
    except Exception as exc:  # noqa: BLE001 - surface validation/runtime issues
        return Response({"error": f"Failed to save record: {exc}"}, status=400)

    return Response(saved, status=201)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def crm_detail_view(request, cooperative_id: str, model_slug: str, pk: str):
    cooperative = get_cooperative(cooperative_id)
    if not cooperative:
        return Response({"error": "Cooperative not found."}, status=404)

    try:
        config = get_crm_config(model_slug)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=404)

    queryset = config.model.objects.filter(cooperative=cooperative)
    instance = queryset.filter(pk=pk).first()
    if not instance:
        return Response({"error": "Record not found."}, status=404)

    if request.method == "GET":
        if not has_crm_permission(request.user, cooperative, config.permission_module, "view"):
            return _permission_denied("view this record")
        result = list_records(
            cooperative,
            model_slug,
            page=1,
            page_size=1,
            filters={"id": pk},
        )
        if not result["data"]:
            return Response({"error": "Record not found."}, status=404)
        return Response(result["data"][0])

    if request.method == "PATCH":
        if not has_crm_permission(request.user, cooperative, config.permission_module, "edit"):
            return _permission_denied("edit records in this module")
        try:
            saved = save_record(cooperative, request.user, model_slug, dict(request.data), instance=instance)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=400)
        except Exception as exc:  # noqa: BLE001 - surface validation/runtime issues
            return Response({"error": f"Failed to update record: {exc}"}, status=400)
        return Response(saved)

    if not has_crm_permission(request.user, cooperative, config.permission_module, "delete"):
        return _permission_denied("delete records in this module")
    deleted = delete_record(cooperative, model_slug, pk)
    if not deleted:
        return Response({"error": "Record not found."}, status=404)
    return Response({"deleted": True})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def crm_import_view(request, cooperative_id: str, model_slug: str):
    cooperative = get_cooperative(cooperative_id)
    if not cooperative:
        return Response({"error": "Cooperative not found."}, status=404)

    try:
        config = get_crm_config(model_slug)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=404)

    if not has_crm_permission(request.user, cooperative, config.permission_module, "create"):
        return _permission_denied("import records into this module")

    uploaded_file = request.FILES.get("file")
    if uploaded_file is None:
        return Response({"error": "file is required."}, status=400)

    try:
        rows = parse_import_file(uploaded_file)
    except ValueError as exc:
        return Response(
            {
                "success": False,
                "parse_error": str(exc),
                "dry_run": True,
                "total_rows": 0,
                "success_count": 0,
                "error_count": 1,
                "imported_count": 0,
                "created_ids": [],
                "header_validation": None,
                "row_validation": None,
                "error_rows": [],
                "skipped_unknown": [],
            },
            status=400,
        )

    dry_run = str(request.query_params.get("dry_run", "false")).lower() == "true"
    member_context = _member_context_from_request(cooperative, request)
    result = import_records(
        cooperative,
        request.user,
        model_slug,
        rows,
        member_context=member_context,
        dry_run=dry_run,
    )
    status_code = 200 if result["success"] or result["error_count"] > 0 else 400
    return Response(result, status=status_code)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def crm_import_template_view(request, cooperative_id: str, model_slug: str):
    cooperative = get_cooperative(cooperative_id)
    if not cooperative:
        return Response({"error": "Cooperative not found."}, status=404)

    try:
        config = get_crm_config(model_slug)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=404)

    if not has_crm_permission(request.user, cooperative, config.permission_module, "view"):
        return _permission_denied("download import templates for this module")

    member_context = _member_context_from_request(cooperative, request)
    return build_import_template_response(cooperative.id, model_slug, member_context=member_context)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def crm_export_view(request, cooperative_id: str, model_slug: str):
    cooperative = get_cooperative(cooperative_id)
    if not cooperative:
        return Response({"error": "Cooperative not found."}, status=404)

    try:
        config = get_crm_config(model_slug)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=404)

    if not has_crm_permission(request.user, cooperative, config.permission_module, "view"):
        return _permission_denied("export records from this module")

    filters = _request_filters(request)
    member_context = _member_context_from_request(cooperative, request)
    if member_context is not None:
        filters.setdefault("member_id", str(member_context.id))
        filters.setdefault("member_number", member_context.member_number)

    return export_records(
        cooperative,
        model_slug,
        fmt=(request.query_params.get("format") or "csv").lower(),
        search=request.query_params.get("search", ""),
        filters=filters,
        order_by=request.query_params.get("order_by"),
    )
