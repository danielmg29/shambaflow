"""
ShambaFlow – Member Dashboard URL Configuration
==============================================
URL patterns for member-centric dashboard views.
"""

from django.urls import path
from apps.crm.views.member_dashboard import (
    member_dashboard_view,
    member_records_view,
    member_form_templates_view,
)

app_name = "member_dashboard"

urlpatterns = [
    # Member dashboard main page
    path(
        "<uuid:member_id>/dashboard/",
        member_dashboard_view,
        name="dashboard"
    ),
    
    # Member records by type
    path(
        "<uuid:member_id>/records/<str:record_type>/",
        member_records_view,
        name="records"
    ),
    
    # Member form templates (with member context)
    path(
        "<uuid:member_id>/form-templates/",
        member_form_templates_view,
        name="form_templates"
    ),
]
