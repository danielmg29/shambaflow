"""
CRM app URLs.

Order matters:
  1. member dashboard routes
  2. schema / import / export action routes
  3. collection / detail CRUD routes
"""

from django.urls import path

from apps.crm.views.data import (
    crm_analytics_view,
    crm_collection_view,
    crm_detail_view,
    crm_export_view,
    crm_import_template_view,
    crm_import_view,
    crm_schema_view,
)
from apps.crm.views.member_dashboard import (
    member_dashboard_view,
    member_form_templates_view,
    member_form_update_handler,
    member_records_view,
)


app_name = "crm"


urlpatterns = [
    # Member mini-dashboard
    path("<str:cooperative_id>/members/<uuid:member_id>/dashboard/", member_dashboard_view, name="member-dashboard"),
    path("<str:cooperative_id>/members/<uuid:member_id>/records/<str:record_type>/", member_records_view, name="member-records"),
    path("<str:cooperative_id>/members/<uuid:member_id>/form-templates/", member_form_templates_view, name="member-form-templates"),
    path("<str:cooperative_id>/members/<str:pk>/update/", member_form_update_handler, name="member-form-update"),

    # Generic CRM schema / import / export
    path("<str:cooperative_id>/<str:model_slug>/schema/", crm_schema_view, name="schema"),
    path("<str:cooperative_id>/<str:model_slug>/analytics/", crm_analytics_view, name="analytics"),
    path("<str:cooperative_id>/<str:model_slug>/import/template/", crm_import_template_view, name="import-template"),
    path("<str:cooperative_id>/<str:model_slug>/import/", crm_import_view, name="import"),
    path("<str:cooperative_id>/<str:model_slug>/export/", crm_export_view, name="export"),

    # Generic CRM CRUD
    path("<str:cooperative_id>/<str:model_slug>/", crm_collection_view, name="collection"),
    path("<str:cooperative_id>/<str:model_slug>/<str:pk>/", crm_detail_view, name="detail"),
]
