"""
ShambaFlow — Infobip SMS Service
Handles OTP delivery and critical alerts via Infobip REST API.
Designed for low-bandwidth environments (East Africa).
"""

import hashlib
import logging
import secrets
import string
from typing import Optional
from django.conf import settings
from django.core.cache import cache
import requests

logger = logging.getLogger('core.notifications')

# Cache key templates
OTP_CACHE_KEY = 'otp:{phone}:{purpose}'
OTP_ATTEMPT_KEY = 'otp_attempts:{phone}:{purpose}'


# ─────────────────────────────────────────
# INFOBIP HTTP CLIENT
# ─────────────────────────────────────────
def _infobip_headers() -> dict:
    """Return standard Infobip API headers."""
    return {
        'Authorization': f'App {settings.INFOBIP_API_KEY}',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    }


def _infobip_post(endpoint: str, payload: dict) -> Optional[dict]:
    """
    Make a POST request to the Infobip API.

    Args:
        endpoint: Path after base URL (e.g. '/sms/2/text/advanced')
        payload:  JSON request body as dict

    Returns:
        Parsed JSON response dict, or None on failure.
    """
    url = f"{settings.INFOBIP_BASE_URL.rstrip('/')}{endpoint}"
    try:
        response = requests.post(
            url,
            headers=_infobip_headers(),
            json=payload,
            timeout=10,
        )
        response.raise_for_status()
        return response.json()

    except requests.exceptions.Timeout:
        logger.error('Infobip request timed out | endpoint=%s', endpoint)
        return None
    except requests.exceptions.HTTPError as e:
        logger.error(
            'Infobip HTTP error | endpoint=%s | status=%s | body=%s',
            endpoint, e.response.status_code, e.response.text
        )
        return None
    except Exception as e:
        logger.exception('Unexpected error calling Infobip | endpoint=%s | error=%s', endpoint, e)
        return None


# ─────────────────────────────────────────
# CORE SMS SENDER
# ─────────────────────────────────────────
def send_sms(phone_number: str, message: str) -> bool:
    """
    Send a plain SMS message via Infobip.

    Args:
        phone_number: E.164 format, e.g. +254712345678
        message:      SMS body text (max 160 chars for single part)

    Returns:
        True on success, False on failure.
    """
    payload = {
        'messages': [
            {
                'from': settings.INFOBIP_SENDER_ID,
                'destinations': [{'to': phone_number}],
                'text': message,
            }
        ]
    }

    result = _infobip_post('/sms/2/text/advanced', payload)

    if result:
        status = (
            result.get('messages', [{}])[0]
            .get('status', {})
            .get('groupName', 'UNKNOWN')
        )
        logger.info(
            'SMS sent | to=%s | status=%s | msg_preview=%.30s',
            phone_number, status, message
        )
        return status in ('PENDING', 'DELIVERED', 'SENT')

    return False


# ─────────────────────────────────────────
# OTP GENERATION & VERIFICATION
# ─────────────────────────────────────────
def generate_otp(length: int = None) -> str:
    """Generate a cryptographically secure numeric OTP."""
    otp_length = length or settings.SHAMBAFLOW.get('OTP_LENGTH', 6)
    return ''.join(secrets.choice(string.digits) for _ in range(otp_length))


def send_otp_sms(phone_number: str, purpose: str = 'verification') -> bool:
    """
    Generate, cache, and send an OTP to a phone number.

    OTP is stored hashed in Redis with TTL.
    The plain OTP is only ever sent via SMS — never stored plain-text.

    Args:
        phone_number: E.164 format recipient number
        purpose:      Context label for the cache key ('verification', 'login', 'password_reset')

    Returns:
        True if SMS was dispatched successfully.
    """
    # Rate-limit: max 5 OTP sends per phone per hour
    attempt_key = OTP_ATTEMPT_KEY.format(phone=phone_number, purpose=purpose)
    attempts = cache.get(attempt_key, 0)

    max_attempts = settings.SHAMBAFLOW.get('OTP_MAX_HOURLY_ATTEMPTS', 5)
    if attempts >= max_attempts:
        logger.warning(
            'OTP rate limit exceeded | phone=%s | purpose=%s',
            phone_number, purpose
        )
        return False

    # Generate OTP and hash for storage
    otp = generate_otp()
    otp_hash = hashlib.sha256(otp.encode()).hexdigest()

    # Store hashed OTP in Redis
    otp_ttl_seconds = settings.SHAMBAFLOW.get('OTP_EXPIRY_MINUTES', 10) * 60
    cache_key = OTP_CACHE_KEY.format(phone=phone_number, purpose=purpose)
    cache.set(cache_key, otp_hash, timeout=otp_ttl_seconds)

    # Increment attempt counter (resets hourly)
    cache.set(attempt_key, attempts + 1, timeout=3600)

    # Build message by purpose
    messages = {
        'verification': f'Your ShambaFlow verification code is: {otp}. Valid for 10 minutes. Do not share this code.',
        'login': f'Your ShambaFlow login code is: {otp}. Valid for 10 minutes.',
        'password_reset': f'Your ShambaFlow password reset code is: {otp}. Valid for 10 minutes.',
    }
    message = messages.get(purpose, f'Your ShambaFlow code is: {otp}. Valid for 10 minutes.')

    success = send_sms(phone_number, message)

    if not success:
        # Clean up the stored OTP if send failed
        cache.delete(cache_key)
        logger.error('OTP SMS failed — cache cleared | phone=%s', phone_number)

    return success


def verify_otp(phone_number: str, otp_input: str, purpose: str = 'verification') -> bool:
    """
    Verify a submitted OTP against the cached hash.

    Args:
        phone_number: The phone the OTP was sent to
        otp_input:    The code the user submitted
        purpose:      Must match the purpose used in send_otp_sms

    Returns:
        True if OTP is correct and not expired, False otherwise.
    """
    cache_key = OTP_CACHE_KEY.format(phone=phone_number, purpose=purpose)
    stored_hash = cache.get(cache_key)

    if not stored_hash:
        logger.info(
            'OTP verify failed — expired or not found | phone=%s | purpose=%s',
            phone_number, purpose
        )
        return False

    submitted_hash = hashlib.sha256(otp_input.strip().encode()).hexdigest()

    if stored_hash == submitted_hash:
        # Consume the OTP — one-time use
        cache.delete(cache_key)
        logger.info('OTP verified successfully | phone=%s | purpose=%s', phone_number, purpose)
        return True

    logger.warning('OTP mismatch | phone=%s | purpose=%s', phone_number, purpose)
    return False


# ─────────────────────────────────────────
# TEMPLATED SMS MESSAGES
# ─────────────────────────────────────────
def send_invitation_sms(phone_number: str, cooperative_name: str, role: str) -> bool:
    """Notify a new helper account of their invitation via SMS."""
    role_display = role.replace('_', ' ').title()
    message = (
        f"You have been invited to join {cooperative_name} on ShambaFlow "
        f"as {role_display}. Check your email for login details. "
        f"shambaflow.com"
    )
    return send_sms(phone_number, message)


def send_tender_alert_sms(phone_number: str, tender_title: str, event_type: str) -> bool:
    """Send a brief tender event alert via SMS."""
    messages = {
        'new_tender': f'New tender on ShambaFlow: "{tender_title[:40]}". Log in to bid. shambaflow.com',
        'bid_accepted': f'Your bid was accepted on ShambaFlow: "{tender_title[:40]}". shambaflow.com',
        'tender_closing': f'Tender closing soon on ShambaFlow: "{tender_title[:40]}". shambaflow.com',
    }
    message = messages.get(
        event_type,
        f'ShambaFlow update on tender: "{tender_title[:50]}". shambaflow.com'
    )
    return send_sms(phone_number, message)


def send_verification_status_sms(phone_number: str, cooperative_name: str, approved: bool) -> bool:
    """Notify cooperative chair of verification approval/rejection."""
    if approved:
        message = (
            f"Congratulations! {cooperative_name} has been verified on ShambaFlow. "
            f"You now have access to premium tenders. shambaflow.com"
        )
    else:
        message = (
            f"Your ShambaFlow verification for {cooperative_name} requires attention. "
            f"Please log in to review the required documents. shambaflow.com"
        )
    return send_sms(phone_number, message)