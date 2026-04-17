"""
ShambaFlow CRM collection service.

One config-driven service handles:
  - schema generation for CRM module pages
  - cooperative-scoped CRUD
  - member-aware filtering and analytics
  - CSV/XLSX import and export

The critical rule is simple:
  - member dashboards operate on one member context
  - module pages operate on cooperative-wide data and may optionally filter to one member

For models without a structural member FK (production, livestock, governance,
finance), member ownership is normalised into extra_data using the canonical
keys:
  member_id, member_number, member_name, collection_scope
"""

from __future__ import annotations

import csv
import io
import math
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Iterable
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape as xml_escape

from django.core.paginator import Paginator
from django.db import models
from django.http import HttpResponse

from core.models import (
    Cooperative,
    FinancialRecord,
    FormTemplate,
    GovernanceRecord,
    LivestockHealthLog,
    Member,
    MemberHerdRecord,
    MemberLandRecord,
    ProductionRecord,
    RolePermission,
    User,
)
from core.services.field_registry import get_field_schema, validate_custom_payload
from core.services.form_submission import _coerce_custom_value, _coerce_value


SCOPE_MEMBER = "MEMBER"
SCOPE_COOPERATIVE = "COOPERATIVE"
DEFAULT_PAGE_SIZE = 25
MAX_PAGE_SIZE = 200
MEMBER_CONTEXT_HIDDEN_IMPORT_FIELDS = {"member_id", "member_number", "member_name", "collection_scope"}
MEMBER_DASHBOARD_HIDDEN_FIELDS = {"member", "member_id", "member_number", "member_name", "display_name", "collection_scope"}


TARGET_TO_MODEL_SLUG = {
    "MEMBER": "members",
    "PRODUCTION": "production",
    "LIVESTOCK": "livestock",
    "GOVERNANCE": "governance",
    "FINANCE": "finance",
    "LAND": "land",
    "HERD": "herds",
}

ANALYTICS_TIMELINE_MONTHS = 6
ANALYTICS_BREAKDOWN_LIMIT = 6
ANALYTICS_MEMBER_LIMIT = 6
ANALYTICS_MAX_CATEGORICAL_VALUES = 8
ANALYTICS_EXCLUDED_FIELD_KEYS = {
    "member_id",
    "member_name",
    "member_number",
    "display_name",
    "collection_scope",
}

MODEL_NUMERIC_HINTS: dict[str, tuple[str, ...]] = {
    "members": ("household", "dependents", "farm", "acre", "hectare"),
    "land": ("acre", "hectare", "area", "size"),
    "herds": ("count", "number", "size", "head", "animal"),
    "production": ("quantity", "yield", "weight", "volume", "bag", "kg"),
    "livestock": ("cost", "price", "dose", "dosage", "weight", "age"),
    "governance": ("attendance", "attendees", "participants", "count"),
    "finance": ("amount", "value", "cost", "price", "revenue", "contribution", "saving", "loan"),
}

MODEL_CATEGORICAL_HINTS: dict[str, tuple[str, ...]] = {
    "members": ("status", "gender", "group", "ward", "village"),
    "land": ("crop", "tenure", "irrigation", "location", "use"),
    "herds": ("animal", "breed", "system", "production"),
    "production": ("product", "crop", "season", "grade", "batch"),
    "livestock": ("animal", "breed", "disease", "treatment", "reason"),
    "governance": ("committee", "location", "decision", "cycle", "status"),
    "finance": ("source", "channel", "method", "purpose", "status"),
}

GENERIC_NUMERIC_HINTS = ("amount", "value", "quantity", "count", "size", "total")


@dataclass(frozen=True)
class SchemaFieldSpec:
    field_key: str
    label: str
    display_type: str = "text"
    is_system: bool = False
    is_required: bool = False
    editable: bool = True
    tag: str = "INFORMATIONAL"
    options: tuple[str, ...] = ()
    help_text: str = ""
    placeholder: str = ""
    validation_rules: dict[str, Any] = field(default_factory=dict)

    def to_schema_field(self) -> dict[str, Any]:
        return {
            "field_key": self.field_key,
            "label": self.label,
            "display_type": self.display_type,
            "is_system": self.is_system,
            "is_required": self.is_required,
            "is_locked": self.is_system,
            "editable": self.editable,
            "tag": self.tag,
            "options": list(self.options),
            "help_text": self.help_text,
            "placeholder": self.placeholder,
            "validation_rules": self.validation_rules,
        }


@dataclass(frozen=True)
class CRMModelConfig:
    slug: str
    model: type[models.Model]
    target_model: str
    permission_module: str
    discriminator: SchemaFieldSpec
    fixed_fields: tuple[SchemaFieldSpec, ...] = ()
    direct_fields: tuple[str, ...] = ()
    member_binding: str = "none"  # none | self | fk | extra
    default_order: tuple[str, ...] = ("-created_at",)
    select_related: tuple[str, ...] = ()

    @property
    def schema_fields(self) -> list[SchemaFieldSpec]:
        return [self.discriminator, *self.fixed_fields]


def _choice_values(choices: Iterable[tuple[str, str]]) -> tuple[str, ...]:
    return tuple(str(key) for key, _ in choices)


CRM_MODEL_CONFIG: dict[str, CRMModelConfig] = {
    "members": CRMModelConfig(
        slug="members",
        model=Member,
        target_model="MEMBER",
        permission_module="MEMBERS",
        discriminator=SchemaFieldSpec(
            field_key="member_number",
            label="Member Number",
            display_type="text",
            is_system=True,
            is_required=True,
            editable=False,
            help_text="Auto-generated by the system.",
        ),
        fixed_fields=(
            SchemaFieldSpec(
                field_key="status",
                label="Status",
                display_type="dropdown",
                is_required=False,
                options=_choice_values(Member.MemberStatus.choices),
                help_text="Member lifecycle status.",
            ),
            SchemaFieldSpec(
                field_key="display_name",
                label="Member Name",
                display_type="text",
                is_system=True,
                is_required=False,
                editable=False,
                help_text="Derived from the member profile fields.",
            ),
        ),
        direct_fields=("status",),
        member_binding="self",
        default_order=("-created_at",),
    ),
    "land": CRMModelConfig(
        slug="land",
        model=MemberLandRecord,
        target_model="LAND",
        permission_module="MEMBERS",
        discriminator=SchemaFieldSpec(
            field_key="member_number",
            label="Member Number",
            display_type="text",
            is_required=True,
            help_text="Enter the cooperative member number for this parcel.",
            placeholder="e.g. SHA-001",
        ),
        fixed_fields=(
            SchemaFieldSpec(
                field_key="member_name",
                label="Member Name",
                display_type="text",
                is_system=True,
                editable=False,
                help_text="Auto-filled from the selected member.",
            ),
        ),
        member_binding="fk",
        default_order=("-created_at",),
        select_related=("member",),
    ),
    "herds": CRMModelConfig(
        slug="herds",
        model=MemberHerdRecord,
        target_model="HERD",
        permission_module="MEMBERS",
        discriminator=SchemaFieldSpec(
            field_key="member_number",
            label="Member Number",
            display_type="text",
            is_required=True,
            help_text="Enter the cooperative member number for this herd.",
            placeholder="e.g. SHA-001",
        ),
        fixed_fields=(
            SchemaFieldSpec(
                field_key="member_name",
                label="Member Name",
                display_type="text",
                is_system=True,
                editable=False,
                help_text="Auto-filled from the selected member.",
            ),
        ),
        member_binding="fk",
        default_order=("-created_at",),
        select_related=("member",),
    ),
    "production": CRMModelConfig(
        slug="production",
        model=ProductionRecord,
        target_model="PRODUCTION",
        permission_module="PRODUCTION",
        discriminator=SchemaFieldSpec(
            field_key="record_date",
            label="Record Date",
            display_type="date",
            is_required=True,
            help_text="Date of the production event.",
        ),
        fixed_fields=(
            SchemaFieldSpec(
                field_key="collection_scope",
                label="Collection Scope",
                display_type="dropdown",
                is_required=False,
                options=(SCOPE_COOPERATIVE, SCOPE_MEMBER),
                help_text="Use MEMBER for one member dashboard records, COOPERATIVE for aggregate records.",
            ),
            SchemaFieldSpec(
                field_key="member_number",
                label="Member Number",
                display_type="text",
                is_required=False,
                help_text="Required when collection scope is MEMBER.",
                placeholder="e.g. SHA-001",
            ),
            SchemaFieldSpec(
                field_key="member_name",
                label="Member Name",
                display_type="text",
                is_system=True,
                editable=False,
                help_text="Auto-filled from the selected member.",
            ),
        ),
        direct_fields=("record_date",),
        member_binding="extra",
        default_order=("-record_date", "-created_at"),
    ),
    "livestock": CRMModelConfig(
        slug="livestock",
        model=LivestockHealthLog,
        target_model="LIVESTOCK",
        permission_module="LIVESTOCK",
        discriminator=SchemaFieldSpec(
            field_key="event_type",
            label="Event Type",
            display_type="dropdown",
            is_required=True,
            options=_choice_values(LivestockHealthLog.EventType.choices),
            help_text="Category of livestock event.",
        ),
        fixed_fields=(
            SchemaFieldSpec(
                field_key="collection_scope",
                label="Collection Scope",
                display_type="dropdown",
                options=(SCOPE_COOPERATIVE, SCOPE_MEMBER),
                help_text="Use MEMBER for one member dashboard records, COOPERATIVE for aggregate records.",
            ),
            SchemaFieldSpec(
                field_key="member_number",
                label="Member Number",
                display_type="text",
                help_text="Required when collection scope is MEMBER.",
                placeholder="e.g. SHA-001",
            ),
            SchemaFieldSpec(
                field_key="member_name",
                label="Member Name",
                display_type="text",
                is_system=True,
                editable=False,
                help_text="Auto-filled from the selected member.",
            ),
        ),
        direct_fields=("event_type",),
        member_binding="extra",
        default_order=("-created_at",),
    ),
    "governance": CRMModelConfig(
        slug="governance",
        model=GovernanceRecord,
        target_model="GOVERNANCE",
        permission_module="GOVERNANCE",
        discriminator=SchemaFieldSpec(
            field_key="record_type",
            label="Record Type",
            display_type="dropdown",
            is_required=True,
            options=_choice_values(GovernanceRecord.RecordType.choices),
            help_text="Category of governance record.",
        ),
        fixed_fields=(
            SchemaFieldSpec(
                field_key="collection_scope",
                label="Collection Scope",
                display_type="dropdown",
                options=(SCOPE_COOPERATIVE, SCOPE_MEMBER),
                help_text="Use MEMBER for one member dashboard records, COOPERATIVE for aggregate records.",
            ),
            SchemaFieldSpec(
                field_key="member_number",
                label="Member Number",
                display_type="text",
                help_text="Required when collection scope is MEMBER.",
                placeholder="e.g. SHA-001",
            ),
            SchemaFieldSpec(
                field_key="member_name",
                label="Member Name",
                display_type="text",
                is_system=True,
                editable=False,
                help_text="Auto-filled from the selected member.",
            ),
        ),
        direct_fields=("record_type",),
        member_binding="extra",
        default_order=("-created_at",),
    ),
    "finance": CRMModelConfig(
        slug="finance",
        model=FinancialRecord,
        target_model="FINANCE",
        permission_module="FINANCE",
        discriminator=SchemaFieldSpec(
            field_key="category",
            label="Category",
            display_type="dropdown",
            is_required=True,
            options=_choice_values(FinancialRecord.Category.choices),
            help_text="Financial record category.",
        ),
        fixed_fields=(
            SchemaFieldSpec(
                field_key="collection_scope",
                label="Collection Scope",
                display_type="dropdown",
                options=(SCOPE_COOPERATIVE, SCOPE_MEMBER),
                help_text="Use MEMBER for one member dashboard records, COOPERATIVE for aggregate records.",
            ),
            SchemaFieldSpec(
                field_key="member_number",
                label="Member Number",
                display_type="text",
                help_text="Required when collection scope is MEMBER.",
                placeholder="e.g. SHA-001",
            ),
            SchemaFieldSpec(
                field_key="member_name",
                label="Member Name",
                display_type="text",
                is_system=True,
                editable=False,
                help_text="Auto-filled from the selected member.",
            ),
        ),
        direct_fields=("category",),
        member_binding="extra",
        default_order=("-created_at",),
    ),
}


def get_crm_config(model_slug: str) -> CRMModelConfig:
    try:
        return CRM_MODEL_CONFIG[model_slug]
    except KeyError as exc:
        raise ValueError(f"Unsupported CRM model: {model_slug}") from exc


def get_cooperative(cooperative_id: str) -> Cooperative | None:
    try:
        return Cooperative.objects.get(pk=cooperative_id)
    except Cooperative.DoesNotExist:
        return None


def has_crm_permission(user: User, cooperative: Cooperative, module: str, action: str) -> bool:
    if not user.is_authenticated:
        return False
    if user.is_chair and str(user.cooperative_id) == str(cooperative.id):
        return True
    if not user.is_helper or str(user.cooperative_id) != str(cooperative.id):
        return False

    normalized = action if action.startswith("can_") else f"can_{action}"
    try:
        permission = RolePermission.objects.get(
            user=user,
            cooperative=cooperative,
            module=module,
        )
    except RolePermission.DoesNotExist:
        return False

    return bool(getattr(permission, normalized, False))


def get_model_permission_snapshot(user: User, cooperative: Cooperative, model_slug: str) -> dict[str, bool]:
    config = get_crm_config(model_slug)
    return {
        "can_view": has_crm_permission(user, cooperative, config.permission_module, "view"),
        "can_create": has_crm_permission(user, cooperative, config.permission_module, "create"),
        "can_edit": has_crm_permission(user, cooperative, config.permission_module, "edit"),
        "can_delete": has_crm_permission(user, cooperative, config.permission_module, "delete"),
    }


def get_target_permission_snapshot(user: User, cooperative: Cooperative, target_model: str) -> dict[str, bool]:
    model_slug = TARGET_TO_MODEL_SLUG.get(target_model)
    if not model_slug:
        return {
            "can_view": False,
            "can_create": False,
            "can_edit": False,
            "can_delete": False,
        }
    return get_model_permission_snapshot(user, cooperative, model_slug)


def _field_lookup(config: CRMModelConfig) -> dict[str, dict[str, Any]]:
    fields: dict[str, dict[str, Any]] = {
        config.discriminator.field_key: config.discriminator.to_schema_field()
    }
    for spec in config.fixed_fields:
        fields[spec.field_key] = spec.to_schema_field()
    return fields


def build_schema(cooperative_id: str, model_slug: str) -> dict[str, Any]:
    config = get_crm_config(model_slug)
    field_lookup = _field_lookup(config)

    cooperative_fields = [spec.to_schema_field() for spec in config.fixed_fields]
    for field_def in get_field_schema(cooperative_id=cooperative_id, target_model=config.target_model):
        cooperative_fields.append(
            {
                "field_key": field_def["field_key"],
                "label": field_def["label"],
                "display_type": field_def["display_type"],
                "is_system": False,
                "is_required": field_def["is_required"],
                "is_locked": field_def["is_locked"],
                "editable": True,
                "tag": field_def["tag"],
                "options": field_def["options"],
                "help_text": field_def["help_text"],
                "placeholder": field_def["placeholder"],
                "validation_rules": field_def["validation_rules"],
            }
        )

    skeleton_field = field_lookup[config.discriminator.field_key]
    all_fields = [skeleton_field, *cooperative_fields]
    return {
        "model_slug": model_slug,
        "target_model": config.target_model,
        "cooperative_id": cooperative_id,
        "skeleton_fields": [skeleton_field],
        "cooperative_fields": cooperative_fields,
        "all_fields": all_fields,
        "meta_fields": [],
        "display_columns": [f["field_key"] for f in all_fields],
        "field_count": len(all_fields),
        "discriminator": skeleton_field,
    }


def _normalize_scalar(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return str(value)


def _member_name(member: Member | None) -> str | None:
    return member.get_display_name() if member else None


def _resolve_member(
    cooperative: Cooperative,
    *,
    member_id: str | None = None,
    member_number: str | None = None,
    fallback_number: str | None = None,
) -> Member | None:
    if member_id:
        return Member.objects.filter(pk=member_id, cooperative=cooperative).first()
    number = member_number or fallback_number
    if number:
        return Member.objects.filter(member_number=number, cooperative=cooperative).first()
    return None


def _coerce_direct_payload(config: CRMModelConfig, payload: dict[str, Any]) -> dict[str, Any]:
    direct_values: dict[str, Any] = {}
    field_names = {config.discriminator.field_key, *config.direct_fields}
    for key in field_names:
        if key not in payload:
            continue
        try:
            model_field = config.model._meta.get_field(key)
        except Exception:
            continue
        if payload[key] in (None, ""):
            direct_values[key] = None
            continue
        direct_values[key] = _coerce_value(payload[key], model_field)
    return direct_values


def _dynamic_registry_lookup(cooperative: Cooperative, config: CRMModelConfig) -> dict[str, dict[str, Any]]:
    return {
        field_def["field_key"]: field_def
        for field_def in get_field_schema(cooperative.id, config.target_model)
    }


def _prepare_dynamic_extra_data(
    cooperative: Cooperative,
    config: CRMModelConfig,
    payload: dict[str, Any],
    *,
    existing_extra_data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    registry = _dynamic_registry_lookup(cooperative, config)
    fixed_lookup = {spec.field_key: spec for spec in config.fixed_fields}
    direct_names = {config.discriminator.field_key, *config.direct_fields}
    ignored = {
        "id",
        "created_at",
        "updated_at",
        "cooperative",
        "cooperative_id",
        "added_by",
        "recorded_by",
        "member",
        "member_id",
    }

    incoming_dynamic: dict[str, Any] = {}
    for key, value in payload.items():
        if key in direct_names or key in ignored:
            continue
        if key in fixed_lookup:
            incoming_dynamic[key] = value
            continue
        if key in registry:
            incoming_dynamic[key] = _coerce_custom_value(value, registry[key]["display_type"])

    merged = dict(existing_extra_data or {})
    merged.update(incoming_dynamic)

    registry_payload = {
        key: value
        for key, value in merged.items()
        if key in registry
    }
    is_valid, errors = validate_custom_payload(
        cooperative_id=cooperative.id,
        target_model=config.target_model,
        payload=registry_payload,
    )
    if not is_valid:
        messages = "; ".join(err["message"] for err in errors)
        raise ValueError(messages)

    return merged


def _prepare_member_bound_extra_data(
    config: CRMModelConfig,
    payload: dict[str, Any],
    extra_data: dict[str, Any],
    member: Member | None,
) -> dict[str, Any]:
    if config.member_binding not in {"extra", "fk"}:
        return extra_data

    normalized = dict(extra_data)
    if config.member_binding == "extra":
        requested_scope = payload.get("collection_scope") or normalized.get("collection_scope")
        scope = (str(requested_scope).upper() if requested_scope else None) or (
            SCOPE_MEMBER if member else SCOPE_COOPERATIVE
        )
        normalized["collection_scope"] = scope

        if scope == SCOPE_MEMBER and not member:
            raise ValueError("member_number is required when collection_scope is MEMBER.")

        if scope == SCOPE_MEMBER and member:
            normalized["member_id"] = str(member.id)
            normalized["member_number"] = member.member_number
            normalized["member_name"] = _member_name(member)
        else:
            normalized.pop("member_id", None)
            normalized.pop("member_number", None)
            normalized.pop("member_name", None)

    if config.member_binding == "fk" and member:
        normalized["member_id"] = str(member.id)
        normalized["member_number"] = member.member_number
        normalized["member_name"] = _member_name(member)

    return normalized


def _extract_member_from_payload(
    cooperative: Cooperative,
    config: CRMModelConfig,
    payload: dict[str, Any],
    *,
    existing_record: models.Model | None = None,
) -> Member | None:
    if config.member_binding == "self":
        if isinstance(existing_record, Member):
            return existing_record
        return None

    member_id = payload.get("member_id") or payload.get("member")
    member_number = payload.get("member_number")

    if not member_id and not member_number and config.member_binding == "fk" and existing_record is not None:
        return getattr(existing_record, "member", None)

    if not member_id and not member_number and config.member_binding == "extra" and existing_record is not None:
        existing_extra = getattr(existing_record, "extra_data", {}) or {}
        member_id = existing_extra.get("member_id")
        member_number = existing_extra.get("member_number")

    member = _resolve_member(
        cooperative,
        member_id=str(member_id) if member_id else None,
        member_number=str(member_number) if member_number else None,
    )

    if config.member_binding == "fk" and member is None:
        raise ValueError("member_number is required for this model.")

    requested_scope = str(payload.get("collection_scope") or "").upper()
    if config.member_binding == "extra" and requested_scope == SCOPE_MEMBER and member is None:
        raise ValueError("member_number is required when collection_scope is MEMBER.")

    return member


def _record_display_name(record: dict[str, Any]) -> str:
    member_name = record.get("display_name") or record.get("member_name")
    if member_name:
        return str(member_name)
    discriminator = record.get("member_number") or record.get("id")
    return str(discriminator)


def serialize_record(record: models.Model, config: CRMModelConfig) -> dict[str, Any]:
    data = {
        "id": str(record.pk),
        "cooperative_id": str(getattr(record, "cooperative_id", "")),
        "extra_data": dict(getattr(record, "extra_data", {}) or {}),
        "created_at": record.created_at.isoformat() if getattr(record, "created_at", None) else None,
        "updated_at": record.updated_at.isoformat() if getattr(record, "updated_at", None) else None,
    }

    if config.slug == "members":
        member: Member = record  # type: ignore[assignment]
        data["member_number"] = member.member_number
        data["status"] = member.status
        data["display_name"] = member.get_display_name()
        return data

    if config.member_binding == "fk":
        member = getattr(record, "member", None)
        data["member_id"] = str(member.id) if member else None
        data["member_number"] = member.member_number if member else None
        data["member_name"] = _member_name(member)
        data["extra_data"].setdefault("member_id", data["member_id"])
        data["extra_data"].setdefault("member_number", data["member_number"])
        data["extra_data"].setdefault("member_name", data["member_name"])

    if config.discriminator.field_key in config.direct_fields or config.discriminator.field_key == "status":
        value = getattr(record, config.discriminator.field_key, None)
        if isinstance(value, (date, datetime)):
            data[config.discriminator.field_key] = value.isoformat()
        else:
            data[config.discriminator.field_key] = value

    for field_name in config.direct_fields:
        value = getattr(record, field_name, None)
        if isinstance(value, (date, datetime)):
            data[field_name] = value.isoformat()
        else:
            data[field_name] = value

    if config.member_binding == "extra":
        data["member_id"] = data["extra_data"].get("member_id")
        data["member_number"] = data["extra_data"].get("member_number")
        data["member_name"] = data["extra_data"].get("member_name")
        data["collection_scope"] = data["extra_data"].get("collection_scope", SCOPE_COOPERATIVE)

    return data


def _get_record_value(record: dict[str, Any], field_key: str) -> Any:
    if field_key in record:
        return record[field_key]
    return (record.get("extra_data") or {}).get(field_key)


def _matches_filter_value(candidate: Any, raw_value: str) -> bool:
    if candidate is None:
        return False
    query = raw_value.strip().lower()
    if isinstance(candidate, bool):
        return query in {"true", "1", "yes"} if candidate else query in {"false", "0", "no"}
    if isinstance(candidate, (int, float, Decimal)):
        return _normalize_scalar(candidate).lower() == query
    if isinstance(candidate, dict):
        return any(_matches_filter_value(item, raw_value) for item in candidate.values())
    if isinstance(candidate, (list, tuple)):
        return any(_matches_filter_value(item, raw_value) for item in candidate)
    return query in _normalize_scalar(candidate).lower()


def _record_matches(record: dict[str, Any], filters: dict[str, str], search: str) -> bool:
    member_id = filters.get("member_id")
    member_number = filters.get("member_number")
    if member_id or member_number:
        member_candidates = [
            _get_record_value(record, "member_id"),
            _get_record_value(record, "member_number"),
        ]
        if member_id and not any(_matches_filter_value(candidate, member_id) for candidate in member_candidates if candidate is not None):
            return False
        if member_number and not any(_matches_filter_value(candidate, member_number) for candidate in member_candidates if candidate is not None):
            return False

    for key, value in filters.items():
        if not value:
            continue
        if key in {"member_id", "member_number"}:
            continue
        if key.startswith("extra__"):
            candidate = (record.get("extra_data") or {}).get(key[7:])
        else:
            candidate = _get_record_value(record, key)
        if not _matches_filter_value(candidate, value):
            return False

    if not search:
        return True

    haystack: list[str] = []
    for key, value in record.items():
        if key == "extra_data":
            for extra_value in (value or {}).values():
                haystack.append(_normalize_scalar(extra_value).lower())
            continue
        haystack.append(_normalize_scalar(value).lower())

    query = search.lower()
    return any(query in item for item in haystack if item)


def _sorted_records(records: list[dict[str, Any]], order_by: str | None) -> list[dict[str, Any]]:
    if not order_by:
        return records
    reverse = order_by.startswith("-")
    field_key = order_by[1:] if reverse else order_by
    return sorted(
        records,
        key=lambda record: (_normalize_scalar(_get_record_value(record, field_key)) or "").lower(),
        reverse=reverse,
    )


def _paginate_list(records: list[dict[str, Any]], page: int, page_size: int) -> dict[str, Any]:
    paginator = Paginator(records, page_size)
    page_obj = paginator.get_page(page)
    return {
        "data": list(page_obj.object_list),
        "page": page,
        "page_size": page_size,
        "total_pages": paginator.num_pages,
        "total_count": paginator.count,
        "has_next": page_obj.has_next(),
        "has_previous": page_obj.has_previous(),
    }


def _base_queryset(cooperative: Cooperative, config: CRMModelConfig):
    queryset = config.model.objects.filter(cooperative=cooperative)
    if config.select_related:
        queryset = queryset.select_related(*config.select_related)
    return queryset


def _apply_queryset_prefilters(
    queryset,
    config: CRMModelConfig,
    filters: dict[str, str] | None,
):
    if not filters:
        return queryset

    member_id = filters.get("member_id")
    member_number = filters.get("member_number")
    if filters.get("id"):
        queryset = queryset.filter(pk=filters["id"])

    if config.member_binding == "self":
        if member_id:
            queryset = queryset.filter(pk=member_id)
        if member_number:
            queryset = queryset.filter(member_number=member_number)
    elif config.member_binding == "fk":
        if member_id:
            queryset = queryset.filter(member_id=member_id)
        if member_number:
            queryset = queryset.filter(member__member_number=member_number)
    elif config.member_binding == "extra":
        if member_id:
            queryset = queryset.filter(extra_data__member_id=member_id)
        if member_number:
            queryset = queryset.filter(extra_data__member_number=member_number)
        if filters.get("collection_scope"):
            queryset = queryset.filter(extra_data__collection_scope=filters["collection_scope"])

    direct_filter_fields = {config.discriminator.field_key, *config.direct_fields}
    if config.slug == "members":
        direct_filter_fields.add("status")

    for field_key in direct_filter_fields:
        if field_key in {"member_id", "member_number", "id", "collection_scope"}:
            continue
        value = filters.get(field_key)
        if value in (None, ""):
            continue
        queryset = queryset.filter(**{field_key: value})

    return queryset


def list_records(
    cooperative: Cooperative,
    model_slug: str,
    *,
    page: int = 1,
    page_size: int = DEFAULT_PAGE_SIZE,
    search: str = "",
    filters: dict[str, str] | None = None,
    order_by: str | None = None,
) -> dict[str, Any]:
    config = get_crm_config(model_slug)
    queryset = _apply_queryset_prefilters(
        _base_queryset(cooperative, config),
        config,
        filters,
    )
    records = [
        serialize_record(instance, config)
        for instance in queryset.order_by(*config.default_order)
    ]
    filtered = [
        record
        for record in records
        if _record_matches(record, filters or {}, search)
    ]
    ordered = _sorted_records(filtered, order_by)
    result = _paginate_list(ordered, page, page_size)
    result["model_slug"] = model_slug
    result["permissions"] = None
    return result


def get_record_detail(cooperative: Cooperative, model_slug: str, record_id: str) -> dict[str, Any] | None:
    config = get_crm_config(model_slug)
    queryset = _base_queryset(cooperative, config)
    try:
        instance = queryset.get(pk=record_id)
    except config.model.DoesNotExist:
        return None
    return serialize_record(instance, config)


def save_record(
    cooperative: Cooperative,
    user: User,
    model_slug: str,
    payload: dict[str, Any],
    *,
    instance: models.Model | None = None,
) -> dict[str, Any]:
    config = get_crm_config(model_slug)
    direct_values = _coerce_direct_payload(config, payload)
    member = _extract_member_from_payload(cooperative, config, payload, existing_record=instance)

    if config.slug == "members":
        extra_data = _prepare_dynamic_extra_data(
            cooperative,
            config,
            payload,
            existing_extra_data=(instance.extra_data if instance else None),  # type: ignore[attr-defined]
        )
        member_instance = instance if isinstance(instance, Member) else Member(cooperative=cooperative, added_by=user)
        for field_name, value in direct_values.items():
            setattr(member_instance, field_name, value)
        member_instance.extra_data = extra_data
        if instance is None:
            member_instance.cooperative = cooperative
            member_instance.added_by = user
        member_instance.full_clean()
        member_instance.save()
        return serialize_record(member_instance, config)

    extra_data = _prepare_dynamic_extra_data(
        cooperative,
        config,
        payload,
        existing_extra_data=(getattr(instance, "extra_data", None) if instance else None),
    )
    extra_data = _prepare_member_bound_extra_data(config, payload, extra_data, member)

    if instance is None:
        record = config.model(cooperative=cooperative)
    else:
        record = instance

    if config.member_binding == "fk":
        setattr(record, "member", member)

    for field_name, value in direct_values.items():
        setattr(record, field_name, value)

    if hasattr(record, "extra_data"):
        record.extra_data = extra_data

    record.full_clean()
    record.save()
    if config.member_binding == "fk" and hasattr(record, "refresh_from_db"):
        record.refresh_from_db()

    return serialize_record(record, config)


def delete_record(cooperative: Cooperative, model_slug: str, record_id: str) -> bool:
    config = get_crm_config(model_slug)
    queryset = _base_queryset(cooperative, config)
    deleted, _ = queryset.filter(pk=record_id).delete()
    return deleted > 0


def get_member_records(
    cooperative: Cooperative,
    member: Member,
    model_slug: str,
    *,
    page: int = 1,
    page_size: int = DEFAULT_PAGE_SIZE,
    search: str = "",
    filters: dict[str, str] | None = None,
) -> dict[str, Any]:
    member_filters = {
        "member_id": str(member.id),
        "member_number": member.member_number,
    }
    for key, value in (filters or {}).items():
        if key in {"member_id", "member_number"} or value in (None, ""):
            continue
        member_filters[key] = value
    return list_records(
        cooperative,
        model_slug,
        page=page,
        page_size=page_size,
        search=search,
        filters=member_filters,
    )


def _parse_dateish(value: Any) -> date | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value

    text = str(value).strip()
    if not text:
        return None

    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        pass

    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def _parse_numeric(value: Any) -> float | None:
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        return float(int(value))
    if isinstance(value, (int, float, Decimal)):
        return float(value)

    text = str(value).strip()
    if not text:
        return None

    normalized = (
        text.replace(",", "")
        .replace("KSh", "")
        .replace("KES", "")
        .replace("$", "")
        .strip()
    )
    try:
        return float(normalized)
    except ValueError:
        return None


def _humanize_value(value: Any) -> str:
    text = _normalize_scalar(value).strip()
    if not text:
        return "Unknown"
    if "_" in text:
        return text.replace("_", " ").title()
    if text.isalpha() and text.isupper():
        return text.title()
    return text


def _format_number(value: float | int | Decimal) -> str:
    number = float(value)
    if math.isclose(number, round(number), rel_tol=0, abs_tol=1e-9):
        return f"{int(round(number)):,}"
    return f"{number:,.1f}"


def _format_date(value: date | None) -> str:
    return value.strftime("%d %b %Y") if value else "—"


def _choice_label_lookup(config: CRMModelConfig) -> dict[str, dict[str, str]]:
    labels: dict[str, dict[str, str]] = {
        "collection_scope": {
            SCOPE_MEMBER: "Member",
            SCOPE_COOPERATIVE: "Cooperative",
        }
    }

    field_names = {config.discriminator.field_key, *config.direct_fields, "status"}
    for field_name in field_names:
        try:
            model_field = config.model._meta.get_field(field_name)
        except Exception:
            continue
        if not getattr(model_field, "choices", None):
            continue
        labels[field_name] = {
            str(key): str(label)
            for key, label in model_field.choices
        }

    return labels


def _field_value_label(
    field_key: str,
    value: Any,
    choice_labels: dict[str, dict[str, str]],
) -> str:
    normalized = _normalize_scalar(value).strip()
    if not normalized:
        return "Unknown"
    return choice_labels.get(field_key, {}).get(normalized, _humanize_value(normalized))


def _month_start(value: date) -> date:
    return value.replace(day=1)


def _shift_month(value: date, months: int) -> date:
    absolute_month = value.year * 12 + (value.month - 1) + months
    year, month_index = divmod(absolute_month, 12)
    return date(year, month_index + 1, 1)


def _analytics_records(
    cooperative: Cooperative,
    model_slug: str,
    *,
    search: str = "",
    filters: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    config = get_crm_config(model_slug)
    queryset = _apply_queryset_prefilters(
        _base_queryset(cooperative, config),
        config,
        filters,
    )
    serialized = [
        serialize_record(instance, config)
        for instance in queryset.order_by(*config.default_order)
    ]
    return [
        record
        for record in serialized
        if _record_matches(record, filters or {}, search)
    ]


def _timeline_field(
    records: list[dict[str, Any]],
    schema: dict[str, Any],
    config: CRMModelConfig,
) -> tuple[str, str]:
    candidates: list[tuple[str, str]] = []

    for field in schema.get("all_fields", []):
        if field["display_type"] in {"date", "datetime"}:
            candidates.append((field["field_key"], field["label"]))

    candidates.append(("created_at", "Created At"))

    best_key = "created_at"
    best_label = "Created At"
    best_count = -1

    for field_key, label in candidates:
        count = 0
        for record in records:
            value = record.get(field_key) if field_key == "created_at" else _get_record_value(record, field_key)
            if _parse_dateish(value):
                count += 1
        if count > best_count:
            best_key = field_key
            best_label = label
            best_count = count

    return best_key, best_label


def _timeline_chart(
    records: list[dict[str, Any]],
    *,
    field_key: str,
    field_label: str,
) -> dict[str, Any] | None:
    timeline_values = [
        _parse_dateish(record.get(field_key) if field_key == "created_at" else _get_record_value(record, field_key))
        for record in records
    ]
    timeline_dates = [item for item in timeline_values if item is not None]
    if not timeline_dates:
        return None

    end_month = _month_start(max(timeline_dates))
    month_starts = [
        _shift_month(end_month, offset)
        for offset in range(-(ANALYTICS_TIMELINE_MONTHS - 1), 1)
    ]
    counts = {month: 0 for month in month_starts}

    for timeline_date in timeline_dates:
        month = _month_start(timeline_date)
        if month in counts:
            counts[month] += 1

    return {
        "id": "timeline",
        "type": "timeline",
        "title": "Activity trend",
        "description": f"Records over time using {field_label.lower()}.",
        "data": [
            {
                "label": month.strftime("%b %Y"),
                "value": counts[month],
            }
            for month in month_starts
        ],
    }


def _value_counts(
    records: list[dict[str, Any]],
    field_key: str,
    choice_labels: dict[str, dict[str, str]],
) -> dict[str, int]:
    counts: dict[str, int] = {}
    for record in records:
        raw = _get_record_value(record, field_key)
        if raw in (None, "", []):
            continue

        values = raw if isinstance(raw, list) else [raw]
        for value in values:
            if isinstance(value, dict):
                continue
            label = _field_value_label(field_key, value, choice_labels)
            counts[label] = counts.get(label, 0) + 1
    return counts


def _chart_from_counts(
    chart_id: str,
    title: str,
    description: str,
    counts: dict[str, int],
    *,
    limit: int = ANALYTICS_BREAKDOWN_LIMIT,
) -> dict[str, Any] | None:
    meaningful = [
        {"label": label, "value": value}
        for label, value in sorted(
            counts.items(),
            key=lambda item: (-item[1], item[0].lower()),
        )[:limit]
        if value > 0
    ]
    if len(meaningful) < 2:
        return None

    return {
        "id": chart_id,
        "type": "bar",
        "title": title,
        "description": description,
        "data": meaningful,
    }


def _field_priority_score(field_key: str, label: str, hints: tuple[str, ...]) -> int:
    haystack = f"{field_key} {label}".lower()
    score = 0
    for index, hint in enumerate(hints):
        if hint in haystack:
            score += max(1, 10 - index)
    return score


def _numeric_field_stats(
    records: list[dict[str, Any]],
    schema: dict[str, Any],
    config: CRMModelConfig,
) -> list[dict[str, Any]]:
    hints = (*MODEL_NUMERIC_HINTS.get(config.slug, ()), *GENERIC_NUMERIC_HINTS)
    stats: list[dict[str, Any]] = []

    for field in schema.get("all_fields", []):
        if field["display_type"] not in {"number", "decimal"}:
            continue
        field_key = field["field_key"]
        if field_key in ANALYTICS_EXCLUDED_FIELD_KEYS:
            continue

        values = [
            parsed
            for parsed in (
                _parse_numeric(_get_record_value(record, field_key))
                for record in records
            )
            if parsed is not None
        ]
        if not values:
            continue

        stats.append(
            {
                "key": field_key,
                "label": field["label"],
                "count": len(values),
                "sum": sum(values),
                "average": sum(values) / len(values),
                "max": max(values),
                "score": (
                    _field_priority_score(field_key, field["label"], hints) * 1000
                    + len(values) * 10
                    + int(abs(sum(values)))
                ),
            }
        )

    return sorted(stats, key=lambda item: item["score"], reverse=True)


def _categorical_breakdown_chart(
    records: list[dict[str, Any]],
    schema: dict[str, Any],
    config: CRMModelConfig,
    choice_labels: dict[str, dict[str, str]],
) -> dict[str, Any] | None:
    if config.slug == "members":
        return _chart_from_counts(
            "status_breakdown",
            "Status mix",
            "Current member lifecycle distribution.",
            _value_counts(records, "status", choice_labels),
        )

    discriminator_field = config.discriminator
    if discriminator_field.display_type not in {"date", "datetime"} and discriminator_field.field_key not in {"member_number"}:
        discriminator_counts = _value_counts(records, discriminator_field.field_key, choice_labels)
        if 1 < len(discriminator_counts) <= ANALYTICS_MAX_CATEGORICAL_VALUES:
            return _chart_from_counts(
                f"{discriminator_field.field_key}_breakdown",
                f"{discriminator_field.label} mix",
                f"How records distribute across {discriminator_field.label.lower()}.",
                discriminator_counts,
            )

    hints = MODEL_CATEGORICAL_HINTS.get(config.slug, ())
    candidates = []
    for field in schema.get("all_fields", []):
        field_key = field["field_key"]
        if field_key in ANALYTICS_EXCLUDED_FIELD_KEYS or field_key == config.discriminator.field_key:
            continue
        if field["display_type"] not in {"dropdown", "multi_select", "boolean", "text"}:
            continue
        counts = _value_counts(records, field_key, choice_labels)
        if not (1 < len(counts) <= ANALYTICS_MAX_CATEGORICAL_VALUES):
            continue
        candidates.append(
            (
                _field_priority_score(field_key, field["label"], hints) * 1000 + sum(counts.values()),
                field,
                counts,
            )
        )

    if not candidates:
        return None

    _, field, counts = max(candidates, key=lambda item: item[0])
    return _chart_from_counts(
        f"{field['field_key']}_breakdown",
        f"{field['label']} mix",
        f"Top values recorded for {field['label'].lower()}.",
        counts,
    )


def get_model_analytics(
    cooperative: Cooperative,
    model_slug: str,
    *,
    search: str = "",
    filters: dict[str, str] | None = None,
) -> dict[str, Any]:
    config = get_crm_config(model_slug)
    schema = build_schema(str(cooperative.id), model_slug)
    records = _analytics_records(
        cooperative,
        model_slug,
        search=search,
        filters=filters,
    )
    choice_labels = _choice_label_lookup(config)

    total_records = len(records)
    timeline_key, timeline_label = _timeline_field(records, schema, config)
    activity_dates = [
        _parse_dateish(
            record.get(timeline_key)
            if timeline_key == "created_at"
            else _get_record_value(record, timeline_key)
        )
        for record in records
    ]
    recent_threshold = date.today() - timedelta(days=30)
    recent_records = sum(1 for item in activity_dates if item and item >= recent_threshold)
    latest_activity = max((item for item in activity_dates if item is not None), default=None)

    unique_members = 0
    member_counts: dict[str, int] = {}
    if model_slug != "members":
        member_identifiers: set[str] = set()
        for record in records:
            identifier = (
                _normalize_scalar(record.get("member_id"))
                or _normalize_scalar(record.get("member_number"))
            )
            if not identifier:
                continue
            member_identifiers.add(identifier)
            label = (
                _normalize_scalar(record.get("member_name"))
                or _normalize_scalar(record.get("member_number"))
                or identifier
            )
            member_counts[label] = member_counts.get(label, 0) + 1
        unique_members = len(member_identifiers)

    scope_chart = None
    if config.member_binding == "extra":
        scope_chart = _chart_from_counts(
            "scope_breakdown",
            "Collection scope",
            "Member-level versus cooperative-level capture.",
            _value_counts(records, "collection_scope", choice_labels),
        )

    primary_breakdown = _categorical_breakdown_chart(records, schema, config, choice_labels)
    member_chart = None
    if model_slug != "members":
        member_chart = _chart_from_counts(
            "member_breakdown",
            "Top members represented",
            "Members contributing the most records in the current view.",
            member_counts,
            limit=ANALYTICS_MEMBER_LIMIT,
        )

    numeric_stats = _numeric_field_stats(records, schema, config)
    primary_numeric = numeric_stats[0] if numeric_stats else None

    cards = [
        {
            "id": "total_records",
            "label": "Total records",
            "value": _format_number(total_records),
            "helper_text": "Records in the current filtered view.",
            "tone": "primary",
        }
    ]

    if model_slug == "members":
        active_count = sum(1 for record in records if record.get("status") == Member.MemberStatus.ACTIVE)
        cards.extend(
            [
                {
                    "id": "active_members",
                    "label": "Active members",
                    "value": _format_number(active_count),
                    "helper_text": "Members currently marked active.",
                    "tone": "default",
                },
                {
                    "id": "recent_members",
                    "label": "Recent additions",
                    "value": _format_number(recent_records),
                    "helper_text": "Members added in the last 30 days.",
                    "tone": "accent",
                },
                {
                    "id": "latest_member",
                    "label": "Latest joined",
                    "value": _format_date(latest_activity),
                    "helper_text": "Newest member record in view.",
                    "tone": "default",
                },
            ]
        )
    else:
        if unique_members > 0:
            cards.append(
                {
                    "id": "unique_members",
                    "label": "Members represented",
                    "value": _format_number(unique_members),
                    "helper_text": "Distinct members linked to these records.",
                    "tone": "default",
                }
            )
        if primary_numeric:
            cards.append(
                {
                    "id": f"{primary_numeric['key']}_total",
                    "label": f"Total {primary_numeric['label']}",
                    "value": _format_number(primary_numeric["sum"]),
                    "helper_text": f"Average {primary_numeric['label'].lower()}: {_format_number(primary_numeric['average'])}.",
                    "tone": "accent",
                }
            )
        elif scope_chart:
            member_scope_count = sum(1 for record in records if record.get("collection_scope") == SCOPE_MEMBER)
            cards.append(
                {
                    "id": "member_scope_records",
                    "label": "Member-scoped records",
                    "value": _format_number(member_scope_count),
                    "helper_text": "Records tied to specific members.",
                    "tone": "accent",
                }
            )

        cards.append(
            {
                "id": "recent_activity",
                "label": "Recent activity",
                "value": _format_number(recent_records),
                "helper_text": "Records captured in the last 30 days.",
                "tone": "default",
            }
        )
        if len(cards) < 4:
            cards.append(
                {
                    "id": "latest_activity",
                    "label": "Latest activity",
                    "value": _format_date(latest_activity),
                    "helper_text": f"Most recent record by {timeline_label.lower()}.",
                    "tone": "default",
                }
            )

    highlights: list[dict[str, str]] = []
    if primary_breakdown and primary_breakdown["data"]:
        top_item = primary_breakdown["data"][0]
        highlights.append(
            {
                "label": primary_breakdown["title"],
                "value": f"{top_item['label']} ({_format_number(top_item['value'])})",
            }
        )
    if member_chart and member_chart["data"]:
        top_member = member_chart["data"][0]
        highlights.append(
            {
                "label": "Most represented member",
                "value": f"{top_member['label']} ({_format_number(top_member['value'])})",
            }
        )
    if primary_numeric:
        highlights.append(
            {
                "label": f"Peak {primary_numeric['label']}",
                "value": _format_number(primary_numeric["max"]),
            }
        )
    if latest_activity:
        highlights.append(
            {
                "label": "Latest activity date",
                "value": _format_date(latest_activity),
            }
        )

    charts = [
        chart
        for chart in (
            _timeline_chart(records, field_key=timeline_key, field_label=timeline_label),
            primary_breakdown,
            scope_chart if primary_breakdown is None or primary_breakdown["id"] != "scope_breakdown" else None,
            member_chart,
        )
        if chart is not None
    ]

    return {
        "model_slug": model_slug,
        "generated_at": datetime.utcnow().isoformat(),
        "total_records": total_records,
        "cards": cards[:4],
        "charts": charts[:3],
        "highlights": highlights[:4],
    }


def get_member_templates(cooperative: Cooperative, user: User) -> list[dict[str, Any]]:
    # Governance records still stay on the model workspace for capture, but we
    # expose their active templates here as well so member dashboard tables can
    # stay aligned with the same field definitions.
    targets = ["PRODUCTION", "LIVESTOCK", "GOVERNANCE", "FINANCE", "LAND", "HERD"]
    permissions: dict[str, bool] = {
        target: has_crm_permission(user, cooperative, get_crm_config({
            "PRODUCTION": "production",
            "LIVESTOCK": "livestock",
            "GOVERNANCE": "governance",
            "FINANCE": "finance",
            "LAND": "land",
            "HERD": "herds",
        }[target]).permission_module, "create")
        for target in targets
    }

    templates: list[dict[str, Any]] = []
    queryset = (
        FormTemplate.objects
        .filter(cooperative=cooperative, target_model__in=targets, status=FormTemplate.Status.ACTIVE)
        .select_related("created_by")
        .prefetch_related("fields")
        .order_by("target_model", "name")
    )
    for template in queryset:
        permission_snapshot = get_target_permission_snapshot(user, cooperative, template.target_model)
        if not (permission_snapshot["can_view"] or permission_snapshot["can_create"]):
            continue

        fields = []
        member_fields = []
        mapped_fields: set[str] = set()
        for field in template.fields.order_by("field_order", "created_at", "id"):
            mapped_fields.add(field.maps_to_model_field)
            field_data = {
                "id": str(field.id),
                "label": field.label,
                "display_type": field.display_type,
                "tag": field.tag,
                "field_order": field.field_order,
                "placeholder": field.placeholder,
                "help_text": field.help_text,
                "is_required": field.is_required,
                "is_model_required": field.is_model_required,
                "default_value": field.default_value,
                "maps_to_model_field": field.maps_to_model_field,
                "is_custom_field": field.is_custom_field,
                "options": field.options,
                "validation_rules": field.validation_rules,
                "conditional_rule": field.conditional_rule,
            }
            fields.append(field_data)
            if field.maps_to_model_field in {"member", "member_id", "member_number", "member_name", "collection_scope"}:
                member_fields.append(
                    {
                        "field_key": field.maps_to_model_field,
                        "label": field.label,
                        "display_type": field.display_type,
                        "is_required": field.is_required,
                    }
                )

        model_slug = TARGET_TO_MODEL_SLUG.get(template.target_model)
        if model_slug:
            config = get_crm_config(model_slug)
            discriminator = config.discriminator
            if config.member_binding == "extra" and discriminator.field_key not in mapped_fields:
                fields.insert(
                    0,
                    {
                        "id": f"system:{template.id}:{discriminator.field_key}",
                        "label": discriminator.label,
                        "display_type": discriminator.display_type,
                        "tag": discriminator.tag,
                        "field_order": -1,
                        "placeholder": discriminator.placeholder,
                        "help_text": discriminator.help_text,
                        "is_required": discriminator.is_required,
                        "is_model_required": discriminator.is_required,
                        "default_value": date.today().isoformat() if discriminator.display_type == "date" else "",
                        "maps_to_model_field": discriminator.field_key,
                        "is_custom_field": False,
                        "options": list(discriminator.options),
                        "validation_rules": discriminator.validation_rules,
                        "conditional_rule": None,
                        "is_system": True,
                    },
                )

        templates.append(
            {
                "id": str(template.id),
                "name": template.name,
                "description": template.description,
                "target_model": template.target_model,
                "target_model_display": template.get_target_model_display(),
                "is_default": template.is_default,
                "status": template.status,
                "field_count": len(fields),
                "fields": fields,
                "member_fields": member_fields,
                "has_member_field": any(item["field_key"] in {"member", "member_id", "member_number"} for item in member_fields),
                "can_create": permissions.get(template.target_model, False),
                "permissions": permission_snapshot,
                "created_at": template.created_at.isoformat(),
                "updated_at": template.updated_at.isoformat(),
            }
        )
    return templates


def _member_dashboard_field_preferences(cooperative: Cooperative) -> dict[str, dict[str, str | None]]:
    target_to_template: dict[str, FormTemplate] = {}
    target_models = {config.target_model for config in CRM_MODEL_CONFIG.values()}
    queryset = (
        FormTemplate.objects
        .filter(cooperative=cooperative, target_model__in=target_models, status=FormTemplate.Status.ACTIVE)
        .prefetch_related("fields")
        .order_by("target_model", "-is_default", "name", "-updated_at")
    )
    for template in queryset:
        target_to_template.setdefault(template.target_model, template)

    preferences: dict[str, dict[str, str | None]] = {}
    for model_slug, config in CRM_MODEL_CONFIG.items():
        if model_slug == "members":
            continue

        template = target_to_template.get(config.target_model)
        if template is not None:
            fields = [
                {
                    "field_key": field.maps_to_model_field,
                    "display_type": field.display_type,
                }
                for field in template.fields.order_by("field_order", "created_at", "id")
                if field.maps_to_model_field not in MEMBER_DASHBOARD_HIDDEN_FIELDS
            ]
        else:
            schema = build_schema(str(cooperative.id), model_slug)
            fields = [
                {
                    "field_key": field["field_key"],
                    "display_type": field["display_type"],
                }
                for field in schema["all_fields"]
                if field["field_key"] not in MEMBER_DASHBOARD_HIDDEN_FIELDS
            ]

        title_field = next(
            (
                field["field_key"]
                for field in fields
                if field["display_type"] not in {"date", "datetime"}
                and field["field_key"] != config.discriminator.field_key
            ),
            None,
        )
        if title_field is None and config.discriminator.display_type not in {"date", "datetime"}:
            title_field = config.discriminator.field_key

        date_field = (
            config.discriminator.field_key
            if config.discriminator.display_type in {"date", "datetime"}
            else next(
                (
                    field["field_key"]
                    for field in fields
                    if field["display_type"] in {"date", "datetime"}
                ),
                None,
            )
        )

        preferences[model_slug] = {
            "title_field": title_field,
            "date_field": date_field,
        }

    return preferences


def _member_dashboard_module_metadata(
    cooperative: Cooperative,
    *,
    field_preferences: dict[str, dict[str, str | None]] | None = None,
) -> dict[str, dict[str, Any]]:
    target_to_template: dict[str, FormTemplate] = {}
    target_models = {config.target_model for config in CRM_MODEL_CONFIG.values()}
    queryset = (
        FormTemplate.objects
        .filter(cooperative=cooperative, target_model__in=target_models, status=FormTemplate.Status.ACTIVE)
        .prefetch_related("fields")
        .order_by("target_model", "-is_default", "name", "-updated_at")
    )
    for template in queryset:
        target_to_template.setdefault(template.target_model, template)

    field_preferences = field_preferences or _member_dashboard_field_preferences(cooperative)
    metadata: dict[str, dict[str, Any]] = {}

    for model_slug, config in CRM_MODEL_CONFIG.items():
        if model_slug == "members":
            continue

        template = target_to_template.get(config.target_model)
        source = "schema"
        source_template_id: str | None = None
        fields: list[dict[str, Any]] = []
        seen: set[str] = set()

        def append_field(
            field_key: str,
            label: str,
            display_type: str,
            options: list[str] | tuple[str, ...] | None = None,
        ) -> None:
            if field_key in MEMBER_DASHBOARD_HIDDEN_FIELDS or field_key in seen:
                return
            seen.add(field_key)
            fields.append(
                {
                    "key": field_key,
                    "label": label,
                    "display_type": display_type,
                    "options": list(options or []),
                }
            )

        if template is not None:
            source = "template"
            source_template_id = str(template.id)
            for field in template.fields.order_by("field_order", "created_at", "id"):
                append_field(
                    field.maps_to_model_field,
                    field.label,
                    field.display_type,
                    field.options,
                )
            if config.discriminator.field_key not in seen and config.discriminator.field_key not in MEMBER_DASHBOARD_HIDDEN_FIELDS:
                fields.insert(
                    0,
                    {
                        "key": config.discriminator.field_key,
                        "label": config.discriminator.label,
                        "display_type": config.discriminator.display_type,
                        "options": list(config.discriminator.options),
                    },
                )
                seen.add(config.discriminator.field_key)
        else:
            schema = build_schema(str(cooperative.id), model_slug)
            for field in schema["all_fields"]:
                append_field(
                    field["field_key"],
                    field["label"],
                    field["display_type"],
                    field.get("options"),
                )

        date_field = field_preferences.get(model_slug, {}).get("date_field")
        table_columns = [
            field
            for field in fields
            if field["key"] != date_field
        ][:4]

        metadata[model_slug] = {
            "source": source,
            "source_template_id": source_template_id,
            "date_field": date_field,
            "title_field": field_preferences.get(model_slug, {}).get("title_field"),
            "table_columns": table_columns,
            "filter_fields": fields,
        }

    return metadata


def _dashboard_record_field_value(record: dict[str, Any], field_key: str | None) -> Any:
    if not field_key:
        return None
    display_key = f"{field_key}_display"
    if record.get(display_key) not in (None, ""):
        return record.get(display_key)
    return _get_record_value(record, field_key)


def _dashboard_record_title(record: dict[str, Any], model_slug: str, title_field_key: str | None) -> str:
    title_value = _dashboard_record_field_value(record, title_field_key)
    if title_value not in (None, ""):
        return _normalize_scalar(title_value)

    config = get_crm_config(model_slug)
    discriminator_value = _dashboard_record_field_value(record, config.discriminator.field_key)
    if discriminator_value not in (None, ""):
        return _normalize_scalar(discriminator_value)

    return config.model._meta.verbose_name.title()


def _dashboard_record_date(record: dict[str, Any], date_field_key: str | None) -> Any:
    value = _dashboard_record_field_value(record, date_field_key)
    if value not in (None, ""):
        return value
    return record.get("created_at") or record.get("updated_at")


def _latest_dashboard_record_date(rows: list[dict[str, Any]], date_field_key: str | None) -> str | None:
    dated_rows: list[tuple[date, Any]] = []
    for row in rows:
        raw_value = _dashboard_record_date(row, date_field_key)
        parsed = _parse_dateish(raw_value)
        if parsed is not None:
            dated_rows.append((parsed, raw_value))

    if dated_rows:
        _, raw_value = max(dated_rows, key=lambda item: item[0])
        return _normalize_scalar(raw_value)

    if not rows:
        return None
    fallback = rows[0].get("created_at") or rows[0].get("updated_at")
    return _normalize_scalar(fallback) if fallback not in (None, "") else None


def get_member_analytics(
    cooperative: Cooperative,
    member: Member,
    *,
    permissions: dict[str, dict[str, bool]] | None = None,
    field_preferences: dict[str, dict[str, str | None]] | None = None,
) -> dict[str, Any]:
    permissions = permissions or {
        slug: {"can_view": True, "can_create": True, "can_edit": True, "can_delete": True}
        for slug in CRM_MODEL_CONFIG
    }
    field_preferences = field_preferences or _member_dashboard_field_preferences(cooperative)

    def visible_records(slug: str) -> list[dict[str, Any]]:
        if not permissions.get(slug, {}).get("can_view"):
            return []
        return get_member_records(
            cooperative,
            member,
            slug,
            page=1,
            page_size=10000,
        )["data"]

    production_rows = visible_records("production")
    livestock_rows = visible_records("livestock")
    governance_rows = visible_records("governance")
    finance_rows = visible_records("finance")
    land_rows = visible_records("land")
    herd_rows = visible_records("herds")

    return {
        "production": {
            "total_records": len(production_rows),
            "latest_date": _latest_dashboard_record_date(
                production_rows,
                field_preferences.get("production", {}).get("date_field"),
            ),
            "seasons": sorted(
                {
                    row.get("extra_data", {}).get("season")
                    for row in production_rows
                    if row.get("extra_data", {}).get("season")
                }
            ),
        },
        "livestock": {
            "total_events": len(livestock_rows),
            "vaccinations": sum(1 for row in livestock_rows if row.get("event_type") == "VACCINATION"),
            "treatments": sum(1 for row in livestock_rows if row.get("event_type") == "TREATMENT"),
            "latest_event": _latest_dashboard_record_date(
                livestock_rows,
                field_preferences.get("livestock", {}).get("date_field"),
            ),
        },
        "governance": {
            "total_records": len(governance_rows),
            "meetings": sum(1 for row in governance_rows if row.get("record_type") == "MEETING"),
            "certificates": sum(1 for row in governance_rows if row.get("record_type") == "CERTIFICATE"),
            "latest_record": _latest_dashboard_record_date(
                governance_rows,
                field_preferences.get("governance", {}).get("date_field"),
            ),
        },
        "financial": {
            "total_records": len(finance_rows),
            "contributions": sum(1 for row in finance_rows if row.get("category") == "CONTRIBUTION"),
            "loans": sum(1 for row in finance_rows if row.get("category") == "LOAN_REPAY"),
            "latest_transaction": _latest_dashboard_record_date(
                finance_rows,
                field_preferences.get("finance", {}).get("date_field"),
            ),
        },
        "assets": {
            "land_records": len(land_rows),
            "herd_records": len(herd_rows),
        },
        "overall": {
            "total_activities": len(production_rows) + len(livestock_rows) + len(governance_rows) + len(finance_rows) + len(land_rows) + len(herd_rows),
            "member_since": member.created_at.isoformat(),
            "status": member.status,
        },
    }


def get_member_recent_activity(
    cooperative: Cooperative,
    member: Member,
    *,
    permissions: dict[str, dict[str, bool]] | None = None,
    field_preferences: dict[str, dict[str, str | None]] | None = None,
    limit: int = 8,
) -> list[dict[str, Any]]:
    permissions = permissions or {
        slug: {"can_view": True, "can_create": True, "can_edit": True, "can_delete": True}
        for slug in CRM_MODEL_CONFIG
    }
    field_preferences = field_preferences or _member_dashboard_field_preferences(cooperative)

    activities: list[dict[str, Any]] = []

    for model_slug in ("production", "livestock", "governance", "finance", "land", "herds"):
        if not permissions.get(model_slug, {}).get("can_view"):
            continue

        rows = get_member_records(cooperative, member, model_slug, page=1, page_size=4)["data"]
        for row in rows:
            preferences = field_preferences.get(model_slug, {})
            activities.append(
                {
                    "type": model_slug,
                    "title": _dashboard_record_title(row, model_slug, preferences.get("title_field")),
                    "date": _normalize_scalar(_dashboard_record_date(row, preferences.get("date_field"))),
                    "data": row,
                }
            )

    activities.sort(
        key=lambda item: _parse_dateish(item.get("date")) or date.min,
        reverse=True,
    )
    return activities[:limit]


def get_member_dashboard_payload(cooperative: Cooperative, member: Member, user: User) -> dict[str, Any]:
    permissions = {
        slug: get_model_permission_snapshot(user, cooperative, slug)
        for slug in CRM_MODEL_CONFIG
    }
    field_preferences = _member_dashboard_field_preferences(cooperative)
    module_metadata = _member_dashboard_module_metadata(cooperative, field_preferences=field_preferences)
    member_filters = {
        "member_id": str(member.id),
        "member_number": member.member_number,
    }
    module_analytics = {
        slug: get_model_analytics(
            cooperative,
            slug,
            filters=member_filters,
        )
        for slug in ("production", "livestock", "governance", "finance", "land", "herds")
        if permissions.get(slug, {}).get("can_view")
    }

    return {
        "member": {
            "id": str(member.id),
            "member_number": member.member_number,
            "display_name": member.get_display_name(),
            "status": member.status,
            "created_at": member.created_at.isoformat(),
            "extra_data": member.extra_data or {},
        },
        "member_status_options": [
            {
                "value": str(value),
                "label": str(label),
            }
            for value, label in Member.MemberStatus.choices
        ],
        "analytics": get_member_analytics(
            cooperative,
            member,
            permissions=permissions,
            field_preferences=field_preferences,
        ),
        "module_analytics": module_analytics,
        "module_metadata": module_metadata,
        "recent_activity": get_member_recent_activity(
            cooperative,
            member,
            permissions=permissions,
            field_preferences=field_preferences,
        ),
        "permissions": permissions,
    }


def _sheet_cell(column_index: int, row_index: int) -> str:
    name = ""
    index = column_index
    while index >= 0:
        name = chr(index % 26 + 65) + name
        index = index // 26 - 1
    return f"{name}{row_index}"


def _xlsx_rows_from_records(rows: list[list[str]]) -> bytes:
    shared_strings: list[str] = []
    shared_index: dict[str, int] = {}

    def shared_id(value: str) -> int:
        if value not in shared_index:
            shared_index[value] = len(shared_strings)
            shared_strings.append(value)
        return shared_index[value]

    sheet_rows: list[str] = []
    for row_idx, row in enumerate(rows, start=1):
        cells: list[str] = []
        for col_idx, value in enumerate(row):
            ref = _sheet_cell(col_idx, row_idx)
            text = "" if value is None else str(value)
            idx = shared_id(text)
            cells.append(f'<c r="{ref}" t="s"><v>{idx}</v></c>')
        sheet_rows.append(f'<row r="{row_idx}">{"".join(cells)}</row>')

    shared_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        f'count="{len(shared_strings)}" uniqueCount="{len(shared_strings)}">'
        + "".join(f"<si><t>{xml_escape(value)}</t></si>" for value in shared_strings)
        + "</sst>"
    )
    sheet_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(sheet_rows)}</sheetData>'
        '</worksheet>'
    )
    workbook_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="Export" sheetId="1" r:id="rId1"/></sheets>'
        '</workbook>'
    )
    workbook_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
        '</Relationships>'
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '</Relationships>'
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
        '</Types>'
    )

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as workbook:
        workbook.writestr("[Content_Types].xml", content_types)
        workbook.writestr("_rels/.rels", root_rels)
        workbook.writestr("xl/workbook.xml", workbook_xml)
        workbook.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        workbook.writestr("xl/worksheets/sheet1.xml", sheet_xml)
        workbook.writestr("xl/sharedStrings.xml", shared_xml)
    return buffer.getvalue()


def _xlsx_rows_from_upload(file_bytes: bytes) -> list[dict[str, str]]:
    ns = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    rows_out: list[dict[str, str]] = []

    with zipfile.ZipFile(io.BytesIO(file_bytes)) as workbook:
        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in workbook.namelist():
            shared_root = ET.fromstring(workbook.read("xl/sharedStrings.xml"))
            shared_strings = [
                "".join(text or "" for text in si.itertext())
                for si in shared_root.findall("x:si", ns)
            ]

        sheet_name = "xl/worksheets/sheet1.xml"
        root = ET.fromstring(workbook.read(sheet_name))
        rows = root.findall(".//x:sheetData/x:row", ns)
        if not rows:
            return []

        parsed_rows: list[list[str]] = []
        for row in rows:
            values: list[str] = []
            for cell in row.findall("x:c", ns):
                cell_type = cell.attrib.get("t")
                value_node = cell.find("x:v", ns)
                text = value_node.text if value_node is not None and value_node.text is not None else ""
                if cell_type == "s":
                    values.append(shared_strings[int(text)] if text else "")
                elif cell_type == "inlineStr":
                    inline = cell.find("x:is/x:t", ns)
                    values.append(inline.text if inline is not None and inline.text is not None else "")
                else:
                    values.append(text)
            parsed_rows.append(values)

        if not parsed_rows:
            return []

        headers = parsed_rows[0]
        for row in parsed_rows[1:]:
            if not any(str(cell).strip() for cell in row):
                continue
            rows_out.append(
                {
                    headers[idx]: row[idx] if idx < len(row) else ""
                    for idx in range(len(headers))
                    if headers[idx]
                }
            )
    return rows_out


def parse_import_file(uploaded_file) -> list[dict[str, str]]:
    name = (uploaded_file.name or "").lower()
    file_bytes = uploaded_file.read()
    uploaded_file.seek(0)

    try:
        if name.endswith(".csv"):
            text = file_bytes.decode("utf-8-sig")
            return [dict(row) for row in csv.DictReader(io.StringIO(text))]
        if name.endswith(".xlsx"):
            return _xlsx_rows_from_upload(file_bytes)
    except Exception as exc:  # noqa: BLE001 - normalize parse failures for the API response
        raise ValueError(f"Could not read the uploaded file: {exc}") from exc
    raise ValueError("Only CSV and Excel (.xlsx) files are supported.")


def _prepare_import_row(
    cooperative: Cooperative,
    model_slug: str,
    row: dict[str, str],
    *,
    member_context: Member | None = None,
) -> dict[str, Any]:
    payload = {key.strip(): value for key, value in row.items() if key and value not in (None, "")}
    if member_context is not None:
        payload.setdefault("collection_scope", SCOPE_MEMBER)
        payload.setdefault("member_id", str(member_context.id))
        payload.setdefault("member_number", member_context.member_number)
    return payload


def _import_headers(
    schema: dict[str, Any],
    *,
    member_context: Member | None = None,
) -> tuple[set[str], set[str]]:
    editable_headers = {
        field["field_key"]
        for field in schema["all_fields"]
        if not (member_context is not None and field["field_key"] in MEMBER_CONTEXT_HIDDEN_IMPORT_FIELDS)
    }
    required_headers = {
        field["field_key"]
        for field in schema["all_fields"]
        if field["is_required"] and not field["is_system"] and field["field_key"] in editable_headers
    }
    return editable_headers, required_headers


def import_records(
    cooperative: Cooperative,
    user: User,
    model_slug: str,
    rows: list[dict[str, str]],
    *,
    member_context: Member | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    schema = build_schema(cooperative.id, model_slug)
    config = get_crm_config(model_slug)
    editable_headers, required_headers = _import_headers(schema, member_context=member_context)
    header_errors = []
    if rows:
        found_headers = set(rows[0].keys())
        unknown_headers = sorted(found_headers - editable_headers)
        if unknown_headers:
            header_errors.append(f"Unknown headers: {', '.join(unknown_headers)}")
        missing_required = sorted(required_headers - found_headers)
        if missing_required:
            header_errors.append(f"Missing required headers: {', '.join(missing_required)}")
    else:
        found_headers = set()
        unknown_headers = []
        missing_required = sorted(required_headers)

    if not rows:
        header_errors.append("The import file has no data rows.")

    error_rows: list[dict[str, Any]] = []
    created_ids: list[str] = []
    success_count = 0

    if header_errors:
        return {
            "success": False,
            "parse_error": None,
            "dry_run": dry_run,
            "total_rows": len(rows),
            "success_count": 0,
            "error_count": len(header_errors),
            "imported_count": 0,
            "created_ids": [],
            "header_validation": {
                "valid": False,
                "errors": header_errors,
                "headers_found": sorted(found_headers),
                "skeleton_present": config.discriminator.field_key in found_headers or member_context is not None or config.discriminator.is_system,
                "unknown_headers": unknown_headers,
                "missing_required": missing_required,
            },
            "row_validation": {
                "total": len(rows),
                "valid_count": 0,
                "error_count": 0,
            },
            "error_rows": [],
            "skipped_unknown": [],
        }

    for index, row in enumerate(rows, start=2):
        try:
            payload = _prepare_import_row(cooperative, model_slug, row, member_context=member_context)
            if not dry_run:
                saved = save_record(cooperative, user, model_slug, payload)
                created_ids.append(saved["id"])
            success_count += 1
        except Exception as exc:  # noqa: BLE001 - collect row-level import errors
            error_rows.append(
                {
                    "row_number": index,
                    "errors": [str(exc)],
                    "raw_row": row,
                }
            )

    return {
        "success": len(error_rows) == 0,
        "parse_error": None,
        "dry_run": dry_run,
        "total_rows": len(rows),
        "success_count": success_count,
        "error_count": len(error_rows) + len(header_errors),
        "imported_count": 0 if dry_run else len(created_ids),
        "created_ids": created_ids,
        "header_validation": {
            "valid": len(header_errors) == 0,
            "errors": header_errors,
            "headers_found": sorted(found_headers),
            "skeleton_present": config.discriminator.field_key in found_headers or member_context is not None or config.discriminator.is_system,
            "unknown_headers": unknown_headers,
            "missing_required": missing_required,
        },
        "row_validation": {
            "total": len(rows),
            "valid_count": success_count,
            "error_count": len(error_rows),
        },
        "error_rows": error_rows,
        "skipped_unknown": [],
    }


def build_import_template_response(
    cooperative_id: str,
    model_slug: str,
    *,
    member_context: Member | None = None,
) -> HttpResponse:
    schema = build_schema(cooperative_id, model_slug)
    headers = [
        field["field_key"]
        for field in schema["all_fields"]
        if not field["is_system"] and not (member_context is not None and field["field_key"] in MEMBER_CONTEXT_HIDDEN_IMPORT_FIELDS)
    ]
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(headers)
    response = HttpResponse(buffer.getvalue(), content_type="text/csv")
    response["Content-Disposition"] = f'attachment; filename="{model_slug}_import_template.csv"'
    return response


def export_records(
    cooperative: Cooperative,
    model_slug: str,
    *,
    fmt: str = "csv",
    search: str = "",
    filters: dict[str, str] | None = None,
    order_by: str | None = None,
) -> HttpResponse:
    result = list_records(
        cooperative,
        model_slug,
        page=1,
        page_size=100000,
        search=search,
        filters=filters,
        order_by=order_by,
    )
    schema = build_schema(cooperative.id, model_slug)
    export_fields = [field["field_key"] for field in schema["all_fields"]]
    rows = [[field for field in export_fields]]
    rows.extend(
        [
            _normalize_scalar(_get_record_value(record, field))
            for field in export_fields
        ]
        for record in result["data"]
    )

    if fmt == "xlsx":
        content = _xlsx_rows_from_records(rows)
        response = HttpResponse(
            content,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = f'attachment; filename="{model_slug}_export.xlsx"'
        return response

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerows(rows)
    response = HttpResponse(buffer.getvalue(), content_type="text/csv")
    response["Content-Disposition"] = f'attachment; filename="{model_slug}_export.csv"'
    return response
