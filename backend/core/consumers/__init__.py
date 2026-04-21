from channels.generic.websocket import AsyncJsonWebsocketConsumer


class ModelConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        model_name = self.scope.get("url_route", {}).get("kwargs", {}).get("model_name", "")
        self.group_name = f"model_{model_name.lower()}"

        if self.channel_layer is not None:
            await self.channel_layer.group_add(self.group_name, self.channel_name)

        await self.accept()
        await self.send_json({"event": "model.ready", "model_name": model_name})

    async def disconnect(self, close_code):
        if self.channel_layer is not None:
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def model_event(self, event):
        await self.send_json(event)


class NotificationConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        user = self.scope.get("user")
        if user is None or user.is_anonymous:
            await self.close(code=4401)
            return

        self.group_name = f"notifications_{user.id}"

        if self.channel_layer is not None:
            await self.channel_layer.group_add(self.group_name, self.channel_name)

        await self.accept()
        await self.send_json({"event": "notification.ready"})

    async def disconnect(self, close_code):
        if self.channel_layer is not None:
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def notification_event(self, event):
        await self.send_json(event)
