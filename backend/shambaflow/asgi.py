"""
ShambaFlow ASGI Configuration
Supports HTTP (Django) + WebSocket (Django Channels via Upstash Redis)
"""

import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
from channels.security.websocket import AllowedHostsOriginValidator

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'shambaflow.settings')

# Load Django ASGI app first so models are registered before routing
django_asgi_app = get_asgi_application()

from core.routing import websocket_urlpatterns  # noqa: E402 — must come after environ.setdefault
from core.auth.websocket import TokenAuthMiddleware  # noqa: E402

application = ProtocolTypeRouter({
    'http': django_asgi_app,
    'websocket': AllowedHostsOriginValidator(
        AuthMiddlewareStack(
            TokenAuthMiddleware(URLRouter(websocket_urlpatterns))
        )
    ),
})
