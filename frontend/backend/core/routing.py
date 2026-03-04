"""
ShambaFlow — WebSocket URL Routing
Maps WebSocket connections to Django Channels consumers.
"""

from django.urls import re_path
from core.consumers import ModelConsumer, NotificationConsumer

websocket_urlpatterns = [
    # Real-time model updates (Adaptive Convergence live sync)
    re_path(r'ws/models/(?P<model_name>\w+)/$', ModelConsumer.as_asgi()),

    # Per-user notification stream
    re_path(r'ws/notifications/$', NotificationConsumer.as_asgi()),
]