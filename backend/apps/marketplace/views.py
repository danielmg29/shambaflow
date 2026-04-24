from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
import json
from pathlib import Path
import uuid

from django.conf import settings
from django.db import transaction
from django.db.models import Avg, Q
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from django.utils.html import strip_tags
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.marketplace.chat import (
    _file_metadata as chat_file_metadata,
    build_chat_inbox_payload,
    broadcast_message_created,
    broadcast_thread_read,
    buyer_company_name as chat_buyer_company_name,
    conversation_queryset as chat_conversation_queryset,
    has_chat_access as chat_has_chat_access,
    infer_message_type,
    message_notification_snippet,
    resolve_chat_thread_context,
    serialize_chat_message,
    serialize_chat_thread,
    total_unread_messages_for_user,
)
from apps.marketplace.sellapay import (
    SellapayApiError,
    SellapayConfigurationError,
    normalize_sellapay_phone,
    request_stk_push,
)
from core.models import (
    Bid,
    BidDocument,
    Buyer,
    BuyerProfile,
    Cooperative,
    Tender,
    TenderMarketplaceAccessPayment,
    TenderMarketplaceBanner,
    TenderMessage,
)
from core.services.notifications import notifications


DEFAULT_REGIONS = [
    "Nairobi County",
    "Kiambu County",
    "Murang'a County",
    "Nyeri County",
    "Nakuru County",
    "Uasin Gishu County",
    "Kisumu County",
    "Mombasa County",
]

VISIBLE_BID_STATUSES = [
    Bid.BidStatus.SUBMITTED,
    Bid.BidStatus.SHORTLISTED,
    Bid.BidStatus.ACCEPTED,
]
EDITABLE_BID_STATUSES = [
    Bid.BidStatus.DRAFT,
    Bid.BidStatus.SUBMITTED,
    Bid.BidStatus.SHORTLISTED,
]
CHAT_READY_BID_STATUSES = [
    Bid.BidStatus.SUBMITTED,
    Bid.BidStatus.SHORTLISTED,
    Bid.BidStatus.ACCEPTED,
]


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


def _decimal_to_float(value: Decimal | None) -> float | None:
    if value is None:
        return None
    return float(value)


def _to_text(value: str) -> str:
    return strip_tags(value or "").strip()


def _format_currency_value(value: Decimal | float | None) -> str:
    if value is None:
        return "Not set"
    return f"KES {float(value):,.0f}"


def _format_number(value: float | int | None, digits: int = 0) -> str:
    if value is None:
        return "0"
    if digits <= 0:
        return f"{int(round(float(value))):,}"
    return f"{float(value):,.{digits}f}"


def _file_metadata(request, file_field) -> dict | None:
    return chat_file_metadata(request, file_field)


def _shift_month(value: date, offset: int) -> date:
    month_index = value.month - 1 + offset
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    return date(year, month, 1)


def _last_month_starts(count: int = 6) -> list[date]:
    start = timezone.localdate().replace(day=1)
    return [_shift_month(start, -(count - index - 1)) for index in range(count)]


def _month_label(value: date) -> str:
    return value.strftime("%b %Y")


def _refresh_tender_bid_totals(tender: Tender) -> None:
    next_total = Bid.objects.filter(tender=tender, status__in=VISIBLE_BID_STATUSES).count()
    if tender.total_bids != next_total:
        tender.total_bids = next_total
        tender.save(update_fields=["total_bids"])


def _buyer_company_name(tender: Tender) -> str:
    return chat_buyer_company_name(tender)


def _buyer_company_snapshot(tender: Tender, request=None) -> dict:
    profile = getattr(tender.buyer, "profile", None)
    return {
        "company_name": _buyer_company_name(tender),
        "buyer_type": profile.buyer_type if profile else None,
        "buyer_type_display": profile.get_buyer_type_display() if profile else None,
        "region": profile.region if profile else "",
        "website": profile.website if profile else "",
        "description": profile.description if profile else "",
        "description_text": _to_text(profile.description) if profile else "",
        "company_logo": _absolute_media_url(request, profile.company_logo) if profile else None,
    }


def _serialize_marketplace_banner(banner: TenderMarketplaceBanner) -> dict:
    return {
        "id": str(banner.id),
        "placement": banner.placement,
        "eyebrow": banner.eyebrow,
        "title": banner.title,
        "body": banner.body,
        "highlight": banner.highlight,
        "surface_theme": banner.surface_theme,
        "primary_cta_label": banner.primary_cta_label,
        "primary_cta_href": banner.primary_cta_href,
        "secondary_cta_label": banner.secondary_cta_label,
        "secondary_cta_href": banner.secondary_cta_href,
    }


def _active_marketplace_banners(*, placement: str) -> list[dict]:
    now = timezone.now()
    banners = (
        TenderMarketplaceBanner.objects
        .filter(placement=placement, is_active=True)
        .filter(Q(starts_at__isnull=True) | Q(starts_at__lte=now))
        .filter(Q(ends_at__isnull=True) | Q(ends_at__gte=now))
        .order_by("sort_order", "-created_at")
    )
    return [_serialize_marketplace_banner(banner) for banner in banners[:4]]


def _marketplace_access_price_kes() -> Decimal:
    return Decimal(str(getattr(settings, "TENDER_MARKETPLACE_ACCESS_PRICE_KES", "1")))


def _marketplace_access_days() -> int:
    return int(getattr(settings, "TENDER_MARKETPLACE_ACCESS_DAYS", 30))


def _marketplace_payment_reference() -> str:
    return f"TM{uuid.uuid4().hex[:12].upper()}"


def _marketplace_billing_phone_number(cooperative: Cooperative) -> str:
    chair = getattr(cooperative, "chair", None)
    return (
        getattr(chair, "phone_number", "")
        or cooperative.phone_number
        or ""
    )


def _serialize_marketplace_access_payment(
    payment: TenderMarketplaceAccessPayment | None,
) -> dict | None:
    if payment is None:
        return None
    return {
        "id": str(payment.id),
        "status": payment.status,
        "reference": payment.reference,
        "amount_kes": float(payment.amount_kes),
        "phone_number": payment.phone_number,
        "provider_transaction_id": payment.provider_transaction_id,
        "provider_message": payment.provider_message,
        "created_at": payment.created_at.isoformat(),
        "activated_at": payment.activated_at.isoformat() if payment.activated_at else None,
        "access_expires_at": payment.access_expires_at.isoformat() if payment.access_expires_at else None,
    }


def _cooperative_has_marketplace_access(cooperative: Cooperative) -> bool:
    if cooperative.subscription_tier != Cooperative.SubscriptionTier.PREMIUM:
        return False
    if cooperative.subscription_expires_at is None:
        return True
    return cooperative.subscription_expires_at >= timezone.now()


def _cooperative_marketplace_access_snapshot(cooperative: Cooperative) -> dict:
    latest_payment = (
        TenderMarketplaceAccessPayment.objects
        .filter(cooperative=cooperative)
        .order_by("-created_at")
        .first()
    )
    billing_phone = _marketplace_billing_phone_number(cooperative)
    try:
        normalized_phone = normalize_sellapay_phone(billing_phone) if billing_phone else None
    except ValueError:
        normalized_phone = None

    has_access = _cooperative_has_marketplace_access(cooperative)
    return {
        "has_access": has_access,
        "requires_payment": not has_access,
        "subscription_tier": cooperative.subscription_tier,
        "access_expires_at": cooperative.subscription_expires_at.isoformat()
        if cooperative.subscription_expires_at
        else None,
        "amount_kes": float(_marketplace_access_price_kes()),
        "access_window_days": _marketplace_access_days(),
        "billing_phone_number": billing_phone,
        "billing_phone_local": normalized_phone,
        "latest_payment": _serialize_marketplace_access_payment(latest_payment),
    }


def _activate_marketplace_access(
    cooperative: Cooperative,
    *,
    payment: TenderMarketplaceAccessPayment,
) -> tuple[datetime, datetime]:
    now = timezone.now()
    access_anchor = (
        cooperative.subscription_expires_at
        if cooperative.subscription_expires_at and cooperative.subscription_expires_at > now
        else now
    )
    access_expires_at = access_anchor + timedelta(days=_marketplace_access_days())

    cooperative.subscription_tier = Cooperative.SubscriptionTier.PREMIUM
    cooperative.subscription_expires_at = access_expires_at
    cooperative.save(update_fields=["subscription_tier", "subscription_expires_at", "updated_at"])

    payment.status = TenderMarketplaceAccessPayment.Status.ACTIVE
    payment.activated_at = now
    payment.access_expires_at = access_expires_at
    payment.save(update_fields=["status", "activated_at", "access_expires_at", "updated_at"])

    return now, access_expires_at


def _get_buyer_context(user) -> tuple[tuple[Buyer, BuyerProfile], Response | None]:
    if not user.is_buyer:
        return (None, None), Response({"error": "Buyer access required."}, status=403)

    profile, _ = BuyerProfile.objects.get_or_create(
        user=user,
        defaults={
            "company_name": user.full_name or user.email,
            "buyer_type": BuyerProfile.BuyerType.RETAILER,
        },
    )
    buyer, _ = Buyer.objects.get_or_create(user=user, defaults={"profile": profile})
    if buyer.profile_id != profile.id:
        buyer.profile = profile
        buyer.save(update_fields=["profile"])

    return (buyer, profile), None


def _get_cooperative_context(
    user,
    *,
    require_marketplace_access: bool = False,
) -> tuple[Cooperative | None, Response | None]:
    if user.is_buyer or not user.cooperative_id:
        return None, Response({"error": "Cooperative access required."}, status=403)
    if not user.is_chair:
        return None, Response(
            {"error": "Only cooperative chair accounts can access the tender marketplace for now."},
            status=403,
        )

    cooperative = Cooperative.objects.select_related("chair").filter(pk=user.cooperative_id).first()
    if cooperative is None:
        return None, Response({"error": "Cooperative not found."}, status=404)
    if require_marketplace_access:
        access = _cooperative_marketplace_access_snapshot(cooperative)
        if access["requires_payment"]:
            return None, Response(
                {
                    "error": "Tender marketplace access requires an active cooperative payment.",
                    "code": "MARKETPLACE_PAYMENT_REQUIRED",
                    "access": access,
                },
                status=402,
            )
    return cooperative, None


def _build_onboarding_payload(user, profile: BuyerProfile, request=None) -> dict:
    steps = [
        {
            "id": "account_contact",
            "title": "Account Contact",
            "description": "Confirm the person responsible for sourcing and the phone number buyers will use.",
            "complete": bool(user.first_name.strip() and user.last_name.strip() and user.phone_number.strip()),
            "fields": ["first_name", "last_name", "phone_number"],
        },
        {
            "id": "company_profile",
            "title": "Company Profile",
            "description": "Add the organisation details cooperatives need before they respond to your tenders.",
            "complete": bool(profile.company_name.strip() and profile.buyer_type and profile.region.strip()),
            "fields": ["company_name", "buyer_type", "region"],
        },
        {
            "id": "sourcing_preferences",
            "title": "Sourcing Preferences",
            "description": "Tell ShambaFlow what categories and sourcing regions matter to your team.",
            "complete": bool(profile.interested_categories and profile.preferred_regions),
            "fields": ["interested_categories", "preferred_regions"],
        },
        {
            "id": "company_story",
            "title": "Buyer Story",
            "description": "Add context about your sourcing needs so cooperatives can respond with the right proposals.",
            "complete": bool(_to_text(profile.description)),
            "fields": ["description"],
        },
    ]

    completed_steps = sum(1 for step in steps if step["complete"])
    completion_percent = round(completed_steps / len(steps) * 100)
    missing_fields = [field for step in steps if not step["complete"] for field in step["fields"]]

    return {
        "is_complete": completed_steps == len(steps),
        "completion_percent": completion_percent,
        "completed_steps": completed_steps,
        "total_steps": len(steps),
        "steps": steps,
        "missing_fields": missing_fields,
        "buyer": {
            "company_name": profile.company_name,
            "buyer_type": profile.buyer_type,
            "buyer_type_display": profile.get_buyer_type_display(),
            "company_logo": _absolute_media_url(request, profile.company_logo),
            "region": profile.region,
            "registration_number": profile.registration_number,
            "physical_address": profile.physical_address,
            "website": profile.website,
            "description": profile.description,
            "interested_categories": profile.interested_categories,
            "preferred_regions": profile.preferred_regions,
        },
        "contact": {
            "first_name": user.first_name,
            "last_name": user.last_name,
            "email": user.email,
            "phone_number": user.phone_number,
            "is_email_verified": user.is_email_verified,
            "is_phone_verified": user.is_phone_verified,
        },
        "category_options": [
            {"value": value, "label": label}
            for value, label in Tender.ProductCategory.choices
        ],
        "suggested_regions": DEFAULT_REGIONS,
    }


def _serialize_tender(tender: Tender) -> dict:
    return {
        "id": str(tender.id),
        "title": tender.title,
        "product_category": tender.product_category,
        "product_category_display": tender.get_product_category_display(),
        "product_name": tender.product_name,
        "status": tender.status,
        "status_display": tender.get_status_display(),
        "eligibility_tier": tender.eligibility_tier,
        "eligibility_tier_display": tender.get_eligibility_tier_display(),
        "quantity_kg_min": _decimal_to_float(tender.quantity_kg_min),
        "quantity_kg_max": _decimal_to_float(tender.quantity_kg_max),
        "quality_specs": tender.quality_specs,
        "quality_specs_text": _to_text(tender.quality_specs),
        "delivery_location": tender.delivery_location,
        "delivery_start": tender.delivery_start.isoformat(),
        "delivery_end": tender.delivery_end.isoformat(),
        "bid_deadline": tender.bid_deadline.isoformat(),
        "indicative_price_min_ksh": _decimal_to_float(tender.indicative_price_min_ksh),
        "indicative_price_max_ksh": _decimal_to_float(tender.indicative_price_max_ksh),
        "is_boosted": tender.is_boosted,
        "min_capacity_index": tender.min_capacity_index,
        "total_bids": tender.total_bids,
        "published_at": tender.published_at.isoformat() if tender.published_at else None,
        "closed_at": tender.closed_at.isoformat() if tender.closed_at else None,
        "created_at": tender.created_at.isoformat(),
        "updated_at": tender.updated_at.isoformat(),
        "is_deadline_passed": tender.bid_deadline <= timezone.now(),
        "href": f"/marketplace/tenders/{tender.id}",
    }


def _serialize_tender_document(document, request=None) -> dict:
    return {
        "id": str(document.id),
        "title": document.title,
        "file": _absolute_media_url(request, document.file),
        "uploaded_at": document.created_at.isoformat(),
    }


def _serialize_bid_document(document, request=None) -> dict:
    return {
        "id": str(document.id),
        "title": document.title,
        "file": _absolute_media_url(request, document.file),
        "uploaded_at": document.created_at.isoformat(),
    }


def _serialize_bid(bid: Bid, request=None) -> dict:
    cooperative = bid.cooperative
    capacity_metric = getattr(cooperative, "capacity_metric", None)
    reputation_score = getattr(cooperative, "reputation_score", None)
    narrative_text = _to_text(bid.narrative)
    return {
        "id": str(bid.id),
        "status": bid.status,
        "status_display": bid.get_status_display(),
        "cooperative_id": str(cooperative.id),
        "cooperative_name": cooperative.name,
        "cooperative_region": cooperative.region,
        "offered_quantity_kg": _decimal_to_float(bid.offered_quantity_kg),
        "offered_price_ksh": _decimal_to_float(bid.offered_price_ksh),
        "proposed_delivery_date": bid.proposed_delivery_date.isoformat(),
        "submitted_at": bid.submitted_at.isoformat() if bid.submitted_at else None,
        "created_at": bid.created_at.isoformat(),
        "updated_at": bid.updated_at.isoformat(),
        "narrative": bid.narrative,
        "narrative_text": narrative_text,
        "terms_notes": bid.terms_notes,
        "revision_number": bid.revision_number,
        "capacity_index": _decimal_to_float(getattr(capacity_metric, "overall_index", None)),
        "is_premium_eligible": bool(getattr(capacity_metric, "is_premium_eligible", False)),
        "credibility_score": _decimal_to_float(getattr(reputation_score, "credibility_score", None)),
        "completion_rate": _decimal_to_float(getattr(reputation_score, "completion_rate", None)),
        "documents": [_serialize_bid_document(document, request=request) for document in bid.documents.all()],
    }


def _serialize_message(message: TenderMessage, request=None, viewer=None) -> dict:
    return serialize_chat_message(message, request=request, viewer=viewer)


def _cooperative_capacity_snapshot(cooperative: Cooperative) -> dict:
    capacity_metric = getattr(cooperative, "capacity_metric", None)
    return {
        "capacity_index": _decimal_to_float(getattr(capacity_metric, "overall_index", None)),
        "is_premium_eligible": bool(getattr(capacity_metric, "is_premium_eligible", False)),
        "is_verified": bool(getattr(cooperative, "is_verified", False)),
    }


def _tender_eligibility(tender: Tender, cooperative: Cooperative) -> dict:
    now = timezone.now()
    snapshot = _cooperative_capacity_snapshot(cooperative)
    capacity_index = snapshot["capacity_index"] or 0

    if tender.status not in {Tender.TenderStatus.PUBLISHED, Tender.TenderStatus.UNDER_REVIEW}:
        reason = f"This tender is {tender.get_status_display().lower()}."
        return {**snapshot, "is_eligible": False, "reason": reason}

    if tender.bid_deadline <= now and tender.status != Tender.TenderStatus.UNDER_REVIEW:
        return {**snapshot, "is_eligible": False, "reason": "The bid deadline has already passed."}

    if capacity_index < tender.min_capacity_index:
        return {
            **snapshot,
            "is_eligible": False,
            "reason": f"Your cooperative needs {max(tender.min_capacity_index - int(round(capacity_index)), 0)} more capacity points for this tender.",
        }

    if tender.eligibility_tier == Tender.EligibilityTier.PREMIUM:
        if not snapshot["is_verified"]:
            return {
                **snapshot,
                "is_eligible": False,
                "reason": "Premium tenders require a verified cooperative profile.",
            }
        if not snapshot["is_premium_eligible"]:
            return {
                **snapshot,
                "is_eligible": False,
                "reason": "Premium tenders require stronger CRM performance and certification readiness.",
            }

    return {**snapshot, "is_eligible": True, "reason": "Eligible to bid."}


def _conversation_queryset(tender: Tender, cooperative: Cooperative):
    return chat_conversation_queryset(tender, cooperative)


def _has_chat_access(tender: Tender, cooperative: Cooperative) -> bool:
    return chat_has_chat_access(tender, cooperative)


def _message_summary_for_buyer(tender: Tender) -> dict[str, dict]:
    summaries: dict[str, dict] = defaultdict(
        lambda: {
            "messages_count": 0,
            "unread_messages": 0,
            "last_message_at": None,
        }
    )

    for message in TenderMessage.objects.filter(tender=tender).select_related("sender", "recipient_cooperative"):
        cooperative_id = (
            str(message.sender.cooperative_id)
            if message.sender.cooperative_id
            else str(message.recipient_cooperative_id)
            if message.recipient_cooperative_id
            else None
        )
        if cooperative_id is None:
            continue

        summary = summaries[cooperative_id]
        summary["messages_count"] += 1
        summary["last_message_at"] = message.created_at.isoformat()
        if message.sender.cooperative_id and not message.is_read:
            summary["unread_messages"] += 1

    return summaries


def _message_summary_for_cooperative(tender: Tender, cooperative: Cooperative) -> dict:
    messages = list(_conversation_queryset(tender, cooperative))
    unread = sum(
        1
        for message in messages
        if message.sender_id == tender.buyer.user_id and not message.is_read
    )
    return {
        "messages_count": len(messages),
        "unread_messages": unread,
        "last_message_at": messages[-1].created_at.isoformat() if messages else None,
    }


def _build_buyer_dashboard_analytics(tenders_queryset, bids_queryset) -> dict:
    tenders = list(tenders_queryset)
    bids = list(bids_queryset)

    month_starts = _last_month_starts(6)
    monthly_tenders = {month: 0 for month in month_starts}
    monthly_bids = {month: 0 for month in month_starts}

    for tender in tenders:
        pivot = (tender.published_at or tender.created_at).date().replace(day=1)
        if pivot in monthly_tenders:
            monthly_tenders[pivot] += 1

    for bid in bids:
        pivot = (bid.submitted_at or bid.created_at).date().replace(day=1)
        if pivot in monthly_bids:
            monthly_bids[pivot] += 1

    category_counts: dict[str, int] = defaultdict(int)
    for tender in tenders:
        category_counts[tender.get_product_category_display()] += 1
    if not category_counts:
        for _, label in Tender.ProductCategory.choices[:4]:
            category_counts[label] = 0

    bid_status_counts = {
        "Submitted": sum(1 for bid in bids if bid.status == Bid.BidStatus.SUBMITTED),
        "Shortlisted": sum(1 for bid in bids if bid.status == Bid.BidStatus.SHORTLISTED),
        "Accepted": sum(1 for bid in bids if bid.status == Bid.BidStatus.ACCEPTED),
        "Rejected": sum(1 for bid in bids if bid.status == Bid.BidStatus.REJECTED),
    }

    active_tenders = [
        tender
        for tender in tenders
        if tender.status in {Tender.TenderStatus.PUBLISHED, Tender.TenderStatus.UNDER_REVIEW}
    ]
    avg_bid_price = (
        sum(float(bid.offered_price_ksh) for bid in bids if bid.status in VISIBLE_BID_STATUSES) / max(
            sum(1 for bid in bids if bid.status in VISIBLE_BID_STATUSES),
            1,
        )
        if bids
        else None
    )
    last_bid = max((bid.submitted_at or bid.created_at for bid in bids), default=None)
    response_density = len(bids) / max(len([tender for tender in tenders if tender.status != Tender.TenderStatus.DRAFT]), 1)

    return {
        "cards": [
            {
                "id": "pipeline_volume",
                "label": "Live Pipeline",
                "value": f"{_format_number(sum(float(tender.quantity_kg_max) for tender in active_tenders), 0)} kg",
                "helper_text": "Maximum committed demand across live tenders.",
                "tone": "primary",
            },
            {
                "id": "average_quote",
                "label": "Average Quote",
                "value": _format_currency_value(avg_bid_price),
                "helper_text": "Mean cooperative asking price across visible responses.",
                "tone": "accent",
            },
            {
                "id": "response_density",
                "label": "Responses / Tender",
                "value": _format_number(response_density, 1),
                "helper_text": "How many cooperative responses each tender attracts on average.",
                "tone": "default",
            },
            {
                "id": "live_buying_regions",
                "label": "Sourcing Regions",
                "value": str(len({tender.delivery_location for tender in active_tenders if tender.delivery_location})),
                "helper_text": "Distinct delivery locations across current sourcing cycles.",
                "tone": "default",
            },
        ],
        "highlights": [
            {
                "label": "Most active category",
                "value": max(category_counts.items(), key=lambda item: item[1])[0] if category_counts else "No tenders yet",
            },
            {
                "label": "Latest response",
                "value": timezone.localtime(last_bid).strftime("%d %b %Y · %H:%M") if last_bid else "No responses yet",
            },
            {
                "label": "Awarded tenders",
                "value": str(sum(1 for tender in tenders if tender.status == Tender.TenderStatus.AWARDED)),
            },
            {
                "label": "Under review",
                "value": str(sum(1 for tender in tenders if tender.status == Tender.TenderStatus.UNDER_REVIEW)),
            },
        ],
        "charts": [
            {
                "id": "buyer_tender_trend",
                "type": "timeline",
                "title": "Tender publishing trend",
                "description": "How many sourcing requests your team has taken live in the last six months.",
                "data": [
                    {"label": _month_label(month), "value": monthly_tenders[month]}
                    for month in month_starts
                ],
            },
            {
                "id": "buyer_bid_trend",
                "type": "line",
                "title": "Bid response trend",
                "description": "Measured response volume from cooperatives over the same period.",
                "data": [
                    {"label": _month_label(month), "value": monthly_bids[month]}
                    for month in month_starts
                ],
            },
            {
                "id": "buyer_category_mix",
                "type": "bar",
                "title": "Tender category mix",
                "description": "The product segments you are sourcing most often.",
                "data": [
                    {"label": label, "value": value}
                    for label, value in sorted(category_counts.items(), key=lambda item: (-item[1], item[0]))[:5]
                ],
            },
            {
                "id": "buyer_bid_status_mix",
                "type": "bar",
                "title": "Negotiation stage mix",
                "description": "Current spread of cooperative responses across your tender pipeline.",
                "data": [
                    {"label": label, "value": value}
                    for label, value in bid_status_counts.items()
                ],
            },
        ],
    }


def _parse_decimal(value, field_name: str, *, required: bool = True) -> Decimal | None:
    if value in (None, ""):
        if required:
            raise ValueError(f"{field_name} is required.")
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError):
        raise ValueError(f"{field_name} must be a valid number.")


def _parse_datetime(value, field_name: str) -> datetime:
    parsed = parse_datetime(str(value)) if value not in (None, "") else None
    if parsed is None:
        raise ValueError(f"{field_name} must be a valid date-time.")
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


def _parse_date(value, field_name: str):
    parsed = parse_date(str(value)) if value not in (None, "") else None
    if parsed is None:
        raise ValueError(f"{field_name} must be a valid date.")
    return parsed


def _latest_bid_for_cooperative(tender: Tender, cooperative: Cooperative) -> Bid | None:
    return (
        Bid.objects
        .filter(tender=tender, cooperative=cooperative)
        .select_related("cooperative", "cooperative__capacity_metric", "cooperative__reputation_score")
        .prefetch_related("documents")
        .order_by("-revision_number", "-created_at")
        .first()
    )


def _editable_bid_for_cooperative(tender: Tender, cooperative: Cooperative) -> Bid | None:
    return (
        Bid.objects
        .filter(tender=tender, cooperative=cooperative, status__in=EDITABLE_BID_STATUSES)
        .select_related("cooperative", "cooperative__capacity_metric", "cooperative__reputation_score")
        .prefetch_related("documents")
        .order_by("-revision_number", "-created_at")
        .first()
    )


def _cooperative_visible_tenders(cooperative: Cooperative):
    return (
        Tender.objects
        .select_related("buyer__user", "buyer__profile")
        .prefetch_related("documents")
        .filter(
            Q(status__in=[Tender.TenderStatus.PUBLISHED, Tender.TenderStatus.UNDER_REVIEW])
            | Q(bids__cooperative=cooperative)
        )
        .distinct()
    )


def _cooperative_can_submit_bid(
    *,
    tender: Tender,
    cooperative: Cooperative,
    eligibility: dict,
    active_bid: Bid | None,
) -> bool:
    if tender.status == Tender.TenderStatus.UNDER_REVIEW:
        return bool(active_bid and active_bid.status in EDITABLE_BID_STATUSES)

    if tender.status != Tender.TenderStatus.PUBLISHED or tender.bid_deadline <= timezone.now():
        return False

    if active_bid is not None:
        return active_bid.status in EDITABLE_BID_STATUSES

    return bool(eligibility["is_eligible"])


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def buyer_onboarding_status_view(request):
    (_, profile), error = _get_buyer_context(request.user)
    if error:
        return error
    return Response(_build_onboarding_payload(request.user, profile, request=request))


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def marketplace_dashboard_view(request):
    (buyer, profile), error = _get_buyer_context(request.user)
    if error:
        return error

    tenders = Tender.objects.filter(buyer=buyer)
    active_tenders = tenders.filter(status__in=[Tender.TenderStatus.PUBLISHED, Tender.TenderStatus.UNDER_REVIEW])
    recent_tenders = list(tenders.order_by("-published_at", "-created_at")[:4])

    bids = Bid.objects.filter(tender__buyer=buyer).select_related("cooperative", "tender")
    recent_bids = list(bids.order_by("-submitted_at", "-created_at")[:6])

    activity = []
    for bid in recent_bids:
        timestamp = bid.submitted_at or bid.created_at
        activity.append({
            "id": f"bid-{bid.id}",
            "type": "bid_received",
            "title": f"New response from {bid.cooperative.name}",
            "description": f"{bid.cooperative.name} responded to {bid.tender.title}.",
            "timestamp": timestamp.isoformat(),
            "href": f"/marketplace/tenders/{bid.tender_id}",
        })

    for tender in tenders.order_by("-updated_at")[:6]:
        if tender.status == Tender.TenderStatus.AWARDED and tender.closed_at:
            event_type = "tender_awarded"
            title = f"Tender awarded: {tender.title}"
            description = "This sourcing request has been awarded."
            timestamp = tender.closed_at
        elif tender.status == Tender.TenderStatus.CLOSED and tender.closed_at:
            event_type = "tender_closed"
            title = f"Tender closed: {tender.title}"
            description = "The bidding window is no longer open."
            timestamp = tender.closed_at
        elif tender.published_at:
            event_type = "tender_published"
            title = f"Tender published: {tender.title}"
            description = "This sourcing request is live in the marketplace."
            timestamp = tender.published_at
        else:
            continue
        activity.append({
            "id": f"tender-{tender.id}-{event_type}",
            "type": event_type,
            "title": title,
            "description": description,
            "timestamp": timestamp.isoformat(),
            "href": f"/marketplace/tenders/{tender.id}",
        })

    activity.sort(key=lambda item: item["timestamp"], reverse=True)
    onboarding = _build_onboarding_payload(request.user, profile, request=request)
    active_tenders_count = active_tenders.count()
    bids_received_count = bids.filter(status__in=VISIBLE_BID_STATUSES).count()
    shortlisted_count = bids.filter(status=Bid.BidStatus.SHORTLISTED).count()
    completed_tenders_count = tenders.filter(
        status__in=[Tender.TenderStatus.AWARDED, Tender.TenderStatus.CLOSED]
    ).count()
    draft_tenders_count = tenders.filter(status=Tender.TenderStatus.DRAFT).count()

    tender_count = tenders.count()
    if profile.total_tenders != tender_count:
        profile.total_tenders = tender_count
        profile.save(update_fields=["total_tenders"])

    return Response(
        {
            "summary": {
                "active_tenders": active_tenders_count,
                "bids_received": bids_received_count,
                "shortlisted": shortlisted_count,
                "completed_tenders": completed_tenders_count,
                "draft_tenders": draft_tenders_count,
                "profile_completion": onboarding["completion_percent"],
            },
            "hero_cards": [
                {
                    "id": "buyer_account",
                    "label": "Buyer account",
                    "value": profile.company_name or request.user.full_name or "Company pending",
                },
                {
                    "id": "profile_readiness",
                    "label": "Profile readiness",
                    "value": f"{onboarding['completion_percent']}% complete",
                },
            ],
            "summary_cards": [
                {
                    "id": "active_tenders",
                    "label": "Active Tenders",
                    "value": str(active_tenders_count),
                    "trend": "neutral",
                    "trend_value": "Open or under-review tenders currently live in the marketplace.",
                    "tone": "default",
                },
                {
                    "id": "responses",
                    "label": "Responses",
                    "value": str(bids_received_count),
                    "trend": "neutral",
                    "trend_value": "Visible cooperative submissions attached to your sourcing pipeline.",
                    "tone": "accent",
                },
                {
                    "id": "shortlisted",
                    "label": "Shortlisted",
                    "value": str(shortlisted_count),
                    "trend": "neutral",
                    "trend_value": "Buyer reviews that have moved into deeper commercial discussion.",
                    "tone": "default",
                },
                {
                    "id": "completed",
                    "label": "Completed",
                    "value": str(completed_tenders_count),
                    "trend": "neutral",
                    "trend_value": "Awarded or closed sourcing cycles already resolved by your team.",
                    "tone": "primary",
                },
                {
                    "id": "drafts",
                    "label": "Drafts",
                    "value": str(draft_tenders_count),
                    "trend": "neutral",
                    "trend_value": "Requests saved before they are published into the tender marketplace.",
                    "tone": "default",
                },
            ],
            "analytics": _build_buyer_dashboard_analytics(tenders, bids),
            "onboarding": {
                "is_complete": onboarding["is_complete"],
                "completion_percent": onboarding["completion_percent"],
                "missing_fields": onboarding["missing_fields"],
            },
            "featured_tenders": [_serialize_tender(tender) for tender in recent_tenders],
            "recent_activity": activity[:8],
        }
    )


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def tender_collection_view(request):
    (buyer, profile), error = _get_buyer_context(request.user)
    if error:
        return error

    if request.method == "POST":
        data = request.data
        status_value = (data.get("status") or Tender.TenderStatus.DRAFT).strip().upper()
        if status_value not in {Tender.TenderStatus.DRAFT, Tender.TenderStatus.PUBLISHED}:
            return Response({"error": "status must be DRAFT or PUBLISHED."}, status=400)

        try:
            quantity_kg_min = _parse_decimal(data.get("quantity_kg_min"), "quantity_kg_min")
            quantity_kg_max = _parse_decimal(data.get("quantity_kg_max"), "quantity_kg_max")
            if quantity_kg_min <= 0 or quantity_kg_max <= 0:
                raise ValueError("quantity_kg_min and quantity_kg_max must be greater than zero.")
            if quantity_kg_max < quantity_kg_min:
                raise ValueError("quantity_kg_max must be greater than or equal to quantity_kg_min.")

            delivery_start = _parse_date(data.get("delivery_start"), "delivery_start")
            delivery_end = _parse_date(data.get("delivery_end"), "delivery_end")
            if delivery_end < delivery_start:
                raise ValueError("delivery_end must be on or after delivery_start.")

            bid_deadline = _parse_datetime(data.get("bid_deadline"), "bid_deadline")
            if status_value == Tender.TenderStatus.PUBLISHED and bid_deadline <= timezone.now():
                raise ValueError("bid_deadline must be in the future for published tenders.")

            indicative_price_min_ksh = _parse_decimal(
                data.get("indicative_price_min_ksh"),
                "indicative_price_min_ksh",
                required=False,
            )
            indicative_price_max_ksh = _parse_decimal(
                data.get("indicative_price_max_ksh"),
                "indicative_price_max_ksh",
                required=False,
            )
            if (
                indicative_price_min_ksh is not None
                and indicative_price_max_ksh is not None
                and indicative_price_max_ksh < indicative_price_min_ksh
            ):
                raise ValueError("indicative_price_max_ksh must be greater than or equal to indicative_price_min_ksh.")
        except ValueError as exc:
            return Response({"error": str(exc)}, status=400)

        product_category = (data.get("product_category") or "").strip().upper()
        eligibility_tier = (data.get("eligibility_tier") or Tender.EligibilityTier.OPEN).strip().upper()
        if product_category not in {choice[0] for choice in Tender.ProductCategory.choices}:
            return Response({"error": "product_category is invalid."}, status=400)
        if eligibility_tier not in {choice[0] for choice in Tender.EligibilityTier.choices}:
            return Response({"error": "eligibility_tier is invalid."}, status=400)

        title = (data.get("title") or "").strip()
        product_name = (data.get("product_name") or "").strip()
        delivery_location = (data.get("delivery_location") or "").strip()
        if not title or not product_name or not delivery_location:
            return Response(
                {"error": "title, product_name, and delivery_location are required."},
                status=400,
            )
        try:
            min_capacity_index = int(data.get("min_capacity_index") or 60)
        except (TypeError, ValueError):
            return Response({"error": "min_capacity_index must be a whole number."}, status=400)
        if min_capacity_index < 0 or min_capacity_index > 100:
            return Response({"error": "min_capacity_index must be between 0 and 100."}, status=400)

        tender = Tender.objects.create(
            buyer=buyer,
            title=title,
            product_category=product_category,
            product_name=product_name,
            status=status_value,
            eligibility_tier=eligibility_tier,
            quantity_kg_min=quantity_kg_min,
            quantity_kg_max=quantity_kg_max,
            quality_specs=data.get("quality_specs") or "",
            delivery_location=delivery_location,
            delivery_start=delivery_start,
            delivery_end=delivery_end,
            bid_deadline=bid_deadline,
            indicative_price_min_ksh=indicative_price_min_ksh,
            indicative_price_max_ksh=indicative_price_max_ksh,
            published_at=timezone.now() if status_value == Tender.TenderStatus.PUBLISHED else None,
            min_capacity_index=min_capacity_index,
        )

        total_tenders = Tender.objects.filter(buyer=buyer).count()
        if profile.total_tenders != total_tenders:
            profile.total_tenders = total_tenders
            profile.save(update_fields=["total_tenders"])

        return Response(
            {
                "message": "Tender created successfully.",
                "tender": _serialize_tender(tender),
            },
            status=201,
        )

    search = (request.GET.get("search") or "").strip()
    status_filter = (request.GET.get("status") or "ALL").strip().upper()
    sort = (request.GET.get("sort") or "recent").strip().lower()

    tenders = Tender.objects.filter(buyer=buyer)
    if search:
        tenders = tenders.filter(
            Q(title__icontains=search)
            | Q(product_name__icontains=search)
            | Q(delivery_location__icontains=search)
        )
    if status_filter != "ALL":
        tenders = tenders.filter(status=status_filter)

    if sort == "deadline":
        tenders = tenders.order_by("bid_deadline", "-created_at")
    elif sort == "bids":
        tenders = tenders.order_by("-total_bids", "-published_at", "-created_at")
    else:
        tenders = tenders.order_by("-published_at", "-created_at")

    all_tenders = Tender.objects.filter(buyer=buyer)
    status_counts = {
        "ALL": all_tenders.count(),
        Tender.TenderStatus.DRAFT: all_tenders.filter(status=Tender.TenderStatus.DRAFT).count(),
        Tender.TenderStatus.PUBLISHED: all_tenders.filter(status=Tender.TenderStatus.PUBLISHED).count(),
        Tender.TenderStatus.UNDER_REVIEW: all_tenders.filter(status=Tender.TenderStatus.UNDER_REVIEW).count(),
        Tender.TenderStatus.AWARDED: all_tenders.filter(status=Tender.TenderStatus.AWARDED).count(),
        Tender.TenderStatus.CLOSED: all_tenders.filter(status=Tender.TenderStatus.CLOSED).count(),
        Tender.TenderStatus.CANCELLED: all_tenders.filter(status=Tender.TenderStatus.CANCELLED).count(),
    }
    onboarding = _build_onboarding_payload(request.user, profile)

    return Response(
        {
            "items": [_serialize_tender(tender) for tender in tenders[:50]],
            "total": tenders.count(),
            "filters": {
                "search": search,
                "status": status_filter,
                "sort": sort,
            },
            "status_counts": status_counts,
            "category_options": [
                {"value": value, "label": label}
                for value, label in Tender.ProductCategory.choices
            ],
            "eligibility_options": [
                {"value": value, "label": label}
                for value, label in Tender.EligibilityTier.choices
            ],
            "onboarding": {
                "is_complete": onboarding["is_complete"],
                "completion_percent": onboarding["completion_percent"],
            },
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def tender_detail_view(request, tender_id: str):
    (buyer, _), error = _get_buyer_context(request.user)
    if error:
        return error

    tender = (
        Tender.objects
        .filter(pk=tender_id, buyer=buyer)
        .prefetch_related("documents")
        .select_related("buyer__user", "buyer__profile")
        .first()
    )
    if tender is None:
        return Response({"error": "Tender not found."}, status=404)

    bids = list(
        Bid.objects
        .filter(tender=tender)
        .select_related(
            "cooperative",
            "cooperative__capacity_metric",
            "cooperative__reputation_score",
        )
        .prefetch_related("documents")
        .order_by("-submitted_at", "-created_at")
    )
    bid_summary = Bid.objects.filter(tender=tender).aggregate(average_price=Avg("offered_price_ksh"))
    message_summaries = _message_summary_for_buyer(tender)

    recent_messages = list(
        TenderMessage.objects
        .filter(tender=tender)
        .select_related("sender", "recipient_cooperative")
        .order_by("-created_at")[:8]
    )

    activity = []
    if tender.published_at:
        activity.append({
            "id": f"published-{tender.id}",
            "type": "tender_published",
            "title": "Tender published",
            "description": f"{tender.title} was published to the marketplace.",
            "timestamp": tender.published_at.isoformat(),
        })
    if tender.closed_at:
        activity.append({
            "id": f"closed-{tender.id}",
            "type": "tender_closed",
            "title": "Tender lifecycle updated",
            "description": f"{tender.title} moved to {tender.get_status_display().lower()}.",
            "timestamp": tender.closed_at.isoformat(),
        })
    for bid in bids[:6]:
        timestamp = bid.submitted_at or bid.created_at
        activity.append({
            "id": f"bid-{bid.id}",
            "type": "bid_received",
            "title": f"Bid received from {bid.cooperative.name}",
            "description": f"{bid.cooperative.name} quoted KES {float(bid.offered_price_ksh):,.2f}.",
            "timestamp": timestamp.isoformat(),
        })
    for message in recent_messages[:4]:
        description = message.body[:120] or (
            _file_metadata(request, message.attachment) or {}
        ).get("name", "Attachment shared")
        activity.append({
            "id": f"message-{message.id}",
            "type": "message",
            "title": f"Message from {message.sender.full_name}",
            "description": description,
            "timestamp": message.created_at.isoformat(),
        })
    activity.sort(key=lambda item: item["timestamp"], reverse=True)

    serialized_bids = []
    for bid in bids:
        summary = message_summaries.get(str(bid.cooperative_id), {})
        bid_payload = _serialize_bid(bid, request=request)
        bid_payload.update(summary)
        bid_payload["can_negotiate"] = bid.status in CHAT_READY_BID_STATUSES
        serialized_bids.append(bid_payload)

    return Response(
        {
            "viewer_role": "buyer",
            "tender": _serialize_tender(tender),
            "buyer": _buyer_company_snapshot(tender, request=request),
            "documents": [_serialize_tender_document(document, request=request) for document in tender.documents.all()],
            "bids_summary": {
                "total": len(bids),
                "submitted": sum(1 for bid in bids if bid.status == Bid.BidStatus.SUBMITTED),
                "shortlisted": sum(1 for bid in bids if bid.status == Bid.BidStatus.SHORTLISTED),
                "accepted": sum(1 for bid in bids if bid.status == Bid.BidStatus.ACCEPTED),
                "average_price_ksh": _decimal_to_float(bid_summary["average_price"]),
            },
            "bids": serialized_bids,
            "messages": [_serialize_message(message, request=request, viewer=request.user) for message in recent_messages],
            "activity": activity[:10],
        }
    )


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def tender_bid_status_view(request, tender_id: str, bid_id: str):
    (buyer, _), error = _get_buyer_context(request.user)
    if error:
        return error

    tender = Tender.objects.filter(pk=tender_id, buyer=buyer).first()
    if tender is None:
        return Response({"error": "Tender not found."}, status=404)

    bid = (
        Bid.objects
        .filter(pk=bid_id, tender=tender)
        .select_related("cooperative", "cooperative__chair")
        .prefetch_related("documents")
        .first()
    )
    if bid is None:
        return Response({"error": "Bid not found."}, status=404)

    next_status = (request.data.get("status") or "").strip().upper()
    allowed_statuses = {
        Bid.BidStatus.SUBMITTED,
        Bid.BidStatus.SHORTLISTED,
        Bid.BidStatus.ACCEPTED,
        Bid.BidStatus.REJECTED,
    }
    if next_status not in allowed_statuses:
        return Response({"error": "Invalid bid status transition."}, status=400)

    if tender.status in {Tender.TenderStatus.CANCELLED, Tender.TenderStatus.CLOSED}:
        return Response({"error": "This tender is no longer accepting bid decisions."}, status=400)

    if bid.status == Bid.BidStatus.ACCEPTED:
        return Response({"error": "The accepted bid cannot be changed from this screen."}, status=400)

    action_url = f"/crm/{bid.cooperative_id}/marketplace/{tender.id}"

    with transaction.atomic():
        bid.status = next_status
        bid.save(update_fields=["status", "updated_at"])

        if next_status == Bid.BidStatus.SHORTLISTED and tender.status == Tender.TenderStatus.PUBLISHED:
            tender.status = Tender.TenderStatus.UNDER_REVIEW
            tender.save(update_fields=["status", "updated_at"])
            notifications.create_notification(
                recipient=bid.cooperative.chair,
                cooperative=bid.cooperative,
                title="Bid shortlisted",
                message=f"Your bid for {tender.title} has been shortlisted for negotiation.",
                category="BID",
                event_type="bid_shortlisted",
                priority="HIGH",
                action_url=action_url,
                data={"tender_id": str(tender.id), "bid_id": str(bid.id)},
            )

        if next_status == Bid.BidStatus.REJECTED:
            notifications.create_notification(
                recipient=bid.cooperative.chair,
                cooperative=bid.cooperative,
                title="Bid update",
                message=f"Your bid for {tender.title} was not selected in its current form.",
                category="BID",
                event_type="bid_rejected",
                priority="NORMAL",
                action_url=action_url,
                data={"tender_id": str(tender.id), "bid_id": str(bid.id)},
            )

        if next_status == Bid.BidStatus.ACCEPTED:
            Bid.objects.filter(
                tender=tender,
            ).exclude(pk=bid.pk).filter(
                status__in=[
                    Bid.BidStatus.SUBMITTED,
                    Bid.BidStatus.SHORTLISTED,
                    Bid.BidStatus.DRAFT,
                ]
            ).update(status=Bid.BidStatus.REJECTED)
            tender.status = Tender.TenderStatus.AWARDED
            tender.closed_at = timezone.now()
            tender.save(update_fields=["status", "closed_at", "updated_at"])
            notifications.on_tender_event(
                email=bid.cooperative.chair.email if bid.cooperative.chair else "",
                phone=bid.cooperative.chair.phone_number if bid.cooperative.chair else "",
                recipient_name=bid.cooperative.name,
                tender_title=tender.title,
                tender_id=str(tender.id),
                event_type="bid_accepted",
                recipient_user=bid.cooperative.chair,
                cooperative=bid.cooperative,
                action_url=action_url,
            )

        _refresh_tender_bid_totals(tender)

    response_bid = _serialize_bid(bid, request=request)
    response_bid.update(_message_summary_for_buyer(tender).get(str(bid.cooperative_id), {}))

    return Response(
        {
            "message": "Bid status updated successfully.",
            "bid": response_bid,
            "tender": _serialize_tender(tender),
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def cooperative_marketplace_access_view(request):
    cooperative, error = _get_cooperative_context(
        request.user,
        require_marketplace_access=False,
    )
    if error:
        return error

    return Response(
        {
            "cooperative": {
                "id": str(cooperative.id),
                "name": cooperative.name,
            },
            "access": _cooperative_marketplace_access_snapshot(cooperative),
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def cooperative_marketplace_access_pay_view(request):
    cooperative, error = _get_cooperative_context(
        request.user,
        require_marketplace_access=False,
    )
    if error:
        return error

    current_access = _cooperative_marketplace_access_snapshot(cooperative)
    if current_access["has_access"]:
        return Response(
            {
                "message": "Tender marketplace access is already active.",
                "access": current_access,
            }
        )

    raw_phone = (request.data.get("phone_number") or current_access["billing_phone_number"] or "").strip()
    try:
        normalized_phone = normalize_sellapay_phone(raw_phone)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=400)

    amount_kes = _marketplace_access_price_kes()
    reference = _marketplace_payment_reference()
    description = f"Tender marketplace access for {cooperative.name}"[:255]

    try:
        provider_response = request_stk_push(
            amount=amount_kes,
            phone_number=normalized_phone,
            reference=reference,
            description=description,
        )
    except SellapayConfigurationError as exc:
        return Response({"error": str(exc)}, status=503)
    except SellapayApiError as exc:
        status_code = exc.status_code or 502
        return Response(
            {
                "error": str(exc),
                "provider": "SELLAPAY",
                "details": exc.payload,
            },
            status=status_code,
        )

    payment = TenderMarketplaceAccessPayment.objects.create(
        cooperative=cooperative,
        initiated_by=request.user,
        provider=TenderMarketplaceAccessPayment.Provider.SELLAPAY,
        status=TenderMarketplaceAccessPayment.Status.PENDING,
        reference=reference,
        amount_kes=amount_kes,
        phone_number=raw_phone,
        normalized_phone=normalized_phone,
        description=description,
        provider_transaction_id=str(provider_response.get("transaction_id") or ""),
        provider_message=str(provider_response.get("message") or ""),
        provider_response=provider_response,
    )

    return Response(
        {
            "message": "M-Pesa prompt sent. Complete the payment on your phone, then confirm access below.",
            "payment": _serialize_marketplace_access_payment(payment),
            "access": _cooperative_marketplace_access_snapshot(cooperative),
        },
        status=201,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def cooperative_marketplace_access_confirm_view(request):
    cooperative, error = _get_cooperative_context(
        request.user,
        require_marketplace_access=False,
    )
    if error:
        return error

    if _cooperative_has_marketplace_access(cooperative):
        return Response(
            {
                "message": "Tender marketplace access is already active.",
                "access": _cooperative_marketplace_access_snapshot(cooperative),
            }
        )

    reference = (request.data.get("reference") or "").strip()
    pending_payments = TenderMarketplaceAccessPayment.objects.filter(
        cooperative=cooperative,
        status=TenderMarketplaceAccessPayment.Status.PENDING,
        created_at__gte=timezone.now() - timedelta(minutes=30),
    )
    if reference:
        pending_payments = pending_payments.filter(reference=reference)

    payment = pending_payments.order_by("-created_at").first()
    if payment is None:
        return Response(
            {
                "error": "No recent pending marketplace payment was found. Start a new prompt and try again.",
            },
            status=400,
        )

    _activate_marketplace_access(cooperative, payment=payment)

    return Response(
        {
            "message": "Tender marketplace access activated.",
            "payment": _serialize_marketplace_access_payment(payment),
            "access": _cooperative_marketplace_access_snapshot(cooperative),
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def cooperative_tender_collection_view(request):
    cooperative, error = _get_cooperative_context(
        request.user,
        require_marketplace_access=True,
    )
    if error:
        return error

    search = (request.GET.get("search") or "").strip()
    status_filter = (request.GET.get("status") or "ALL").strip().upper()
    sort = (request.GET.get("sort") or "recent").strip().lower()

    tenders = _cooperative_visible_tenders(cooperative)
    if search:
        tenders = tenders.filter(
            Q(title__icontains=search)
            | Q(product_name__icontains=search)
            | Q(delivery_location__icontains=search)
            | Q(buyer__profile__company_name__icontains=search)
        )

    items = list(tenders)
    bid_lookup = {}
    for bid in (
        Bid.objects
        .filter(tender__in=items, cooperative=cooperative)
        .select_related("cooperative", "cooperative__capacity_metric", "cooperative__reputation_score")
        .prefetch_related("documents")
        .order_by("tender_id", "-revision_number", "-created_at")
    ):
        if bid.tender_id not in bid_lookup:
            bid_lookup[bid.tender_id] = bid
    unread_counts = defaultdict(int)
    for message in TenderMessage.objects.filter(
        tender__in=items,
        recipient_cooperative=cooperative,
        sender__user_type="BUYER",
        is_read=False,
    ):
        unread_counts[message.tender_id] += 1

    serialized_items = []
    for tender in items:
        my_bid = bid_lookup.get(tender.id)
        eligibility = _tender_eligibility(tender, cooperative)
        active_bid = my_bid if my_bid and my_bid.status in EDITABLE_BID_STATUSES else None
        item = _serialize_tender(tender)
        item.update({
            "buyer": _buyer_company_snapshot(tender, request=request),
            "eligibility": eligibility,
            "my_bid": _serialize_bid(my_bid, request=request) if my_bid else None,
            "can_submit_bid": _cooperative_can_submit_bid(
                tender=tender,
                cooperative=cooperative,
                eligibility=eligibility,
                active_bid=active_bid,
            ),
            "unread_messages": unread_counts[tender.id],
        })
        serialized_items.append(item)

    all_serialized_items = list(serialized_items)

    if status_filter == "OPEN":
        serialized_items = [
            item for item in serialized_items
            if item["status"] == Tender.TenderStatus.PUBLISHED and not item["is_deadline_passed"]
        ]
    elif status_filter == "NEGOTIATION":
        serialized_items = [
            item for item in serialized_items
            if (item["my_bid"] or {}).get("status") in {Bid.BidStatus.SUBMITTED, Bid.BidStatus.SHORTLISTED}
        ]
    elif status_filter == "AWARDED":
        serialized_items = [
            item for item in serialized_items
            if (item["my_bid"] or {}).get("status") == Bid.BidStatus.ACCEPTED
        ]
    elif status_filter == "MY_BIDS":
        serialized_items = [item for item in serialized_items if item["my_bid"] is not None]

    if sort == "deadline":
        serialized_items.sort(key=lambda item: (item["bid_deadline"], item["title"]))
    elif sort == "responses":
        serialized_items.sort(key=lambda item: (-item["total_bids"], item["title"]))
    else:
        serialized_items.sort(key=lambda item: item["published_at"] or item["created_at"], reverse=True)

    summary = {
        "open_tenders": sum(
            1
            for item in all_serialized_items
            if item["status"] == Tender.TenderStatus.PUBLISHED and not item["is_deadline_passed"]
        ),
        "eligible_now": sum(
            1
            for item in all_serialized_items
            if item["eligibility"]["is_eligible"] and item["status"] == Tender.TenderStatus.PUBLISHED and not item["is_deadline_passed"]
        ),
        "my_active_bids": sum(
            1
            for item in all_serialized_items
            if (item["my_bid"] or {}).get("status") in EDITABLE_BID_STATUSES
        ),
        "shortlisted_bids": sum(
            1
            for item in all_serialized_items
            if (item["my_bid"] or {}).get("status") == Bid.BidStatus.SHORTLISTED
        ),
        "awarded_bids": sum(
            1
            for item in all_serialized_items
            if (item["my_bid"] or {}).get("status") == Bid.BidStatus.ACCEPTED
        ),
        "unread_messages": sum(item["unread_messages"] for item in all_serialized_items),
    }
    hero_metrics = [
        {
            "id": "eligible_now",
            "label": "Eligible now",
            "value": str(summary["eligible_now"]),
        },
        {
            "id": "unread_chats",
            "label": "Unread chats",
            "value": str(summary["unread_messages"]),
        },
        {
            "id": "negotiation_live",
            "label": "Negotiation live",
            "value": str(
                sum(
                    1
                    for item in all_serialized_items
                    if (item["my_bid"] or {}).get("status")
                    in {Bid.BidStatus.SUBMITTED, Bid.BidStatus.SHORTLISTED}
                )
            ),
        },
        {
            "id": "awarded_bids",
            "label": "Awarded bids",
            "value": str(summary["awarded_bids"]),
        },
    ]
    summary_cards = [
        {
            "id": "open_briefs",
            "label": "Open briefs",
            "value": str(summary["open_tenders"]),
            "hint": "Published buyer tenders still receiving cooperative responses.",
        },
        {
            "id": "best_fit",
            "label": "Best-fit opportunities",
            "value": str(summary["eligible_now"]),
            "hint": "Tenders the cooperative is ready to respond to right now.",
        },
        {
            "id": "active_bids",
            "label": "Active bids",
            "value": str(summary["my_active_bids"]),
            "hint": "Draft, submitted, or shortlisted bids still moving through the pipeline.",
        },
        {
            "id": "negotiation_queue",
            "label": "Negotiation queue",
            "value": str(summary["shortlisted_bids"]),
            "hint": "Buyer conversations already inside deeper commercial review.",
        },
        {
            "id": "unread_conversations",
            "label": "Unread conversations",
            "value": str(summary["unread_messages"]),
            "hint": "Tender threads that still need your response from the buyer.",
        },
    ]

    return Response(
        {
            "summary": summary,
            "hero_metrics": hero_metrics,
            "summary_cards": summary_cards,
            "items": serialized_items[:50],
            "promotions": _active_marketplace_banners(
                placement=TenderMarketplaceBanner.Placement.COOPERATIVE_DISCOVER,
            ),
            "filters": {
                "search": search,
                "status": status_filter,
                "sort": sort,
            },
            "status_counts": {
                "ALL": len(all_serialized_items),
                "OPEN": sum(
                    1
                    for item in all_serialized_items
                    if item["status"] == Tender.TenderStatus.PUBLISHED and not item["is_deadline_passed"]
                ),
                "MY_BIDS": sum(1 for item in all_serialized_items if item["my_bid"] is not None),
                "NEGOTIATION": sum(
                    1
                    for item in all_serialized_items
                    if (item["my_bid"] or {}).get("status") in {Bid.BidStatus.SUBMITTED, Bid.BidStatus.SHORTLISTED}
                ),
                "AWARDED": sum(
                    1
                    for item in all_serialized_items
                    if (item["my_bid"] or {}).get("status") == Bid.BidStatus.ACCEPTED
                ),
            },
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def cooperative_tender_detail_view(request, tender_id: str):
    cooperative, error = _get_cooperative_context(
        request.user,
        require_marketplace_access=True,
    )
    if error:
        return error

    tender = _cooperative_visible_tenders(cooperative).filter(pk=tender_id).first()
    if tender is None:
        return Response({"error": "Tender not found."}, status=404)

    eligibility = _tender_eligibility(tender, cooperative)
    latest_bid = _latest_bid_for_cooperative(tender, cooperative)
    active_bid = _editable_bid_for_cooperative(tender, cooperative)
    bid_history = list(
        Bid.objects
        .filter(tender=tender, cooperative=cooperative)
        .select_related("cooperative", "cooperative__capacity_metric", "cooperative__reputation_score")
        .prefetch_related("documents")
        .order_by("-revision_number", "-created_at")
    )
    can_submit_bid = _cooperative_can_submit_bid(
        tender=tender,
        cooperative=cooperative,
        eligibility=eligibility,
        active_bid=active_bid,
    )
    message_summary = _message_summary_for_cooperative(tender, cooperative)
    recent_messages = list(_conversation_queryset(tender, cooperative).order_by("-created_at")[:6])

    return Response(
        {
            "viewer_role": "cooperative",
            "tender": _serialize_tender(tender),
            "buyer": _buyer_company_snapshot(tender, request=request),
            "cooperative": {
                "id": str(cooperative.id),
                "name": cooperative.name,
                "region": cooperative.region,
                **_cooperative_capacity_snapshot(cooperative),
            },
            "documents": [_serialize_tender_document(document, request=request) for document in tender.documents.all()],
            "eligibility": eligibility,
            "my_bid": _serialize_bid(active_bid or latest_bid, request=request) if (active_bid or latest_bid) else None,
            "bid_history": [_serialize_bid(bid, request=request) for bid in bid_history],
            "can_submit_bid": can_submit_bid,
            "can_chat": _has_chat_access(tender, cooperative),
            "message_summary": message_summary,
            "recent_messages": [
                _serialize_message(message, request=request, viewer=request.user)
                for message in reversed(recent_messages)
            ],
        }
    )


@api_view(["POST", "PATCH"])
@permission_classes([IsAuthenticated])
def cooperative_bid_view(request, tender_id: str):
    cooperative, error = _get_cooperative_context(
        request.user,
        require_marketplace_access=True,
    )
    if error:
        return error

    tender = _cooperative_visible_tenders(cooperative).filter(pk=tender_id).first()
    if tender is None:
        return Response({"error": "Tender not found."}, status=404)

    active_bid = _editable_bid_for_cooperative(tender, cooperative)
    latest_bid = _latest_bid_for_cooperative(tender, cooperative)
    eligibility = _tender_eligibility(tender, cooperative)

    if request.method == "PATCH":
        if active_bid is None:
            return Response({"error": "No editable bid is available for this tender."}, status=404)
        if active_bid.status == Bid.BidStatus.ACCEPTED:
            return Response({"error": "Accepted bids cannot be withdrawn."}, status=400)

        active_bid.status = Bid.BidStatus.WITHDRAWN
        active_bid.save(update_fields=["status", "updated_at"])
        _refresh_tender_bid_totals(tender)
        return Response(
            {
                "message": "Bid withdrawn successfully.",
                "bid": _serialize_bid(active_bid, request=request),
                "tender": _serialize_tender(tender),
            }
        )

    if not _cooperative_can_submit_bid(
        tender=tender,
        cooperative=cooperative,
        eligibility=eligibility,
        active_bid=active_bid,
    ):
        return Response({"error": eligibility["reason"]}, status=403)

    try:
        offered_quantity_kg = _parse_decimal(request.data.get("offered_quantity_kg"), "offered_quantity_kg")
        offered_price_ksh = _parse_decimal(request.data.get("offered_price_ksh"), "offered_price_ksh")
        proposed_delivery_date = _parse_date(request.data.get("proposed_delivery_date"), "proposed_delivery_date")
        if offered_quantity_kg <= 0:
            raise ValueError("offered_quantity_kg must be greater than zero.")
        if offered_price_ksh < 0:
            raise ValueError("offered_price_ksh must be zero or greater.")
        if proposed_delivery_date < tender.delivery_start or proposed_delivery_date > tender.delivery_end:
            raise ValueError("proposed_delivery_date must fall inside the tender delivery window.")
    except ValueError as exc:
        return Response({"error": str(exc)}, status=400)

    requested_status = (request.data.get("status") or Bid.BidStatus.SUBMITTED).strip().upper()
    if requested_status not in {Bid.BidStatus.DRAFT, Bid.BidStatus.SUBMITTED}:
        return Response({"error": "status must be DRAFT or SUBMITTED."}, status=400)
    if active_bid is not None and active_bid.status != Bid.BidStatus.DRAFT and requested_status == Bid.BidStatus.DRAFT:
        return Response({"error": "A submitted or shortlisted bid cannot be moved back to draft."}, status=400)

    if requested_status == Bid.BidStatus.SUBMITTED and tender.status == Tender.TenderStatus.PUBLISHED and tender.bid_deadline <= timezone.now():
        return Response({"error": "The bid deadline has already passed."}, status=400)

    with transaction.atomic():
        created = False
        if active_bid is not None:
            bid = active_bid
        else:
            created = True
            previous_bid = latest_bid if latest_bid else None
            next_revision = (latest_bid.revision_number + 1) if latest_bid else 1
            bid = Bid(
                tender=tender,
                cooperative=cooperative,
                submitted_by=request.user,
                previous_bid=previous_bid,
                revision_number=next_revision,
            )

        was_visible = bid.pk is not None and bid.status in VISIBLE_BID_STATUSES
        previous_status = bid.status if bid.pk else None
        bid.offered_quantity_kg = offered_quantity_kg
        bid.offered_price_ksh = offered_price_ksh
        bid.proposed_delivery_date = proposed_delivery_date
        bid.narrative = request.data.get("narrative") or ""
        bid.terms_notes = request.data.get("terms_notes") or ""
        bid.status = requested_status
        bid.submitted_by = request.user
        if requested_status == Bid.BidStatus.SUBMITTED:
            bid.submitted_at = timezone.now()
        bid.save()

        for file in request.FILES.getlist("documents"):
            BidDocument.objects.create(
                bid=bid,
                title=Path(getattr(file, "name", "document")).name,
                file=file,
                uploaded_by=request.user,
            )

        _refresh_tender_bid_totals(tender)

        just_became_visible = bid.status in VISIBLE_BID_STATUSES and not was_visible
        if just_became_visible:
            notifications.on_tender_event(
                email=tender.buyer.user.email,
                phone=tender.buyer.user.phone_number,
                recipient_name=_buyer_company_name(tender),
                tender_title=tender.title,
                tender_id=str(tender.id),
                event_type="new_bid",
                recipient_user=tender.buyer.user,
                action_url=f"/marketplace/tenders/{tender.id}",
            )
        elif previous_status == Bid.BidStatus.DRAFT and bid.status == Bid.BidStatus.SUBMITTED:
            notifications.on_tender_event(
                email=tender.buyer.user.email,
                phone=tender.buyer.user.phone_number,
                recipient_name=_buyer_company_name(tender),
                tender_title=tender.title,
                tender_id=str(tender.id),
                event_type="new_bid",
                recipient_user=tender.buyer.user,
                action_url=f"/marketplace/tenders/{tender.id}",
            )

    return Response(
        {
            "message": "Bid submitted successfully." if requested_status == Bid.BidStatus.SUBMITTED else "Bid draft saved.",
            "created_revision": created,
            "bid": _serialize_bid(bid, request=request),
            "tender": _serialize_tender(tender),
        },
        status=201 if created else 200,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def chat_threads_view(request):
    if not (request.user.is_buyer or request.user.is_chair):
        return Response(
            {"error": "Only buyer and cooperative chair accounts can access tender chat."},
            status=403,
        )
    if request.user.is_chair:
        _, error = _get_cooperative_context(
            request.user,
            require_marketplace_access=True,
        )
        if error:
            return error
    return Response(build_chat_inbox_payload(request.user, request=request))


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def tender_messages_view(request, tender_id: str):
    if request.user.is_chair:
        _, error = _get_cooperative_context(
            request.user,
            require_marketplace_access=True,
        )
        if error:
            return error

    cooperative_id = (
        request.data.get("cooperative_id")
        or request.query_params.get("cooperative_id")
        or ""
    ).strip() or None
    context, status_code, error_message = resolve_chat_thread_context(
        user=request.user,
        tender_id=tender_id,
        cooperative_id=cooperative_id,
    )
    if status_code is not None:
        return Response({"error": error_message}, status=status_code)

    tender = context["tender"]
    cooperative = context["cooperative"]
    conversation = _conversation_queryset(tender, cooperative)
    thread = serialize_chat_thread(
        tender=tender,
        cooperative=cooperative,
        viewer=request.user,
        request=request,
    )

    if request.method == "GET":
        now = timezone.now()
        if request.user.is_buyer:
            unread = conversation.filter(sender__cooperative=cooperative, is_read=False)
        else:
            unread = conversation.filter(
                sender=tender.buyer.user,
                recipient_cooperative=cooperative,
                is_read=False,
            )
        updated = unread.update(is_read=True, read_at=now)

        messages = list(conversation)
        if updated:
            broadcast_thread_read(
                tender=tender,
                cooperative=cooperative,
                actor=request.user,
                request=request,
            )
            thread = serialize_chat_thread(
                tender=tender,
                cooperative=cooperative,
                viewer=request.user,
                request=request,
            )

        return Response(
            {
                "conversation": {
                    "thread_id": thread["id"],
                    "tender_id": str(tender.id),
                    "tender_title": tender.title,
                    "buyer_company_name": _buyer_company_name(tender),
                    "cooperative_id": str(cooperative.id),
                    "cooperative_name": cooperative.name,
                    "can_send": thread["can_send"],
                    "message_count": len(messages),
                    "partner_user_id": thread["partner_user_id"],
                    "partner_name": thread["partner_name"],
                    "partner_avatar_url": thread["partner_avatar_url"],
                    "partner_is_online": thread["partner_is_online"],
                    "partner_last_seen_at": thread["partner_last_seen_at"],
                },
                "thread": thread,
                "messages": [_serialize_message(message, request=request, viewer=request.user) for message in messages],
            }
        )

    body = (request.data.get("body") or "").strip()
    attachment = request.FILES.get("attachment")
    if not body and attachment is None:
        return Response({"error": "Add a message or an attachment before sending."}, status=400)

    raw_metadata = request.data.get("metadata")
    metadata = {}
    if raw_metadata:
        try:
            metadata = json.loads(raw_metadata) if isinstance(raw_metadata, str) else dict(raw_metadata)
        except (TypeError, ValueError, json.JSONDecodeError):
            return Response({"error": "metadata must be valid JSON."}, status=400)

    requested_message_type = (request.data.get("message_type") or "").strip().upper() or None
    message_type = infer_message_type(
        requested_type=requested_message_type,
        attachment=attachment,
        body=body,
    )

    message = TenderMessage.objects.create(
        tender=tender,
        sender=request.user,
        recipient_cooperative=cooperative if request.user.is_buyer else None,
        body=body,
        message_type=message_type,
        metadata=metadata,
        attachment=attachment,
    )

    if request.user.is_buyer and cooperative.chair:
        notifications.create_notification(
            recipient=cooperative.chair,
            cooperative=cooperative,
            title=f"New negotiation message for {tender.title}",
            message=f"{request.user.full_name} {message_notification_snippet(message)} in the tender chat.",
            category="BID",
            event_type="tender_message",
            priority="HIGH",
            action_url=f"/crm/{cooperative.id}/marketplace/{tender.id}",
            data={"tender_id": str(tender.id)},
        )
    elif not request.user.is_buyer:
        notifications.create_notification(
            recipient=tender.buyer.user,
            title=f"New negotiation message for {tender.title}",
            message=f"{request.user.full_name} from {cooperative.name} {message_notification_snippet(message)}.",
            category="BID",
            event_type="tender_message",
            priority="HIGH",
            action_url=f"/marketplace/tenders/{tender.id}",
            data={"tender_id": str(tender.id), "cooperative_id": str(cooperative.id)},
        )

    broadcast_message_created(message, request=request)

    return Response(
        {
            "message": "Message sent successfully.",
            "item": _serialize_message(message, request=request, viewer=request.user),
            "thread": serialize_chat_thread(
                tender=tender,
                cooperative=cooperative,
                viewer=request.user,
                request=request,
            ),
            "inbox": {
                "unread_messages": total_unread_messages_for_user(request.user),
            },
        },
        status=201,
    )
