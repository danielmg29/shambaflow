"""
ShambaFlow — Auth Services
All authentication business logic. Views are thin wrappers around these functions.
"""

import hashlib
import secrets
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from django.utils.text import slugify

from core.services.infobip_sms import verify_otp as verify_sms_otp
from core.services.notifications import notifications

User = get_user_model()


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()

def _gen_token(n: int = 32) -> str:
    return secrets.token_urlsafe(n)


# ── COOPERATIVE REGISTRATION ───────────────────────────────────────

@transaction.atomic
def register_cooperative(data: dict) -> dict:
    from core.models import Cooperative, CooperativeChairProfile

    chair_email = data['chair_email'].lower().strip()
    chair_phone = data.get('chair_phone', '').strip()
    verification_method = data.get('verification_method', 'email')
    reg_number = data.get('registration_number', '').strip()
    chair_password = data.get('chair_password') or data.get('password')

    if not chair_password:
        raise ValueError('Password is required.')

    if User.objects.filter(email=chair_email).exists():
        raise ValueError('An account with this email address already exists.')
    if chair_phone and User.objects.filter(phone_number=chair_phone).exists():
        raise ValueError('An account with this phone number already exists.')
    if reg_number and Cooperative.objects.filter(registration_number=reg_number).exists():
        raise ValueError('A cooperative with this registration number already exists.')

    coop_name = data['cooperative_name'].strip()

    # Generate a unique slug from the cooperative name (required + unique).
    base_slug = slugify(coop_name) or "cooperative"
    slug = base_slug
    n = 1
    while Cooperative.objects.filter(slug=slug).exists():
        slug = f"{base_slug}-{n}"
        n += 1

    cooperative = Cooperative.objects.create(
        name=coop_name,
        slug=slug,
        registration_number=reg_number,
        cooperative_type=data.get('cooperative_type', 'MIXED'),
        region=data.get('region', ''),
        country=data.get('country', 'Kenya'),
        verification_status='PENDING',
    )

    verification_token = _gen_token()

    chair = User.objects.create_user(
        username=chair_email,
        email=chair_email,
        password=chair_password,
        first_name=data.get('chair_first_name', ''),
        last_name=data.get('chair_last_name', ''),
        phone_number=chair_phone,
        user_type='CHAIR',
        cooperative=cooperative,
        is_email_verified=False,
        is_phone_verified=False,
        email_verification_token=_hash(verification_token),
        must_change_password=False,
    )

    CooperativeChairProfile.objects.create(user=chair)
    cooperative.chair = chair
    cooperative.save(update_fields=['chair'])

    if verification_method != 'sms' or not chair_phone:
        verification_method = 'email'

    chair_name = f"{data.get('chair_first_name', '')} {data.get('chair_last_name', '')}".strip()
    notifications.on_cooperative_registered(
        email=chair_email,
        phone=chair_phone,
        cooperative_name=cooperative.name,
        chair_name=chair_name or chair_email,
        verification_token=verification_token,
        verification_method=verification_method,
        recipient_user=chair,
        cooperative=cooperative,
    )

    return {
        'user_id': str(chair.id),
        'cooperative_id': str(cooperative.id),
        'cooperative_name': cooperative.name,
        'verification_method': verification_method,
    }


# ── BUYER REGISTRATION ─────────────────────────────────────────────

@transaction.atomic
def register_buyer(data: dict) -> dict:
    from core.models import BuyerProfile

    email = data['email'].lower().strip()
    phone = data.get('phone', '').strip()
    verification_method = data.get('verification_method', 'email')

    if User.objects.filter(email=email).exists():
        raise ValueError('An account with this email address already exists.')
    if phone and User.objects.filter(phone_number=phone).exists():
        raise ValueError('An account with this phone number already exists.')

    verification_token = _gen_token()

    user = User.objects.create_user(
        username=email,
        email=email,
        password=data['password'],
        first_name=data.get('first_name', ''),
        last_name=data.get('last_name', ''),
        phone_number=phone,
        user_type='BUYER',
        is_email_verified=False,
        is_phone_verified=False,
        email_verification_token=_hash(verification_token),
        must_change_password=False,
    )

    BuyerProfile.objects.create(
        user=user,
        company_name=data.get('company_name', ''),
        buyer_type=data.get('buyer_type', 'TRADER'),
    )

    if verification_method != 'sms' or not phone:
        verification_method = 'email'

    buyer_name = f"{data.get('first_name', '')} {data.get('last_name', '')}".strip()
    notifications.on_buyer_registered(
        email=email,
        phone=phone,
        buyer_name=buyer_name or email,
        verification_token=verification_token,
        verification_method=verification_method,
        recipient_user=user,
    )

    return {'user_id': str(user.id), 'verification_method': verification_method}


# ── EMAIL VERIFICATION ─────────────────────────────────────────────

def verify_email_token(token: str) -> tuple[bool, str]:
    try:
        user = User.objects.get(email_verification_token=_hash(token))
    except User.DoesNotExist:
        return False, 'This verification link is invalid or has already been used.'

    if user.is_email_verified:
        return True, 'Your email is already verified. You can log in.'

    user.is_email_verified = True
    user.email_verification_token = ''
    user.save(update_fields=['is_email_verified', 'email_verification_token'])
    return True, 'Email verified successfully. You can now log in.'


def resend_verification_email(email: str) -> tuple[bool, str]:
    msg = 'If this email is registered, a verification link has been sent.'
    try:
        user = User.objects.get(email=email.lower().strip())
    except User.DoesNotExist:
        return True, msg

    if user.is_email_verified:
        return True, 'This email address is already verified.'

    token = _gen_token()
    user.email_verification_token = _hash(token)
    user.save(update_fields=['email_verification_token'])

    if user.is_buyer:
        notifications.on_buyer_registered(
            email=user.email,
            phone=user.phone_number,
            buyer_name=user.get_full_name() or user.email,
            verification_token=token,
            verification_method='email',
            recipient_user=user,
        )
    else:
        notifications.on_cooperative_registered(
            email=user.email,
            phone=user.phone_number,
            cooperative_name=user.cooperative.name if user.cooperative else 'ShambaFlow',
            chair_name=user.get_full_name() or user.email,
            verification_token=token,
            verification_method='email',
            recipient_user=user,
            cooperative=user.cooperative if user.cooperative_id else None,
        )

    return True, msg


# ── PHONE / OTP VERIFICATION ───────────────────────────────────────

def verify_phone_otp(phone: str, otp: str, purpose: str = 'verification') -> tuple[bool, str]:
    if not verify_sms_otp(phone, otp, purpose=purpose):
        return False, 'The code is invalid or has expired. Please request a new one.'

    try:
        user = User.objects.get(phone_number=phone)
        if purpose == 'verification':
            user.is_phone_verified = True
            user.save(update_fields=['is_phone_verified'])
    except User.DoesNotExist:
        pass

    return True, 'Phone number verified successfully.'


# ── PASSWORD RESET ─────────────────────────────────────────────────

def initiate_password_reset(identifier: str, method: str = 'email') -> None:
    identifier = identifier.strip()
    try:
        user = User.objects.get(email=identifier.lower()) if '@' in identifier \
            else User.objects.get(phone_number=identifier)
    except User.DoesNotExist:
        return

    if method == 'sms':
        notifications.send_otp(
            phone=user.phone_number,
            purpose='password_reset',
            recipient_user=user,
            cooperative=user.cooperative if user.cooperative_id else None,
        )
    else:
        token = _gen_token()
        user.reset_password_token = _hash(token)
        user.reset_password_token_expires = timezone.now() + timedelta(hours=1)
        user.save(update_fields=['reset_password_token', 'reset_password_token_expires'])
        notifications.on_password_reset_requested(
            email=user.email,
            user_name=user.get_full_name() or user.email,
            reset_token=token,
            recipient_user=user,
        )


def complete_password_reset(token: str, new_password: str) -> tuple[bool, str]:
    try:
        user = User.objects.get(
            reset_password_token=_hash(token),
            reset_password_token_expires__gt=timezone.now(),
        )
    except User.DoesNotExist:
        return False, 'This reset link is invalid or has expired.'

    user.set_password(new_password)
    user.reset_password_token = ''
    user.reset_password_token_expires = None
    user.must_change_password = False
    user.save(update_fields=[
        'password', 'reset_password_token',
        'reset_password_token_expires', 'must_change_password',
    ])
    return True, 'Password reset successfully. You can now log in.'


def complete_password_reset_otp(phone: str, otp: str, new_password: str) -> tuple[bool, str]:
    if not verify_sms_otp(phone, otp, purpose='password_reset'):
        return False, 'The code is invalid or has expired.'

    try:
        user = User.objects.get(phone_number=phone)
    except User.DoesNotExist:
        return False, 'No account found with this phone number.'

    user.set_password(new_password)
    user.must_change_password = False
    user.save(update_fields=['password', 'must_change_password'])
    return True, 'Password reset successfully. You can now log in.'


# ── CHANGE PASSWORD ────────────────────────────────────────────────

def change_password(user, current_password: str, new_password: str) -> tuple[bool, str]:
    if not user.check_password(current_password):
        return False, 'Current password is incorrect.'
    user.set_password(new_password)
    user.must_change_password = False
    user.save(update_fields=['password', 'must_change_password'])
    return True, 'Password changed successfully.'


# ── ACCEPT INVITATION ──────────────────────────────────────────────

@transaction.atomic
def accept_invitation(token: str, new_password: str) -> tuple[bool, str, dict | None]:
    from core.models import CooperativeInvitation

    try:
        invitation = CooperativeInvitation.objects.select_related(
            'invited_user', 'cooperative'
        ).get(
            token=_hash(token),
            is_accepted=False,
            expires_at__gt=timezone.now(),
        )
    except CooperativeInvitation.DoesNotExist:
        return False, 'This invitation link is invalid or has expired.', None

    helper = invitation.invited_user
    helper.set_password(new_password)
    helper.is_email_verified = True
    helper.must_change_password = False
    helper.save(update_fields=['password', 'is_email_verified', 'must_change_password'])

    invitation.is_accepted = True
    invitation.accepted_at = timezone.now()
    invitation.save(update_fields=['is_accepted', 'accepted_at'])

    return True, 'Account activated. You can now log in.', {
        'user_id': str(helper.id),
        'email': helper.email,
        'cooperative_id': str(invitation.cooperative.id),
        'role': helper.helper_role,
    }
