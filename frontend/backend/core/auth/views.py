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
from core.services.infobip_sms import send_otp_sms

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
    sent = send_otp_sms(d['phone_number'], purpose=d['purpose'])
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

@api_view(['POST'])
@permission_classes([AllowAny])
def accept_invitation_view(request):
    """POST /api/auth/accept-invitation/"""
    serializer = AcceptInvitationSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    d = serializer.validated_data
    success, message, user_data = accept_invitation(d['token'], d['new_password'])
    http_status = status.HTTP_201_CREATED if success else status.HTTP_400_BAD_REQUEST
    resp = {'success': success, 'message': message}
    if user_data:
        resp['data'] = user_data
    return Response(resp, status=http_status)


# ══════════════════════════════════════════════════════════════════
#  CURRENT USER PROFILE — GET + PATCH
# ══════════════════════════════════════════════════════════════════

@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def me_view(request):
    """
    GET  /api/auth/me/ — return full user profile
    PATCH /api/auth/me/ — update personal fields
    """
    if request.method == 'GET':
        serializer = UserProfileSerializer(request.user)
        data = serializer.data

        # Attach profile data based on user type
        if request.user.is_chair:
            data['profile'] = _get_chair_profile(request.user)
        elif request.user.is_buyer:
            data['profile'] = _get_buyer_profile(request.user)
        else:
            data['profile'] = None

        return Response(data)

    # PATCH
    serializer = UpdateProfileSerializer(data=request.data, partial=True)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    d = serializer.validated_data
    user = request.user
    for field, value in d.items():
        setattr(user, field, value)
    user.save(update_fields=list(d.keys()))

    return Response(UserProfileSerializer(user).data)


def _get_chair_profile(user) -> dict | None:
    try:
        p = user.chair_profile
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
            'profile_photo': p.profile_photo.url if p.profile_photo else None,
        }
    except Exception:
        return None


def _get_buyer_profile(user) -> dict | None:
    try:
        p = user.buyer_profile
        return {
            'company_name': p.company_name,
            'buyer_type': p.buyer_type,
            'registration_number': p.registration_number,
            'tax_pin': p.tax_pin,
            'country': p.country,
            'region': p.region,
            'website': p.website,
            'description': p.description,
            'is_verified': p.is_verified,
            'interested_categories': p.interested_categories,
            'preferred_regions': p.preferred_regions,
            'average_rating': str(p.average_rating),
            'total_tenders': p.total_tenders,
            'email_notifications': p.email_notifications,
            'sms_notifications': p.sms_notifications,
            'company_logo': p.company_logo.url if p.company_logo else None,
        }
    except Exception:
        return None