"""
ShambaFlow — Auth URL Configuration

Adaptive Convergence note:
Auth is intentionally NOT handled by the dynamic CRUD catch-alls.
These endpoints are explicit and must remain above /api/<model_name> routes.
"""

from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from . import views

app_name = "auth"

urlpatterns = [
    # ── Registration ──────────────────────────────────────────────────────────
    path("register/cooperative/", views.register_cooperative_view, name="register_cooperative"),
    path("register/buyer/", views.register_buyer_view, name="register_buyer"),

    # ── JWT auth ──────────────────────────────────────────────────────────────
    path("login/", views.ShambaFlowLoginView.as_view(), name="login"),
    path("logout/", views.logout_view, name="logout"),
    path("token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),

    # ── Verification ──────────────────────────────────────────────────────────
    path("verify-email/", views.verify_email_view, name="verify_email"),
    path("resend-verification/", views.resend_verification_view, name="resend_verification"),
    path("verify-otp/", views.verify_otp_view, name="verify_otp"),
    path("resend-otp/", views.resend_otp_view, name="resend_otp"),

    # ── Password reset ────────────────────────────────────────────────────────
    path("forgot-password/", views.forgot_password_view, name="forgot_password"),
    path("reset-password/", views.reset_password_view, name="reset_password"),
    path("reset-password-otp/", views.reset_password_otp_view, name="reset_password_otp"),
    path("change-password/", views.change_password_view, name="change_password"),

    # ── Invitations ───────────────────────────────────────────────────────────
    path("accept-invitation/", views.accept_invitation_view, name="accept_invitation"),

    # ── Current user profile ──────────────────────────────────────────────────
    path("me/", views.me_view, name="me"),
]
