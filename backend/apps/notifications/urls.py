"""Notification center endpoints."""

from django.urls import path

from apps.notifications.views import (
    notification_detail,
    notification_list,
    notification_mark_all_read,
)

app_name = "notifications"

urlpatterns = [
    path("", notification_list, name="list"),
    path("read-all/", notification_mark_all_read, name="mark-all-read"),
    path("<str:notification_id>/", notification_detail, name="detail"),
]
