"""
ShambaFlow – Member Context Service
==================================
Service for handling member-specific form submissions and context.
Provides member field defaults and filtering for form builder operations.
"""

from typing import Dict, Any, Optional
from django.contrib.auth import get_user_model
from core.models import Member, Cooperative

User = get_user_model()


def get_member_context_defaults(member: Member) -> Dict[str, Any]:
    """
    Generate default values for form fields when submitting in member context.
    Returns a dictionary of field defaults that can be used in form submissions.
    """
    defaults = {}
    
    # Common member field mappings
    member_field_mappings = {
        "collection_scope": "MEMBER",
        "member": str(member.id),
        "member_id": str(member.id),
        "member_number": member.member_number,
        "member_name": member.get_display_name(),
    }
    
    # Add member-specific defaults based on extra_data
    extra_data = member.extra_data or {}
    
    # Common member profile fields that might be referenced in forms
    profile_mappings = {
        "first_name": extra_data.get("first_name"),
        "last_name": extra_data.get("last_name"),
        "full_name": extra_data.get("full_name"),
        "jina_kamili": extra_data.get("jina_kamili"),
        "phone": extra_data.get("phone"),
        "mobile": extra_data.get("mobile"),
        "email": extra_data.get("email"),
        "gender": extra_data.get("gender"),
        "location": extra_data.get("location"),
        "village": extra_data.get("village"),
        "ward": extra_data.get("ward"),
        "district": extra_data.get("district"),
        "county": extra_data.get("county"),
    }
    
    # Combine all mappings, filtering out None values
    defaults = {k: v for k, v in {**member_field_mappings, **profile_mappings}.items() if v is not None}
    
    return defaults


def get_member_templates_with_context(cooperative: Cooperative, member: Member) -> list[dict]:
    """
    Get form templates for a member with pre-configured member context.
    Filters templates that are relevant to member-specific data entry.
    """
    from core.models import FormTemplate
    from core.services.form_semantic import FORM_BUILDER_TARGET_MODELS
    
    # Target models that typically have member context
    member_context_models = ["PRODUCTION", "LIVESTOCK", "GOVERNANCE", "FINANCE"]
    
    templates = []
    for target_model in member_context_models:
        if target_model not in FORM_BUILDER_TARGET_MODELS:
            continue
            
        model_templates = FormTemplate.objects.filter(
            cooperative=cooperative,
            target_model=target_model,
            status="ACTIVE"
        ).select_related("created_by").prefetch_related("fields")
        
        for template in model_templates:
            # Check if template has member-related fields
            has_member_field = False
            member_fields = []
            
            for field in template.fields.all():
                if field.maps_to_model_field in ["member", "member_id", "member_number"]:
                    has_member_field = True
                    member_fields.append({
                        "field_key": field.maps_to_model_field,
                        "label": field.label,
                        "display_type": field.display_type,
                        "is_required": field.is_required,
                    })
            
            template_data = {
                "id": str(template.id),
                "name": template.name,
                "description": template.description,
                "target_model": template.target_model,
                "target_model_display": FORM_BUILDER_TARGET_MODELS.get(target_model, target_model),
                "has_member_field": has_member_field,
                "member_fields": member_fields,
                "field_count": template.fields.count(),
                "member_context": {
                    "member_id": str(member.id),
                    "member_number": member.member_number,
                    "member_name": member.get_display_name(),
                    "defaults": get_member_context_defaults(member),
                },
                "created_at": template.created_at.isoformat(),
                "updated_at": template.updated_at.isoformat(),
            }
            
            templates.append(template_data)
    
    return templates


def prepare_form_submission_with_member_context(
    template, 
    member: Member, 
    form_data: Dict[str, Any],
    user: User
) -> Dict[str, Any]:
    """
    Prepare form submission data with member context.
    Merges member defaults with user-provided form data.
    """
    member_defaults = get_member_context_defaults(member)
    
    # Start with member defaults
    submission_data = member_defaults.copy()
    
    # Override with user-provided data
    submission_data.update(form_data)
    
    # Add system fields
    submission_data.update({
        "cooperative": str(member.cooperative.id),
        "recorded_by": str(user.id),
        "added_by": str(user.id),
    })
    
    return submission_data


def filter_member_records(
    cooperative: Cooperative,
    member: Member,
    record_type: str,
    page: int = 1,
    page_size: int = 20
) -> Dict[str, Any]:
    """
    Filter records for a specific member across different model types.
    Returns paginated results with metadata.
    """
    from django.db.models import Q
    from django.core.paginator import Paginator
    
    # Build member filter conditions
    member_filters = Q(
        extra_data__member=str(member.id)
    ) | Q(
        extra_data__member_id=str(member.id)
    ) | Q(
        extra_data__member_number=member.member_number
    )
    
    if record_type == "production":
        from core.models import ProductionRecord
        queryset = ProductionRecord.objects.filter(
            cooperative=cooperative
        ).filter(member_filters).order_by('-record_date')
        
    elif record_type == "livestock":
        from core.models import LivestockHealthLog
        queryset = LivestockHealthLog.objects.filter(
            cooperative=cooperative
        ).filter(member_filters).order_by('-created_at')
        
    elif record_type == "governance":
        from core.models import GovernanceRecord
        queryset = GovernanceRecord.objects.filter(
            cooperative=cooperative
        ).filter(member_filters).order_by('-created_at')
        
    elif record_type == "financial":
        from core.models import FinancialRecord
        queryset = FinancialRecord.objects.filter(
            cooperative=cooperative
        ).filter(member_filters).order_by('-created_at')
        
    else:
        return {"error": f"Invalid record type: {record_type}"}
    
    # Apply pagination
    paginator = Paginator(queryset, page_size)
    page_obj = paginator.get_page(page)
    
    # Serialize results
    data = []
    for record in page_obj.object_list:
        if record_type == "production":
            data.append({
                "id": str(record.id),
                "record_date": record.record_date.isoformat(),
                "extra_data": record.extra_data or {},
                "created_at": record.created_at.isoformat(),
                "updated_at": record.updated_at.isoformat(),
            })
        elif record_type == "livestock":
            data.append({
                "id": str(record.id),
                "event_type": record.event_type,
                "event_type_display": record.get_event_type_display(),
                "extra_data": record.extra_data or {},
                "created_at": record.created_at.isoformat(),
                "updated_at": record.updated_at.isoformat(),
            })
        elif record_type == "governance":
            data.append({
                "id": str(record.id),
                "record_type": record.record_type,
                "record_type_display": record.get_record_type_display(),
                "extra_data": record.extra_data or {},
                "created_at": record.created_at.isoformat(),
                "updated_at": record.updated_at.isoformat(),
            })
        elif record_type == "financial":
            data.append({
                "id": str(record.id),
                "category": record.category,
                "category_display": record.get_category_display(),
                "extra_data": record.extra_data or {},
                "created_at": record.created_at.isoformat(),
                "updated_at": record.updated_at.isoformat(),
            })
    
    return {
        "data": data,
        "page": page,
        "total_pages": paginator.num_pages,
        "total_count": paginator.count,
        "has_next": page_obj.has_next(),
        "has_previous": page_obj.has_previous(),
    }
