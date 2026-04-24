"""
ShambaFlow — WebSocket URL Routing
Maps WebSocket connections to Django Channels consumers.
"""

from django.urls import re_path
from core.consumers import ModelConsumer, NotificationConsumer
from apps.marketplace.consumers import MarketplaceChatConsumer

websocket_urlpatterns = [
    # Real-time model updates (Adaptive Convergence live sync)
    re_path(r'ws/models/(?P<model_name>\w+)/$', ModelConsumer.as_asgi()),

    # Per-user notification stream
    re_path(r'ws/notifications/$', NotificationConsumer.as_asgi()),

    # Marketplace tender negotiation chat
    re_path(r'ws/marketplace/chat/$', MarketplaceChatConsumer.as_asgi()),
]
