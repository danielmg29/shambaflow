"""
ShambaFlow — Auth Views

All views are thin wrappers around core/auth/services.py.
Serializers validate input; services do the work.

Endpoints:
  POST /api/auth/register/cooperative/
  POST /api/auth/register/buyer/
  POST /api/auth/login/
  POST /api/auth/logout/
  POST /api/auth/token/refresh/
  POST /api/auth/verify-email/
  POST /api/auth/verify-otp/
  POST /api/auth/resend-otp/
  POST /api/auth/resend-verification/
  POST /api/auth/forgot-password/
  POST /api/auth/reset-password/
  POST /api/auth/reset-password-otp/
  POST /api/auth/change-password/
  POST /api/auth/accept-invitation/
  GET  /api/auth/me/
  PATCH /api/auth/me/
"""

import logging
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from rest_framework_simplejwt.exceptions import TokenError
import pyotp
import qrcode
import base64
from io import BytesIO
import hashlib
import secrets

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.contrib.auth import authenticate
from django.utils import timezone

from core.auth.serializers import (
    ShambaFlowTokenObtainSerializer,
    CooperativeRegistrationSerializer,
    BuyerRegistrationSerializer,
    ForgotPasswordSerializer,
    ResetPasswordSerializer,
    VerifyEmailSerializer,
    VerifyOTPSerializer,
    ResendOTPSerializer,
    ResendVerificationEmailSerializer,
    ChangePasswordSerializer,
    AcceptInvitationSerializer,
    UserProfileSerializer,
    UpdateProfileSerializer,
)
from core.auth.services import (
    register_cooperative,
    register_buyer,
    verify_email_token,
    verify_phone_otp,
    resend_verification_email,
    initiate_password_reset,
    complete_password_reset,
    complete_password_reset_otp,
    change_password,
    accept_invitation,
)
from core.models import User, Cooperative, RolePermission, Invitation, CooperativeChairProfile, BuyerProfile
from core.services.notifications import notifications

logger = logging.getLogger('shambaflow')


# ══════════════════════════════════════════════════════════════════
#  JWT LOGIN — custom view using our serializer
# ══════════════════════════════════════════════════════════════════

class ShambaFlowLoginView(TokenObtainPairView):
    """
    POST /api/auth/login/
    Returns: access, refresh, user payload (see ShambaFlowTokenObtainSerializer)
    """
    serializer_class = ShambaFlowTokenObtainSerializer
    throttle_scope = 'auth'


# ══════════════════════════════════════════════════════════════════
#  LOGOUT — blacklist the refresh token
# ══════════════════════════════════════════════════════════════════

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout_view(request):
    """
    POST /api/auth/logout/
    Body: {"refresh": "<refresh_token>"}
    Blacklists the refresh token so it cannot be reused.
    """
    refresh_token = request.data.get('refresh')
    if not refresh_token:
        return Response(
            {'error': 'Refresh token is required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        token = RefreshToken(refresh_token)
        token.blacklist()
        return Response({'message': 'Logged out successfully.'})
    except TokenError as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


# ══════════════════════════════════════════════════════════════════
#  COOPERATIVE REGISTRATION
# ══════════════════════════════════════════════════════════════════

@api_view(['POST'])
@permission_classes([AllowAny])
def register_cooperative_view(request):
    """
    POST /api/auth/register/cooperative/
    4-step wizard payload sent as one JSON body.
    """
    serializer = CooperativeRegistrationSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(
            {'error': 'Registration data is invalid.', 'errors': serializer.errors},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        result = register_cooperative(serializer.validated_data)
        return Response(
            {
                'message': (
                    'Cooperative registered successfully. '
                    'Please check your email to verify your account.'
                    if result['verification_method'] == 'email'
                    else 'Cooperative registered successfully. '
                         'A verification code has been sent to your phone.'
                ),
                'data': result,
            },
            status=status.HTTP_201_CREATED,
        )
    except ValueError as e:
        return Response({'error': str(e)}, status=status.HTTP_409_CONFLICT)
    except Exception as e:
        logger.exception('Unexpected error during cooperative registration: %s', e)
        return Response(
            {'error': 'Registration failed. Please try again.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ══════════════════════════════════════════════════════════════════
#  BUYER REGISTRATION
# ══════════════════════════════════════════════════════════════════

@api_view(['POST'])
@permission_classes([AllowAny])
def register_buyer_view(request):
    """POST /api/auth/register/buyer/"""
    serializer = BuyerRegistrationSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(
            {'error': 'Registration data is invalid.', 'errors': serializer.errors},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        result = register_buyer(serializer.validated_data)
        return Response(
            {
                'message': (
                    'Account created. Please verify your email to continue.'
                    if result['verification_method'] == 'email'
                    else 'Account created. A verification code has been sent to your phone.'
                ),
                'data': result,
            },
            status=status.HTTP_201_CREATED,
        )
    except ValueError as e:
        return Response({'error': str(e)}, status=status.HTTP_409_CONFLICT)
    except Exception as e:
        logger.exception('Unexpected error during buyer registration: %s', e)
        return Response(
            {'error': 'Registration failed. Please try again.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ══════════════════════════════════════════════════════════════════
#  EMAIL VERIFICATION
# ══════════════════════════════════════════════════════════════════

@api_view(['POST'])
@permission_classes([AllowAny])
def verify_email_view(request):
    """POST /api/auth/verify-email/ — validate the token from the link."""
    serializer = VerifyEmailSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    success, message = verify_email_token(serializer.validated_data['token'])
    http_status = status.HTTP_200_OK if success else status.HTTP_400_BAD_REQUEST
    return Response({'success': success, 'message': message}, status=http_status)


@api_view(['POST'])
@permission_classes([AllowAny])
def resend_verification_view(request):
    """POST /api/auth/resend-verification/ — resend verification email."""
    serializer = ResendVerificationEmailSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    success, message = resend_verification_email(serializer.validated_data['email'])
    return Response({'success': success, 'message': message})


# ══════════════════════════════════════════════════════════════════
#  OTP (SMS) VERIFICATION
# ══════════════════════════════════════════════════════════════════

@api_view(['POST'])
@permission_classes([AllowAny])
def verify_otp_view(request):
    """POST /api/auth/verify-otp/ — validate an SMS OTP."""
    serializer = VerifyOTPSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    d = serializer.validated_data
    success, message = verify_phone_otp(d['phone_number'], d['otp'], d['purpose'])
    http_status = status.HTTP_200_OK if success else status.HTTP_400_BAD_REQUEST
    return Response({'success': success, 'message': message}, status=http_status)


@api_view(['POST'])
@permission_classes([AllowAny])
def resend_otp_view(request):
    """POST /api/auth/resend-otp/ — resend SMS OTP."""
    serializer = ResendOTPSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    d = serializer.validated_data
    sent = notifications.send_otp(
        phone=d['phone_number'],
        purpose=d['purpose'],
        recipient_user=request.user if request.user.is_authenticated else None,
        cooperative=request.user.cooperative if request.user.is_authenticated and request.user.cooperative_id else None,
    )
    if sent:
        return Response({'message': 'A new verification code has been sent.'})
    return Response(
        {'error': 'Failed to send SMS. Please try again or use email verification.'},
        status=status.HTTP_429_TOO_MANY_REQUESTS,
    )


# ══════════════════════════════════════════════════════════════════
#  FORGOT PASSWORD
# ══════════════════════════════════════════════════════════════════

@api_view(['POST'])
@permission_classes([AllowAny])
def forgot_password_view(request):
    """
    POST /api/auth/forgot-password/
    Body: {"identifier": "email_or_phone", "verification_method": "email|sms"}
    Always 200 to prevent account enumeration.
    """
    serializer = ForgotPasswordSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    d = serializer.validated_data
    initiate_password_reset(d['identifier'], d['verification_method'])

    if d['verification_method'] == 'sms':
        msg = 'If an account with this phone number exists, a reset code has been sent via SMS.'
    else:
        msg = 'If an account with this email exists, a password reset link has been sent.'

    return Response({'message': msg})


# ══════════════════════════════════════════════════════════════════
#  RESET PASSWORD
# ══════════════════════════════════════════════════════════════════

@api_view(['POST'])
@permission_classes([AllowAny])
def reset_password_view(request):
    """POST /api/auth/reset-password/ — use email reset token."""
    serializer = ResetPasswordSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    d = serializer.validated_data
    success, message = complete_password_reset(d['token'], d['new_password'])
    http_status = status.HTTP_200_OK if success else status.HTTP_400_BAD_REQUEST
    return Response({'success': success, 'message': message}, status=http_status)


@api_view(['POST'])
@permission_classes([AllowAny])
def reset_password_otp_view(request):
    """POST /api/auth/reset-password-otp/ — use SMS OTP to reset password."""
    phone = request.data.get('phone')
    otp = request.data.get('otp')
    new_password = request.data.get('new_password')
    if not all([phone, otp, new_password]):
        return Response(
            {'error': 'phone, otp, and new_password are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if len(new_password) < 8:
        return Response(
            {'error': 'Password must be at least 8 characters.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    success, message = complete_password_reset_otp(phone, otp, new_password)
    http_status = status.HTTP_200_OK if success else status.HTTP_400_BAD_REQUEST
    return Response({'success': success, 'message': message}, status=http_status)


# ══════════════════════════════════════════════════════════════════
#  CHANGE PASSWORD (authenticated)
# ══════════════════════════════════════════════════════════════════

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def change_password_view(request):
    """POST /api/auth/change-password/"""
    serializer = ChangePasswordSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    d = serializer.validated_data
    success, message = change_password(request.user, d['current_password'], d['new_password'])
    http_status = status.HTTP_200_OK if success else status.HTTP_400_BAD_REQUEST
    return Response({'success': success, 'message': message}, status=http_status)


# ══════════════════════════════════════════════════════════════════
#  ACCEPT INVITATION
# ══════════════════════════════════════════════════════════════════

@api_view(["POST"])
@permission_classes([AllowAny])
def accept_invitation_view(request):
    """
    Accept a cooperative invitation and set a permanent password.

    Request body:
        token            — invite token from the email URL param
        new_password     — chosen permanent password (min 8 chars)
        confirm_password — must match new_password

    On success:
        - Marks Invitation.accepted = True
        - Sets the user's permanent password
        - Clears must_change_password
        - Marks is_email_verified = True
        - Returns JWT (access + refresh) so the helper enters the CRM immediately

    Error cases:
        400 — missing fields, password mismatch, password too short
        404 — token not found
        410 — token expired
        409 — invitation already accepted
    """
    token            = request.data.get("token", "").strip()
    new_password     = request.data.get("new_password", "")
    confirm_password = request.data.get("confirm_password", "")

    # ── Input validation ───────────────────────────────────────────────────────
    if not token:
        return Response({"error": "Invitation token is required."}, status=400)

    if not new_password or not confirm_password:
        return Response({"error": "Both new_password and confirm_password are required."}, status=400)

    if new_password != confirm_password:
        return Response({"error": "Passwords do not match."}, status=400)

    if len(new_password) < 8:
        return Response({"error": "Password must be at least 8 characters."}, status=400)

    # ── Token lookup ───────────────────────────────────────────────────────────
    try:
        invitation = Invitation.objects.select_related(
            "cooperative", "invited_by"
        ).get(token=token)
    except Invitation.DoesNotExist:
        return Response({"error": "Invitation not found. The link may be invalid."}, status=404)

    if invitation.accepted:
        return Response(
            {"error": "This invitation has already been accepted. Please log in."},
            status=409,
        )

    if invitation.expires_at < timezone.now():
        return Response(
            {"error": "This invitation has expired. Ask your Cooperative Chair to re-send it."},
            status=410,
        )

    # ── Find the matching user account ────────────────────────────────────────
    try:
        user = User.objects.get(email=invitation.email, cooperative=invitation.cooperative)
    except User.DoesNotExist:
        return Response(
            {"error": "No user account found for this invitation. Contact your Chair."},
            status=404,
        )

    # ── Activate account ───────────────────────────────────────────────────────
    user.set_password(new_password)
    user.must_change_password = False
    user.is_email_verified    = True  # clicking the link counts as email verification
    user.save(update_fields=["password", "must_change_password", "is_email_verified"])

    # Mark invitation accepted
    invitation.accepted = True
    invitation.save(update_fields=["accepted"])

    # ── Issue JWT ──────────────────────────────────────────────────────────────
    refresh = RefreshToken.for_user(user)

    return Response(
        {
            "message":      f"Welcome to {invitation.cooperative.name}! Your account is now active.",
            "access":       str(refresh.access_token),
            "refresh":      str(refresh),
            "user": {
                "id":            str(user.id),
                "email":         user.email,
                "first_name":    user.first_name,
                "last_name":     user.last_name,
                "user_type":     user.user_type,
                "helper_role":   user.helper_role,
                "cooperative_id": str(user.cooperative_id),
            },
            "cooperative": {
                "id":   str(invitation.cooperative.id),
                "name": invitation.cooperative.name,
            },
        },
        status=200,
    )


# ══════════════════════════════════════════════════════════════════
#  CURRENT USER PROFILE — GET + PATCH
# ══════════════════════════════════════════════════════════════════

@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def me_view(request):
    """
    GET  → Full user context snapshot.
    PATCH → Update personal info, role/profile fields, notifications, and profile images.
    """
    user: User = request.user

    def _to_bool(value):
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {"1", "true", "yes", "on"}

    def _build_response() -> dict:
        cooperative_data = None
        permissions_map = {}
        company_name = None
        avatar_url = None

        if user.cooperative_id:
            try:
                coop: Cooperative = (
                    Cooperative.objects
                    .select_related("chair")
                    .get(pk=user.cooperative_id)
                )
                cooperative_data = {
                    "id":                    str(coop.id),
                    "name":                  coop.name,
                    "registration_number":   coop.registration_number,
                    "verification_status":   coop.verification_status,
                    "subscription_tier":     coop.subscription_tier,
                    "cooperative_type":      coop.cooperative_type,
                    "region":                coop.region,
                    "total_members":         coop.members.count(),
                    "is_verified":           coop.verification_status == "VERIFIED",
                }

                if user.is_helper:
                    perms = RolePermission.objects.filter(
                        user=user, cooperative_id=user.cooperative_id
                    ).values(
                        "module", "can_view", "can_create",
                        "can_edit", "can_delete", "can_edit_templates",
                    )
                    for p in perms:
                        permissions_map[p["module"]] = {
                            "can_view":           p["can_view"],
                            "can_create":         p["can_create"],
                            "can_edit":           p["can_edit"],
                            "can_delete":         p["can_delete"],
                            "can_edit_templates": p["can_edit_templates"],
                        }

                if user.is_chair:
                    for module in ["MEMBERS", "PRODUCTION", "LIVESTOCK", "GOVERNANCE", "FINANCE", "FORM_BUILDER"]:
                        permissions_map[module] = {
                            "can_view": True, "can_create": True, "can_edit": True,
                            "can_delete": True, "can_edit_templates": True,
                        }
            except Cooperative.DoesNotExist:
                pass

        profile_data = None
        if user.is_chair:
            profile_data = _get_chair_profile(user, request=request)
            avatar_url = profile_data.get("profile_photo") if profile_data else None
        elif user.is_buyer:
            profile_data = _get_buyer_profile(user, request=request)
            company_name = profile_data.get("company_name") if profile_data else None
            avatar_url = profile_data.get("company_logo") if profile_data else None

        return {
            "id":                   str(user.id),
            "email":                user.email,
            "first_name":           user.first_name,
            "last_name":            user.last_name,
            "full_name":            user.full_name,
            "phone_number":         user.phone_number,
            "user_type":            user.user_type,
            "helper_role":          user.helper_role or None,
            "is_email_verified":    user.is_email_verified,
            "is_phone_verified":    user.is_phone_verified,
            "two_fa_enabled":       user.two_fa_enabled,
            "must_change_password": user.must_change_password,
            "cooperative":          cooperative_data,
            "cooperative_name":     cooperative_data["name"] if cooperative_data else None,
            "cooperative_id":       str(user.cooperative_id) if user.cooperative_id else None,
            "company_name":         company_name,
            "avatar_url":           avatar_url,
            "permissions":          permissions_map,
            "profile":              profile_data,
        }

    if request.method == "PATCH":
        changed = []

        for field in ["first_name", "last_name", "phone_number"]:
            if field in request.data:
                setattr(user, field, request.data[field])
                changed.append(field)

        if "phone_number" in changed:
            user.is_phone_verified = False
            changed.append("is_phone_verified")

        if changed:
            user.save(update_fields=changed)

        profile_changed = []
        if user.is_chair:
            chair_profile, _ = CooperativeChairProfile.objects.get_or_create(user=user)
            for field in ["title", "bio", "region", "alt_phone", "physical_address"]:
                if field in request.data:
                    setattr(chair_profile, field, request.data[field])
                    profile_changed.append(field)
            for field in ["email_notifications", "sms_notifications", "tender_alerts"]:
                if field in request.data:
                    setattr(chair_profile, field, _to_bool(request.data[field]))
                    profile_changed.append(field)
            if "profile_photo" in request.FILES:
                chair_profile.profile_photo = request.FILES["profile_photo"]
                profile_changed.append("profile_photo")
            if _to_bool(request.data.get("remove_profile_photo")) and chair_profile.profile_photo:
                chair_profile.profile_photo.delete(save=False)
                chair_profile.profile_photo = None
                profile_changed.append("profile_photo")
            if profile_changed:
                chair_profile.save(update_fields=list(dict.fromkeys(profile_changed)))

        elif user.is_buyer:
            buyer_profile, _ = BuyerProfile.objects.get_or_create(
                user=user,
                defaults={
                    "company_name": user.full_name or user.email,
                    "buyer_type": BuyerProfile.BuyerType.RETAILER,
                },
            )
            for field in [
                "company_name",
                "buyer_type",
                "registration_number",
                "tax_pin",
                "country",
                "region",
                "physical_address",
                "website",
                "description",
            ]:
                if field in request.data:
                    setattr(buyer_profile, field, request.data[field])
                    profile_changed.append(field)
            if "interested_categories" in request.data:
                buyer_profile.interested_categories = request.data.get("interested_categories") or []
                profile_changed.append("interested_categories")
            if "preferred_regions" in request.data:
                buyer_profile.preferred_regions = request.data.get("preferred_regions") or []
                profile_changed.append("preferred_regions")
            for field in ["email_notifications", "sms_notifications"]:
                if field in request.data:
                    setattr(buyer_profile, field, _to_bool(request.data[field]))
                    profile_changed.append(field)
            if "company_logo" in request.FILES:
                buyer_profile.company_logo = request.FILES["company_logo"]
                profile_changed.append("company_logo")
            if _to_bool(request.data.get("remove_company_logo")) and buyer_profile.company_logo:
                buyer_profile.company_logo.delete(save=False)
                buyer_profile.company_logo = None
                profile_changed.append("company_logo")
            if profile_changed:
                buyer_profile.save(update_fields=list(dict.fromkeys(profile_changed)))

        payload = _build_response()
        payload["message"] = "Profile updated."
        payload["updated_fields"] = changed + profile_changed
        return Response(payload)

    return Response(_build_response())


def _absolute_media_url(request, file_field) -> str | None:
    if not file_field:
        return None
    try:
        url = file_field.url
    except Exception:
        return None
    if request is None or str(url).startswith(("http://", "https://")):
        return url
    return request.build_absolute_uri(url)


def _get_chair_profile(user, request=None) -> dict | None:
    try:
        p, _ = CooperativeChairProfile.objects.get_or_create(user=user)
        return {
            'national_id': p.national_id,
            'date_of_birth': str(p.date_of_birth) if p.date_of_birth else None,
            'gender': p.gender,
            'title': p.title,
            'years_in_role': p.years_in_role,
            'bio': p.bio,
            'region': p.region,
            'physical_address': p.physical_address,
            'alt_phone': p.alt_phone,
            'email_notifications': p.email_notifications,
            'sms_notifications': p.sms_notifications,
            'tender_alerts': p.tender_alerts,
            'profile_photo': _absolute_media_url(request, p.profile_photo),
        }
    except Exception:
        return None


def _get_buyer_profile(user, request=None) -> dict | None:
    try:
        p = user.buyer_profile
        try:
            total_tenders = user.buyer.tenders.count()
        except Exception:
            total_tenders = p.total_tenders
        return {
            'company_name': p.company_name,
            'buyer_type': p.buyer_type,
            'registration_number': p.registration_number,
            'tax_pin': p.tax_pin,
            'country': p.country,
            'region': p.region,
            'physical_address': p.physical_address,
            'website': p.website,
            'description': p.description,
            'is_verified': p.is_verified,
            'interested_categories': p.interested_categories,
            'preferred_regions': p.preferred_regions,
            'average_rating': str(p.average_rating),
            'total_tenders': total_tenders,
            'email_notifications': p.email_notifications,
            'sms_notifications': p.sms_notifications,
            'company_logo': _absolute_media_url(request, p.company_logo),
        }
    except Exception:
        return None

@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated])
def profile_view(request):
    """
    GET → Return the authenticated user's full profile.
    PUT → Update personal info (name, phone). Email change requires re-verification.
    """
    user = request.user

    if request.method == "GET":
        cooperative_data = None
        if user.cooperative:
            cooperative_data = {
                "id": str(user.cooperative.id),
                "name": user.cooperative.name,
                "type": user.cooperative.type,
                "region": user.cooperative.region,
                "verification_status": user.cooperative.verification_status,
            }

        return Response({
            "id": str(user.id),
            "first_name": user.first_name,
            "last_name": user.last_name,
            "email": user.email,
            "phone_number": user.phone_number,
            "role": user.role,
            "is_email_verified": user.is_email_verified,
            "is_phone_verified": user.is_phone_verified,
            "two_fa_enabled": getattr(user, "two_fa_enabled", False),
            "date_joined": user.date_joined.isoformat(),
            "last_login": user.last_login.isoformat() if user.last_login else None,
            "cooperative": cooperative_data,
            "notification_channels": {
                "email": user.email if user.is_email_verified else None,
                "phone": user.phone_number if user.is_phone_verified else None,
            },
        })

    # PUT – update allowed fields
    allowed_fields = ["first_name", "last_name", "phone_number"]
    for field in allowed_fields:
        if field in request.data:
            setattr(user, field, request.data[field])

    # Phone number change resets verification
    if "phone_number" in request.data:
        user.is_phone_verified = False
        user.phone_verification_code = ""

    user.save()

    return Response({
        "message": "Profile updated successfully.",
        "first_name": user.first_name,
        "last_name": user.last_name,
        "phone_number": user.phone_number,
        "is_phone_verified": user.is_phone_verified,
    })


# ─────────────────────────────────────────────
# ─────────────────────────────────────────────


# ─────────────────────────────────────────────
# Two-Factor Authentication (TOTP via pyotp)
# ─────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def setup_2fa_view(request):
    """
    POST → Generate a TOTP secret and return a QR code + manual key.
    The user must call verify-2fa to actually activate it.
    """
    user = request.user

    # Generate a new TOTP secret
    secret = pyotp.random_base32()
    totp = pyotp.TOTP(secret)

    # Build the OTP Auth URI (for QR code)
    app_name = "ShambaFlow"
    otp_uri = totp.provisioning_uri(name=user.email, issuer_name=app_name)

    # Generate QR code as base64 PNG
    qr = qrcode.make(otp_uri)
    buffer = BytesIO()
    qr.save(buffer, format="PNG")
    qr_base64 = base64.b64encode(buffer.getvalue()).decode()

    # Store the pending secret (not yet activated – requires verification)
    user.pending_2fa_secret = secret
    user.save(update_fields=["pending_2fa_secret"])

    return Response({
        "message": "Scan the QR code with your authenticator app, then verify to activate.",
        "qr_code": f"data:image/png;base64,{qr_base64}",
        "manual_key": secret,
        "otp_uri": otp_uri,
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def verify_2fa_view(request):
    """
    POST → Verify a TOTP code to activate 2FA.

    Body: { "code": "123456" }
    """
    user = request.user
    code = request.data.get("code", "")

    pending_secret = getattr(user, "pending_2fa_secret", None)
    if not pending_secret:
        return Response({"error": "No pending 2FA setup. Call setup-2fa first."}, status=400)

    totp = pyotp.TOTP(pending_secret)
    if not totp.verify(code, valid_window=1):
        return Response({"error": "Invalid verification code."}, status=400)

    # Activate 2FA
    user.two_fa_secret = pending_secret
    user.two_fa_enabled = True
    user.pending_2fa_secret = ""
    user.save(update_fields=["two_fa_secret", "two_fa_enabled", "pending_2fa_secret"])

    return Response({"message": "Two-factor authentication enabled successfully."})


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def disable_2fa_view(request):
    """
    DELETE → Disable 2FA after confirming password.

    Body: { "password": "..." }
    """
    user = request.user
    password = request.data.get("password", "")

    if not user.check_password(password):
        return Response({"error": "Password incorrect."}, status=401)

    if not getattr(user, "two_fa_enabled", False):
        return Response({"error": "2FA is not currently enabled."}, status=400)

    user.two_fa_secret = ""
    user.two_fa_enabled = False
    user.save(update_fields=["two_fa_secret", "two_fa_enabled"])

    return Response({"message": "Two-factor authentication disabled."})
