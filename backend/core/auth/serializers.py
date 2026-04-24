"""
ShambaFlow — Auth Serializers

Covers:
  • ShambaFlowTokenObtainSerializer  — custom JWT login (referenced in settings.SIMPLE_JWT)
  • RegisterCooperativeSerializer    — cooperative + chair registration (4-step wizard)
  • RegisterBuyerSerializer          — buyer self-registration
  • ForgotPasswordSerializer         — initiate password reset (email or SMS)
  • ResetPasswordSerializer          — confirm reset with token
  • VerifyEmailSerializer            — email verification via token link
  • VerifyOTPSerializer              — phone OTP verification
  • ChangePasswordSerializer         — logged-in user changing password
  • AcceptInvitationSerializer       — helper accepting a Chair invitation
"""

import hashlib
import secrets
import logging
from django.core.exceptions import ObjectDoesNotExist
from django.contrib.auth import get_user_model
from django.conf import settings
from django.utils import timezone
from datetime import timedelta
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken

logger = logging.getLogger('shambaflow')
User = get_user_model()


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


# ══════════════════════════════════════════════════════════════════
#  JWT LOGIN
# ══════════════════════════════════════════════════════════════════

class ShambaFlowTokenObtainSerializer(TokenObtainPairSerializer):
    """
    Custom JWT login serializer.

    Extends the standard pair serializer to:
      • Include user_type, cooperative_id, must_change_password in the
        token payload so the frontend can route correctly on login.
      • Block unverified emails from logging in.
      • Block helpers who must change their password from accessing
        any endpoint until they comply.
    """

    @classmethod
    def get_token(cls, user: User):
        token = super().get_token(user)

        # Embed identity claims into the JWT payload
        token['user_type']   = user.user_type
        token['full_name']   = user.full_name
        token['email']       = user.email
        token['must_change'] = user.must_change_password

        if user.cooperative_id:
            token['cooperative_id'] = str(user.cooperative_id)

        return token

    def validate(self, attrs):
        data = super().validate(attrs)
        user = self.user
        request = self.context.get("request")

        # Gate: email must be verified
        if not user.is_email_verified:
            raise serializers.ValidationError(
                'Please verify your email address before logging in. '
                'Check your inbox for the verification link.'
            )

        permissions_map = {}
        cooperative_name = None
        company_name = None
        avatar_url = None
        if user.cooperative_id:
            cooperative_name = getattr(user.cooperative, "name", None)
            if user.is_chair:
                for module in ["MEMBERS", "PRODUCTION", "LIVESTOCK", "GOVERNANCE", "FINANCE", "FORM_BUILDER"]:
                    permissions_map[module] = {
                        "can_view": True,
                        "can_create": True,
                        "can_edit": True,
                        "can_delete": True,
                        "can_edit_templates": True,
                    }
            elif user.is_helper:
                from core.models import RolePermission

                perms = RolePermission.objects.filter(
                    user=user,
                    cooperative_id=user.cooperative_id,
                ).values(
                    "module",
                    "can_view",
                    "can_create",
                    "can_edit",
                    "can_delete",
                    "can_edit_templates",
                )
                for perm in perms:
                    permissions_map[perm["module"]] = {
                        "can_view": perm["can_view"],
                        "can_create": perm["can_create"],
                        "can_edit": perm["can_edit"],
                        "can_delete": perm["can_delete"],
                        "can_edit_templates": perm["can_edit_templates"],
                    }

        try:
            if user.is_buyer:
                company_name = user.buyer_profile.company_name
                avatar_url = _absolute_media_url(request, user.buyer_profile.company_logo)
            elif user.is_chair:
                avatar_url = _absolute_media_url(request, user.chair_profile.profile_photo)
        except ObjectDoesNotExist:
            pass

        # Enrich response body (beyond just access/refresh tokens)
        data['user'] = {
            'id':                  str(user.id),
            'email':               user.email,
            'first_name':          user.first_name,
            'last_name':           user.last_name,
            'full_name':           user.full_name,
            'user_type':           user.user_type,
            'must_change_password': user.must_change_password,
            'cooperative_id':      str(user.cooperative_id) if user.cooperative_id else None,
            'cooperative_name':    cooperative_name,
            'company_name':        company_name,
            'avatar_url':          avatar_url,
            'helper_role':         user.helper_role or None,
            'is_email_verified':   user.is_email_verified,
            'is_phone_verified':   user.is_phone_verified,
            'permissions':         permissions_map,
        }

        logger.info('Login success | user=%s | type=%s', user.email, user.user_type)
        return data


# ══════════════════════════════════════════════════════════════════
#  COOPERATIVE REGISTRATION (Chair + Cooperative)
# ══════════════════════════════════════════════════════════════════

class CooperativeRegistrationSerializer(serializers.Serializer):
    """
    Step-based cooperative onboarding.
    Collects all data in one payload; the view handles the DB transaction.
    """

    # ── Step 1: Cooperative details ───────────────────────────
    cooperative_name        = serializers.CharField(max_length=255)
    registration_number     = serializers.CharField(max_length=100)
    cooperative_type        = serializers.ChoiceField(choices=['CROP', 'LIVESTOCK', 'MIXED'])
    region                  = serializers.CharField(max_length=150)
    country                 = serializers.CharField(max_length=100, default='Kenya')

    # ── Step 2: Chair details ─────────────────────────────────
    chair_first_name        = serializers.CharField(max_length=100)
    chair_last_name         = serializers.CharField(max_length=100)
    chair_email             = serializers.EmailField()
    chair_phone             = serializers.CharField(max_length=20)
    chair_password          = serializers.CharField(
        min_length=8, write_only=True, style={'input_type': 'password'}
    )
    chair_password_confirm  = serializers.CharField(
        write_only=True, style={'input_type': 'password'}
    )

    # ── Step 3: Verification method preference ────────────────
    verification_method     = serializers.ChoiceField(
        choices=['email', 'sms'],
        default='email',
        help_text='Whether the verification OTP/link goes to email or SMS.',
    )

    def validate_chair_email(self, value: str) -> str:
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError(
                'An account with this email address already exists.'
            )
        return value.lower()

    def validate_registration_number(self, value: str) -> str:
        from core.models import Cooperative
        if Cooperative.objects.filter(registration_number=value).exists():
            raise serializers.ValidationError(
                'A cooperative with this registration number already exists.'
            )
        return value

    def validate(self, data):
        if data['chair_password'] != data['chair_password_confirm']:
            raise serializers.ValidationError(
                {'chair_password_confirm': 'Passwords do not match.'}
            )
        return data


# ══════════════════════════════════════════════════════════════════
#  BUYER REGISTRATION
# ══════════════════════════════════════════════════════════════════

class BuyerRegistrationSerializer(serializers.Serializer):
    """Self-registration for Buyer accounts (marketplace side)."""

    # Personal identity
    first_name        = serializers.CharField(max_length=100)
    last_name         = serializers.CharField(max_length=100)
    email             = serializers.EmailField()
    phone             = serializers.CharField(max_length=20)
    password          = serializers.CharField(
        min_length=8, write_only=True, style={'input_type': 'password'}
    )
    password_confirm  = serializers.CharField(
        write_only=True, style={'input_type': 'password'}
    )

    # Company identity
    company_name        = serializers.CharField(max_length=255)
    buyer_type          = serializers.ChoiceField(choices=[
        'PROCESSOR', 'RETAILER', 'EXPORTER', 'NGO', 'GOVERNMENT', 'TRADER', 'OTHER'
    ])
    registration_number = serializers.CharField(max_length=100, required=False, allow_blank=True)

    # Verification method preference
    verification_method = serializers.ChoiceField(
        choices=['email', 'sms'],
        default='email',
    )

    def validate_email(self, value: str) -> str:
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError(
                'An account with this email address already exists.'
            )
        return value.lower()

    def validate(self, data):
        if data['password'] != data['password_confirm']:
            raise serializers.ValidationError(
                {'password_confirm': 'Passwords do not match.'}
            )
        return data


# ══════════════════════════════════════════════════════════════════
#  FORGOT PASSWORD
# ══════════════════════════════════════════════════════════════════

class ForgotPasswordSerializer(serializers.Serializer):
    """
    Initiate a password reset.
    The user may choose to receive the reset token via email or SMS.
    """
    identifier          = serializers.CharField(
        help_text='Email address or phone number (E.164 format).',
    )
    verification_method = serializers.ChoiceField(
        choices=['email', 'sms'],
        default='email',
    )


# ══════════════════════════════════════════════════════════════════
#  RESET PASSWORD
# ══════════════════════════════════════════════════════════════════

class ResetPasswordSerializer(serializers.Serializer):
    token            = serializers.CharField()
    new_password     = serializers.CharField(
        min_length=8, write_only=True, style={'input_type': 'password'}
    )
    confirm_password = serializers.CharField(
        write_only=True, style={'input_type': 'password'}
    )

    def validate(self, data):
        if data['new_password'] != data['confirm_password']:
            raise serializers.ValidationError(
                {'confirm_password': 'Passwords do not match.'}
            )
        return data


# ══════════════════════════════════════════════════════════════════
#  EMAIL VERIFICATION
# ══════════════════════════════════════════════════════════════════

class VerifyEmailSerializer(serializers.Serializer):
    token = serializers.CharField()


# ══════════════════════════════════════════════════════════════════
#  OTP VERIFICATION (phone / SMS)
# ══════════════════════════════════════════════════════════════════

class VerifyOTPSerializer(serializers.Serializer):
    phone_number = serializers.CharField()
    otp          = serializers.CharField(min_length=6, max_length=6)
    purpose      = serializers.ChoiceField(
        choices=['verification', 'login', 'password_reset'],
        default='verification',
    )


class ResendOTPSerializer(serializers.Serializer):
    phone_number = serializers.CharField()
    purpose      = serializers.ChoiceField(
        choices=['verification', 'login', 'password_reset'],
        default='verification',
    )


# ══════════════════════════════════════════════════════════════════
#  CHANGE PASSWORD (authenticated user)
# ══════════════════════════════════════════════════════════════════

class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(
        write_only=True, style={'input_type': 'password'}
    )
    new_password     = serializers.CharField(
        min_length=8, write_only=True, style={'input_type': 'password'}
    )
    confirm_password = serializers.CharField(
        write_only=True, style={'input_type': 'password'}
    )

    def validate(self, data):
        if data['new_password'] != data['confirm_password']:
            raise serializers.ValidationError(
                {'confirm_password': 'Passwords do not match.'}
            )
        return data


# ══════════════════════════════════════════════════════════════════
#  ACCEPT INVITATION (helper first-login)
# ══════════════════════════════════════════════════════════════════

class AcceptInvitationSerializer(serializers.Serializer):
    """
    Validates the invitation token and sets a permanent password.
    Called when a helper clicks their invitation link.
    """
    token            = serializers.CharField()
    new_password     = serializers.CharField(
        min_length=8, write_only=True, style={'input_type': 'password'}
    )
    confirm_password = serializers.CharField(
        write_only=True, style={'input_type': 'password'}
    )

    def validate(self, data):
        if data['new_password'] != data['confirm_password']:
            raise serializers.ValidationError(
                {'confirm_password': 'Passwords do not match.'}
            )
        return data


# ══════════════════════════════════════════════════════════════════
#  RESEND VERIFICATION EMAIL
# ══════════════════════════════════════════════════════════════════

class ResendVerificationEmailSerializer(serializers.Serializer):
    email = serializers.EmailField()


# ══════════════════════════════════════════════════════════════════
#  USER PROFILE SERIALIZERS
# ══════════════════════════════════════════════════════════════════

class UserProfileSerializer(serializers.ModelSerializer):
    """Read-only snapshot of the authenticated user — safe for token refresh."""
    full_name      = serializers.CharField(read_only=True)
    cooperative_id = serializers.SerializerMethodField()

    class Meta:
        model  = User
        fields = [
            'id', 'email', 'first_name', 'last_name', 'full_name',
            'user_type', 'helper_role', 'phone_number',
            'is_email_verified', 'is_phone_verified',
            'cooperative_id', 'must_change_password',
        ]
        read_only_fields = [
            'id', 'email', 'user_type', 'helper_role',
            'is_email_verified', 'is_phone_verified',
            'cooperative_id', 'must_change_password',
        ]

    def get_cooperative_id(self, obj):
        return str(obj.cooperative_id) if obj.cooperative_id else None


class UpdateProfileSerializer(serializers.Serializer):
    """Editable personal fields shared across all user types."""
    first_name   = serializers.CharField(max_length=100, required=False)
    last_name    = serializers.CharField(max_length=100, required=False)
    phone_number = serializers.CharField(max_length=20, required=False, allow_blank=True)
