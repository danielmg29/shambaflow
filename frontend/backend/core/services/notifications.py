"""
ShambaFlow — Unified Notification Dispatcher
Single interface for routing all communications through Brevo (email)
and Infobip (SMS). Decouples the rest of the app from specific providers.
"""

import logging
from typing import Optional
from core.services.brevo_email import (
    send_cooperative_verification_email,
    send_helper_invitation_email,
    send_tender_notification_email,
    send_password_reset_email,
)
from core.services.infobip_sms import (
    send_otp_sms,
    send_invitation_sms,
    send_tender_alert_sms,
    send_verification_status_sms,
)

logger = logging.getLogger('core.notifications')


class NotificationDispatcher:
    """
    Centralised dispatcher for all ShambaFlow notifications.
    Call this class from views, signals, or background tasks.
    Never call Brevo/Infobip services directly from business logic.
    """

    # ── Account & Onboarding ──────────────────────────────────

    @staticmethod
    def on_cooperative_registered(
        email: str,
        phone: str,
        cooperative_name: str,
        chair_name: str,
        verification_token: str,
    ) -> None:
        """Triggered when a Cooperative Chair completes onboarding."""
        send_cooperative_verification_email(
            to_email=email,
            cooperative_name=cooperative_name,
            chair_name=chair_name,
            verification_token=verification_token,
        )
        send_otp_sms(phone_number=phone, purpose='verification')
        logger.info('on_cooperative_registered dispatched | coop=%s', cooperative_name)

    @staticmethod
    def on_helper_invited(
        email: str,
        phone: str,
        invitee_name: str,
        cooperative_name: str,
        role: str,
        invitation_token: str,
        temporary_password: str,
    ) -> None:
        """Triggered when a Chair creates a helper account."""
        send_helper_invitation_email(
            to_email=email,
            invitee_name=invitee_name,
            cooperative_name=cooperative_name,
            role=role,
            invitation_token=invitation_token,
            temporary_password=temporary_password,
        )
        send_invitation_sms(
            phone_number=phone,
            cooperative_name=cooperative_name,
            role=role,
        )
        logger.info(
            'on_helper_invited dispatched | email=%s | role=%s | coop=%s',
            email, role, cooperative_name
        )

    @staticmethod
    def send_otp(phone: str, purpose: str = 'verification') -> bool:
        """Dispatch an OTP for phone verification or 2FA."""
        return send_otp_sms(phone_number=phone, purpose=purpose)

    # ── Tender Events ─────────────────────────────────────────

    @staticmethod
    def on_tender_event(
        email: str,
        phone: str,
        recipient_name: str,
        tender_title: str,
        tender_id: str,
        event_type: str,
    ) -> None:
        """
        Triggered for tender lifecycle events.
        event_type: 'new_bid' | 'tender_awarded' | 'tender_published' | 'bid_accepted'
        """
        send_tender_notification_email(
            to_email=email,
            recipient_name=recipient_name,
            tender_title=tender_title,
            tender_id=tender_id,
            event_type=event_type,
        )

        sms_event_map = {
            'tender_published': 'new_tender',
            'bid_accepted': 'bid_accepted',
        }
        sms_event = sms_event_map.get(event_type)
        if sms_event:
            send_tender_alert_sms(
                phone_number=phone,
                tender_title=tender_title,
                event_type=sms_event,
            )

        logger.info(
            'on_tender_event dispatched | event=%s | tender=%s | to=%s',
            event_type, tender_id, email
        )

    # ── Verification Status ───────────────────────────────────

    @staticmethod
    def on_verification_status_change(
        phone: str,
        cooperative_name: str,
        approved: bool,
    ) -> None:
        """Triggered when platform admins approve/reject a cooperative."""
        send_verification_status_sms(
            phone_number=phone,
            cooperative_name=cooperative_name,
            approved=approved,
        )
        logger.info(
            'on_verification_status_change dispatched | coop=%s | approved=%s',
            cooperative_name, approved
        )

    # ── Password Reset ────────────────────────────────────────

    @staticmethod
    def on_password_reset_requested(
        email: str,
        user_name: str,
        reset_token: str,
    ) -> None:
        """Triggered when a user requests a password reset."""
        send_password_reset_email(
            to_email=email,
            user_name=user_name,
            reset_token=reset_token,
        )
        logger.info('on_password_reset_requested dispatched | email=%s', email)


# ─────────────────────────────────────────
# Module-level singleton for easy import
# ─────────────────────────────────────────
notifications = NotificationDispatcher()