"""
ShambaFlow — Root URL Configuration
=====================================
Route ordering (must be maintained):
  1. Admin
  2. Health / OpenAPI docs
  3. /api/auth/          ← specific, before catch-all
  4. /api/settings/      ← specific, before catch-all
  5. /api/form-builder/  ← specific, before catch-all
  6. /api/identity/ … /api/notifications/
  7. /api/schema/        ← specific schema paths
  8. /api/<model_name>   ← catch-all LAST
"""

from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularSwaggerView,
    SpectacularRedocView,
)

from core.views.dynamic import dynamic_crud_handler, dynamic_detail_handler
from core.schema.introspection import get_schema_view, get_all_schemas_view
from core.views.health import health_check

# ── Settings views ────────────────────────────────────────────────────────────
from core.views.settings import (
    cooperative_profile_settings,
    notification_preferences,
    role_management,
    role_detail,
    template_permissions,
    verification_documents,
    verification_document_detail,
)

urlpatterns = [
    # ── Admin ──────────────────────────────────────────────────────────────────
    path("admin/", admin.site.urls),

    # ── Health Check ───────────────────────────────────────────────────────────
    path("health/", health_check),
    path("api/", include("core.urls")),

    # ── OpenAPI / Docs ─────────────────────────────────────────────────────────
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/",   SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/redoc/",  SpectacularRedocView.as_view(url_name="schema"),   name="redoc"),

    # ── Authentication ─────────────────────────────────────────────────────────
    path("api/auth/", include("core.auth.urls")),

    # ── Settings ───────────────────────────────────────────────────────────────
    path("api/settings/cooperative/<str:cooperative_id>/",                          cooperative_profile_settings,    name="settings-profile"),
    path("api/settings/cooperative/<str:cooperative_id>/notifications/",            notification_preferences,        name="settings-notifications"),
    path("api/settings/cooperative/<str:cooperative_id>/roles/",                    role_management,                 name="settings-roles"),
    path("api/settings/cooperative/<str:cooperative_id>/roles/<str:user_id>/",      role_detail,                     name="settings-role-detail"),
    path("api/settings/cooperative/<str:cooperative_id>/template-permissions/",     template_permissions,            name="settings-template-perms"),
    path("api/settings/cooperative/<str:cooperative_id>/verification/",             verification_documents,          name="settings-verification"),
    path("api/settings/cooperative/<str:cooperative_id>/verification/<str:doc_id>/", verification_document_detail,   name="settings-verification-detail"),

    # ── Domain App routers ─────────────────────────────────────────────────────
    path("api/identity/",      include("apps.identity.urls")),
    path("api/crm/",           include("apps.crm.urls")),
    path("api/marketplace/",   include("apps.marketplace.urls")),
    path("api/reputation/",    include("apps.reputation.urls")),
    path("api/notifications/", include("apps.notifications.urls")),

    # ── Schema Introspection ───────────────────────────────────────────────────
    path("api/schema/all",              get_all_schemas_view),
    path("api/schema/<str:model_name>", get_schema_view),

    # ── Dynamic CRUD catch-all (MUST be last) ──────────────────────────────────
    path("api/<str:model_name>",          dynamic_crud_handler),
    path("api/<str:model_name>/<int:pk>", dynamic_detail_handler),

    # ── CKEditor 5 ─────────────────────────────────────────────────────────────
    path("ckeditor5/", include("django_ckeditor_5.urls")),
]

if settings.DEBUG:
    import debug_toolbar
    urlpatterns = [path("__debug__/", include(debug_toolbar.urls))] + urlpatterns

urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)