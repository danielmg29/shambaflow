from __future__ import annotations

from datetime import timedelta
import mimetypes
from pathlib import Path
from typing import Any

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.core.cache import cache
from django.db.models import Q
from django.utils import timezone

from core.models import Bid, Cooperative, Tender, TenderMessage, User

CHAT_READY_BID_STATUSES = (
    Bid.BidStatus.SUBMITTED,
    Bid.BidStatus.SHORTLISTED,
    Bid.BidStatus.ACCEPTED,
)

CHAT_PRESENCE_TTL_SECONDS = 75
CHAT_PRESENCE_OFFLINE_TTL_SECONDS = 60 * 60 * 24
CHAT_ACTIVITY_TTL_SECONDS = 12


def thread_id_for(tender_id: str | Tender, cooperative_id: str | Cooperative) -> str:
    tender_pk = str(tender_id.pk if hasattr(tender_id, "pk") else tender_id)
    cooperative_pk = str(cooperative_id.pk if hasattr(cooperative_id, "pk") else cooperative_id)
    return f"{tender_pk}:{cooperative_pk}"


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


def _file_metadata(request, file_field) -> dict[str, Any] | None:
    try:
        raw_name = file_field.name or ""
    except Exception:
        raw_name = ""
    url = _absolute_media_url(request, file_field)
    if not raw_name and not url:
        return None
    name = Path(raw_name).name or "attachment"
    media_type, _ = mimetypes.guess_type(name)

    if media_type and media_type.startswith("image/"):
        kind = "image"
    elif media_type and media_type.startswith("video/"):
        kind = "video"
    elif media_type and media_type.startswith("audio/"):
        kind = "audio"
    else:
        kind = "document"

    return {
        "url": url,
        "name": name,
        "media_type": media_type,
        "kind": kind,
    }


def infer_message_type(
    *,
    requested_type: str | None = None,
    attachment=None,
    body: str = "",
) -> str:
    explicit = (requested_type or "").strip().upper()
    if explicit in {choice[0] for choice in TenderMessage.MessageType.choices}:
        return explicit

    attachment_metadata = _file_metadata(None, attachment) if attachment else None
    attachment_kind = attachment_metadata["kind"] if attachment_metadata else None
    if attachment_kind == "image":
        return TenderMessage.MessageType.IMAGE
    if attachment_kind == "video":
        return TenderMessage.MessageType.VIDEO
    if attachment_kind == "audio":
        return TenderMessage.MessageType.AUDIO
    if attachment_kind == "document":
        return TenderMessage.MessageType.DOCUMENT
    return TenderMessage.MessageType.TEXT if body.strip() else TenderMessage.MessageType.DOCUMENT


def message_preview(message: TenderMessage | None) -> str:
    if message is None:
        return "No messages yet. Start the negotiation thread."

    body = (message.body or "").strip()
    if body:
        return body[:120]

    labels = {
        TenderMessage.MessageType.IMAGE: "Image shared",
        TenderMessage.MessageType.VIDEO: "Video shared",
        TenderMessage.MessageType.AUDIO: "Voice message",
        TenderMessage.MessageType.DOCUMENT: "Document shared",
    }
    return labels.get(message.message_type, "Attachment shared")


def message_notification_snippet(message: TenderMessage) -> str:
    labels = {
        TenderMessage.MessageType.TEXT: "sent a new message",
        TenderMessage.MessageType.IMAGE: "shared an image",
        TenderMessage.MessageType.VIDEO: "shared a video",
        TenderMessage.MessageType.AUDIO: "sent a voice message",
        TenderMessage.MessageType.DOCUMENT: "shared a document",
    }
    return labels.get(message.message_type, "sent a new message")


def buyer_company_name(tender: Tender) -> str:
    profile = getattr(tender.buyer, "profile", None)
    if profile and profile.company_name:
        return profile.company_name
    return tender.buyer.user.full_name


def _user_avatar_url(user: User | None, request=None) -> str | None:
    if user is None:
        return None
    try:
        if user.is_buyer:
            return _absolute_media_url(request, user.buyer_profile.company_logo)
        if user.is_chair:
            return _absolute_media_url(request, user.chair_profile.profile_photo)
    except Exception:
        return None
    return None


def conversation_queryset(tender: Tender, cooperative: Cooperative):
    return (
        TenderMessage.objects
        .filter(tender=tender)
        .filter(
            Q(sender__cooperative=cooperative)
            | Q(sender=tender.buyer.user, recipient_cooperative=cooperative)
        )
        .select_related("sender", "recipient_cooperative")
        .order_by("created_at")
    )


def has_chat_access(tender: Tender, cooperative: Cooperative) -> bool:
    return Bid.objects.filter(
        tender=tender,
        cooperative=cooperative,
        status__in=CHAT_READY_BID_STATUSES,
    ).exists()


def _presence_cache_key(user_id: str) -> str:
    return f"marketplace_chat:presence:{user_id}"


def mark_chat_presence(user: User, *, active_thread_id: str | None = None) -> dict[str, Any]:
    payload = {
        "user_id": str(user.id),
        "is_online": True,
        "last_seen_at": timezone.now().isoformat(),
        "active_thread_id": active_thread_id,
    }
    cache.set(_presence_cache_key(str(user.id)), payload, timeout=CHAT_PRESENCE_TTL_SECONDS)
    return payload


def clear_chat_presence(user: User) -> dict[str, Any]:
    payload = {
        "user_id": str(user.id),
        "is_online": False,
        "last_seen_at": timezone.now().isoformat(),
        "active_thread_id": None,
    }
    cache.set(
        _presence_cache_key(str(user.id)),
        payload,
        timeout=CHAT_PRESENCE_OFFLINE_TTL_SECONDS,
    )
    return payload


def presence_snapshot(user: User | str) -> dict[str, Any]:
    user_id = str(user.id) if isinstance(user, User) else str(user)
    cached = cache.get(_presence_cache_key(user_id)) or {}
    last_seen_at = cached.get("last_seen_at")
    is_online = bool(cached.get("is_online"))
    if last_seen_at:
        try:
            last_seen = timezone.datetime.fromisoformat(last_seen_at)
            if timezone.is_naive(last_seen):
                last_seen = timezone.make_aware(last_seen, timezone.get_current_timezone())
            if timezone.now() - last_seen > timedelta(seconds=CHAT_PRESENCE_TTL_SECONDS):
                is_online = False
        except Exception:
            is_online = False
    return {
        "user_id": user_id,
        "is_online": is_online,
        "last_seen_at": last_seen_at,
        "active_thread_id": cached.get("active_thread_id"),
    }


def is_chat_user_online(user: User | str | None) -> bool:
    if user is None:
        return False
    return bool(presence_snapshot(user)["is_online"])


def serialize_chat_message(message: TenderMessage, request=None, viewer: User | None = None) -> dict[str, Any]:
    sender = message.sender
    recipient_cooperative = message.recipient_cooperative
    attachment = _file_metadata(request, message.attachment)
    metadata = dict(message.metadata or {})
    return {
        "id": str(message.id),
        "thread_id": thread_id_for(
            message.tender_id,
            sender.cooperative_id or recipient_cooperative_id(recipient_cooperative),
        ),
        "sender_id": str(sender.id),
        "sender_name": sender.full_name,
        "sender_type": sender.user_type,
        "sender_cooperative_id": str(sender.cooperative_id) if sender.cooperative_id else None,
        "sender_avatar_url": _user_avatar_url(sender, request=request),
        "recipient_cooperative_id": recipient_cooperative_id(recipient_cooperative),
        "recipient_cooperative": recipient_cooperative.name if recipient_cooperative else None,
        "body": message.body,
        "message_type": message.message_type,
        "metadata": metadata,
        "attachment": attachment,
        "preview_text": message_preview(message),
        "is_read": message.is_read,
        "read_at": message.read_at.isoformat() if message.read_at else None,
        "created_at": message.created_at.isoformat(),
        "is_mine": bool(viewer and sender.id == viewer.id),
    }


def recipient_cooperative_id(recipient_cooperative: Cooperative | None) -> str | None:
    return str(recipient_cooperative.id) if recipient_cooperative else None


def _thread_unread_count(viewer: User, tender: Tender, cooperative: Cooperative) -> int:
    conversation = conversation_queryset(tender, cooperative)
    if viewer.is_buyer:
        return conversation.filter(sender__cooperative=cooperative, is_read=False).count()
    return conversation.filter(
        sender=tender.buyer.user,
        recipient_cooperative=cooperative,
        is_read=False,
    ).count()


def _thread_partner_user(viewer: User, tender: Tender, cooperative: Cooperative) -> User | None:
    if viewer.is_buyer:
        return cooperative.chair
    return tender.buyer.user


def serialize_chat_thread(
    *,
    tender: Tender,
    cooperative: Cooperative,
    viewer: User,
    request=None,
    fallback_activity_at=None,
) -> dict[str, Any]:
    messages = list(conversation_queryset(tender, cooperative))
    last_message = messages[-1] if messages else None
    unread_messages = _thread_unread_count(viewer, tender, cooperative)
    partner = _thread_partner_user(viewer, tender, cooperative)
    partner_presence = presence_snapshot(partner) if partner else {
        "user_id": None,
        "is_online": False,
        "last_seen_at": None,
        "active_thread_id": None,
    }

    last_activity = last_message.created_at if last_message else fallback_activity_at
    href = (
        f"/marketplace/tenders/{tender.id}"
        if viewer.is_buyer
        else f"/crm/{cooperative.id}/marketplace/{tender.id}"
    )
    return {
        "id": thread_id_for(tender.id, cooperative.id),
        "tender_id": str(tender.id),
        "tender_title": tender.title,
        "tender_status": tender.status,
        "tender_status_display": tender.get_status_display(),
        "cooperative_id": str(cooperative.id),
        "cooperative_name": cooperative.name,
        "buyer_company_name": buyer_company_name(tender),
        "viewer_role": "buyer" if viewer.is_buyer else "cooperative",
        "partner_user_id": str(partner.id) if partner else None,
        "partner_name": partner.full_name if partner else cooperative.name if viewer.is_buyer else buyer_company_name(tender),
        "partner_role": "CHAIR" if viewer.is_buyer else "BUYER",
        "partner_avatar_url": _user_avatar_url(partner, request=request),
        "partner_is_online": bool(partner_presence["is_online"]),
        "partner_last_seen_at": partner_presence["last_seen_at"],
        "messages_count": len(messages),
        "unread_messages": unread_messages,
        "last_message_at": last_activity.isoformat() if last_activity else None,
        "last_message_type": last_message.message_type if last_message else None,
        "last_message_preview": message_preview(last_message),
        "last_message_sender_name": last_message.sender.full_name if last_message else None,
        "can_send": has_chat_access(tender, cooperative),
        "href": href,
    }


def total_unread_messages_for_user(user: User) -> int:
    if user.is_buyer:
        return TenderMessage.objects.filter(
            tender__buyer__user=user,
            sender__cooperative__isnull=False,
            is_read=False,
        ).count()
    if user.is_chair and user.cooperative_id:
        return TenderMessage.objects.filter(
            recipient_cooperative_id=user.cooperative_id,
            sender__user_type=User.UserType.BUYER,
            is_read=False,
        ).count()
    return 0


def build_chat_threads_for_user(user: User, request=None) -> list[dict[str, Any]]:
    if user.is_buyer:
        bids = list(
            Bid.objects
            .filter(tender__buyer__user=user, status__in=CHAT_READY_BID_STATUSES)
            .select_related(
                "cooperative",
                "cooperative__chair",
                "cooperative__chair__chair_profile",
                "tender",
                "tender__buyer__user",
                "tender__buyer__profile",
            )
            .order_by("-submitted_at", "-updated_at")
        )
        items = [
            serialize_chat_thread(
                tender=bid.tender,
                cooperative=bid.cooperative,
                viewer=user,
                request=request,
                fallback_activity_at=bid.updated_at,
            )
            for bid in bids
        ]
    elif user.is_chair and user.cooperative_id:
        bids = list(
            Bid.objects
            .filter(cooperative_id=user.cooperative_id, status__in=CHAT_READY_BID_STATUSES)
            .select_related(
                "cooperative",
                "tender",
                "tender__buyer__user",
                "tender__buyer__profile",
                "tender__buyer__profile__user",
            )
            .order_by("-submitted_at", "-updated_at")
        )
        cooperative = Cooperative.objects.select_related("chair").filter(pk=user.cooperative_id).first()
        items = []
        if cooperative is not None:
            items = [
                serialize_chat_thread(
                    tender=bid.tender,
                    cooperative=cooperative,
                    viewer=user,
                    request=request,
                    fallback_activity_at=bid.updated_at,
                )
                for bid in bids
            ]
    else:
        return []

    items.sort(key=lambda item: item["last_message_at"] or "", reverse=True)
    return items


def build_chat_inbox_payload(user: User, request=None) -> dict[str, Any]:
    threads = build_chat_threads_for_user(user, request=request)
    return {
        "viewer_role": "buyer" if user.is_buyer else "cooperative",
        "summary": {
            "threads_count": len(threads),
            "unread_messages": sum(item["unread_messages"] for item in threads),
            "online_threads": sum(1 for item in threads if item["partner_is_online"]),
        },
        "threads": threads,
    }


def resolve_chat_thread_context(
    *,
    user: User,
    tender_id: str,
    cooperative_id: str | None = None,
) -> tuple[dict[str, Any] | None, int | None, str | None]:
    tender = (
        Tender.objects
        .select_related("buyer__user", "buyer__profile")
        .filter(pk=tender_id)
        .first()
    )
    if tender is None:
        return None, 404, "Tender not found."

    if user.is_buyer:
        if tender.buyer.user_id != user.id:
            return None, 404, "Tender not found."
        if not cooperative_id:
            return None, 400, "cooperative_id is required for buyer conversations."
        cooperative = Cooperative.objects.select_related("chair").filter(pk=cooperative_id).first()
        if cooperative is None:
            return None, 404, "Cooperative not found."
    elif user.is_chair and user.cooperative_id:
        cooperative = Cooperative.objects.select_related("chair").filter(pk=user.cooperative_id).first()
        if cooperative is None:
            return None, 404, "Cooperative not found."
        visible = Bid.objects.filter(tender=tender, cooperative=cooperative).exists() or tender.bids.filter(cooperative=cooperative).exists()
        if not visible:
            return None, 404, "Tender not found."
    else:
        return None, 403, "Only buyer and cooperative chair accounts can access tender chat."

    if not has_chat_access(tender, cooperative):
        return None, 403, "Messages open once a cooperative has submitted a bid."

    return {
        "tender": tender,
        "cooperative": cooperative,
        "viewer_role": "buyer" if user.is_buyer else "cooperative",
        "thread_id": thread_id_for(tender.id, cooperative.id),
    }, None, None


def _chat_group_name(user_id: str) -> str:
    return f"marketplace_chat_user_{user_id}"


def send_chat_event(user_ids: set[str] | list[str], event: str, payload: dict[str, Any]) -> None:
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return

    for user_id in {str(item) for item in user_ids if item}:
        try:
            async_to_sync(channel_layer.group_send)(
                _chat_group_name(user_id),
                {
                    "type": "chat_event",
                    "event": event,
                    **payload,
                },
            )
        except Exception:
            continue


def _chat_partners_for_user(user: User) -> set[str]:
    if user.is_buyer:
        return {
            str(chair_id)
            for chair_id in Bid.objects.filter(
                tender__buyer__user=user,
                status__in=CHAT_READY_BID_STATUSES,
                cooperative__chair__isnull=False,
            ).values_list("cooperative__chair_id", flat=True)
            if chair_id
        }
    if user.is_chair and user.cooperative_id:
        return {
            str(user_id)
            for user_id in Bid.objects.filter(
                cooperative_id=user.cooperative_id,
                status__in=CHAT_READY_BID_STATUSES,
            ).values_list("tender__buyer__user_id", flat=True)
            if user_id
        }
    return set()


def broadcast_presence_changed(user: User, *, is_online: bool) -> None:
    send_chat_event(
        _chat_partners_for_user(user),
        "chat.presence.changed",
        {
            "presence": {
                **presence_snapshot(user),
                "is_online": is_online,
                "user_name": user.full_name,
            },
        },
    )


def broadcast_chat_activity(
    *,
    tender: Tender,
    cooperative: Cooperative,
    actor: User,
    activity: str,
) -> None:
    partner = tender.buyer.user if actor.cooperative_id else cooperative.chair
    if partner is None:
        return
    send_chat_event(
        {str(partner.id)},
        "chat.activity.changed",
        {
            "thread_id": thread_id_for(tender.id, cooperative.id),
            "activity": {
                "user_id": str(actor.id),
                "user_name": actor.full_name,
                "state": activity,
                "expires_in_seconds": CHAT_ACTIVITY_TTL_SECONDS,
                "tender_id": str(tender.id),
                "cooperative_id": str(cooperative.id),
            },
        },
    )


def _chat_event_viewers(tender: Tender, cooperative: Cooperative) -> list[User]:
    viewers: list[User] = []
    if tender.buyer.user_id:
        viewers.append(tender.buyer.user)
    if cooperative.chair_id:
        viewers.append(cooperative.chair)
    return viewers


def broadcast_message_created(message: TenderMessage, request=None) -> None:
    cooperative = (
        message.sender.cooperative
        if message.sender.cooperative_id
        else message.recipient_cooperative
    )
    if cooperative is None:
        return

    for viewer in _chat_event_viewers(message.tender, cooperative):
        thread = serialize_chat_thread(
            tender=message.tender,
            cooperative=cooperative,
            viewer=viewer,
            request=request,
        )
        send_chat_event(
            {str(viewer.id)},
            "chat.message.created",
            {
                "thread": thread,
                "message": serialize_chat_message(message, request=request, viewer=viewer),
                "inbox": {
                    "unread_messages": total_unread_messages_for_user(viewer),
                },
            },
        )


def broadcast_thread_read(
    *,
    tender: Tender,
    cooperative: Cooperative,
    actor: User,
    request=None,
) -> None:
    viewers = [viewer for viewer in _chat_event_viewers(tender, cooperative) if viewer is not None]
    for viewer in viewers:
        send_chat_event(
            {str(viewer.id)},
            "chat.thread.read",
            {
                "thread": serialize_chat_thread(
                    tender=tender,
                    cooperative=cooperative,
                    viewer=viewer,
                    request=request,
                ),
                "reader_user_id": str(actor.id),
                "inbox": {
                    "unread_messages": total_unread_messages_for_user(viewer),
                },
            },
        )
