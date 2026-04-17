"""
ShambaFlow – Auth URL Configuration
=====================================
All authentication endpoints. Included under /api/auth/ in root urls.py.
MUST be placed before the dynamic catch-all in the root URL config.
"""

from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from core.auth.views import (
    register_cooperative_view,
    register_buyer_view,
    ShambaFlowLoginView,
    logout_view,
    verify_email_view,
    resend_verification_view,
    verify_otp_view,
    resend_otp_view,
    forgot_password_view,
    reset_password_view,
    reset_password_otp_view,
    change_password_view,
    me_view,
    accept_invitation_view,
    setup_2fa_view,
    verify_2fa_view,
    disable_2fa_view,
)

urlpatterns = [
    # ── Registration ───────────────────────────────────────────────────────────
    path("register/cooperative/", register_cooperative_view,  name="register-cooperative"),
    path("register/buyer/",       register_buyer_view,         name="register-buyer"),

    # ── Login / Logout ─────────────────────────────────────────────────────────
    path("login/",   ShambaFlowLoginView.as_view(),  name="auth-login"),
    path("logout/",  logout_view, name="auth-logout"),

    # ── JWT refresh ────────────────────────────────────────────────────────────
    path("token/refresh/", TokenRefreshView.as_view(), name="token-refresh"),

    # ── Current user context ───────────────────────────────────────────────────
    # GET  → full user snapshot (cooperative, permissions, 2FA status, cooperative.id)
    # PATCH → update personal info (first_name, last_name, phone_number)
    path("me/", me_view, name="auth-me"),

    # ── Email verification ─────────────────────────────────────────────────────
    path("verify-email/",        verify_email_view,       name="verify-email"),
    path("resend-verification/", resend_verification_view, name="resend-verification"),

    # ── OTP via Infobip ────────────────────────────────────────────────────────
    path("verify-otp/", verify_otp_view, name="verify-otp"),
    path("resend-otp/", resend_otp_view, name="resend-otp"),

    # ── Password management ────────────────────────────────────────────────────
    path("forgot-password/",    forgot_password_view,    name="forgot-password"),
    path("reset-password/",     reset_password_view,     name="reset-password"),
    path("reset-password-otp/", reset_password_otp_view, name="reset-password-otp"),
    path("change-password/",    change_password_view,    name="change-password"),

    # ── Invitation acceptance ──────────────────────────────────────────────────
    # Helper clicks email link → /accept-invitation?token=…
    # Frontend POSTs {token, new_password, confirm_password} here.
    # Returns JWT on success so helper enters CRM immediately.
    path("accept-invitation/", accept_invitation_view, name="accept-invitation"),

    # ── 2FA (TOTP) ─────────────────────────────────────────────────────────────
    path("setup-2fa/",   setup_2fa_view,   name="setup-2fa"),
    path("verify-2fa/",  verify_2fa_view,  name="verify-2fa"),
    path("disable-2fa/", disable_2fa_view, name="disable-2fa"),
]