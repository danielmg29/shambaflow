"""
ShambaFlow — Root URL Configuration
Adaptive Convergence: Single dynamic CRUD handler for all models.
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

urlpatterns = [
    # ── Admin (Unfold) ───────────────────────────────────────
    path('admin/', admin.site.urls),

    # ── Health Check ─────────────────────────────────────────
    path('health/', health_check),

    # ── OpenAPI Schema (raw JSON) ─────────────────────────────
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),

    # ── Swagger UI  →  /api/docs/ ────────────────────────────
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),

    # ── ReDoc UI    →  /api/redoc/ ───────────────────────────
    path('api/redoc/', SpectacularRedocView.as_view(url_name='schema'), name='redoc'),

    # ── Authentication ────────────────────────────────────────
    # MUST come before the dynamic catch-all patterns below.
    path('api/auth/', include('core.auth.urls')),

    # ── Domain Apps ───────────────────────────────────────────
    # MUST come before the dynamic catch-all patterns below.
    path('api/identity/', include('apps.identity.urls')),
    path('api/crm/', include('apps.crm.urls')),
    path('api/marketplace/', include('apps.marketplace.urls')),
    path('api/reputation/', include('apps.reputation.urls')),
    path('api/notifications/', include('apps.notifications.urls')),

    # ── Adaptive Convergence Schema Introspection ─────────────
    # Specific schema paths before the generic <model_name> catch-all.
    path('api/schema/all', get_all_schemas_view),
    path('api/schema/<str:model_name>', get_schema_view),

    # ── Dynamic CRUD (Adaptive Convergence — all models) ──────
    # These are catch-alls — they MUST be last among /api/ routes.
    path('api/<str:model_name>', dynamic_crud_handler),
    path('api/<str:model_name>/<int:pk>', dynamic_detail_handler),

    # ── CKEditor 5 upload endpoint ────────────────────────────
    path('ckeditor5/', include('django_ckeditor_5.urls')),
]

# ── Debug Toolbar (development only) ──────────────────────────
if settings.DEBUG:
    import debug_toolbar
    urlpatterns = [
        path('__debug__/', include(debug_toolbar.urls)),
    ] + urlpatterns

# ── Media files (development only) ────────────────────────────
urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)