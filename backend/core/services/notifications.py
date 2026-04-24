"""
ShambaFlow — Unified Notification Dispatcher

Adaptive Convergence intent:
the backend owns notification state and delivery decisions, while the
frontend renders whatever the backend publishes.
"""

import logging
from typing import Any

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.utils import timezone

from core.models import Cooperative, Notification, NotificationPreference, User
from core.services.brevo_email import (
    send_buyer_verification_email,
    send_cooperative_verification_email,
    send_invitation_email,
    send_password_reset_email,
    send_tender_notification_email,
)
from core.services.infobip_sms import (
    send_invitation_sms,
    send_otp_sms,
    send_tender_alert_sms,
    send_verification_status_sms,
)

logger = logging.getLogger("core.notifications")


class NotificationDispatcher:
    """
    Centralized dispatcher for all ShambaFlow notifications.

    It persists in-app notifications, respects saved channel preferences where
    practical, and can broadcast changes to websocket consumers when a channel
    layer is configured.
    """

    IN_APP = "IN_APP"
    EMAIL = "EMAIL"
    SMS = "SMS"

    # ── Serialization / Broadcast ──────────────────────────────────────────

    @staticmethod
    def serialize(notification: Notification) -> dict[str, Any]:
        return {
            "id": str(notification.id),
            "title": notification.title,
            "message": notification.message,
            "category": notification.category,
            "event_type": notification.event_type,
            "priority": notification.priority,
            "action_url": notification.action_url,
            "delivery_channels": notification.delivery_channels,
            "is_read": notification.is_read,
            "read_at": notification.read_at.isoformat() if notification.read_at else None,
            "created_at": notification.created_at.isoformat(),
            "updated_at": notification.updated_at.isoformat(),
            "cooperative_id": str(notification.cooperative_id) if notification.cooperative_id else None,
            "data": notification.data or {},
        }

    @classmethod
    def unread_count(cls, user: User | str) -> int:
        user_id = str(user.id) if isinstance(user, User) else str(user)
        return Notification.objects.filter(recipient_id=user_id, is_read=False).count()

    @classmethod
    def _broadcast(cls, user: User | str, event: str, notification: Notification | None = None) -> None:
        channel_layer = get_channel_layer()
        if channel_layer is None:
            return

        user_id = str(user.id) if isinstance(user, User) else str(user)
        payload = {
            "type": "notification_event",
            "event": event,
            "unread_count": cls.unread_count(user_id),
        }
        if notification is not None:
            payload["notification"] = cls.serialize(notification)

        try:
            async_to_sync(channel_layer.group_send)(f"notifications_{user_id}", payload)
        except Exception:
            logger.exception("Failed to broadcast notification event | user=%s | event=%s", user_id, event)

    @classmethod
    def broadcast_state(cls, user: User | str, event: str = "notification.updated") -> None:
        cls._broadcast(user, event)

    # ── Preference helpers ──────────────────────────────────────────────────

    @staticmethod
    def _related(obj: Any, attr: str) -> Any | None:
        try:
            return getattr(obj, attr)
        except Exception:
            return None

    @staticmethod
    def _get_cooperative_preference(user: User | None, cooperative: Cooperative | None) -> NotificationPreference | None:
        if user is None or cooperative is None:
            return None
        return (
            NotificationPreference.objects
            .filter(user=user, cooperative=cooperative)
            .first()
        )

    @classmethod
    def _channel_enabled(
        cls,
        *,
        user: User | None,
        cooperative: Cooperative | None,
        channel: str,
        preference_field: str | None = None,
        requires_tender_alerts: bool = False,
    ) -> bool:
        if user is None:
            return True

        if user.is_chair:
            profile = cls._related(user, "chair_profile")
            if profile is not None:
                if channel == cls.EMAIL and not profile.email_notifications:
                    return False
                if channel == cls.SMS and not profile.sms_notifications:
                    return False
                if requires_tender_alerts and not profile.tender_alerts:
                    return False

        if user.is_buyer:
            profile = cls._related(user, "buyer_profile")
            if profile is not None:
                if channel == cls.EMAIL and not profile.email_notifications:
                    return False
                if channel == cls.SMS and not profile.sms_notifications:
                    return False

        if preference_field:
            pref = cls._get_cooperative_preference(user, cooperative)
            if pref is not None and not getattr(pref, preference_field, True):
                return False

        return True

    # ── In-app persistence ──────────────────────────────────────────────────

    @classmethod
    def create_notification(
        cls,
        *,
        recipient: User | None,
        title: str,
        message: str,
        category: str,
        event_type: str,
        priority: str = Notification.Priority.NORMAL,
        cooperative: Cooperative | None = None,
        action_url: str = "",
        data: dict[str, Any] | None = None,
        delivery_channels: list[str] | None = None,
    ) -> Notification | None:
        if recipient is None:
            return None

        notification = Notification.objects.create(
            recipient=recipient,
            cooperative=cooperative,
            title=title,
            message=message,
            category=category,
            event_type=event_type,
            priority=priority,
            action_url=action_url,
            data=data or {},
            delivery_channels=delivery_channels or [cls.IN_APP],
        )
        cls._broadcast(recipient, "notification.created", notification)
        return notification

    @classmethod
    def set_read_state(cls, notification: Notification, *, is_read: bool) -> Notification:
        if notification.is_read == is_read:
            return notification

        notification.is_read = is_read
        notification.read_at = timezone.now() if is_read else None
        notification.save(update_fields=["is_read", "read_at", "updated_at"])
        cls._broadcast(notification.recipient, "notification.updated", notification)
        return notification

    # ── Delivery helpers ────────────────────────────────────────────────────

    @classmethod
    def _deliver_email(
        cls,
        *,
        user: User | None,
        cooperative: Cooperative | None,
        preference_field: str | None,
        sender: Any,
        requires_tender_alerts: bool = False,
        **kwargs,
    ) -> bool:
        if not cls._channel_enabled(
            user=user,
            cooperative=cooperative,
            channel=cls.EMAIL,
            preference_field=preference_field,
            requires_tender_alerts=requires_tender_alerts,
        ):
            return False

        try:
            return bool(sender(**kwargs))
        except Exception:
            logger.exception("Email notification failed | to=%s", kwargs.get("to_email"))
            return False

    @classmethod
    def _deliver_sms(
        cls,
        *,
        user: User | None,
        cooperative: Cooperative | None,
        preference_field: str | None,
        sender: Any,
        requires_tender_alerts: bool = False,
        **kwargs,
    ) -> bool:
        if not cls._channel_enabled(
            user=user,
            cooperative=cooperative,
            channel=cls.SMS,
            preference_field=preference_field,
            requires_tender_alerts=requires_tender_alerts,
        ):
            return False

        try:
            return bool(sender(**kwargs))
        except Exception:
            logger.exception("SMS notification failed | to=%s", kwargs.get("phone_number") or kwargs.get("to_phone"))
            return False

    # ── Account & Onboarding ────────────────────────────────────────────────

    @classmethod
    def on_cooperative_registered(
        cls,
        *,
        email: str,
        phone: str,
        cooperative_name: str,
        chair_name: str,
        verification_token: str,
        verification_method: str = "email",
        recipient_user: User | None = None,
        cooperative: Cooperative | None = None,
    ) -> None:
        channels = [cls.IN_APP]

        if verification_method == "sms" and phone:
            if cls._deliver_sms(
                user=recipient_user,
                cooperative=cooperative,
                preference_field="sms_otp",
                sender=send_otp_sms,
                phone_number=phone,
                purpose="verification",
            ):
                channels.append(cls.SMS)
        elif cls._deliver_email(
            user=recipient_user,
            cooperative=cooperative,
            preference_field=None,
            sender=send_cooperative_verification_email,
            to_email=email,
            cooperative_name=cooperative_name,
            chair_name=chair_name,
            verification_token=verification_token,
        ):
            channels.append(cls.EMAIL)

        cls.create_notification(
            recipient=recipient_user,
            cooperative=cooperative,
            title="Complete your cooperative setup",
            message=(
                f"{cooperative_name} has been created. Finish verification via "
                f"{'SMS' if verification_method == 'sms' else 'email'} to activate your account."
            ),
            category=Notification.Category.ACCOUNT,
            event_type="account_created",
            priority=Notification.Priority.HIGH,
            action_url="/login",
            data={"verification_method": verification_method},
            delivery_channels=channels,
        )
        logger.info("on_cooperative_registered dispatched | coop=%s", cooperative_name)

    @classmethod
    def on_buyer_registered(
        cls,
        *,
        email: str,
        phone: str,
        buyer_name: str,
        verification_token: str,
        verification_method: str = "email",
        recipient_user: User | None = None,
    ) -> None:
        channels = [cls.IN_APP]

        if verification_method == "sms" and phone:
            if cls._deliver_sms(
                user=recipient_user,
                cooperative=None,
                preference_field=None,
                sender=send_otp_sms,
                phone_number=phone,
                purpose="verification",
            ):
                channels.append(cls.SMS)
        elif cls._deliver_email(
            user=recipient_user,
            cooperative=None,
            preference_field=None,
            sender=send_buyer_verification_email,
            to_email=email,
            buyer_name=buyer_name,
            company_name=(cls._related(recipient_user, "buyer_profile").company_name
                          if recipient_user and cls._related(recipient_user, "buyer_profile")
                          else "ShambaFlow Buyer"),
            verification_token=verification_token,
        ):
            channels.append(cls.EMAIL)

        cls.create_notification(
            recipient=recipient_user,
            title="Complete your buyer account setup",
            message=(
                "Your buyer account is ready. Verify your contact channel to start posting tenders."
            ),
            category=Notification.Category.ACCOUNT,
            event_type="buyer_account_created",
            priority=Notification.Priority.HIGH,
            action_url="/marketplace/onboarding",
            data={"verification_method": verification_method},
            delivery_channels=channels,
        )
        logger.info("on_buyer_registered dispatched | email=%s", email)

    @classmethod
    def on_helper_invited(
        cls,
        *,
        email: str,
        phone: str,
        invitee_name: str,
        cooperative_name: str,
        role: str,
        invitation_token: str,
        temporary_password: str,
        recipient_user: User | None = None,
        cooperative: Cooperative | None = None,
    ) -> None:
        channels = [cls.IN_APP]

        if cls._deliver_email(
            user=recipient_user,
            cooperative=cooperative,
            preference_field="email_invitations",
            sender=send_invitation_email,
            to_email=email,
            invitee_name=invitee_name,
            cooperative_name=cooperative_name,
            role=role,
            invitation_token=invitation_token,
            temporary_password=temporary_password,
        ):
            channels.append(cls.EMAIL)

        if phone and cls._deliver_sms(
            user=recipient_user,
            cooperative=cooperative,
            preference_field="sms_invitations",
            sender=send_invitation_sms,
            phone_number=phone,
            cooperative_name=cooperative_name,
            role=role,
        ):
            channels.append(cls.SMS)

        cls.create_notification(
            recipient=recipient_user,
            cooperative=cooperative,
            title=f"Invitation to join {cooperative_name}",
            message=f"You have been invited as {role.replace('_', ' ').title()}.",
            category=Notification.Category.INVITATION,
            event_type="helper_invited",
            priority=Notification.Priority.HIGH,
            action_url="/accept-invitation",
            data={"role": role, "cooperative_name": cooperative_name},
            delivery_channels=channels,
        )
        logger.info(
            "on_helper_invited dispatched | email=%s | role=%s | coop=%s",
            email, role, cooperative_name,
        )

    @classmethod
    def send_otp(
        cls,
        *,
        phone: str,
        purpose: str = "verification",
        recipient_user: User | None = None,
        cooperative: Cooperative | None = None,
    ) -> bool:
        sent = cls._deliver_sms(
            user=recipient_user if purpose == "verification" else None,
            cooperative=cooperative if purpose == "verification" else None,
            preference_field="sms_otp" if purpose == "verification" else None,
            sender=send_otp_sms,
            phone_number=phone,
            purpose=purpose,
        )

        if sent and recipient_user is not None:
            cls.create_notification(
                recipient=recipient_user,
                cooperative=cooperative,
                title="One-time code sent",
                message=f"A {purpose.replace('_', ' ')} code was sent to your phone number.",
                category=Notification.Category.SECURITY,
                event_type=f"{purpose}_otp_sent",
                priority=Notification.Priority.HIGH,
                delivery_channels=[cls.IN_APP, cls.SMS],
            )

        return sent

    # ── Tender & Marketplace Events ─────────────────────────────────────────

    @classmethod
    def on_tender_event(
        cls,
        *,
        email: str,
        phone: str,
        recipient_name: str,
        tender_title: str,
        tender_id: str,
        event_type: str,
        recipient_user: User | None = None,
        cooperative: Cooperative | None = None,
        action_url: str = "",
    ) -> None:
        channels = [cls.IN_APP]

        if cls._deliver_email(
            user=recipient_user,
            cooperative=cooperative,
            preference_field="email_tender_updates" if cooperative else None,
            sender=send_tender_notification_email,
            requires_tender_alerts=bool(cooperative),
            to_email=email,
            recipient_name=recipient_name,
            tender_title=tender_title,
            tender_id=tender_id,
            event_type=event_type,
        ):
            channels.append(cls.EMAIL)

        sms_event_map = {
            "tender_published": "new_tender",
            "bid_accepted": "bid_accepted",
        }
        sms_event = sms_event_map.get(event_type)
        if sms_event and phone and cls._deliver_sms(
            user=recipient_user,
            cooperative=cooperative,
            preference_field="sms_tender_updates" if cooperative else None,
            sender=send_tender_alert_sms,
            requires_tender_alerts=bool(cooperative),
            phone_number=phone,
            tender_title=tender_title,
            event_type=sms_event,
        ):
            channels.append(cls.SMS)

        message_by_event = {
            "tender_published": f"A new tender has been published: {tender_title}.",
            "new_bid": f"A new bid was submitted for {tender_title}.",
            "tender_awarded": f"Tender awarded: {tender_title}.",
            "bid_accepted": f"Your bid was accepted for {tender_title}.",
        }
        cls.create_notification(
            recipient=recipient_user,
            cooperative=cooperative,
            title=tender_title,
            message=message_by_event.get(event_type, f"Tender update: {tender_title}."),
            category=Notification.Category.TENDER if event_type != "new_bid" else Notification.Category.BID,
            event_type=event_type,
            priority=Notification.Priority.HIGH,
            action_url=action_url,
            data={"tender_id": tender_id, "event_type": event_type},
            delivery_channels=channels,
        )
        logger.info(
            "on_tender_event dispatched | event=%s | tender=%s | to=%s",
            event_type, tender_id, email,
        )

    # ── Verification / Security ─────────────────────────────────────────────

    @classmethod
    def on_verification_status_change(
        cls,
        *,
        phone: str,
        cooperative_name: str,
        approved: bool,
        recipient_user: User | None = None,
        cooperative: Cooperative | None = None,
        action_url: str = "",
    ) -> None:
        channels = [cls.IN_APP]

        if phone and cls._deliver_sms(
            user=recipient_user,
            cooperative=cooperative,
            preference_field="sms_critical_alerts",
            sender=send_verification_status_sms,
            phone_number=phone,
            cooperative_name=cooperative_name,
            approved=approved,
        ):
            channels.append(cls.SMS)

        cls.create_notification(
            recipient=recipient_user,
            cooperative=cooperative,
            title="Verification status updated",
            message=(
                f"{cooperative_name} has been "
                f"{'approved and verified' if approved else 'updated with a non-approved verification status'}."
            ),
            category=Notification.Category.VERIFICATION,
            event_type="verification_status_changed",
            priority=Notification.Priority.HIGH,
            action_url=action_url,
            data={"approved": approved},
            delivery_channels=channels,
        )
        logger.info(
            "on_verification_status_change dispatched | coop=%s | approved=%s",
            cooperative_name, approved,
        )

    @classmethod
    def on_password_reset_requested(
        cls,
        *,
        email: str,
        user_name: str,
        reset_token: str,
        recipient_user: User | None = None,
    ) -> None:
        channels = [cls.IN_APP]

        if cls._deliver_email(
            user=None,
            cooperative=None,
            preference_field=None,
            sender=send_password_reset_email,
            to_email=email,
            user_name=user_name,
            reset_token=reset_token,
        ):
            channels.append(cls.EMAIL)

        cls.create_notification(
            recipient=recipient_user,
            title="Password reset requested",
            message="A password reset request was created for your account.",
            category=Notification.Category.SECURITY,
            event_type="password_reset_requested",
            priority=Notification.Priority.CRITICAL,
            action_url="/reset-password",
            delivery_channels=channels,
        )
        logger.info("on_password_reset_requested dispatched | email=%s", email)


notifications = NotificationDispatcher()
