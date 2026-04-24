"""
ShambaFlow — Brevo Email Service
Handles all transactional email via Brevo API (formerly Sendinblue).
Uses Brevo's API v3 for reliability over raw SMTP.
"""

import logging
from typing import Optional
import sib_api_v3_sdk
from sib_api_v3_sdk.rest import ApiException
from django.conf import settings

logger = logging.getLogger('core.notifications')


# ─────────────────────────────────────────
# BREVO CLIENT — Singleton Configuration
# ─────────────────────────────────────────
def _get_brevo_client():
    """Initialise and return a configured Brevo transactional email API client."""
    configuration = sib_api_v3_sdk.Configuration()
    configuration.api_key['api-key'] = settings.BREVO_API_KEY
    return sib_api_v3_sdk.TransactionalEmailsApi(
        sib_api_v3_sdk.ApiClient(configuration)
    )


def _looks_like_brevo_smtp_login(address: str | None) -> bool:
    if not address:
        return False
    return address.strip().lower().endswith("@smtp-brevo.com")


# ─────────────────────────────────────────
# CORE SEND FUNCTION
# ─────────────────────────────────────────
def send_email(
    to_email: str,
    to_name: str,
    subject: str,
    html_content: str,
    text_content: Optional[str] = None,
    reply_to: Optional[str] = None,
) -> bool:
    """
    Send a single transactional email via Brevo API.

    Args:
        to_email:      Recipient email address
        to_name:       Recipient display name
        subject:       Email subject line
        html_content:  HTML body of the email
        text_content:  Plain text fallback (auto-stripped if None)
        reply_to:      Optional reply-to address

    Returns:
        True on success, False on failure.
    """
    if _looks_like_brevo_smtp_login(settings.BREVO_SENDER_EMAIL):
        logger.error(
            "Brevo sender misconfigured: BREVO_SENDER_EMAIL=%s looks like the SMTP login. "
            "Use a verified sender address from your own authenticated domain instead, "
            "and keep the SMTP login in BREVO_SMTP_LOGIN. "
            "If you recently changed backend/.env, restart the Django process so the new settings are loaded.",
            settings.BREVO_SENDER_EMAIL,
        )
        return False

    try:
        api_instance = _get_brevo_client()

        send_smtp_email = sib_api_v3_sdk.SendSmtpEmail(
            sender={
                'name': settings.BREVO_SENDER_NAME,
                'email': settings.BREVO_SENDER_EMAIL,
            },
            to=[{'email': to_email, 'name': to_name}],
            subject=subject,
            html_content=html_content,
            text_content=text_content or _strip_html(html_content),
            reply_to={'email': reply_to} if reply_to else None,
        )

        response = api_instance.send_transac_email(send_smtp_email)
        logger.info(
            'Brevo email sent | to=%s | subject=%s | messageId=%s',
            to_email, subject, response.message_id
        )
        return True

    except ApiException as e:
        logger.error(
            'Brevo API error | to=%s | status=%s | body=%s',
            to_email, e.status, e.body
        )
        return False
    except Exception as e:
        logger.exception('Unexpected error sending email to %s: %s', to_email, e)
        return False


# ─────────────────────────────────────────
# TRANSACTIONAL EMAIL TEMPLATES
# ─────────────────────────────────────────

def send_cooperative_verification_email(
    to_email: str,
    cooperative_name: str,
    chair_name: str,
    verification_token: str,
) -> bool:
    """
    Sent when a cooperative completes onboarding and awaits verification.
    """
    verification_url = (
        f"{settings.FRONTEND_URL}/verify-email?token={verification_token}"
    )
    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #1a5e1a; padding: 24px; text-align: center;">
            <h1 style="color: #a8e063; margin: 0;">ShambaFlow</h1>
        </div>
        <div style="padding: 32px; background: #ffffff;">
            <h2 style="color: #1a5e1a;">Welcome, {chair_name}!</h2>
            <p>Your cooperative <strong>{cooperative_name}</strong> has been registered on ShambaFlow.</p>
            <p>Please verify your email address to activate your account:</p>
            <div style="text-align: center; margin: 32px 0;">
                <a href="{verification_url}"
                   style="background: #2e7d32; color: white; padding: 14px 32px;
                          text-decoration: none; border-radius: 6px; font-weight: bold;">
                    Verify Email Address
                </a>
            </div>
            <p style="color: #666; font-size: 14px;">
                This link expires in 72 hours. If you did not register on ShambaFlow, please ignore this email.
            </p>
        </div>
        <div style="padding: 16px; text-align: center; background: #f5f5f5; color: #999; font-size: 12px;">
            © ShambaFlow — Digital Infrastructure for Organised Agricultural Supply
        </div>
    </div>
    """
    return send_email(
        to_email=to_email,
        to_name=f"{chair_name} ({cooperative_name})",
        subject=f"Verify your ShambaFlow account — {cooperative_name}",
        html_content=html,
    )


def send_buyer_verification_email(
    to_email: str,
    buyer_name: str,
    company_name: str,
    verification_token: str,
) -> bool:
    """
    Sent when a buyer self-registers and needs to verify their email address.
    """
    verification_url = (
        f"{settings.FRONTEND_URL}/verify-email?token={verification_token}"
    )
    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #16423c; padding: 24px; text-align: center;">
            <h1 style="color: #f4efe6; margin: 0;">ShambaFlow</h1>
        </div>
        <div style="padding: 32px; background: #ffffff;">
            <h2 style="color: #16423c;">Welcome, {buyer_name}!</h2>
            <p>
                Your buyer account for <strong>{company_name}</strong> has been created on ShambaFlow.
            </p>
            <p>
                Verify your email address to finish onboarding and start publishing structured tenders.
            </p>
            <div style="text-align: center; margin: 32px 0;">
                <a href="{verification_url}"
                   style="background: #1f6f5f; color: white; padding: 14px 32px;
                          text-decoration: none; border-radius: 6px; font-weight: bold;">
                    Verify Buyer Account
                </a>
            </div>
            <div style="background: #f4f7f2; border-radius: 8px; padding: 16px; margin: 24px 0;">
                <p style="margin: 0 0 8px 0; font-weight: bold; color: #16423c;">What happens next?</p>
                <p style="margin: 0; color: #4a5565;">
                    Complete your buyer onboarding, add sourcing preferences, and publish your first tender.
                </p>
            </div>
            <p style="color: #666; font-size: 14px;">
                This link expires in 72 hours. If you did not create this account, please ignore this email.
            </p>
        </div>
        <div style="padding: 16px; text-align: center; background: #f5f5f5; color: #999; font-size: 12px;">
            © ShambaFlow — Digital Infrastructure for Organised Agricultural Supply
        </div>
    </div>
    """
    return send_email(
        to_email=to_email,
        to_name=f"{buyer_name} ({company_name})",
        subject=f"Verify your ShambaFlow buyer account — {company_name}",
        html_content=html,
    )


def send_invitation_email(
    to_email: str,
    invitee_name: str,
    cooperative_name: str,
    role: str,
    invitation_token: str,
    temporary_password: str,
) -> bool:
    """
    Sent when a Cooperative Chair creates a helper account.
    """
    accept_url = (
        f"{settings.FRONTEND_URL}/accept-invitation?token={invitation_token}"
    )
    role_display = role.replace('_', ' ').title()
    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #1a5e1a; padding: 24px; text-align: center;">
            <h1 style="color: #a8e063; margin: 0;">ShambaFlow</h1>
        </div>
        <div style="padding: 32px; background: #ffffff;">
            <h2 style="color: #1a5e1a;">You've been invited!</h2>
            <p>Hello {invitee_name},</p>
            <p>
                You have been invited to join <strong>{cooperative_name}</strong>
                on ShambaFlow as a <strong>{role_display}</strong>.
            </p>
            <div style="background: #f9f9f9; border-left: 4px solid #2e7d32;
                        padding: 16px; margin: 24px 0; border-radius: 4px;">
                <p style="margin: 0 0 8px 0;"><strong>Your temporary credentials:</strong></p>
                <p style="margin: 0;">Email: <code>{to_email}</code></p>
                <p style="margin: 4px 0 0 0;">Password: <code>{temporary_password}</code></p>
            </div>
            <p>Click below to accept your invitation and set a new password:</p>
            <div style="text-align: center; margin: 32px 0;">
                <a href="{accept_url}"
                   style="background: #2e7d32; color: white; padding: 14px 32px;
                          text-decoration: none; border-radius: 6px; font-weight: bold;">
                    Accept Invitation
                </a>
            </div>
            <p style="color: #666; font-size: 14px;">
                This invitation expires in 72 hours.
            </p>
        </div>
        <div style="padding: 16px; text-align: center; background: #f5f5f5;
                    color: #999; font-size: 12px;">
            © ShambaFlow — Digital Infrastructure for Organised Agricultural Supply
        </div>
    </div>
    """
    return send_email(
        to_email=to_email,
        to_name=invitee_name,
        subject=f"You're invited to join {cooperative_name} on ShambaFlow",
        html_content=html,
    )


def send_tender_notification_email(
    to_email: str,
    recipient_name: str,
    tender_title: str,
    tender_id: str,
    event_type: str,   # 'new_bid' | 'tender_awarded' | 'tender_published' | 'bid_accepted'
) -> bool:
    """
    Sent for tender lifecycle events.
    """
    tender_url = f"{settings.FRONTEND_URL}/tenders/{tender_id}"

    event_messages = {
        'new_bid': ('New Bid Received', f'A new bid has been submitted on your tender <strong>{tender_title}</strong>.'),
        'tender_awarded': ('Tender Awarded', f'The tender <strong>{tender_title}</strong> has been awarded.'),
        'tender_published': ('New Tender Available', f'A new tender matching your profile has been published: <strong>{tender_title}</strong>.'),
        'bid_accepted': ('Your Bid Was Accepted', f'Your bid on <strong>{tender_title}</strong> has been accepted.'),
    }

    subject_line, message_body = event_messages.get(
        event_type,
        ('Tender Update', f'There is an update on tender <strong>{tender_title}</strong>.')
    )

    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #1a5e1a; padding: 24px; text-align: center;">
            <h1 style="color: #a8e063; margin: 0;">ShambaFlow</h1>
        </div>
        <div style="padding: 32px; background: #ffffff;">
            <h2 style="color: #1a5e1a;">{subject_line}</h2>
            <p>Hello {recipient_name},</p>
            <p>{message_body}</p>
            <div style="text-align: center; margin: 32px 0;">
                <a href="{tender_url}"
                   style="background: #2e7d32; color: white; padding: 14px 32px;
                          text-decoration: none; border-radius: 6px; font-weight: bold;">
                    View Tender
                </a>
            </div>
        </div>
        <div style="padding: 16px; text-align: center; background: #f5f5f5;
                    color: #999; font-size: 12px;">
            © ShambaFlow — Digital Infrastructure for Organised Agricultural Supply
        </div>
    </div>
    """
    return send_email(
        to_email=to_email,
        to_name=recipient_name,
        subject=f"ShambaFlow: {subject_line} — {tender_title}",
        html_content=html,
    )


def send_password_reset_email(
    to_email: str,
    user_name: str,
    reset_token: str,
) -> bool:
    """
    Sent when a user requests a password reset.
    """
    reset_url = f"{settings.FRONTEND_URL}/reset-password?token={reset_token}"
    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #1a5e1a; padding: 24px; text-align: center;">
            <h1 style="color: #a8e063; margin: 0;">ShambaFlow</h1>
        </div>
        <div style="padding: 32px; background: #ffffff;">
            <h2 style="color: #1a5e1a;">Password Reset Request</h2>
            <p>Hello {user_name},</p>
            <p>We received a request to reset your ShambaFlow password. Click below to proceed:</p>
            <div style="text-align: center; margin: 32px 0;">
                <a href="{reset_url}"
                   style="background: #c0392b; color: white; padding: 14px 32px;
                          text-decoration: none; border-radius: 6px; font-weight: bold;">
                    Reset Password
                </a>
            </div>
            <p style="color: #666; font-size: 14px;">
                This link expires in 1 hour. If you did not request this, please ignore this email.
                Your password will not change.
            </p>
        </div>
        <div style="padding: 16px; text-align: center; background: #f5f5f5;
                    color: #999; font-size: 12px;">
            © ShambaFlow — Digital Infrastructure for Organised Agricultural Supply
        </div>
    </div>
    """
    return send_email(
        to_email=to_email,
        to_name=user_name,
        subject='Reset your ShambaFlow password',
        html_content=html,
    )


# ─────────────────────────────────────────
# UTILITY
# ─────────────────────────────────────────
def _strip_html(html: str) -> str:
    """Crude HTML-to-text fallback for plain text email parts."""
    import re
    text = re.sub(r'<[^>]+>', ' ', html)
    text = re.sub(r'\s+', ' ', text).strip()
    return text
