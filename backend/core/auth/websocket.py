from __future__ import annotations

from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import AccessToken
from rest_framework_simplejwt.exceptions import TokenError

User = get_user_model()


@database_sync_to_async
def _get_user_for_token(raw_token: str):
    try:
        token = AccessToken(raw_token)
        user_id = token.get("user_id")
        if not user_id:
            return AnonymousUser()
        return User.objects.filter(pk=user_id).first() or AnonymousUser()
    except TokenError:
        return AnonymousUser()
    except Exception:
        return AnonymousUser()


class TokenAuthMiddleware:
    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        query_string = scope.get("query_string", b"").decode("utf-8")
        params = parse_qs(query_string)
        raw_token = (params.get("token") or [""])[0].strip()
        if raw_token:
            scope["user"] = await _get_user_for_token(raw_token)
        elif "user" not in scope:
            scope["user"] = AnonymousUser()
        return await self.inner(scope, receive, send)
