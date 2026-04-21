from django.utils import timezone

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import Notification
from core.services.notifications import notifications


def _serialize_many(queryset):
    return [notifications.serialize(item) for item in queryset]


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def notification_list(request):
    status_filter = (request.GET.get("status") or "all").strip().lower()
    limit_raw = request.GET.get("limit", 8)

    try:
        limit = max(1, min(50, int(limit_raw)))
    except (TypeError, ValueError):
        limit = 8

    queryset = (
        Notification.objects
        .filter(recipient=request.user)
        .select_related("cooperative")
        .order_by("-created_at")
    )

    if status_filter == "unread":
        queryset = queryset.filter(is_read=False)
    elif status_filter == "read":
        queryset = queryset.filter(is_read=True)

    unread_count = Notification.objects.filter(recipient=request.user, is_read=False).count()

    return Response(
        {
            "items": _serialize_many(queryset[:limit]),
            "total": queryset.count(),
            "unread_count": unread_count,
        }
    )


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def notification_detail(request, notification_id: str):
    try:
        notification = Notification.objects.get(pk=notification_id, recipient=request.user)
    except (Notification.DoesNotExist, ValueError):
        return Response({"error": "Notification not found."}, status=404)

    is_read = request.data.get("is_read", True)
    is_read = is_read if isinstance(is_read, bool) else str(is_read).strip().lower() in {"1", "true", "yes", "on"}

    notification = notifications.set_read_state(notification, is_read=is_read)

    return Response(
        {
            "message": "Notification updated.",
            "notification": notifications.serialize(notification),
            "unread_count": notifications.unread_count(request.user),
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def notification_mark_all_read(request):
    now = timezone.now()
    updated = (
        Notification.objects
        .filter(recipient=request.user, is_read=False)
        .update(is_read=True, read_at=now, updated_at=now)
    )

    notifications.broadcast_state(request.user, event="notification.bulk_read")

    return Response(
        {
            "message": "Notifications marked as read.",
            "marked_read": updated,
            "unread_count": 0,
        }
    )
