from __future__ import annotations

from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from apps.marketplace.chat import (
    broadcast_chat_activity,
    broadcast_presence_changed,
    clear_chat_presence,
    mark_chat_presence,
    resolve_chat_thread_context,
)


class MarketplaceChatConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        user = self.scope.get("user")
        if user is None or user.is_anonymous:
            await self.close(code=4401)
            return

        self.user = user
        self.group_name = f"marketplace_chat_user_{user.id}"
        self.active_thread = None
        self.current_activity = "idle"

        if self.channel_layer is not None:
            await self.channel_layer.group_add(self.group_name, self.channel_name)

        await self.accept()
        await self._mark_online()
        await self.send_json(
            {
                "event": "chat.ready",
                "user_id": str(user.id),
            }
        )

    async def disconnect(self, close_code):
        if getattr(self, "channel_layer", None) is not None and getattr(self, "group_name", None):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

        user = getattr(self, "user", None)
        if user is not None and not user.is_anonymous:
            if self.active_thread and self.current_activity != "idle":
                await self._broadcast_activity("idle", self.active_thread)
            await self._mark_offline()

    async def receive_json(self, content, **kwargs):
        event = (content.get("event") or "").strip()
        if event == "chat.heartbeat":
            await self._mark_online(active_thread=self.active_thread)
            return

        if event == "chat.thread.open":
            thread = await self._resolve_thread(content)
            if thread is None:
                await self.send_json({"event": "chat.error", "message": "Unable to open that conversation."})
                return
            self.active_thread = thread
            self.current_activity = "idle"
            await self._mark_online(active_thread=thread)
            await self.send_json(
                {
                    "event": "chat.thread.opened",
                    "thread_id": thread["thread_id"],
                }
            )
            return

        if event == "chat.thread.close":
            if self.active_thread and self.current_activity != "idle":
                await self._broadcast_activity("idle", self.active_thread)
            self.active_thread = None
            self.current_activity = "idle"
            await self._mark_online(active_thread=None)
            return

        if event == "chat.activity":
            state = (content.get("state") or "").strip().lower()
            if state not in {"typing", "recording", "idle"}:
                return
            thread = await self._resolve_thread(content)
            if thread is None:
                return
            self.active_thread = thread
            self.current_activity = state
            await self._mark_online(active_thread=thread)
            await self._broadcast_activity(state, thread)
            return

    async def chat_event(self, event):
        payload = {key: value for key, value in event.items() if key != "type"}
        await self.send_json(payload)

    async def _mark_online(self, *, active_thread=None):
        await database_sync_to_async(mark_chat_presence)(
            self.user,
            active_thread_id=active_thread["thread_id"] if active_thread else None,
        )
        await database_sync_to_async(broadcast_presence_changed)(self.user, is_online=True)

    async def _mark_offline(self):
        await database_sync_to_async(clear_chat_presence)(self.user)
        await database_sync_to_async(broadcast_presence_changed)(self.user, is_online=False)

    async def _broadcast_activity(self, state: str, thread):
        await database_sync_to_async(broadcast_chat_activity)(
            tender=thread["tender"],
            cooperative=thread["cooperative"],
            actor=self.user,
            activity=state,
        )

    async def _resolve_thread(self, payload):
        tender_id = str(payload.get("tender_id") or "").strip()
        cooperative_id = str(payload.get("cooperative_id") or "").strip() or None
        if not tender_id:
            return None

        context, status_code, _ = await database_sync_to_async(resolve_chat_thread_context)(
            user=self.user,
            tender_id=tender_id,
            cooperative_id=cooperative_id,
        )
        if status_code is not None:
            return None
        return context
